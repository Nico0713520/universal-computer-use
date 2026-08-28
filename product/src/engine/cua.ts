import { randomUUID } from "node:crypto";

import {
  CaptureScope,
  CuaDriver,
  EffectiveScope,
  type CuaDriverLike,
} from "@trycua/cua-driver";

import { ComputerUseError } from "../errors.js";
import type { ComputerAction } from "../protocol.js";
import { mapAction } from "./action-mapper.js";
import {
  parseAppList,
  parseDesktopObservation,
  parseHealth,
  parseWindowList,
  parseWindowState,
} from "./cua-json.js";
import type { EngineLock } from "./lock.js";
import type {
  EngineDesktopObservation,
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

export class CuaEngine implements EnginePort {
  readonly name = "cua-driver" as const;

  private constructor(
    private readonly sdk: CuaSdkLike,
    readonly version: string,
    readonly sessionId: string,
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
    const started = await sdk.startSession({
      session: publicSession,
      captureScope: CaptureScope.Desktop,
    });
    if (
      started.state.captureScope !== CaptureScope.Desktop ||
      started.state.effectiveScope !== EffectiveScope.Desktop
    ) {
      await sdk.endSession({ session: started.state.session });
      throw new ComputerUseError(
        "engine_version_mismatch",
        "Cua did not establish the requested desktop scope",
        "setup",
        false,
      );
    }

    return new CuaEngine(sdk, lock.version, started.state.session);
  }

  async discover(input: EngineDiscoverInput, signal: AbortSignal): Promise<EngineDiscovery> {
    if (!input.apps && !input.windows) return { apps: [], windows: [] };
    const platform = supportedPlatform();
    const appsResult = await this.sdk.callTool("list_apps", "{}", { signal });
    const apps = parseAppList(appsResult, platform);
    if (!input.windows) return { apps: input.apps ? apps : [], windows: [] };
    const windowsResult = await this.sdk.callTool("list_windows", "{}", { signal });
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
    const native = windowInput.target.window.native;
    const pid = native.pid;
    const windowId = native.window_id;
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(windowId)) {
      throw new ComputerUseError("engine_contract_changed", "Window target has invalid native identifiers", "doctor", false);
    }
    const result = await this.sdk.callTool(
      "get_window_state",
      JSON.stringify({
        session: this.sessionId,
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

  async execute(action: ComputerAction, signal: AbortSignal): Promise<EngineExecution> {
    const mapped = mapAction(action, this.sessionId);
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
    await this.sdk.endSession({ session: this.sessionId });
  }
}
