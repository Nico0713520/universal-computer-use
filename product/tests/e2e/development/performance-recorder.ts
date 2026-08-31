export type PerformanceScenarioName =
  | "window_visual_observe"
  | "window_semantic_observe"
  | "semantic_action_next_state"
  | "pixel_action_next_state";

export type PerformanceFailureKind =
  | "tool_error"
  | "contract_mismatch"
  | "oracle_mismatch"
  | "target_lost"
  | "fixture_unavailable"
  | "telemetry_missing";

export type PerformanceOutcome = "passed" | PerformanceFailureKind;

export type PerformanceStageName =
  | "queue_wait"
  | "engine_execute"
  | "post_action_observe"
  | "projection"
  | "tool_total"
  | "transport_overhead";

export type PerformanceStageTimings = Readonly<
  Partial<Record<PerformanceStageName, number>>
>;

export const PERFORMANCE_ACTION_ROUTES = [
  "accessibility",
  "synthetic_events",
  "global_input",
  "system_api",
  "dom",
  "trusted_input",
  "unknown",
] as const;

export type PerformanceActionRoute = typeof PERFORMANCE_ACTION_ROUTES[number];

export type PerformanceSample = Readonly<{
  durationMs: number;
  outcome: PerformanceOutcome;
  stages: PerformanceStageTimings;
  route?: PerformanceActionRoute;
}>;

export type PerformanceStageAggregate = Readonly<{
  sample_count: number;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
}>;

type PerformanceLatencyProfile = Readonly<{
  sample_count: 30;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
  slo: Readonly<{ p50_ms: number; p95_ms: number }>;
  status: "passed" | "failed";
}>;

export type CorrectnessAwarePerformanceProfile = PerformanceLatencyProfile & Readonly<{
  correct_count: number;
  failed_count: number;
  success_rate: number;
  latency_status: "passed" | "failed";
  correctness_status: "passed" | "failed";
  failure_counts: Readonly<Partial<Record<PerformanceFailureKind, number>>>;
  route_counts: Readonly<Partial<Record<PerformanceActionRoute, number>>>;
  stages: Readonly<Partial<Record<PerformanceStageName, PerformanceStageAggregate>>>;
}>;

export type CorrectnessAwarePerformanceEvidence = Readonly<
  Record<PerformanceScenarioName, CorrectnessAwarePerformanceProfile>
>;

// Schema-v4 has one performance boundary. Keep these compatibility names as
// strict aliases so callers cannot silently fall back to the latency-only v2
// shape and lose correctness or stage evidence during projection.
export type PerformanceProfile = CorrectnessAwarePerformanceProfile;
export type PerformanceEvidence = CorrectnessAwarePerformanceEvidence;

export const PERFORMANCE_SCENARIO_NAMES: readonly PerformanceScenarioName[] = [
  "window_visual_observe",
  "window_semantic_observe",
  "semantic_action_next_state",
  "pixel_action_next_state",
];

export const PERFORMANCE_SLOS: Readonly<
  Record<PerformanceScenarioName, Readonly<{ p50_ms: number; p95_ms: number }>>
> = {
  window_visual_observe: { p50_ms: 700, p95_ms: 1_500 },
  window_semantic_observe: { p50_ms: 400, p95_ms: 1_000 },
  semantic_action_next_state: { p50_ms: 1_500, p95_ms: 2_000 },
  pixel_action_next_state: { p50_ms: 1_500, p95_ms: 3_000 },
};

const PERFORMANCE_OUTCOMES = new Set<PerformanceOutcome>([
  "passed",
  "tool_error",
  "contract_mismatch",
  "oracle_mismatch",
  "target_lost",
  "fixture_unavailable",
  "telemetry_missing",
]);

const PERFORMANCE_STAGE_NAMES: readonly PerformanceStageName[] = [
  "queue_wait",
  "engine_execute",
  "post_action_observe",
  "projection",
  "tool_total",
  "transport_overhead",
];

const PERFORMANCE_STAGE_NAME_SET = new Set<PerformanceStageName>(PERFORMANCE_STAGE_NAMES);
const PERFORMANCE_ACTION_ROUTE_SET = new Set<PerformanceActionRoute>(PERFORMANCE_ACTION_ROUTES);

function isActionScenario(name: PerformanceScenarioName): boolean {
  return name === "semantic_action_next_state" || name === "pixel_action_next_state";
}

export function nearestRank(samples: readonly number[], percentile: number): number {
  if (samples.length === 0 || percentile <= 0 || percentile > 1) {
    throw new RangeError("invalid_percentile_samples");
  }
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(percentile * sorted.length) - 1]!;
}

