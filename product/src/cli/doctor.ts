import process from "node:process";

import type { EngineLock, EnginePlatform } from "../engine/lock.js";
import type { CursorMode } from "../engine/cursor-mode.js";
import type { EnginePort } from "../engine/port.js";
import {
  ComputerUseError,
  type ComputerUseDiagnosticReason,
  type ComputerUseErrorCode,
} from "../errors.js";
import { PRODUCT_VERSION, PROTOCOL_VERSION } from "../version.js";
import type {
  MacPermissionProbeResult,
  PermissionState,
} from "./macos-permissions.js";
import { resolveEnginePlatform } from "./setup.js";

export interface DoctorPermissionReport {
  accessibility: PermissionState;
  screen_recording: PermissionState;
  source: "driver-daemon" | "observation" | "unknown";
}

export type DoctorErrorReport = Readonly<{
  code: ComputerUseErrorCode;
  message: string;
  recovery: ComputerUseError["recovery"];
  retryable: boolean;
  diagnostic_reason?: ComputerUseDiagnosticReason;
}>;

export type DoctorReport = Readonly<{
  ok: boolean;
  product_version: string;
  protocol_version: string;
  cursor_mode: CursorMode;
  cursor_ready: boolean;
  platform: EnginePlatform | null;
  supported_platform: boolean;
  expected_engine_version: string;
  reported_engine_version: string | null;
  engine_connected: boolean;
  required_tools_present: boolean;
  desktop_unlocked: boolean | null;
  permissions: "granted" | "required" | "unknown";
  permission_details: DoctorPermissionReport;
  observation_succeeded: boolean;
  screenshot: Readonly<{ width: number; height: number }> | null;
  cleanup: Readonly<{
    status: "not_needed" | "succeeded" | "failed";
    error?: DoctorErrorReport;
  }>;
  error?: DoctorErrorReport;
}>;

export type DoctorOptions = Readonly<{
  platform?: NodeJS.Platform;
  arch?: string;
  cursorMode?: CursorMode;
}>;

export type DoctorDependencies = Readonly<{
  lock: EngineLock;
  connectEngine: (
    lock: EngineLock,
    options: Readonly<{ cursorMode: CursorMode }>,
  ) => Promise<EnginePort>;
  probeInteractiveSession: () => Promise<boolean | null>;
  verifyRuntimeIdentity: () => Promise<void>;
  probeMacPermissions: () => Promise<MacPermissionProbeResult>;
}>;

const UNKNOWN_PERMISSIONS: DoctorPermissionReport = {
  accessibility: "unknown",
  screen_recording: "unknown",
  source: "unknown",
};

function aggregatePermissions(
  permissions: DoctorPermissionReport,
): DoctorReport["permissions"] {
  if (
    permissions.accessibility === "required" ||
    permissions.screen_recording === "required"
  ) {
    return "required";
  }
  if (
    permissions.accessibility === "granted" &&
    permissions.screen_recording === "granted"
  ) {
    return "granted";
  }
  return "unknown";
}

