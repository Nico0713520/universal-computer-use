import {
  PERFORMANCE_SCENARIO_NAMES,
  PERFORMANCE_SLOS,
  performanceCorrectnessPassed,
  type CorrectnessAwarePerformanceEvidence,
  type CorrectnessAwarePerformanceProfile,
  type PerformanceFailureKind,
  type PerformanceStageAggregate,
  type PerformanceStageName,
} from "./performance-recorder.js";

export type AcceptanceTimingName =
  | "mcp_start"
  | "desktop_observe"
  | "window_discover"
  | "window_observe"
  | "coordinate_action"
  | "element_action"
  | "mcp_reconnect";

export type AcceptanceScenarioName =
  | "two_tool_inventory"
  | "desktop_png"
  | "fresh_snapshot"
  | "stale_snapshot_rejected"
  | "exact_window_discovered"
  | "window_png_and_element"
  | "background_element_effect"
  | "window_coordinate_effect"
  | "old_refs_rejected_after_reconnect";

export type AcceptanceMetadata = Readonly<{
  product_version: string;
  protocol_version: string;
  engine_version: string;
  macos_version: string;
  architecture: "arm64" | "x86_64";
}>;

export type AcceptanceTiming = Readonly<{
  name: AcceptanceTimingName;
  duration_ms: number;
  target_ms: number;
  hard_limit_ms: number;
  status: "target_met" | "degraded" | "failed";
}>;

export type DevelopmentEvidence = Readonly<{
  schema_version: 3;
  evidence_type: "computer-use-macos-development-acceptance";
  status: "passed" | "degraded" | "failed";
  metadata: AcceptanceMetadata;
  scenarios: Readonly<Record<AcceptanceScenarioName, boolean>>;
  timings: readonly AcceptanceTiming[];
  performance: CorrectnessAwarePerformanceEvidence;
  adaptive_correctness: AdaptiveCorrectnessEvidence;
  real_app_smoke: RealAppSmokeEvidence;
  cleanup_passed: true;
  timestamp: string;
}>;

export type RealAppSmokeErrorCode =
  | "calculator_unavailable"
  | "textedit_unavailable"
  | "unsupported_locale"
  | "verification_failed";

export type RealAppSmokeEvidence = Readonly<{
  calculator_703: boolean;
  textedit_unique_value: boolean;
  textedit_single_write: boolean;
  error_code?: RealAppSmokeErrorCode;
  cleanup_failed?: true;
}>;

export type AdaptiveCorrectnessEvidence = Readonly<{
  no_fixed_action_delay: boolean;
  semantic_sequence: boolean;
  pixel_once: boolean;
  unique_input_once: boolean;
  visual_recovery_once: boolean;
  focus_preserved: boolean;
}>;

const TIMING_NAMES: readonly AcceptanceTimingName[] = [
  "mcp_start",
  "desktop_observe",
  "window_discover",
  "window_observe",
  "coordinate_action",
  "element_action",
  "mcp_reconnect",
];

export const ACCEPTANCE_SCENARIO_NAMES: readonly AcceptanceScenarioName[] = [
  "two_tool_inventory",
  "desktop_png",
  "fresh_snapshot",
  "stale_snapshot_rejected",
  "exact_window_discovered",
  "window_png_and_element",
  "background_element_effect",
  "window_coordinate_effect",
  "old_refs_rejected_after_reconnect",
];

const LIMITS: Readonly<Record<AcceptanceTimingName, readonly [number, number]>> = {
  mcp_start: [2_000, 10_000],
  desktop_observe: [1_000, 3_000],
  window_discover: [1_000, 3_000],
  window_observe: [1_000, 3_000],
  coordinate_action: [1_000, 3_000],
  element_action: [3_000, 8_000],
  mcp_reconnect: [2_000, 10_000],
};

