import { describe, expect, it } from "vitest";

import { SingleProfileRecorder } from "../e2e/development/single-profile-recorder.js";
import type { PerformanceSample } from "../e2e/development/performance-recorder.js";

const METADATA = {
  product_version: "0.2.6",
  protocol_version: "1.2.0",
  engine_version: "0.22.2",
  macos_version: "15.6.1",
  architecture: "arm64",
} as const;

function pixelSample(durationMs: number, outcome: PerformanceSample["outcome"] = "passed"): PerformanceSample {
  return {
    durationMs,
    outcome,
    route: "synthetic_events",
    stages: {
      queue_wait: 1,
      engine_execute: 2,
      post_action_observe: 3,
      projection: 4,
      tool_total: durationMs,
      transport_overhead: 5,
    },
  };
}

function complete(recorder: SingleProfileRecorder): void {
  for (let index = 0; index < 5; index += 1) recorder.recordWarmup(pixelSample(999));
  for (let index = 0; index < 30; index += 1) recorder.recordMeasured(pixelSample(index + 1));
}

describe("SingleProfileRecorder", () => {
  it("emits one redacted 5-warm-up/30-measured profile artifact", () => {
    const recorder = new SingleProfileRecorder("pixel_action_next_state");
    complete(recorder);

    const evidence = recorder.evidence(METADATA, true, "2026-08-31T00:00:00.000Z");

    expect(evidence).toEqual({
      schema_version: 1,
      evidence_type: "computer-use-macos-development-profile",
      status: "passed",
      metadata: METADATA,
      profile_name: "pixel_action_next_state",
      performance: expect.objectContaining({
        sample_count: 30,
        correct_count: 30,
        route_counts: { synthetic_events: 30 },
        status: "passed",
      }),
      cleanup_passed: true,
      timestamp: "2026-08-31T00:00:00.000Z",
    });
    expect(JSON.stringify(evidence)).not.toContain("samples");
    expect(JSON.stringify(evidence)).not.toContain("999");
  });

  it("fails closed on incomplete sampling or cleanup", () => {
    const recorder = new SingleProfileRecorder("pixel_action_next_state");

    expect(() => recorder.evidence(METADATA, true)).toThrow("invalid_performance_samples");
    complete(recorder);
    expect(() => recorder.evidence(METADATA, false)).toThrow("profile_cleanup_failed");
  });

  it("derives failed status from correctness without rewriting the measured result", () => {
    const recorder = new SingleProfileRecorder("pixel_action_next_state");
    for (let index = 0; index < 5; index += 1) recorder.recordWarmup(pixelSample(1));
    for (let index = 0; index < 30; index += 1) {
      recorder.recordMeasured(pixelSample(index + 1, index === 29 ? "oracle_mismatch" : "passed"));
    }

    expect(recorder.evidence(METADATA, true)).toMatchObject({
      status: "failed",
      performance: {
        correct_count: 29,
        failed_count: 1,
        failure_counts: { oracle_mismatch: 1 },
        status: "failed",
      },
    });
  });
});
