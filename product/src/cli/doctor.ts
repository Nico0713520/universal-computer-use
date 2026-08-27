import process from "node:process";

import type { EngineLock, EnginePlatform } from "../engine/lock.js";
import type { EnginePort } from "../engine/port.js";
import { ComputerUseError, type ComputerUseErrorCode } from "../errors.js";
import { PRODUCT_VERSION, PROTOCOL_VERSION } from "../version.js";
import { resolveEnginePlatform } from "./setup.js";

export type DoctorReport = Readonly<{
  ok: boolean;
  product_version: string;
  protocol_version: string;
  platform: EnginePlatform | null;
  supported_platform: boolean;
  expected_engine_version: string;
  reported_engine_version: string | null;
  engine_connected: boolean;
  required_tools_present: boolean;
  desktop_unlocked: boolean | null;
  permissions: "granted" | "required" | "unknown";
  observation_succeeded: boolean;
  screenshot: Readonly<{ width: number; height: number }> | null;
  error?: Readonly<{
    code: ComputerUseErrorCode;
    message: string;
    recovery: ComputerUseError["recovery"];
    retryable: boolean;
  }>;
}>;

export type DoctorOptions = Readonly<{
  platform?: NodeJS.Platform;
  arch?: string;
}>;

export type DoctorDependencies = Readonly<{
  lock: EngineLock;
  connectEngine: (lock: EngineLock) => Promise<EnginePort>;
}>;

function serializedError(error: unknown): NonNullable<DoctorReport["error"]> {
  if (error instanceof ComputerUseError) {
    return {
      code: error.code,
      message: error.message,
      recovery: error.recovery,
      retryable: error.retryable,
    };
  }
  return {
    code: "runtime_unavailable",
    message: error instanceof Error ? error.message : "Unknown Runtime failure",
    recovery: "doctor",
    retryable: true,
  };
}

function failedBase(
  lock: EngineLock,
  platform: EnginePlatform | null,
  error: NonNullable<DoctorReport["error"]>,
): DoctorReport {
  return {
    ok: false,
    product_version: PRODUCT_VERSION,
    protocol_version: PROTOCOL_VERSION,
    platform,
    supported_platform: platform !== null,
    expected_engine_version: lock.version,
    reported_engine_version: null,
    engine_connected: false,
    required_tools_present: false,
    desktop_unlocked: null,
    permissions: "unknown",
    observation_succeeded: false,
    screenshot: null,
    error,
  };
}

export async function runDoctor(
  options: DoctorOptions,
  dependencies: DoctorDependencies,
): Promise<DoctorReport> {
  let platform: EnginePlatform;
  try {
    platform = resolveEnginePlatform(
      options.platform ?? process.platform,
      options.arch ?? process.arch,
    );
  } catch (error) {
    return failedBase(dependencies.lock, null, serializedError(error));
  }

  let engine: EnginePort;
  try {
    engine = await dependencies.connectEngine(dependencies.lock);
  } catch (error) {
    return failedBase(dependencies.lock, platform, serializedError(error));
  }

  let requiredToolsPresent = false;
  try {
    if (engine.version !== dependencies.lock.version) {
      throw new ComputerUseError(
        "engine_version_mismatch",
        "Installed Cua version differs from engine.lock.json",
        "setup",
        false,
      );
    }
    requiredToolsPresent = true;
    const observed = await engine.observe(new AbortController().signal);
    if (observed.platform !== platform) {
      throw new ComputerUseError(
        "engine_version_mismatch",
        "Runtime desktop platform differs from the current host",
        "setup",
        false,
      );
    }
    return {
      ok: true,
      product_version: PRODUCT_VERSION,
      protocol_version: PROTOCOL_VERSION,
      platform,
      supported_platform: true,
      expected_engine_version: dependencies.lock.version,
      reported_engine_version: engine.version,
      engine_connected: true,
      required_tools_present: true,
      desktop_unlocked: true,
      // Cua Driver 0.22.1 does not expose a portable permission-state field
      // through EnginePort. A permission_required observation failure is
      // reported below; otherwise the status remains explicitly unknown.
      permissions: "unknown",
      observation_succeeded: true,
      screenshot: {
        width: observed.image.width,
        height: observed.image.height,
      },
    };
  } catch (error) {
    const failure = serializedError(error);
    return {
      ...failedBase(dependencies.lock, platform, failure),
      reported_engine_version: engine.version,
      engine_connected: true,
      required_tools_present: requiredToolsPresent,
      desktop_unlocked:
        failure.code === "interactive_session_required" ? false : null,
      permissions: failure.code === "permission_required" ? "required" : "unknown",
    };
  } finally {
    await engine.close();
  }
}
