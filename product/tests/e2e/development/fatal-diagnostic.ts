import { writeFile } from "node:fs/promises";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ERROR_CODES, type ComputerUseErrorCode } from "../../../src/errors.js";
import type { PerformanceScenarioName } from "./performance-recorder.js";

export type FatalDiagnosticPhase =
  | "setup"
  | "correctness"
  | "performance"
  | "real_app_smoke"
  | "reconnect"
  | "evidence";

export type FatalDiagnosticErrorCode =
  | "interactive_session_required"
  | "fixture_start_failed"
  | "fixture_unavailable"
  | "fixture_reset_ack_timeout"
  | "browser_launch_failed"
  | "focus_sentinel_unavailable"
  | "mcp_connection_failed"
  | "target_lost"
  | "acceptance_profiles_missing"
  | "acceptance_architecture_unsupported"
  | "acceptance_evidence_invalid"
  | "acceptance_deadline_exceeded"
  | "cleanup_failed"
  | "unexpected_failure";

export type FatalDiagnosticOwnedProcesses = Readonly<{
  fixture: boolean;
  browser: boolean;
  sentinel: boolean;
  mcp: boolean;
}>;

export type FatalDiagnosticCleanupResult = Readonly<{
  ownedProcesses: FatalDiagnosticOwnedProcesses;
  failure?: unknown;
}>;

export type FatalDiagnostic = Readonly<{
  schema_version: 1;
  evidence_type: "computer-use-macos-development-fatal-diagnostic";
  status: "failed";
  phase: FatalDiagnosticPhase;
  scenario: PerformanceScenarioName | null;
  sample_kind: "warmup" | "measured" | null;
  sample_index: number | null;
  error_code: FatalDiagnosticErrorCode;
  elapsed_ms: number;
  owned_processes: FatalDiagnosticOwnedProcesses;
  last_tool: Readonly<{
    name: "computer_observe" | "computer_act";
    error_code: ComputerUseErrorCode | null;
  }> | null;
  cleanup_passed: boolean;
  timestamp: string;
}>;

const FATAL_ERROR_CODES: readonly FatalDiagnosticErrorCode[] = [
  "interactive_session_required",
  "fixture_start_failed",
  "fixture_unavailable",
  "fixture_reset_ack_timeout",
  "browser_launch_failed",
  "focus_sentinel_unavailable",
  "mcp_connection_failed",
  "target_lost",
  "acceptance_profiles_missing",
  "acceptance_architecture_unsupported",
  "acceptance_evidence_invalid",
  "acceptance_deadline_exceeded",
  "cleanup_failed",
  "unexpected_failure",
];

const FATAL_ERROR_PREFIXES: readonly (readonly [string, FatalDiagnosticErrorCode])[] = [
  ["acceptance_preflight_interactive_session_required", "interactive_session_required"],
  ["fixture_start", "fixture_start_failed"],
  ["fixture_discovery", "target_lost"],
  ["fixture_window_observation", "target_lost"],
  ["acceptance_browser_", "browser_launch_failed"],
  ["focus_sentinel_", "focus_sentinel_unavailable"],
  ["acceptance_mcp_", "mcp_connection_failed"],
  ["mcp_", "mcp_connection_failed"],
  ["fixture_", "fixture_unavailable"],
];

function projectErrorCode(error: unknown): FatalDiagnosticErrorCode {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return FATAL_ERROR_CODES.find((code) => message === code || message.startsWith(`${code}:`))
    ?? FATAL_ERROR_PREFIXES.find(([prefix]) => message.startsWith(prefix))?.[1]
    ?? "unexpected_failure";
}

export class FatalDiagnosticTracker {
  readonly #now: () => number;
  readonly #timestamp: () => string;
  readonly #startedAt: number;
  #phase: FatalDiagnosticPhase = "setup";
  #scenario: PerformanceScenarioName | null = null;
  #sampleKind: "warmup" | "measured" | null = null;
  #sampleIndex: number | null = null;
  #lastTool: FatalDiagnostic["last_tool"] = null;

  constructor(options: Readonly<{ now?: () => number; timestamp?: () => string }> = {}) {
    this.#now = options.now ?? (() => performance.now());
    this.#timestamp = options.timestamp ?? (() => new Date().toISOString());
    this.#startedAt = this.#now();
  }

