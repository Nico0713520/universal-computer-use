import { describe, expect, it, vi } from "vitest";

import type {
  FocusSentinelState,
  HarnessState,
} from "../e2e/development/macos-acceptance-support.js";
import { preparePerformanceScenario } from "../e2e/development/performance-preparation.js";

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
  });

  it("resets only the owned sentinel text for semantic actions", async () => {
    const deps = dependencies();

    await expect(preparePerformanceScenario("semantic_action_next_state", deps))
      .resolves.toEqual({ kind: "semantic", sentinelState: SENTINEL_STATE });

    expect(deps.resetSentinelText).toHaveBeenCalledTimes(1);
    expect(deps.readFixtureState).not.toHaveBeenCalled();
  });

  it("reads but does not reset fixture state for pixel actions", async () => {
    const deps = dependencies();

    await expect(preparePerformanceScenario("pixel_action_next_state", deps))
      .resolves.toEqual({ kind: "pixel", fixtureState: FIXTURE_STATE });

    expect(deps.readFixtureState).toHaveBeenCalledTimes(1);
    expect(deps.resetSentinelText).not.toHaveBeenCalled();
  });
});
