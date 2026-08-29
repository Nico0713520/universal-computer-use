import { describe, expect, it } from "vitest";

import {
  PerformanceRecorder,
  type PerformanceScenarioName,
  nearestRank,
  summarizeSamples,
} from "../e2e/development/performance-recorder.js";

const SCENARIO_NAMES: readonly PerformanceScenarioName[] = [
  "window_visual_observe",
  "window_semantic_observe",
  "semantic_action_next_state",
  "pixel_action_next_state",
];

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
  it("discards five warm-ups and emits only fixed aggregates for 30 measured results", () => {
    const recorder = new PerformanceRecorder();

    for (const name of SCENARIO_NAMES) {
      for (let index = 0; index < 5; index += 1) {
        recorder.recordWarmup(name, {
          durationMs: 99_999,
          correctnessPassed: false,
        });
      }
      for (let durationMs = 30; durationMs >= 1; durationMs -= 1) {
        recorder.recordMeasured(name, { durationMs, correctnessPassed: true });
      }
    }

    expect(recorder.performance()).toEqual({
      window_visual_observe: {
        sample_count: 30,
        p50_ms: 15,
        p95_ms: 29,
        max_ms: 30,
        slo: { p50_ms: 700, p95_ms: 1_500 },
        status: "passed",
      },
      window_semantic_observe: {
        sample_count: 30,
        p50_ms: 15,
        p95_ms: 29,
        max_ms: 30,
        slo: { p50_ms: 400, p95_ms: 1_000 },
        status: "passed",
      },
      semantic_action_next_state: {
        sample_count: 30,
        p50_ms: 15,
        p95_ms: 29,
        max_ms: 30,
        slo: { p50_ms: 1_000, p95_ms: 2_000 },
        status: "passed",
      },
      pixel_action_next_state: {
        sample_count: 30,
        p50_ms: 15,
        p95_ms: 29,
        max_ms: 30,
        slo: { p50_ms: 1_500, p95_ms: 3_000 },
        status: "passed",
      },
    });
  });

  it("keeps failed measured-call durations and fails a scenario on one correctness failure", () => {
    const recorder = new PerformanceRecorder();

    for (const name of SCENARIO_NAMES) {
      for (let index = 0; index < 5; index += 1) {
        recorder.recordWarmup(name, { durationMs: 0, correctnessPassed: true });
      }
      for (let index = 0; index < 30; index += 1) {
        recorder.recordMeasured(name, {
          durationMs: name === "window_visual_observe" && index === 29 ? 699 : 10,
          correctnessPassed: !(name === "window_visual_observe" && index === 29),
        });
      }
    }

    expect(recorder.performance().window_visual_observe).toEqual({
      sample_count: 30,
      p50_ms: 10,
      p95_ms: 10,
      max_ms: 699,
      slo: { p50_ms: 700, p95_ms: 1_500 },
      status: "failed",
    });
  });

  it("enforces five warm-ups and exactly 30 measured results per fixed scenario", () => {
    const recorder = new PerformanceRecorder();
    const sample = { durationMs: 1, correctnessPassed: true } as const;

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
