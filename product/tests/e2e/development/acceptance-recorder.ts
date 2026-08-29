import {
  PERFORMANCE_SCENARIO_NAMES,
  PERFORMANCE_SLOS,
  type PerformanceEvidence,
  type PerformanceProfile,
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
  schema_version: 2;
  evidence_type: "computer-use-macos-development-acceptance";
  status: "passed" | "degraded" | "failed";
  metadata: AcceptanceMetadata;
  scenarios: Readonly<Record<AcceptanceScenarioName, boolean>>;
  timings: readonly AcceptanceTiming[];
  performance: PerformanceEvidence;
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

function projectPerformance(performance: PerformanceEvidence | undefined): PerformanceEvidence {
  if (performance === undefined) throw new Error("acceptance_evidence_incomplete");

  return Object.fromEntries(PERFORMANCE_SCENARIO_NAMES.map((name) => {
    const profile = performance[name] as PerformanceProfile | undefined;
    const expectedSlo = PERFORMANCE_SLOS[name];
    if (
      profile === undefined
      || profile.sample_count !== 30
      || !Number.isFinite(profile.p50_ms)
      || !Number.isFinite(profile.p95_ms)
      || !Number.isFinite(profile.max_ms)
      || profile.p50_ms < 0
      || profile.p95_ms < profile.p50_ms
      || profile.max_ms < profile.p95_ms
      || profile.slo?.p50_ms !== expectedSlo.p50_ms
      || profile.slo?.p95_ms !== expectedSlo.p95_ms
      || (profile.status !== "passed" && profile.status !== "failed")
      || (profile.status === "passed" && (
        profile.p50_ms > expectedSlo.p50_ms || profile.p95_ms > expectedSlo.p95_ms
      ))
    ) {
      throw new Error("acceptance_evidence_incomplete");
    }
    return [name, {
      sample_count: 30,
      p50_ms: profile.p50_ms,
      p95_ms: profile.p95_ms,
      max_ms: profile.max_ms,
      slo: { ...expectedSlo },
      status: profile.status,
    } satisfies PerformanceProfile];
  })) as Record<keyof PerformanceEvidence, PerformanceProfile>;
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
    performance?: PerformanceEvidence,
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

    return {
      schema_version: 2,
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
  }
}
