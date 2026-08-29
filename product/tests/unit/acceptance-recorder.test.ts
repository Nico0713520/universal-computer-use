import { describe, expect, it } from "vitest";

import {
  AcceptanceRecorder,
  type AcceptanceMetadata,
  type AcceptanceScenarioName,
  type AcceptanceTimingName,
} from "../e2e/development/acceptance-recorder.js";
import type { PerformanceEvidence } from "../e2e/development/performance-recorder.js";

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
  product_version: "0.2.2",
  protocol_version: "1.2.0",
  engine_version: "0.22.2",
  macos_version: "15.6.1",
  architecture: "arm64",
};

const PASSING_PERFORMANCE: PerformanceEvidence = {
  window_visual_observe: {
    sample_count: 30,
    p50_ms: 500,
    p95_ms: 1_200,
    max_ms: 1_300,
    slo: { p50_ms: 700, p95_ms: 1_500 },
    status: "passed",
  },
  window_semantic_observe: {
    sample_count: 30,
    p50_ms: 300,
    p95_ms: 800,
    max_ms: 900,
    slo: { p50_ms: 400, p95_ms: 1_000 },
    status: "passed",
  },
  semantic_action_next_state: {
    sample_count: 30,
    p50_ms: 800,
    p95_ms: 1_800,
    max_ms: 1_900,
    slo: { p50_ms: 1_000, p95_ms: 2_000 },
    status: "passed",
  },
  pixel_action_next_state: {
    sample_count: 30,
    p50_ms: 1_200,
    p95_ms: 2_800,
    max_ms: 2_900,
    slo: { p50_ms: 1_500, p95_ms: 3_000 },
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

  it("emits only the fixed schema-v2 aggregate, smoke and legacy acceptance fields", async () => {
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
      schema_version: 2,
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
});