function validateSample(name: PerformanceScenarioName, sample: PerformanceSample): void {
  const stageEntries = typeof sample.stages === "object" && sample.stages !== null
    && !Array.isArray(sample.stages)
    ? Object.entries(sample.stages)
    : undefined;
  if (
    !Number.isFinite(sample.durationMs)
    || sample.durationMs < 0
    || !PERFORMANCE_OUTCOMES.has(sample.outcome)
    || (isActionScenario(name)
      ? (sample.outcome === "passed" && sample.route === undefined) ||
        (sample.route !== undefined && !PERFORMANCE_ACTION_ROUTE_SET.has(sample.route))
      : sample.route !== undefined)
    || stageEntries === undefined
    || stageEntries.some(([name, timing]) => (
      !PERFORMANCE_STAGE_NAME_SET.has(name as PerformanceStageName)
      || typeof timing !== "number"
      || !Number.isFinite(timing)
      || timing < 0
    ))
  ) {
    throw new RangeError("invalid_performance_sample");
  }
}

function summarizeStage(samples: readonly number[]): PerformanceStageAggregate {
  if (
    samples.length === 0
    || samples.some((sample) => !Number.isFinite(sample) || sample < 0)
  ) {
    throw new RangeError("invalid_performance_stage_samples");
  }
  return {
    sample_count: samples.length,
    p50_ms: nearestRank(samples, 0.5),
    p95_ms: nearestRank(samples, 0.95),
    max_ms: Math.max(...samples),
  };
}

export function summarizeSamples(samples: readonly number[]): Readonly<{
  sample_count: 30;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
}> {
  if (
    samples.length !== 30
    || samples.some((sample) => !Number.isFinite(sample) || sample < 0)
  ) {
    throw new RangeError("invalid_performance_samples");
  }
  return {
    sample_count: 30,
    p50_ms: nearestRank(samples, 0.5),
    p95_ms: nearestRank(samples, 0.95),
    max_ms: Math.max(...samples),
  };
}

export class PerformanceRecorder {
  readonly #warmups = new Map<PerformanceScenarioName, number>();
  readonly #measured = new Map<PerformanceScenarioName, PerformanceSample[]>();

  recordWarmup(name: PerformanceScenarioName, sample: PerformanceSample): void {
    validateSample(name, sample);
    const count = this.#warmups.get(name) ?? 0;
    if (count >= 5 || (this.#measured.get(name)?.length ?? 0) > 0) {
      throw new Error(`performance_warmup_limit:${name}`);
    }
    this.#warmups.set(name, count + 1);
  }

  recordMeasured(name: PerformanceScenarioName, sample: PerformanceSample): void {
    validateSample(name, sample);
    if (this.#warmups.get(name) !== 5) {
      throw new Error(`performance_warmups_incomplete:${name}`);
    }
    const samples = this.#measured.get(name) ?? [];
    if (samples.length >= 30) {
      throw new Error(`performance_sample_limit:${name}`);
    }
    samples.push({ ...sample, stages: { ...sample.stages } });
    this.#measured.set(name, samples);
  }

  performance(): CorrectnessAwarePerformanceEvidence {
    return Object.fromEntries(PERFORMANCE_SCENARIO_NAMES.map((name) => {
      const samples = this.#measured.get(name) ?? [];
      const summary = summarizeSamples(samples.map((sample) => sample.durationMs));
      const slo = PERFORMANCE_SLOS[name];
      const correctCount = samples.filter((sample) => sample.outcome === "passed").length;
      const failedCount = samples.length - correctCount;
      const latencyStatus = summary.p50_ms <= slo.p50_ms && summary.p95_ms <= slo.p95_ms
        ? "passed"
        : "failed";
      const correctnessStatus = correctCount === 30 ? "passed" : "failed";
      const failureCounts: Partial<Record<PerformanceFailureKind, number>> = {};
      const routeCounts: Partial<Record<PerformanceActionRoute, number>> = {};
      for (const sample of samples) {
        if (sample.outcome !== "passed") {
          failureCounts[sample.outcome] = (failureCounts[sample.outcome] ?? 0) + 1;
        }
        if (sample.route !== undefined) {
          routeCounts[sample.route] = (routeCounts[sample.route] ?? 0) + 1;
        }
      }
      const stages: Partial<Record<PerformanceStageName, PerformanceStageAggregate>> = {};
      for (const stageName of PERFORMANCE_STAGE_NAMES) {
        const stageSamples = samples.flatMap((sample) => {
          const timing = sample.stages[stageName];
          return timing === undefined ? [] : [timing];
        });
        if (stageSamples.length > 0) stages[stageName] = summarizeStage(stageSamples);
      }
      return [name, {
        ...summary,
        correct_count: correctCount,
        failed_count: failedCount,
        success_rate: correctCount / 30,
        slo: { ...slo },
        latency_status: latencyStatus,
        correctness_status: correctnessStatus,
        failure_counts: failureCounts,
        route_counts: routeCounts,
        stages,
        status: latencyStatus === "passed" && correctnessStatus === "passed" ? "passed" : "failed",
      } satisfies CorrectnessAwarePerformanceProfile];
    })) as Record<PerformanceScenarioName, CorrectnessAwarePerformanceProfile>;
  }
}