  setPhase(phase: FatalDiagnosticPhase): void {
    this.#phase = phase;
    this.#scenario = null;
    this.#sampleKind = null;
    this.#sampleIndex = null;
    this.#lastTool = null;
  }

  setPerformanceSample(
    scenario: PerformanceScenarioName,
    kind: "warmup" | "measured",
    index: number,
  ): void {
    const maximum = kind === "warmup" ? 4 : 29;
    if (!Number.isInteger(index) || index < 0 || index > maximum) {
      throw new RangeError("invalid_sample_index");
    }
    this.#phase = "performance";
    this.#scenario = scenario;
    this.#sampleKind = kind;
    this.#sampleIndex = index;
    this.#lastTool = null;
  }

  recordTool(
    name: "computer_observe" | "computer_act",
    errorCode: unknown,
  ): void {
    this.#lastTool = {
      name,
      error_code: ERROR_CODES.includes(errorCode as ComputerUseErrorCode)
        ? errorCode as ComputerUseErrorCode
        : null,
    };
  }

  recordToolResult(
    name: "computer_observe" | "computer_act",
    result: CallToolResult,
  ): void {
    const state = typeof result.structuredContent === "object" && result.structuredContent !== null
      ? result.structuredContent as Record<string, unknown>
      : {};
    const actionResult = typeof state.action_result === "object" && state.action_result !== null
      ? state.action_result as Record<string, unknown>
      : {};
    this.recordTool(name, state.code ?? actionResult.error_code);
  }

  build(
    error: unknown,
    ownedProcesses: FatalDiagnosticOwnedProcesses,
    cleanupPassed: boolean,
  ): FatalDiagnostic {
    return {
      schema_version: 1,
      evidence_type: "computer-use-macos-development-fatal-diagnostic",
      status: "failed",
      phase: this.#phase,
      scenario: this.#scenario,
      sample_kind: this.#sampleKind,
      sample_index: this.#sampleIndex,
      error_code: cleanupPassed ? projectErrorCode(error) : "cleanup_failed",
      elapsed_ms: Math.ceil(Math.max(0, this.#now() - this.#startedAt)),
      owned_processes: {
        fixture: ownedProcesses.fixture,
        browser: ownedProcesses.browser,
        sentinel: ownedProcesses.sentinel,
        mcp: ownedProcesses.mcp,
      },
      last_tool: this.#lastTool === null ? null : { ...this.#lastTool },
      cleanup_passed: cleanupPassed,
      timestamp: this.#timestamp(),
    };
  }

  async write(
    path: string,
    error: unknown,
    ownedProcesses: FatalDiagnosticOwnedProcesses,
    cleanupPassed: boolean,
  ): Promise<FatalDiagnostic> {
    const diagnostic = this.build(error, ownedProcesses, cleanupPassed);
    await writeFile(path, `${JSON.stringify(diagnostic, null, 2)}\n`, { flag: "wx" });
    return diagnostic;
  }
}

export async function runFatalGuardedLifecycle<T>(options: Readonly<{
  diagnosticPath: string;
  tracker: FatalDiagnosticTracker;
  timeoutMs?: number;
  operation: (signal: AbortSignal) => Promise<T>;
  cleanup: () => Promise<FatalDiagnosticCleanupResult>;
}>): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 540_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("invalid_acceptance_deadline");
  }
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      const error = new Error("acceptance_deadline_exceeded");
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  let completed = false;
  let value: T | undefined;
  let operationFailure: unknown;
  try {
    value = await Promise.race([options.operation(controller.signal), deadline]);
    completed = true;
  } catch (error) {
    operationFailure = error;
  } finally {
    clearTimeout(timeout);
  }

  let cleanup: FatalDiagnosticCleanupResult;
  try {
    cleanup = await options.cleanup();
  } catch (error) {
    cleanup = {
      ownedProcesses: { fixture: true, browser: true, sentinel: true, mcp: true },
      failure: error,
    };
  }
  const failure = cleanup.failure ?? operationFailure;
  if (failure !== undefined || !completed) {
    const fatalFailure = failure ?? new Error("unexpected_failure");
    await options.tracker.write(
      options.diagnosticPath,
      fatalFailure,
      cleanup.ownedProcesses,
      cleanup.failure === undefined,
    );
    throw fatalFailure;
  }
  return value as T;
}
