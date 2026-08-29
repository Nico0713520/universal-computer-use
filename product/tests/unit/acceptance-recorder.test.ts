import { describe, expect, it } from "vitest";

import {
  AcceptanceRecorder,
  type AcceptanceMetadata,
  type AcceptanceScenarioName,
  type AcceptanceTimingName,
} from "../e2e/development/acceptance-recorder.js";

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

    const evidence = recorder.evidence(METADATA, true);

    expect(evidence.status).toBe("degraded");
    expect(evidence.timings).toEqual([
      { name: "mcp_start", duration_ms: 2_000, target_ms: 2_000, hard_limit_ms: 10_000, status: "target_met" },
      { name: "desktop_observe", duration_ms: 1_001, target_ms: 1_000, hard_limit_ms: 3_000, status: "degraded" },
      { name: "window_discover", duration_ms: 1, target_ms: 1_000, hard_limit_ms: 3_000, status: "target_met" },
      { name: "window_observe", duration_ms: 1, target_ms: 1_000, hard_limit_ms: 3_000, status: "target_met" },
      { name: "coordinate_action", duration_ms: 3_000, target_ms: 1_000, hard_limit_ms: 3_000, status: "degraded" },
      { name: "element_action", duration_ms: 1, target_ms: 3_000, hard_limit_ms: 8_000, status: "target_met" },
      { name: "mcp_reconnect", duration_ms: 1, target_ms: 2_000, hard_limit_ms: 10_000, status: "target_met" },
    ]);
    expect(JSON.stringify(evidence)).not.toMatch(/screenshot|opaque-ref|token/);
  });

  it("records a hard-limit failure and rejects only after a successful operation", async () => {
    let now = 0;
    const recorder = new AcceptanceRecorder(() => now);

    await expect(recorder.measure("element_action", async () => {
      now = 8_001;
      return "completed";
    })).rejects.toThrow("acceptance_timing_exceeded:element_action");

    expect(() => recorder.evidence(METADATA, true)).toThrow("acceptance_evidence_incomplete");
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

  it("requires every passing scenario, every timing and successful cleanup", async () => {
    const incomplete = await passingRecorder();
    incomplete.recordScenario("desktop_png", false);
    expect(() => incomplete.evidence(METADATA, true)).toThrow("acceptance_evidence_incomplete");

    const dirty = await passingRecorder();
    expect(() => dirty.evidence(METADATA, false)).toThrow("acceptance_cleanup_failed");
  });

  it("emits only the fixed metadata, scenario, timing, cleanup and timestamp fields", async () => {
    const evidence = (await passingRecorder()).evidence(METADATA, true);

    expect(Object.keys(evidence).sort()).toEqual([
      "cleanup_passed",
      "evidence_type",
      "metadata",
      "scenarios",
      "schema_version",
      "status",
      "timestamp",
      "timings",
    ]);
    expect(evidence).toMatchObject({
      schema_version: 1,
      evidence_type: "computer-use-macos-development-acceptance",
      status: "passed",
      metadata: METADATA,
      cleanup_passed: true,
      scenarios: Object.fromEntries(SCENARIO_NAMES.map((name) => [name, true])),
    });
    expect(Number.isNaN(Date.parse(evidence.timestamp))).toBe(false);
  });
});
