import { describe, expect, it } from "vitest";

import {
  AcceptanceRecorder,
  type AcceptanceMetadata,
  type AcceptanceScenarioName,
  type AcceptanceTimingName,
} from "../e2e/development/acceptance-recorder.js";
import type { CorrectnessAwarePerformanceEvidence } from "../e2e/development/performance-recorder.js";

const TIMING_NAMES: readonly AcceptanceTimingName[] = [
  "mcp_start",
  "desktop_observe",
  "window_discover",
  "window_observe",
  "coordinate_action",
  "element_action",
  "mcp_reconnect",
];

const SCENARIO_NAMES: readonly AcceptanceScenarioName[] = [
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

const METADATA: AcceptanceMetadata = {
  product_version: "0.2.4",
  protocol_version: "1.2.0",
  engine_version: "0.22.2",
  macos_version: "15.6.1",
  architecture: "arm64",
};

const OBSERVE_STAGES = {
  queue_wait: { sample_count: 30, p50_ms: 1, p95_ms: 2, max_ms: 3 },
  post_action_observe: { sample_count: 30, p50_ms: 50, p95_ms: 60, max_ms: 70 },
  projection: { sample_count: 30, p50_ms: 2, p95_ms: 3, max_ms: 4 },
  tool_total: { sample_count: 30, p50_ms: 55, p95_ms: 65, max_ms: 75 },
  transport_overhead: { sample_count: 30, p50_ms: 5, p95_ms: 6, max_ms: 7 },
} as const;

const ACTION_STAGES = {
  ...OBSERVE_STAGES,
  engine_execute: { sample_count: 30, p50_ms: 20, p95_ms: 25, max_ms: 30 },
} as const;

const PASSING_PERFORMANCE: CorrectnessAwarePerformanceEvidence = {
  window_visual_observe: {
    sample_count: 30,
    correct_count: 30,
    failed_count: 0,
    success_rate: 1,
    p50_ms: 500,
    p95_ms: 1_200,
    max_ms: 1_300,
    slo: { p50_ms: 700, p95_ms: 1_500 },
    latency_status: "passed",
    correctness_status: "passed",
    failure_counts: {},
    route_counts: {},
    stages: OBSERVE_STAGES,
    status: "passed",
  },
  window_semantic_observe: {
    sample_count: 30,
    correct_count: 30,
    failed_count: 0,
    success_rate: 1,
    p50_ms: 300,
    p95_ms: 800,
    max_ms: 900,
    slo: { p50_ms: 400, p95_ms: 1_000 },
    latency_status: "passed",
    correctness_status: "passed",
    failure_counts: {},
    route_counts: {},
    stages: OBSERVE_STAGES,
    status: "passed",
  },
  semantic_action_next_state: {
    sample_count: 30,
    correct_count: 30,
    failed_count: 0,
    success_rate: 1,
    p50_ms: 800,
    p95_ms: 1_800,
    max_ms: 1_900,
    slo: { p50_ms: 1_500, p95_ms: 2_000 },
    latency_status: "passed",
    correctness_status: "passed",
    failure_counts: {},
    route_counts: { accessibility: 30 },
    stages: ACTION_STAGES,
    status: "passed",
  },
  pixel_action_next_state: {
    sample_count: 30,
    correct_count: 30,
    failed_count: 0,
    success_rate: 1,
    p50_ms: 1_200,
    p95_ms: 2_800,
    max_ms: 2_900,
    slo: { p50_ms: 1_500, p95_ms: 3_000 },
    latency_status: "passed",
    correctness_status: "passed",
    failure_counts: {},
    route_counts: { synthetic_events: 30 },
    stages: ACTION_STAGES,
    status: "passed",
  },
};

const PASSING_REAL_APP_SMOKE = {
  calculator_703: true,
  textedit_unique_value: true,
  textedit_single_write: true,
} as const;

const PASSING_ADAPTIVE_CORRECTNESS = {
  no_fixed_action_delay: true,
  semantic_sequence: true,
  pixel_once: true,
  unique_input_once: true,
  visual_recovery_once: true,
  focus_preserved: true,
} as const;

function evidence(
  recorder: AcceptanceRecorder,
  cleanupPassed = true,
  performance = PASSING_PERFORMANCE,
  realAppSmoke: {
    calculator_703: boolean;
    textedit_unique_value: boolean;
    textedit_single_write: boolean;
    error_code?: "calculator_unavailable" | "textedit_unavailable" | "unsupported_locale" | "verification_failed";
    cleanup_failed?: true;
  } = PASSING_REAL_APP_SMOKE,
) {
  return recorder.evidence(
    METADATA,
    cleanupPassed,
    performance,
    realAppSmoke,
    PASSING_ADAPTIVE_CORRECTNESS,
  );
}

async function passingRecorder(): Promise<AcceptanceRecorder> {
  let now = 0;
  const recorder = new AcceptanceRecorder(() => now);

  for (const name of TIMING_NAMES) {
    await recorder.measure(name, async () => {
      now += 1;
    });
  }
  for (const name of SCENARIO_NAMES) recorder.recordScenario(name, true);

  return recorder;
}

describe("AcceptanceRecorder", () => {
  it("classifies exact target and hard-limit boundaries without persisting operation context", async () => {
    let now = 0;
    const recorder = new AcceptanceRecorder(() => now);

    await recorder.measure("mcp_start", async () => {
      now = 2_000;
      return { screenshot: "must-not-be-recorded", token: "opaque-ref" };
    });
    await recorder.measure("desktop_observe", async () => {
      now += 1_001;
    });
    await recorder.measure("window_discover", async () => { now += 1; });
    await recorder.measure("window_observe", async () => { now += 1; });
    await recorder.measure("coordinate_action", async () => { now += 3_000; });
    await recorder.measure("element_action", async () => { now += 1; });
    await recorder.measure("mcp_reconnect", async () => { now += 1; });
    for (const name of SCENARIO_NAMES) recorder.recordScenario(name, true);

    const result = evidence(recorder);

    expect(result.status).toBe("degraded");
    expect(result.timings).toEqual([
      { name: "mcp_start", duration_ms: 2_000, target_ms: 2_000, hard_limit_ms: 10_000, status: "target_met" },
      { name: "desktop_observe", duration_ms: 1_001, target_ms: 1_000, hard_limit_ms: 3_000, status: "degraded" },
      { name: "window_discover", duration_ms: 1, target_ms: 1_000, hard_limit_ms: 3_000, status: "target_met" },
      { name: "window_observe", duration_ms: 1, target_ms: 1_000, hard_limit_ms: 3_000, status: "target_met" },
      { name: "coordinate_action", duration_ms: 3_000, target_ms: 1_000, hard_limit_ms: 3_000, status: "degraded" },
      { name: "element_action", duration_ms: 1, target_ms: 3_000, hard_limit_ms: 8_000, status: "target_met" },
      { name: "mcp_reconnect", duration_ms: 1, target_ms: 2_000, hard_limit_ms: 10_000, status: "target_met" },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/screenshot|opaque-ref|token/);
  });

  it("records a hard-limit failure and emits complete failed evidence", async () => {
    let now = 0;
    const recorder = new AcceptanceRecorder(() => now);

    await expect(recorder.measure("element_action", async () => {
      now = 8_001;
      return "completed";
    })).resolves.toBe("completed");

    for (const name of TIMING_NAMES.filter((name) => name !== "element_action")) {
      await recorder.measure(name, async () => { now += 1; });
    }
    for (const name of SCENARIO_NAMES) recorder.recordScenario(name, true);

    const result = evidence(recorder);
    expect(result.status).toBe("failed");
    expect(result.timings.find((timing) => timing.name === "element_action")).toMatchObject({
      duration_ms: 8_001,
      status: "failed",
    });
  });

  it("rethrows operation failures unchanged while still recording elapsed time", async () => {
    let now = 0;
    const recorder = new AcceptanceRecorder(() => now);
    const failure = new Error("fixture_failed");

    await expect(recorder.measure("window_observe", async () => {
      now = 4_000;
      throw failure;
    })).rejects.toBe(failure);
  });

  it("can explicitly complete a failed timing when a correctness precondition is absent", async () => {
    const recorder = await passingRecorder();

    recorder.recordFailedTiming("element_action");

    const result = evidence(recorder);
    expect(result.status).toBe("failed");
    expect(result.timings.find((timing) => timing.name === "element_action")).toEqual({
      name: "element_action",
      duration_ms: 0,
      target_ms: 3_000,
      hard_limit_ms: 8_000,
      status: "failed",
    });
  });

  it("requires every recorded scenario and timing but preserves a false scenario as failed evidence", async () => {
    const failed = await passingRecorder();
    failed.recordScenario("desktop_png", false);
    const result = evidence(failed);
    expect(result.status).toBe("failed");
    expect(result.scenarios.desktop_png).toBe(false);

    const incomplete = new AcceptanceRecorder();
    expect(() => evidence(incomplete)).toThrow("acceptance_evidence_incomplete");

    const dirty = await passingRecorder();
    expect(() => evidence(dirty, false)).toThrow("acceptance_cleanup_failed");
  });

  it("emits only the fixed schema-v4 aggregate, smoke and legacy acceptance fields", async () => {
    const result = evidence(await passingRecorder());

    expect(Object.keys(result).sort()).toEqual([
      "adaptive_correctness",
      "cleanup_passed",
      "evidence_type",
      "metadata",
      "performance",
      "real_app_smoke",
      "scenarios",
      "schema_version",
      "status",
      "timestamp",
      "timings",
    ]);
    expect(result).toMatchObject({
      schema_version: 4,
      evidence_type: "computer-use-macos-development-acceptance",
      status: "passed",
      metadata: METADATA,
      performance: PASSING_PERFORMANCE,
      real_app_smoke: PASSING_REAL_APP_SMOKE,
      adaptive_correctness: PASSING_ADAPTIVE_CORRECTNESS,
      cleanup_passed: true,
      scenarios: Object.fromEntries(SCENARIO_NAMES.map((name) => [name, true])),
    });
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
  });

  it("emits failed evidence for a failed aggregate or a false real-app smoke", async () => {
    const failedPerformance = {
      ...PASSING_PERFORMANCE,
      window_semantic_observe: {
        ...PASSING_PERFORMANCE.window_semantic_observe,
        correct_count: 29,
        failed_count: 1,
        success_rate: 29 / 30,
        correctness_status: "failed" as const,
        failure_counts: { oracle_mismatch: 1 },
        status: "failed" as const,
      },
    };

    expect(evidence(await passingRecorder(), true, failedPerformance).status).toBe("failed");
    expect(evidence(await passingRecorder(), true, PASSING_PERFORMANCE, {
      calculator_703: false,
      textedit_unique_value: true,
      textedit_single_write: true,
      error_code: "calculator_unavailable",
    }).status).toBe("failed");
    expect(evidence(await passingRecorder(), true, PASSING_PERFORMANCE, {
      ...PASSING_REAL_APP_SMOKE,
      cleanup_failed: true,
    }).status).toBe("failed");
  });

  it("fails evidence when any explicit adaptive correctness proof is false", async () => {
    const recorder = await passingRecorder();
    const result = recorder.evidence(
      METADATA,
      true,
      PASSING_PERFORMANCE,
      PASSING_REAL_APP_SMOKE,
      { ...PASSING_ADAPTIVE_CORRECTNESS, focus_preserved: false },
    );

    expect(result.status).toBe("failed");
    expect(result.adaptive_correctness.focus_preserved).toBe(false);
  });

  it("requires both aggregate performance and real-app smoke inputs", async () => {
    const recorder = await passingRecorder();

    expect(() => recorder.evidence(METADATA, true)).toThrow("acceptance_evidence_incomplete");
  });

  it.each([
    ["incorrect count sum", { correct_count: 29, failed_count: 0 }],
    ["incorrect success rate", { correct_count: 29, failed_count: 1, success_rate: 0.5 }],
    ["passed correctness at 29/30", {
      correct_count: 29,
      failed_count: 1,
      success_rate: 29 / 30,
      correctness_status: "passed",
      failure_counts: { oracle_mismatch: 1 },
    }],
    ["failure count mismatch", {
      correct_count: 29,
      failed_count: 1,
      success_rate: 29 / 30,
      correctness_status: "failed",
      failure_counts: {},
      status: "failed",
    }],
    ["latency status mismatch", { latency_status: "failed" }],
    ["overall status mismatch", { status: "failed" }],
  ])("rejects %s instead of projecting an inconsistent profile", async (_label, mutation) => {
    const recorder = await passingRecorder();
    const invalid = {
      ...PASSING_PERFORMANCE,
      window_visual_observe: {
        ...PASSING_PERFORMANCE.window_visual_observe,
        ...mutation,
      },
    } as CorrectnessAwarePerformanceEvidence;

    expect(() => evidence(recorder, true, invalid)).toThrow("acceptance_evidence_incomplete");
  });

  it("requires every applicable stage with all 30 measured values", async () => {
    const recorder = await passingRecorder();
    const missingStage = structuredClone(PASSING_PERFORMANCE) as CorrectnessAwarePerformanceEvidence;
    delete (missingStage.semantic_action_next_state.stages as Record<string, unknown>).engine_execute;
    expect(() => evidence(recorder, true, missingStage)).toThrow("acceptance_evidence_incomplete");

    const partialStage = structuredClone(PASSING_PERFORMANCE) as CorrectnessAwarePerformanceEvidence;
    (partialStage.window_visual_observe.stages.tool_total as { sample_count: number }).sample_count = 29;
    expect(() => evidence(recorder, true, partialStage)).toThrow("acceptance_evidence_incomplete");
  });

  it("requires complete closed route counts for passed action profiles", async () => {
    const recorder = await passingRecorder();
    const missingRoutes = structuredClone(PASSING_PERFORMANCE) as CorrectnessAwarePerformanceEvidence;
    (missingRoutes.pixel_action_next_state as { route_counts: Record<string, number> }).route_counts = {};
    expect(() => evidence(recorder, true, missingRoutes))
      .toThrow("acceptance_evidence_incomplete");

    const privateRoute = structuredClone(PASSING_PERFORMANCE) as CorrectnessAwarePerformanceEvidence;
    (privateRoute.semantic_action_next_state.route_counts as Record<string, number>).private_route = 30;
    expect(() => evidence(recorder, true, privateRoute))
      .toThrow("acceptance_evidence_incomplete");

    const observeRoute = structuredClone(PASSING_PERFORMANCE) as CorrectnessAwarePerformanceEvidence;
    (observeRoute.window_visual_observe.route_counts as Record<string, number>).accessibility = 30;
    expect(() => evidence(recorder, true, observeRoute))
      .toThrow("acceptance_evidence_incomplete");
  });

  it("preserves a complete failed artifact when telemetry is missing for one measured call", async () => {
    const failed = structuredClone(PASSING_PERFORMANCE) as CorrectnessAwarePerformanceEvidence;
    const profile = failed.window_visual_observe as {
      correct_count: number;
      failed_count: number;
      success_rate: number;
      correctness_status: "passed" | "failed";
      failure_counts: Record<string, number>;
      stages: Record<string, { sample_count: number }>;
      status: "passed" | "failed";
    };
    profile.correct_count = 29;
    profile.failed_count = 1;
    profile.success_rate = 29 / 30;
    profile.correctness_status = "failed";
    profile.failure_counts = { telemetry_missing: 1 };
    profile.stages = structuredClone(OBSERVE_STAGES) as Record<string, { sample_count: number }>;
    profile.stages.tool_total!.sample_count = 29;
    profile.status = "failed";

    const result = evidence(await passingRecorder(), true, failed);
    expect(result.status).toBe("failed");
    expect(result.performance.window_visual_observe).toMatchObject({
      failure_counts: { telemetry_missing: 1 },
      stages: { tool_total: { sample_count: 29 } },
      status: "failed",
    });
  });

  it("copies the schema-v4 profile without retaining raw samples or unknown fields", async () => {
    const recorder = await passingRecorder();
    const withPrivateFields = structuredClone(PASSING_PERFORMANCE) as unknown as Record<string, Record<string, unknown>>;
    withPrivateFields.window_visual_observe.samples = [{ screenshot: "private" }];
    withPrivateFields.window_visual_observe.path = "/private/path";

    const result = evidence(
      recorder,
      true,
      withPrivateFields as unknown as CorrectnessAwarePerformanceEvidence,
    );
    expect(result.performance.window_visual_observe).toEqual(PASSING_PERFORMANCE.window_visual_observe);
    expect(JSON.stringify(result.performance)).not.toMatch(/samples|screenshot|private|path/);
  });
});
