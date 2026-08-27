import { randomUUID } from "node:crypto";

import {
  CaptureScope,
  CuaDriver,
  EffectiveScope,
  type CuaDriverLike,
  type ToolResult,
} from "@trycua/cua-driver";

import { ComputerUseError } from "../errors.js";
import type { ComputerAction } from "../protocol.js";
import { mapAction } from "./action-mapper.js";
import type { EngineLock } from "./lock.js";
import type { EngineExecution, EngineObservation, EnginePort } from "./port.js";
import { mapCuaResult } from "./result-mapper.js";

export type CuaSdkLike = Pick<
  CuaDriverLike,
  "metadata" | "listToolsJson" | "startSession" | "callTool" | "endSession"
>;

type DesktopStateJson = {
  platform: "macos" | "windows";
  screenshot_width: number;
  screenshot_height: number;
  screen_width: number;
  screen_height: number;
  scale_factor: number;
};

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

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

function parseDesktopObservation(result: ToolResult): EngineObservation {
  if (result.isError) {
    throw new ComputerUseError(
      "capture_failed",
      "Cua failed to capture the desktop",
      "observe_again",
      true,
    );
  }

  let desktop: DesktopStateJson;
  try {
    desktop = JSON.parse(result.structuredJson ?? "") as DesktopStateJson;
  } catch {
    throw new ComputerUseError(
      "capture_failed",
      "Cua returned malformed desktop metadata",
      "observe_again",
      true,
    );
  }
  if (
    typeof desktop !== "object" ||
    desktop === null ||
    (desktop.platform !== "macos" && desktop.platform !== "windows") ||
    !isPositiveInteger(desktop.screenshot_width) ||
    !isPositiveInteger(desktop.screenshot_height) ||
    !isPositiveInteger(desktop.screen_width) ||
    !isPositiveInteger(desktop.screen_height) ||
    typeof desktop.scale_factor !== "number" ||
    !Number.isFinite(desktop.scale_factor) ||
    desktop.scale_factor <= 0
  ) {
    throw new ComputerUseError(
      "capture_failed",
      "Cua returned invalid desktop metadata",
      "observe_again",
      true,
    );
  }
  const image = result.images.length === 1 ? result.images[0] : undefined;
  if (
    image === undefined ||
    image.mimeType !== "image/png" ||
    image.dataBase64.length === 0
  ) {
    throw new ComputerUseError(
      "capture_failed",
      "Cua did not return exactly one screenshot image",
      "observe_again",
      true,
    );
  }

  return {
    image: {
      mimeType: "image/png",
      dataBase64: image.dataBase64,
      width: desktop.screenshot_width,
      height: desktop.screenshot_height,
    },
    platform: desktop.platform,
    scaleFactor: desktop.scale_factor,
  };
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

  async observe(signal: AbortSignal): Promise<EngineObservation> {
    const result = await this.sdk.callTool(
      "get_desktop_state",
      JSON.stringify({ session: this.sessionId }),
      { signal },
    );
    return parseDesktopObservation(result);
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

  async close(): Promise<void> {
    await this.sdk.endSession({ session: this.sessionId });
  }
}
