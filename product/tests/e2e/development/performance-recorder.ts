export type PerformanceScenarioName =
  | "window_visual_observe"
  | "window_semantic_observe"
  | "semantic_action_next_state"
  | "pixel_action_next_state";

export type PerformanceSample = Readonly<{
  durationMs: number;
  correctnessPassed: boolean;
}>;

export type PerformanceProfile = Readonly<{
  sample_count: 30;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
  slo: Readonly<{ p50_ms: number; p95_ms: number }>;
  status: "passed" | "failed";
}>;

export type PerformanceEvidence = Readonly<Record<PerformanceScenarioName, PerformanceProfile>>;

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
  semantic_action_next_state: { p50_ms: 1_000, p95_ms: 2_000 },
  pixel_action_next_state: { p50_ms: 1_500, p95_ms: 3_000 },
};

export function nearestRank(samples: readonly number[], percentile: number): number {
  if (samples.length === 0 || percentile <= 0 || percentile > 1) {
    throw new RangeError("invalid_percentile_samples");
  }
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(percentile * sorted.length) - 1]!;
}

function validateSample(sample: PerformanceSample): void {
  if (
    !Number.isFinite(sample.durationMs)
    || sample.durationMs < 0
    || typeof sample.correctnessPassed !== "boolean"
  ) {
    throw new RangeError("invalid_performance_sample");
  }
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
    validateSample(sample);
    const count = this.#warmups.get(name) ?? 0;
    if (count >= 5 || (this.#measured.get(name)?.length ?? 0) > 0) {
      throw new Error(`performance_warmup_limit:${name}`);
    }
    this.#warmups.set(name, count + 1);
  }

  recordMeasured(name: PerformanceScenarioName, sample: PerformanceSample): void {
    validateSample(sample);
    if (this.#warmups.get(name) !== 5) {
      throw new Error(`performance_warmups_incomplete:${name}`);
    }
    const samples = this.#measured.get(name) ?? [];
    if (samples.length >= 30) {
      throw new Error(`performance_sample_limit:${name}`);
    }
    samples.push({ ...sample });
    this.#measured.set(name, samples);
  }

  performance(): PerformanceEvidence {
    return Object.fromEntries(PERFORMANCE_SCENARIO_NAMES.map((name) => {
      const samples = this.#measured.get(name) ?? [];
      const summary = summarizeSamples(samples.map((sample) => sample.durationMs));
      const slo = PERFORMANCE_SLOS[name];
      const correctnessPassed = samples.every((sample) => sample.correctnessPassed);
      return [name, {
        ...summary,
        slo: { ...slo },
        status: correctnessPassed
          && summary.p50_ms <= slo.p50_ms
          && summary.p95_ms <= slo.p95_ms
          ? "passed"
          : "failed",
      } satisfies PerformanceProfile];
    })) as Record<PerformanceScenarioName, PerformanceProfile>;
  }
}
