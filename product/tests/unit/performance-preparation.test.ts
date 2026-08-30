import { describe, expect, it, vi } from "vitest";

import type {
  FocusSentinelState,
  HarnessState,
} from "../e2e/development/macos-acceptance-support.js";
import { AcceptanceTelemetryCollector } from
  "../e2e/development/macos-acceptance-telemetry.js";
import {
  establishPerformanceTelemetryBoundary,
  preparePerformanceScenario,
} from "../e2e/development/performance-preparation.js";

const FIXTURE_STATE: HarnessState = {
  reset_generation: 4,
  reset_ack_generation: 4,
  clicks: 9,
  pixel_clicks: 7,
  semantic_sequence: ["alpha"],
  text: "fixture",
  text_write_count: 2,
  overlay_enabled: false,
  overlay_clicks: 0,
};

const SENTINEL_STATE: FocusSentinelState = {
  reset_generation: 6,
  text: "",
  text_write_count: 0,
};

function dependencies() {
  return {
    readFixtureState: vi.fn(async () => FIXTURE_STATE),
    resetSentinelText: vi.fn(async () => SENTINEL_STATE),
    preparePixelTarget: vi.fn(async () => undefined),
  };
}

describe("preparePerformanceScenario", () => {
  it("does no fixture or sentinel preparation for observe scenarios", async () => {
    const deps = dependencies();

    await expect(preparePerformanceScenario("window_visual_observe", deps))
      .resolves.toEqual({ kind: "observe" });
    await expect(preparePerformanceScenario("window_semantic_observe", deps))
      .resolves.toEqual({ kind: "observe" });

    expect(deps.readFixtureState).not.toHaveBeenCalled();
    expect(deps.resetSentinelText).not.toHaveBeenCalled();
    expect(deps.preparePixelTarget).not.toHaveBeenCalled();
  });

  it("resets only the owned sentinel text for semantic actions", async () => {
    const deps = dependencies();

    await expect(preparePerformanceScenario("semantic_action_next_state", deps))
      .resolves.toEqual({ kind: "semantic", sentinelState: SENTINEL_STATE });

    expect(deps.resetSentinelText).toHaveBeenCalledTimes(1);
    expect(deps.readFixtureState).not.toHaveBeenCalled();
    expect(deps.preparePixelTarget).not.toHaveBeenCalled();
  });

  it("foregrounds the owned pixel target before reading its oracle state", async () => {
    const deps = dependencies();

    await expect(preparePerformanceScenario("pixel_action_next_state", deps))
      .resolves.toEqual({ kind: "pixel", fixtureState: FIXTURE_STATE });

    expect(deps.preparePixelTarget).toHaveBeenCalledTimes(1);
    expect(deps.readFixtureState).toHaveBeenCalledTimes(1);
    expect(deps.resetSentinelText).not.toHaveBeenCalled();
    expect(deps.preparePixelTarget.mock.invocationCallOrder[0])
      .toBeLessThan(deps.readFixtureState.mock.invocationCallOrder[0]!);
  });
});

describe("establishPerformanceTelemetryBoundary", () => {
  it("clears correctness telemetry immediately before measured profiles", () => {
    const telemetry = { clear: vi.fn() };

    establishPerformanceTelemetryBoundary(telemetry);

    expect(telemetry.clear).toHaveBeenCalledTimes(1);
  });

  it("drops correctness telemetry but accepts the first complete measured record", async () => {
    const telemetry = new AcceptanceTelemetryCollector();
    telemetry.ingest(`${JSON.stringify({
      tool_name: "computer_observe",
      timings: {
        queue_wait_ms: 0,
        post_action_observe_ms: 2,
        projection_ms: 1,
        tool_total_ms: 4,
      },
    })}\n`);

    establishPerformanceTelemetryBoundary(telemetry);
    const cursor = telemetry.cursor();
    telemetry.ingest(`${JSON.stringify({
      tool_name: "computer_observe",
      timings: {
        queue_wait_ms: 0,
        post_action_observe_ms: 3,
        projection_ms: 1,
        tool_total_ms: 5,
      },
    })}\n`);

    await expect(telemetry.waitForOne(cursor, "computer_observe", 10)).resolves.toEqual({
      queue_wait: 0,
      post_action_observe: 3,
      projection: 1,
      tool_total: 5,
    });
  });
});