function serializedError(error: unknown): DoctorErrorReport {
  if (error instanceof ComputerUseError) {
    return {
      code: error.code,
      message: error.message,
      recovery: error.recovery,
      retryable: error.retryable,
      ...(error.diagnosticReason === undefined
        ? {}
        : { diagnostic_reason: error.diagnosticReason }),
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
  cursorMode: CursorMode,
  error: NonNullable<DoctorReport["error"]>,
): DoctorReport {
  return {
    ok: false,
    product_version: PRODUCT_VERSION,
    protocol_version: PROTOCOL_VERSION,
    cursor_mode: cursorMode,
    cursor_ready: false,
    platform,
    supported_platform: platform !== null,
    expected_engine_version: lock.version,
    reported_engine_version: null,
    engine_connected: false,
    required_tools_present: false,
    desktop_unlocked: null,
    permissions: "unknown",
    permission_details: UNKNOWN_PERMISSIONS,
    observation_succeeded: false,
    screenshot: null,
    cleanup: { status: "not_needed" },
    error,
  };
}

export async function runDoctor(
  options: DoctorOptions,
  dependencies: DoctorDependencies,
): Promise<DoctorReport> {
  const cursorMode = options.cursorMode ?? "auto";
  let platform: EnginePlatform;
  try {
    platform = resolveEnginePlatform(
      options.platform ?? process.platform,
      options.arch ?? process.arch,
    );
  } catch (error) {
    return failedBase(dependencies.lock, null, cursorMode, serializedError(error));
  }

  let desktopUnlocked: boolean | null = null;
  let permissionDetails: DoctorPermissionReport = UNKNOWN_PERMISSIONS;
  if (platform === "macos") {
    try {
      const interactiveSession = await dependencies.probeInteractiveSession();
      if (interactiveSession === false) {
        throw new ComputerUseError(
          "interactive_session_required",
          "The macOS login window is active",
          "stop",
          false,
          { diagnosticReason: "interactive_session_locked" },
        );
      }
      if (interactiveSession === null) {
        throw new ComputerUseError(
          "runtime_unavailable",
          "The macOS interactive session could not be verified",
          "doctor",
          true,
          { diagnosticReason: "interactive_session_unknown" },
        );
      }
      desktopUnlocked = true;
      await dependencies.verifyRuntimeIdentity();
      permissionDetails = await dependencies.probeMacPermissions();
      if (aggregatePermissions(permissionDetails) === "required") {
        throw new ComputerUseError(
          "permission_required",
          "CuaDriver is missing one or more required desktop permissions",
          "grant_permission",
          false,
          { diagnosticReason: "desktop_permission_required" },
        );
      }
    } catch (error) {
      const failure = serializedError(error);
      return {
        ...failedBase(dependencies.lock, platform, cursorMode, failure),
        desktop_unlocked:
          failure.code === "interactive_session_required" ? false : desktopUnlocked,
        permissions: failure.code === "permission_required"
          ? "required"
          : aggregatePermissions(permissionDetails),
        permission_details: permissionDetails,
      };
    }
  }

  let engine: EnginePort;
  try {
    engine = await dependencies.connectEngine(dependencies.lock, { cursorMode });
  } catch (error) {
    return {
      ...failedBase(
        dependencies.lock,
        platform,
        cursorMode,
        serializedError(error),
      ),
      desktop_unlocked: desktopUnlocked,
      permissions: aggregatePermissions(permissionDetails),
      permission_details: permissionDetails,
    };
  }

  let requiredToolsPresent = false;
  let report: DoctorReport;
  try {
    if (engine.version !== dependencies.lock.version) {
      throw new ComputerUseError(
        "engine_version_mismatch",
        "Installed Cua version differs from engine.lock.json",
        "setup",
        false,
        { diagnosticReason: "runtime_version_mismatch" },
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
        { diagnosticReason: "runtime_version_mismatch" },
      );
    }
    report = {
      ok: true,
      product_version: PRODUCT_VERSION,
      protocol_version: PROTOCOL_VERSION,
      cursor_mode: cursorMode,
      cursor_ready: true,
      platform,
      supported_platform: true,
      expected_engine_version: dependencies.lock.version,
      reported_engine_version: engine.version,
      engine_connected: true,
      required_tools_present: true,
      desktop_unlocked: true,
      permissions: aggregatePermissions(permissionDetails),
      permission_details: permissionDetails,
      observation_succeeded: true,
      screenshot: {
        width: observed.image.width,
        height: observed.image.height,
      },
      cleanup: { status: "not_needed" },
    };
  } catch (error) {
    const failure = serializedError(error);
    const observedPermissionDetails: DoctorPermissionReport =
      failure.diagnostic_reason === "screen_recording_permission_required"
        ? {
            accessibility: "unknown",
            screen_recording: "required",
            source: "observation",
          }
        : failure.diagnostic_reason === "accessibility_permission_required"
          ? {
              accessibility: "required",
              screen_recording: "unknown",
              source: "observation",
            }
          : {
              accessibility: "unknown",
              screen_recording: "unknown",
              source: "observation",
            };
    const reportedPermissionDetails: DoctorPermissionReport =
      failure.code === "permission_required" &&
      aggregatePermissions(permissionDetails) !== "required"
        ? observedPermissionDetails
        : permissionDetails;
    report = {
      ...failedBase(dependencies.lock, platform, cursorMode, failure),
      cursor_ready: true,
      reported_engine_version: engine.version,
      engine_connected: true,
      required_tools_present: requiredToolsPresent,
      desktop_unlocked:
        failure.code === "interactive_session_required" ? false : desktopUnlocked,
      permissions: failure.code === "permission_required"
        ? "required"
        : aggregatePermissions(reportedPermissionDetails),
      permission_details: reportedPermissionDetails,
    };
  }

  try {
    await engine.close();
    return { ...report, cleanup: { status: "succeeded" } };
  } catch {
    const cleanupFailure = serializedError(
      new ComputerUseError(
        "runtime_unavailable",
        "Diagnostic session cleanup failed",
        "doctor",
        true,
        { diagnosticReason: "session_cleanup_failed" },
      ),
    );
    return {
      ...report,
      ok: false,
      ...(report.error === undefined ? { error: cleanupFailure } : {}),
      cleanup: { status: "failed", error: cleanupFailure },
    };
  }
}
