import { writeFile } from "node:fs/promises";

export type CursorAbDiagnosticPhase =
  | "setup"
  | "cursor_state"
  | "measurement"
  | "invariants"
  | "evidence"
  | "cleanup";

export type CursorAbDiagnosticErrorCode =
  | "route_mismatch"
  | "cursor_state_failed"
  | "effect_mismatch"
  | "target_failed"
  | "invariants_failed"
  | "cleanup_failed"
  | "capture_failed"
  | "session_failed"
  | "runtime_failed"
  | "internal_error";

export type CursorAbDiagnostic = Readonly<{
  schema_version: 1;
  evidence_type: "computer-use-macos-cursor-ab-diagnostic";
  status: "failed";
  phase: CursorAbDiagnosticPhase;
  error_code: CursorAbDiagnosticErrorCode;
  cleanup_passed: boolean;
  timestamp: string;
}>;

const ERROR_PROJECTIONS: readonly (readonly [string, CursorAbDiagnosticErrorCode])[] = [
  ["cursor_ab_route_mismatch", "route_mismatch"],
  ["cursor_ab_state_", "cursor_state_failed"],
  ["cursor_ab_effect_mismatch", "effect_mismatch"],
  ["cursor_ab_evidence_incomplete", "effect_mismatch"],
  ["cursor_ab_target_", "target_failed"],
  ["cursor_ab_geometry_", "target_failed"],
  ["cursor_ab_evidence_invalid", "invariants_failed"],
  ["cursor_ab_capture_missing", "capture_failed"],
  ["cursor_ab_session_invalid", "session_failed"],
  ["cursor_ab_requires_darwin", "session_failed"],
  ["cursor_ab_evidence_path_missing", "session_failed"],
  ["cursor_ab_engine_version_mismatch", "runtime_failed"],
  ["cursor_ab_runtime_missing", "runtime_failed"],
  ["cursor_ab_architecture_unsupported", "runtime_failed"],
];

function projectErrorCode(error: unknown): CursorAbDiagnosticErrorCode {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return ERROR_PROJECTIONS.find(([prefix]) => message === prefix || message.startsWith(prefix))?.[1]
    ?? "internal_error";
}

export class CursorAbDiagnosticTracker {
  readonly #timestamp: () => string;
  #phase: CursorAbDiagnosticPhase = "setup";

  constructor(options: Readonly<{ timestamp?: () => string }> = {}) {
    this.#timestamp = options.timestamp ?? (() => new Date().toISOString());
  }

  setPhase(phase: Exclude<CursorAbDiagnosticPhase, "cleanup">): void {
    this.#phase = phase;
  }

  build(error: unknown, cleanupPassed: boolean): CursorAbDiagnostic {
    return {
      schema_version: 1,
      evidence_type: "computer-use-macos-cursor-ab-diagnostic",
      status: "failed",
      phase: cleanupPassed ? this.#phase : "cleanup",
      error_code: cleanupPassed ? projectErrorCode(error) : "cleanup_failed",
      cleanup_passed: cleanupPassed,
      timestamp: this.#timestamp(),
    };
  }

  async write(path: string, error: unknown, cleanupPassed: boolean): Promise<CursorAbDiagnostic> {
    const diagnostic = this.build(error, cleanupPassed);
    await writeFile(path, `${JSON.stringify(diagnostic, null, 2)}\n`, { flag: "wx" });
    return diagnostic;
  }
}

export async function runCursorAbGuardedLifecycle<T>(options: Readonly<{
  diagnosticPath: string;
  tracker: CursorAbDiagnosticTracker;
  operation: () => Promise<T>;
  cleanup: () => Promise<void>;
}>): Promise<T> {
  let completed = false;
  let value: T | undefined;
  let operationFailure: unknown;
  try {
    value = await options.operation();
    completed = true;
  } catch (error) {
    operationFailure = error;
  }

  let cleanupFailure: unknown;
  try {
    await options.cleanup();
  } catch (error) {
    cleanupFailure = error;
  }
  const failure = cleanupFailure ?? operationFailure;
  if (failure !== undefined || !completed) {
    const guardedFailure = failure ?? new Error("cursor_ab_internal_failure");
    await options.tracker.write(options.diagnosticPath, guardedFailure, cleanupFailure === undefined);
    throw guardedFailure;
  }
  return value as T;
}
