import { describe, expect, it } from "vitest";

import { CursorAbRecorder } from "../e2e/development/cursor-ab-recorder.js";

const METADATA = {
  product_version: "0.2.8",
  engine_version: "0.22.2",
  macos_version: "15.6.1",
  architecture: "arm64",
} as const;

function complete(recorder: CursorAbRecorder): void {
  recorder.recordReadback("enabled", true);
  recorder.recordReadback("disabled", false);
  for (const mode of ["enabled", "disabled"] as const) {
    for (let index = 0; index < 5; index += 1) {
      recorder.recordWarmup(mode, { durationMs: 999, correct: true, route: "synthetic_events" });
    }
    for (let index = 0; index < 30; index += 1) {
      recorder.recordMeasured(mode, {
        durationMs: mode === "enabled" ? 100 + index : 20 + index,
        correct: true,
        route: "synthetic_events",
      });
    }
  }
}

describe("CursorAbRecorder", () => {
  it("reports same-target enabled/disabled aggregates without a fabricated speed threshold", () => {
    const recorder = new CursorAbRecorder();
    complete(recorder);

    expect(recorder.evidence(METADATA, {
      same_driver_process: true,
      same_session: true,
      same_target: true,
    }, true, "2026-08-31T00:00:00.000Z")).toEqual({
      schema_version: 1,
      evidence_type: "computer-use-macos-cursor-ab",
      status: "passed",
      metadata: METADATA,
      cursor_readback: { enabled: true, disabled: true },
      invariants: {
        same_driver_process: true,
        same_session: true,
        same_target: true,
      },
      modes: {
        enabled: {
          sample_count: 30,
          correct_count: 30,
          p50_ms: 114,
          p95_ms: 128,
          max_ms: 129,
          route_counts: { synthetic_events: 30 },
        },
        disabled: {
          sample_count: 30,
          correct_count: 30,
          p50_ms: 34,
          p95_ms: 48,
          max_ms: 49,
          route_counts: { synthetic_events: 30 },
        },
      },
      delta_ms: { p50: -80, p95: -80, max: -80 },
      cleanup_passed: true,
      timestamp: "2026-08-31T00:00:00.000Z",
    });
  });

  it("rejects missing readback, mixed routes, incorrect effects, changed invariants, and cleanup failure", () => {
    const cases: Array<(recorder: CursorAbRecorder) => void> = [
      (recorder) => recorder.recordReadback("disabled", true),
      (recorder) => recorder.recordMeasured("disabled", {
        durationMs: 1,
        correct: true,
        route: "accessibility" as never,
      }),
    ];

    for (const mutate of cases) {
      const recorder = new CursorAbRecorder();
      if (mutate === cases[0]) {
        recorder.recordReadback("enabled", true);
        expect(() => mutate(recorder)).toThrow("cursor_ab_evidence_incomplete");
        continue;
      }
      complete(recorder);
      expect(() => mutate(recorder)).toThrow();
    }

    const incorrect = new CursorAbRecorder();
    incorrect.recordReadback("enabled", true);
    incorrect.recordReadback("disabled", false);
    for (const mode of ["enabled", "disabled"] as const) {
      for (let index = 0; index < 5; index += 1) {
        incorrect.recordWarmup(mode, { durationMs: 1, correct: true, route: "synthetic_events" });
      }
      for (let index = 0; index < 30; index += 1) {
        incorrect.recordMeasured(mode, {
          durationMs: 1,
          correct: !(mode === "disabled" && index === 29),
          route: "synthetic_events",
        });
      }
    }
    expect(() => incorrect.evidence(METADATA, {
      same_driver_process: true,
      same_session: true,
      same_target: true,
    }, true)).toThrow("cursor_ab_evidence_incomplete");

    const completeRecorder = new CursorAbRecorder();
    complete(completeRecorder);
    expect(() => completeRecorder.evidence(METADATA, {
      same_driver_process: true,
      same_session: false,
      same_target: true,
    }, true)).toThrow("cursor_ab_evidence_incomplete");
    expect(() => completeRecorder.evidence(METADATA, {
      same_driver_process: true,
      same_session: true,
      same_target: true,
    }, false)).toThrow("cursor_ab_evidence_incomplete");
  });
});