const REAL_APP_SMOKE_ERROR_CODES = new Set<RealAppSmokeErrorCode>([
  "calculator_unavailable",
  "textedit_unavailable",
  "unsupported_locale",
  "verification_failed",
]);

const PERFORMANCE_FAILURE_KINDS: readonly PerformanceFailureKind[] = [
  "tool_error",
  "contract_mismatch",
  "oracle_mismatch",
  "target_lost",
  "fixture_unavailable",
  "telemetry_missing",
];

const PERFORMANCE_STAGE_NAMES: readonly PerformanceStageName[] = [
  "queue_wait",
  "engine_execute",
  "post_action_observe",
  "projection",
  "tool_total",
  "transport_overhead",
];

const OBSERVE_STAGE_NAMES: readonly PerformanceStageName[] = [
  "queue_wait",
  "post_action_observe",
  "projection",
  "tool_total",
  "transport_overhead",
];

const ACTION_STAGE_NAMES: readonly PerformanceStageName[] = [
  ...OBSERVE_STAGE_NAMES,
  "engine_execute",
];

function incomplete(): never {
  throw new Error("acceptance_evidence_incomplete");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredStages(name: (typeof PERFORMANCE_SCENARIO_NAMES)[number]): readonly PerformanceStageName[] {
  return name === "semantic_action_next_state" || name === "pixel_action_next_state"
    ? ACTION_STAGE_NAMES
    : OBSERVE_STAGE_NAMES;
}

function validateStageAggregate(value: unknown, requireComplete: boolean): asserts value is PerformanceStageAggregate {
  if (!isRecord(value)) incomplete();
  const sampleCount = value.sample_count;
  const p50 = value.p50_ms;
  const p95 = value.p95_ms;
  const max = value.max_ms;
  if (
    !Number.isInteger(sampleCount)
    || (sampleCount as number) < 1
    || (sampleCount as number) > 30
    || (requireComplete && sampleCount !== 30)
    || typeof p50 !== "number"
    || typeof p95 !== "number"
    || typeof max !== "number"
    || !Number.isFinite(p50)
    || !Number.isFinite(p95)
    || !Number.isFinite(max)
    || p50 < 0
    || p95 < p50
    || max < p95
  ) incomplete();
}

function validatePerformanceProfile(
  name: (typeof PERFORMANCE_SCENARIO_NAMES)[number],
  value: unknown,
): asserts value is CorrectnessAwarePerformanceProfile {
  if (!isRecord(value)) incomplete();
  const expectedSlo = PERFORMANCE_SLOS[name];
  const correctCount = value.correct_count;
  const failedCount = value.failed_count;
  const successRate = value.success_rate;
  const p50 = value.p50_ms;
  const p95 = value.p95_ms;
  const max = value.max_ms;
  const failureCountsForGate = isRecord(value.failure_counts)
    ? value.failure_counts as Partial<Record<PerformanceFailureKind, number>>
    : {};
  const latencyPassed = typeof p50 === "number" && typeof p95 === "number"
    && p50 <= expectedSlo.p50_ms && p95 <= expectedSlo.p95_ms;
  const expectedCorrectnessStatus = Number.isInteger(correctCount)
    && performanceCorrectnessPassed(name, correctCount as number, failureCountsForGate)
    ? "passed"
    : "failed";
  const expectedLatencyStatus = latencyPassed ? "passed" : "failed";
  const expectedStatus = expectedCorrectnessStatus === "passed" && expectedLatencyStatus === "passed"
    ? "passed"
    : "failed";

  if (
    value.sample_count !== 30
    || !Number.isInteger(correctCount)
    || !Number.isInteger(failedCount)
    || (correctCount as number) < 0
    || (failedCount as number) < 0
    || (correctCount as number) + (failedCount as number) !== 30
    || typeof successRate !== "number"
    || !Number.isFinite(successRate)
    || successRate !== (correctCount as number) / 30
    || typeof p50 !== "number"
    || typeof p95 !== "number"
    || typeof max !== "number"
    || !Number.isFinite(p50)
    || !Number.isFinite(p95)
    || !Number.isFinite(max)
    || p50 < 0
    || p95 < p50
    || max < p95
    || !isRecord(value.slo)
    || value.slo.p50_ms !== expectedSlo.p50_ms
    || value.slo.p95_ms !== expectedSlo.p95_ms
    || value.latency_status !== expectedLatencyStatus
    || value.correctness_status !== expectedCorrectnessStatus
    || value.status !== expectedStatus
    || !isRecord(value.failure_counts)
    || !isRecord(value.stages)
  ) incomplete();

  const failureEntries = Object.entries(value.failure_counts);
  if (
    failureEntries.some(([kind, count]) => (
      !PERFORMANCE_FAILURE_KINDS.includes(kind as PerformanceFailureKind)
      || !Number.isInteger(count)
      || (count as number) < 1
      || (count as number) > 30
    ))
    || failureEntries.reduce((sum, [, count]) => sum + (count as number), 0) !== failedCount
  ) incomplete();

  const stages = value.stages;
  const stageEntries = Object.entries(stages);
  if (stageEntries.some(([stageName]) => !PERFORMANCE_STAGE_NAMES.includes(stageName as PerformanceStageName))) {
    incomplete();
  }
  const completeStagesRequired = value.status === "passed";
  if (
    completeStagesRequired
    && requiredStages(name).some((stageName) => stages[stageName] === undefined)
  ) incomplete();
  for (const [, stage] of stageEntries) validateStageAggregate(stage, completeStagesRequired);
}

function projectPerformance(
  performance: CorrectnessAwarePerformanceEvidence | undefined,
): CorrectnessAwarePerformanceEvidence {
  if (performance === undefined) throw new Error("acceptance_evidence_incomplete");

  return Object.fromEntries(PERFORMANCE_SCENARIO_NAMES.map((name) => {
    const profile = performance[name] as CorrectnessAwarePerformanceProfile | undefined;
    validatePerformanceProfile(name, profile);
    const failureCounts = Object.fromEntries(PERFORMANCE_FAILURE_KINDS.flatMap((kind) => {
      const count = profile.failure_counts[kind];
      return count === undefined ? [] : [[kind, count]];
    }));
    const stages = Object.fromEntries(PERFORMANCE_STAGE_NAMES.flatMap((stageName) => {
      const stage = profile.stages[stageName];
      return stage === undefined ? [] : [[stageName, { ...stage }]];
    }));
    return [name, {
      sample_count: 30,
      correct_count: profile.correct_count,
      failed_count: profile.failed_count,
      success_rate: profile.success_rate,
      p50_ms: profile.p50_ms,
      p95_ms: profile.p95_ms,
      max_ms: profile.max_ms,
      slo: { ...PERFORMANCE_SLOS[name] },
      latency_status: profile.latency_status,
      correctness_status: profile.correctness_status,
      failure_counts: failureCounts,
      stages,
      status: profile.status,
    } satisfies CorrectnessAwarePerformanceProfile];
  })) as Record<keyof CorrectnessAwarePerformanceEvidence, CorrectnessAwarePerformanceProfile>;
}

function projectRealAppSmoke(smoke: RealAppSmokeEvidence | undefined): RealAppSmokeEvidence {
  if (
    smoke === undefined
    || typeof smoke.calculator_703 !== "boolean"
    || typeof smoke.textedit_unique_value !== "boolean"
    || typeof smoke.textedit_single_write !== "boolean"
    || (smoke.error_code !== undefined && !REAL_APP_SMOKE_ERROR_CODES.has(smoke.error_code))
    || (smoke.cleanup_failed !== undefined && smoke.cleanup_failed !== true)
  ) {
    throw new Error("acceptance_evidence_incomplete");
  }
  return {
    calculator_703: smoke.calculator_703,
    textedit_unique_value: smoke.textedit_unique_value,
    textedit_single_write: smoke.textedit_single_write,
    ...(smoke.error_code === undefined ? {} : { error_code: smoke.error_code }),
    ...(smoke.cleanup_failed === undefined ? {} : { cleanup_failed: true as const }),
  };
}

const ADAPTIVE_CORRECTNESS_KEYS: readonly (keyof AdaptiveCorrectnessEvidence)[] = [
  "no_fixed_action_delay",
  "semantic_sequence",
  "pixel_once",
  "unique_input_once",
  "visual_recovery_once",
  "focus_preserved",
];

function projectAdaptiveCorrectness(
  value: AdaptiveCorrectnessEvidence | undefined,
): AdaptiveCorrectnessEvidence {
  if (value === undefined || ADAPTIVE_CORRECTNESS_KEYS.some((key) => typeof value[key] !== "boolean")) {
    throw new Error("acceptance_evidence_incomplete");
  }
  return Object.fromEntries(
    ADAPTIVE_CORRECTNESS_KEYS.map((key) => [key, value[key]]),
  ) as Record<keyof AdaptiveCorrectnessEvidence, boolean>;
}

export class AcceptanceRecorder {
  readonly #now: () => number;
  readonly #timings = new Map<AcceptanceTimingName, AcceptanceTiming>();
  readonly #scenarios = new Map<AcceptanceScenarioName, boolean>();

  constructor(now: () => number = () => performance.now()) {
    this.#now = now;
  }

  async measure<T>(name: AcceptanceTimingName, operation: () => Promise<T>): Promise<T> {
    const startedAt = this.#now();
    let completed = false;
    let value: T | undefined;
    let operationFailure: unknown;

    try {
      value = await operation();
      completed = true;
    } catch (error) {
      operationFailure = error;
    } finally {
      const durationMs = Math.ceil(Math.max(0, this.#now() - startedAt));
      const [targetMs, hardLimitMs] = LIMITS[name];
      const status = !completed
        ? "failed"
        : durationMs <= targetMs
          ? "target_met"
          : durationMs <= hardLimitMs
            ? "degraded"
            : "failed";
      this.#timings.set(name, {
        name,
        duration_ms: durationMs,
        target_ms: targetMs,
        hard_limit_ms: hardLimitMs,
        status,
      });
    }

    if (!completed) throw operationFailure;
    return value as T;
  }

  recordScenario(name: AcceptanceScenarioName, passed: boolean): void {
    this.#scenarios.set(name, passed);
  }

  recordFailedTiming(name: AcceptanceTimingName): void {
    const [targetMs, hardLimitMs] = LIMITS[name];
    this.#timings.set(name, {
      name,
      duration_ms: 0,
      target_ms: targetMs,
      hard_limit_ms: hardLimitMs,
      status: "failed",
    });
  }

  evidence(
    metadata: AcceptanceMetadata,
    cleanupPassed: boolean,
    performance?: CorrectnessAwarePerformanceEvidence,
    realAppSmoke?: RealAppSmokeEvidence,
    adaptiveCorrectness?: AdaptiveCorrectnessEvidence,
  ): DevelopmentEvidence {
    if (!cleanupPassed) throw new Error("acceptance_cleanup_failed");

    const completeScenarios = ACCEPTANCE_SCENARIO_NAMES.every((name) => this.#scenarios.has(name));
    if (!completeScenarios) {
      throw new Error("acceptance_evidence_incomplete");
    }
    const timings = TIMING_NAMES.map((name) => {
      const timing = this.#timings.get(name);
      if (timing === undefined) {
        throw new Error("acceptance_evidence_incomplete");
      }
      return timing;
    });

    const projectedPerformance = projectPerformance(performance);
    const projectedRealAppSmoke = projectRealAppSmoke(realAppSmoke);
    const projectedAdaptiveCorrectness = projectAdaptiveCorrectness(adaptiveCorrectness);
    const performancePassed = PERFORMANCE_SCENARIO_NAMES.every(
      (name) => projectedPerformance[name].status === "passed",
    );
    const smokePassed = projectedRealAppSmoke.calculator_703
      && projectedRealAppSmoke.textedit_unique_value
      && projectedRealAppSmoke.textedit_single_write
      && projectedRealAppSmoke.error_code === undefined
      && projectedRealAppSmoke.cleanup_failed === undefined;
    const adaptiveCorrectnessPassed = ADAPTIVE_CORRECTNESS_KEYS.every(
      (key) => projectedAdaptiveCorrectness[key],
    );
    const scenariosPassed = ACCEPTANCE_SCENARIO_NAMES.every((name) => this.#scenarios.get(name) === true);
    const timingFailed = timings.some((timing) => timing.status === "failed");
    const status = !scenariosPassed || timingFailed || !performancePassed || !smokePassed ||
      !adaptiveCorrectnessPassed
      ? "failed"
      : timings.some((timing) => timing.status === "degraded")
        ? "degraded"
        : "passed";

    const result: DevelopmentEvidence = {
      schema_version: 3,
      evidence_type: "computer-use-macos-development-acceptance",
      status,
      metadata: { ...metadata },
      scenarios: Object.fromEntries(
        ACCEPTANCE_SCENARIO_NAMES.map((name) => [name, this.#scenarios.get(name) === true]),
      ) as Record<AcceptanceScenarioName, boolean>,
      timings,
      performance: projectedPerformance,
      adaptive_correctness: projectedAdaptiveCorrectness,
      real_app_smoke: projectedRealAppSmoke,
      cleanup_passed: true,
      timestamp: new Date().toISOString(),
    };
    validateDevelopmentEvidenceSemantics(result);
    return result;
  }
}

export function validateDevelopmentEvidenceSemantics(
  value: unknown,
): asserts value is DevelopmentEvidence {
  if (!isRecord(value) || !isRecord(value.performance)) incomplete();
  const performanceEvidence = value.performance;
  for (const name of PERFORMANCE_SCENARIO_NAMES) {
    validatePerformanceProfile(name, performanceEvidence[name]);
  }

  if (!isRecord(value.scenarios) || !Array.isArray(value.timings)) incomplete();
  const scenarios = value.scenarios;
  const scenariosPassed = ACCEPTANCE_SCENARIO_NAMES.every((name) => scenarios[name] === true);
  const timingStatuses = value.timings.map((timing) => (
    isRecord(timing) ? timing.status : undefined
  ));
  if (timingStatuses.some((status) => (
    status !== "target_met" && status !== "degraded" && status !== "failed"
  ))) incomplete();
  const performancePassed = PERFORMANCE_SCENARIO_NAMES.every((name) => (
    (performanceEvidence[name] as CorrectnessAwarePerformanceProfile).status === "passed"
  ));
  if (!isRecord(value.real_app_smoke) || !isRecord(value.adaptive_correctness)) incomplete();
  const adaptiveCorrectness = value.adaptive_correctness;
  const smokePassed = value.real_app_smoke.calculator_703 === true
    && value.real_app_smoke.textedit_unique_value === true
    && value.real_app_smoke.textedit_single_write === true
    && value.real_app_smoke.error_code === undefined
    && value.real_app_smoke.cleanup_failed === undefined;
  const adaptiveCorrectnessPassed = ADAPTIVE_CORRECTNESS_KEYS.every(
    (key) => adaptiveCorrectness[key] === true,
  );
  const expectedStatus = !scenariosPassed
    || timingStatuses.includes("failed")
    || !performancePassed
    || !smokePassed
    || !adaptiveCorrectnessPassed
    ? "failed"
    : timingStatuses.includes("degraded")
      ? "degraded"
      : "passed";
  if (value.status !== expectedStatus) incomplete();
}
