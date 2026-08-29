import { randomUUID } from "node:crypto";

import {
  CaptureScope,
  CuaDriver,
  EffectiveScope,
  type CuaDriverLike,
} from "@trycua/cua-driver";

import { ComputerUseError } from "../errors.js";
import { mapAction } from "./action-mapper.js";
import {
  parseAppList,
  parseDesktopObservation,
  parseHealth,
  parseLaunchResult,
  parseWindowList,
  parseWindowState,
} from "./cua-json.js";
import type { EngineLock } from "./lock.js";
import type {
  EngineDesktopObservation,
  EngineAction,
  EngineDiscoverInput,
  EngineDiscovery,
  EngineExecution,
  EngineObservation,
  EngineObserveInput,
  EnginePort,
} from "./port.js";
import { mapCuaResult } from "./result-mapper.js";

export type CuaSdkLike = Pick<
  CuaDriverLike,
  "metadata" | "listToolsJson" | "startSession" | "callTool" | "endSession"
>;

function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function cancellableWait(waitMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, waitMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function supportedPlatform(): "macos" | "windows" {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  throw new ComputerUseError("unsupported_platform", "Unsupported host platform", "stop", false);
}

export function assertPreciseWindowSupport(platform: "macos" | "windows"): void {
  if (platform === "windows") {
    throw new ComputerUseError(
      "unsupported_platform",
      "Precise app and window tools are unavailable on Windows in locked Cua 0.22.2",
      "stop",
      false,
    );
  }
}

export class CuaEngine implements EnginePort {
  readonly name = "cua-driver" as const;

  private constructor(
    private readonly sdk: CuaSdkLike,
    readonly version: string,
    readonly sessionId: string,
    private readonly windowSessionId: string,
  ) {}

  static async connect(lock: EngineLock): Promise<CuaEngine> {
    let sdk: CuaSdkLike;
    try {
      sdk = CuaDriver.connect(undefined);
    } catch {
      throw new ComputerUseError(
        "runtime_unavailable",
        "Cua Driver daemon is unavailable",
        "doctor",
        true,
      );
    }

    return CuaEngine.fromSdk(sdk, lock);
  }

  static async fromSdk(sdk: CuaSdkLike, lock: EngineLock): Promise<CuaEngine> {
    const metadata = await sdk.metadata();
    if (metadata.driverVersion !== lock.version) {
      throw new ComputerUseError(
        "engine_version_mismatch",
        "Installed Cua version differs from engine.lock.json",
        "setup",
        false,
      );
    }

    let inventory: unknown;
    try {
      inventory = JSON.parse(await sdk.listToolsJson()) as unknown;
    } catch {
      throw new ComputerUseError(
        "engine_version_mismatch",
        "Cua tool contract is malformed",
        "setup",
        false,
      );
    }
    const tools =
      typeof inventory === "object" && inventory !== null && "tools" in inventory
        ? inventory.tools
        : undefined;
    const availableTools = new Set(
      Array.isArray(tools)
        ? tools.flatMap((tool: unknown) =>
            typeof tool === "object" &&
            tool !== null &&
            "name" in tool &&
            typeof tool.name === "string"
              ? [tool.name]
              : [],
          )
        : [],
    );
    if (lock.required_tools.some((name) => !availableTools.has(name))) {
      throw new ComputerUseError(
        "engine_version_mismatch",
        "Cua tool contract is incomplete",
        "setup",
        false,
      );
    }

    const publicSession = `ucu_${randomUUID()}`;
    const starts = await Promise.allSettled([
      sdk.startSession({
        session: publicSession,
        captureScope: CaptureScope.Desktop,
      }),
      sdk.startSession({
        session: `${publicSession}_window`,
        captureScope: CaptureScope.Window,
      }),
    ]);
    const activeSessions = starts.flatMap((start) => start.status === "fulfilled" ? [start.value.state.session] : []);
    const desktop = starts[0];
    const window = starts[1];
    const validDesktop = desktop?.status === "fulfilled" &&
      desktop.value.state.captureScope === CaptureScope.Desktop &&
      desktop.value.state.effectiveScope === EffectiveScope.Desktop;
    const validWindow = window?.status === "fulfilled" &&
      window.value.state.captureScope === CaptureScope.Window &&
      window.value.state.effectiveScope === EffectiveScope.Window;
    if (!validDesktop || !validWindow) {
      await Promise.allSettled([...activeSessions].reverse().map(async (session) => sdk.endSession({ session })));
      const rejected = starts.find((start): start is PromiseRejectedResult => start.status === "rejected");
      if (rejected !== undefined) throw rejected.reason;
      throw new ComputerUseError(
        "engine_version_mismatch",
        "Cua did not establish the required desktop and window scopes",
        "setup",
        false,
      );
    }

    return new CuaEngine(sdk, lock.version, desktop.value.state.session, window.value.state.session);
  }

  async discover(input: EngineDiscoverInput, signal: AbortSignal): Promise<EngineDiscovery> {
    if (!input.apps && !input.windows) return { apps: [], windows: [] };
    const platform = supportedPlatform();
    assertPreciseWindowSupport(platform);
    if (!input.windows) {
      const appsResult = await this.sdk.callTool("list_apps", "{}", { signal });
      return { apps: input.apps ? parseAppList(appsResult, platform) : [], windows: [] };
    }
    const [appsResult, windowsResult] = await Promise.all([
      this.sdk.callTool("list_apps", "{}", { signal }),
      this.sdk.callTool("list_windows", "{}", { signal }),
    ]);
    const apps = parseAppList(appsResult, platform);
    const windows = parseWindowList(windowsResult, apps, platform);
    return { apps: input.apps ? apps : [], windows };
  }

  async observe(signal: AbortSignal): Promise<EngineDesktopObservation>;
  async observe(input: EngineObserveInput, signal: AbortSignal): Promise<EngineObservation>;
  async observe(
    inputOrSignal: EngineObserveInput | AbortSignal,
    maybeSignal?: AbortSignal,
  ): Promise<EngineObservation> {
    if (inputOrSignal instanceof AbortSignal) {
      const result = await this.sdk.callTool(
        "get_desktop_state",
        JSON.stringify({ session: this.sessionId }),
        { signal: inputOrSignal },
      );
      return parseDesktopObservation(result);
    }
    const signal = maybeSignal;
    if (signal === undefined) throw new TypeError("observe signal is required");
    const input = inputOrSignal as EngineObserveInput;
    if (input.target.kind === "desktop") {
      const result = await this.sdk.callTool(
        "get_desktop_state",
        JSON.stringify({ session: this.sessionId }),
        { signal },
      );
      return parseDesktopObservation(result);
    }
    const windowInput = input as Extract<EngineObserveInput, { target: { kind: "window" } }>;
    assertPreciseWindowSupport(supportedPlatform());
    const native = windowInput.target.window.native;
    const pid = native.pid;
    const windowId = native.window_id;
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(windowId)) {
      throw new ComputerUseError("engine_contract_changed", "Window target has invalid native identifiers", "doctor", false);
    }
    const result = await this.sdk.callTool(
      "get_window_state",
      JSON.stringify({
        session: this.windowSessionId,
        pid,
        window_id: windowId,
        include_screenshot: windowInput.includeScreenshot,
        ...(windowInput.query === undefined ? {} : { query: windowInput.query }),
        max_elements: windowInput.maxElements,
        max_depth: windowInput.maxDepth,
      }),
      { signal },
    );
    return parseWindowState(result, windowInput.target.window, windowInput.includeScreenshot);
  }

  async execute(action: EngineAction, signal: AbortSignal): Promise<EngineExecution> {
    const mapped = mapAction(
      action,
      action.target.kind === "desktop" ? this.sessionId : this.windowSessionId,
    );
    if ("waitMs" in mapped) {
      await cancellableWait(mapped.waitMs, signal);
      return {
        status: "executed",
        effect: "confirmed",
        route: "system_api",
        delivery: "not_applicable",
      };
    }

    const result = await this.sdk.callTool(
      mapped.tool,
      JSON.stringify(mapped.args),
      { signal },
    );
    if (action.target.kind === "app" && !result.isError) {
      return parseLaunchResult(result, action.target.app);
    }
    return mapCuaResult(result);
  }

  async health(signal: AbortSignal): Promise<boolean> {
    const result = await this.sdk.callTool(
      "health_report",
      JSON.stringify({ include: ["binary_version", "platform_supported", "session_active"] }),
      { signal },
    );
    return parseHealth(result, this.version);
  }

  async close(): Promise<void> {
    const closed = await Promise.allSettled([
      this.sdk.endSession({ session: this.windowSessionId }),
      this.sdk.endSession({ session: this.sessionId }),
    ]);
    const rejected = closed.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (rejected !== undefined) throw rejected.reason;
  }
}
