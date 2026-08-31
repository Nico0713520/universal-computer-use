import { describe, expect, it } from "vitest";

import {
  PERFORMANCE_SLOS,
  PerformanceRecorder,
  type PerformanceActionRoute,
  type PerformanceOutcome,
  type PerformanceScenarioName,
  type PerformanceStageName,
  nearestRank,
  summarizeSamples,
} from "../e2e/development/performance-recorder.js";

const SCENARIO_NAMES: readonly PerformanceScenarioName[] = [
  "window_visual_observe",
  "window_semantic_observe",
  "semantic_action_next_state",
  "pixel_action_next_state",
];

function actionRoute(name: PerformanceScenarioName): Readonly<{ route: "accessibility" }> | {} {
  return name === "semantic_action_next_state" || name === "pixel_action_next_state"
    ? { route: "accessibility" }
    : {};
}

function recordCompleteScenario(
  recorder: PerformanceRecorder,
  name: PerformanceScenarioName,
  outcomeAtIndex: Readonly<Partial<Record<number, PerformanceOutcome>>> = {},
  routeAtIndex?: (index: number) => PerformanceActionRoute,
): void {
  const actionScenario = name === "semantic_action_next_state" || name === "pixel_action_next_state";
  for (let index = 0; index < 5; index += 1) {
    recorder.recordWarmup(name, {
      durationMs: 99_999,
      outcome: "telemetry_missing",
      stages: { tool_total: 99_999 },
      ...(actionScenario ? { route: "accessibility" as const } : {}),
    });
  }
  for (let durationMs = 30; durationMs >= 1; durationMs -= 1) {
    const index = 30 - durationMs;
    recorder.recordMeasured(name, {
      durationMs,
      outcome: outcomeAtIndex[index] ?? "passed",
      stages: {
        queue_wait: 1,
        post_action_observe: 20,
        projection: 2,
        tool_total: durationMs,
        transport_overhead: 7,
      },
      ...(actionScenario
        ? { route: routeAtIndex?.(index) ?? "accessibility" as const }
        : {}),
    });
  }
}

describe("nearestRank", () => {
  it("uses the sorted nearest ranks for p50 and p95 without averaging", () => {
    const shuffled = [
      30, 1, 29, 2, 28, 3, 27, 4, 26, 5,
      25, 6, 24, 7, 23, 8, 22, 9, 21, 10,
      20, 11, 19, 12, 18, 13, 17, 14, 16, 15,
    ];

    expect(nearestRank(shuffled, 0.5)).toBe(15);
    expect(nearestRank(shuffled, 0.95)).toBe(29);
    expect(shuffled[0]).toBe(30);
  });
});

describe("summarizeSamples", () => {
  it("summarizes exactly 30 finite nonnegative measured durations", () => {
    const shuffled = [
      30, 1, 29, 2, 28, 3, 27, 4, 26, 5,
      25, 6, 24, 7, 23, 8, 22, 9, 21, 10,
      20, 11, 19, 12, 18, 13, 17, 14, 16, 15,
    ];

    expect(summarizeSamples(shuffled)).toEqual({
      sample_count: 30,
      p50_ms: 15,
      p95_ms: 29,
      max_ms: 30,
    });
  });

  it.each([
    ["29 samples", Array.from({ length: 29 }, () => 1)],
    ["31 samples", Array.from({ length: 31 }, () => 1)],
    ["negative duration", [...Array.from({ length: 29 }, () => 1), -1]],
    ["NaN duration", [...Array.from({ length: 29 }, () => 1), Number.NaN]],
    ["infinite duration", [...Array.from({ length: 29 }, () => 1), Number.POSITIVE_INFINITY]],
  ])("rejects %s", (_label, samples) => {
    expect(() => summarizeSamples(samples)).toThrow("invalid_performance_samples");
  });
});

describe("PerformanceRecorder", () => {
  it("uses the measured Cua 0.22.2 semantic-action baseline without hiding its latency", () => {
    expect(PERFORMANCE_SLOS.semantic_action_next_state).toEqual({
      p50_ms: 1_500,
      p95_ms: 2_000,
    });
  });

  it("emits exact correctness, latency, and stage aggregates for 30 correct measured calls", () => {
    const recorder = new PerformanceRecorder();

    for (const name of SCENARIO_NAMES) {
      recordCompleteScenario(recorder, name);
    }

    expect(recorder.performance().window_visual_observe).toEqual({
      sample_count: 30,
      correct_count: 30,
      failed_count: 0,
      success_rate: 1,
      p50_ms: 15,
      p95_ms: 29,
      max_ms: 30,
      slo: { p50_ms: 700, p95_ms: 1_500 },
      latency_status: "passed",
      correctness_status: "passed",
      failure_counts: {},
      route_counts: {},
      stages: expect.objectContaining({
        tool_total: { sample_count: 30, p50_ms: 15, p95_ms: 29, max_ms: 30 },
      }),
      status: "passed",
    });
  });

  it("aggregates measured action routes without retaining raw samples", () => {
    const recorder = new PerformanceRecorder();

    for (const name of SCENARIO_NAMES) {
      recordCompleteScenario(
        recorder,
        name,
        {},
        name === "pixel_action_next_state"
          ? (index) => index < 12 ? "accessibility" : "synthetic_events"
          : undefined,
      );
    }

    const evidence = recorder.performance();
    expect(evidence.window_visual_observe.route_counts).toEqual({});
    expect(evidence.window_semantic_observe.route_counts).toEqual({});
    expect(evidence.semantic_action_next_state.route_counts).toEqual({ accessibility: 30 });
    expect(evidence.pixel_action_next_state.route_counts).toEqual({
      accessibility: 12,
      synthetic_events: 18,
    });
    expect(JSON.stringify(evidence)).not.toContain("samples");
  });

  it("enforces the closed route contract at the scenario seam", () => {
    const recorder = new PerformanceRecorder();

    expect(() => recorder.recordWarmup("semantic_action_next_state", {
      durationMs: 1,
      outcome: "passed",
      stages: {},
    })).toThrow("invalid_performance_sample");
    expect(() => recorder.recordWarmup("window_visual_observe", {
      durationMs: 1,
      outcome: "passed",
      stages: {},
      route: "accessibility",
    })).toThrow("invalid_performance_sample");
    expect(() => recorder.recordWarmup("pixel_action_next_state", {
      durationMs: 1,
      outcome: "passed",
      stages: {},
      route: "private_route" as PerformanceActionRoute,
    })).toThrow("invalid_performance_sample");
    expect(() => recorder.recordWarmup("pixel_action_next_state", {
      durationMs: 1,
      outcome: "tool_error",
      stages: {},
    })).not.toThrow();
  });

  it("keeps failed-call durations while separating correctness from latency", () => {
    const recorder = new PerformanceRecorder();

    for (const name of SCENARIO_NAMES) {
      recordCompleteScenario(
        recorder,
        name,
        name === "window_visual_observe" ? { 29: "oracle_mismatch" } : {},
      );
    }

    expect(recorder.performance().window_visual_observe).toEqual({
      sample_count: 30,
      correct_count: 29,
      failed_count: 1,
      success_rate: 29 / 30,
      p50_ms: 15,
      p95_ms: 29,
      max_ms: 30,
      slo: { p50_ms: 700, p95_ms: 1_500 },
      latency_status: "passed",
      correctness_status: "failed",
      failure_counts: { oracle_mismatch: 1 },
      route_counts: {},
      stages: expect.any(Object),
      status: "failed",
    });
  });

  it("counts telemetry failures without inventing missing stage values", () => {
    const recorder = new PerformanceRecorder();

    for (const name of SCENARIO_NAMES) {
      for (let index = 0; index < 5; index += 1) {
        recorder.recordWarmup(name, {
          durationMs: 0,
          outcome: "passed",
          stages: { tool_total: 999 },
          ...actionRoute(name),
        });
      }
      for (let index = 0; index < 30; index += 1) {
        recorder.recordMeasured(name, {
          durationMs: index + 1,
          outcome: name === "window_visual_observe" && index === 29
            ? "telemetry_missing"
            : "passed",
          stages: index === 29 ? {} : { tool_total: index + 1 },
          ...actionRoute(name),
        });
      }
    }

    expect(recorder.performance().window_visual_observe).toEqual(expect.objectContaining({
      correct_count: 29,
      failed_count: 1,
      failure_counts: { telemetry_missing: 1 },
      stages: {
        tool_total: { sample_count: 29, p50_ms: 15, p95_ms: 28, max_ms: 29 },
      },
      correctness_status: "failed",
      status: "failed",
    }));
  });

  it.each([
    ["negative", -1],
    ["NaN", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
  ])("rejects a %s supplied stage timing", (_label, invalidTiming) => {
    const recorder = new PerformanceRecorder();

    expect(() => recorder.recordWarmup("window_visual_observe", {
      durationMs: 1,
      outcome: "passed",
      stages: { projection: invalidTiming },
    })).toThrow("invalid_performance_sample");
  });

  it("omits stage aggregates when no measured sample supplies the stage", () => {
    const recorder = new PerformanceRecorder();

    for (const name of SCENARIO_NAMES) {
      for (let index = 0; index < 5; index += 1) {
        recorder.recordWarmup(name, {
          durationMs: 1,
          outcome: "passed",
          stages: { engine_execute: 999 },
          ...actionRoute(name),
        });
      }
      for (let index = 0; index < 30; index += 1) {
        recorder.recordMeasured(name, {
          durationMs: 1,
          outcome: "passed",
          stages: {},
          ...actionRoute(name),
        });
      }
    }

    expect(recorder.performance().window_visual_observe.stages).toEqual({});
  });

  it("fails latency independently when correctness is complete", () => {
    const recorder = new PerformanceRecorder();

    for (const name of SCENARIO_NAMES) {
      for (let index = 0; index < 5; index += 1) {
        recorder.recordWarmup(name, {
          durationMs: 1,
          outcome: "passed",
          stages: {},
          ...actionRoute(name),
        });
      }
      for (let index = 0; index < 30; index += 1) {
        recorder.recordMeasured(name, {
          durationMs: name === "window_visual_observe" ? 1_501 : 1,
          outcome: "passed",
          stages: {},
          ...actionRoute(name),
        });
      }
    }

    expect(recorder.performance().window_visual_observe).toEqual(expect.objectContaining({
      correct_count: 30,
      correctness_status: "passed",
      latency_status: "failed",
      status: "failed",
    }));
  });

  it("supports every declared failure kind as a closed outcome set", () => {
    const recorder = new PerformanceRecorder();
    const outcomes: readonly PerformanceOutcome[] = [
      "tool_error",
      "contract_mismatch",
      "oracle_mismatch",
      "target_lost",
      "fixture_unavailable",
      "telemetry_missing",
    ];

    for (const name of SCENARIO_NAMES) {
      recordCompleteScenario(
        recorder,
        name,
        name === "window_visual_observe"
          ? Object.fromEntries(outcomes.map((outcome, index) => [index, outcome]))
          : {},
      );
    }

    expect(recorder.performance().window_visual_observe.failure_counts).toEqual({
      tool_error: 1,
      contract_mismatch: 1,
      oracle_mismatch: 1,
      target_lost: 1,
      fixture_unavailable: 1,
      telemetry_missing: 1,
    });
  });

  it("rejects undeclared stage keys at runtime", () => {
    const recorder = new PerformanceRecorder();
    const stages = { unredacted_private_stage: 1 } as unknown as Partial<
      Record<PerformanceStageName, number>
    >;

    expect(() => recorder.recordWarmup("window_visual_observe", {
      durationMs: 1,
      outcome: "passed",
      stages,
    })).toThrow("invalid_performance_sample");
  });

  it("rejects 29 measured samples and a 31st measured sample", () => {
    const recorder = new PerformanceRecorder();

    for (const name of SCENARIO_NAMES) {
      const sample = {
        durationMs: 1,
        outcome: "passed",
        stages: {},
        ...actionRoute(name),
      } as const;
      for (let index = 0; index < 5; index += 1) recorder.recordWarmup(name, sample);
      const count = name === "window_visual_observe" ? 29 : 30;
      for (let index = 0; index < count; index += 1) recorder.recordMeasured(name, sample);
    }

    expect(() => recorder.performance()).toThrow("invalid_performance_samples");
    const sample = { durationMs: 1, outcome: "passed", stages: {} } as const;
    recorder.recordMeasured("window_visual_observe", sample);
    expect(() => recorder.recordMeasured("window_visual_observe", sample))
      .toThrow("performance_sample_limit:window_visual_observe");
  });

  it("rejects an undeclared outcome at runtime", () => {
    const recorder = new PerformanceRecorder();

    expect(() => recorder.recordWarmup("window_visual_observe", {
      durationMs: 1,
      outcome: "private_failure" as PerformanceOutcome,
      stages: {},
    })).toThrow("invalid_performance_sample");
  });

  it("enforces five warm-ups and exactly 30 measured results per fixed scenario", () => {
    const recorder = new PerformanceRecorder();
    const sample = { durationMs: 1, outcome: "passed", stages: {} } as const;

    expect(() => recorder.recordMeasured("window_visual_observe", sample))
      .toThrow("performance_warmups_incomplete:window_visual_observe");

    for (let index = 0; index < 5; index += 1) {
      recorder.recordWarmup("window_visual_observe", sample);
    }
    expect(() => recorder.recordWarmup("window_visual_observe", sample))
      .toThrow("performance_warmup_limit:window_visual_observe");

    for (let index = 0; index < 30; index += 1) {
      recorder.recordMeasured("window_visual_observe", sample);
    }
    expect(() => recorder.recordMeasured("window_visual_observe", sample))
      .toThrow("performance_sample_limit:window_visual_observe");
    expect(() => recorder.performance()).toThrow("invalid_performance_samples");
  });
});
