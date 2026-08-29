import { describe, expect, it } from "vitest";

import { RuntimeTiming } from "../../src/logging/timing.js";

describe("RuntimeTiming", () => {
  it("accumulates repeated phases and reports nonnegative integer milliseconds", async () => {
    let now = 100;
    const timing = new RuntimeTiming(() => now);

    now = 107.2;
    timing.markDequeued();
    await timing.measure("postActionObserveMs", async () => { now = 117.4; });
    await timing.measure("postActionObserveMs", async () => { now = 120.1; });
    timing.measureSync("projectionMs", () => { now = 121.2; });

    expect(timing.finish()).toEqual({
      queueWaitMs: 8,
      postActionObserveMs: 13,
      projectionMs: 2,
      toolTotalMs: 22,
    });
  });

  it("returns one frozen snapshot and omits phases that were not measured", () => {
    let now = 10;
    const timing = new RuntimeTiming(() => now);
    now = 12.1;

    const first = timing.finish();
    now = 99;
    const second = timing.finish();

    expect(second).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first).toEqual({ queueWaitMs: 0, toolTotalMs: 3 });
    expect(first).not.toHaveProperty("engineExecuteMs");
  });

  it("retains elapsed time when a measured operation throws and rethrows unchanged", async () => {
    let now = 20;
    const timing = new RuntimeTiming(() => now);
    const failure = new Error("fixture failure");

    const thrown = await timing.measure("engineExecuteMs", async () => {
      now = 24.4;
      throw failure;
    }).catch((error: unknown) => error);

    expect(thrown).toBe(failure);
    expect(timing.finish()).toEqual({
      queueWaitMs: 0,
      engineExecuteMs: 5,
      toolTotalMs: 5,
    });
  });

  it("clamps backward clock readings to zero", () => {
    let now = 50;
    const timing = new RuntimeTiming(() => now);
    now = 40;
    timing.markDequeued();
    timing.measureSync("projectionMs", () => { now = 30; });

    expect(timing.finish()).toEqual({
      queueWaitMs: 0,
      projectionMs: 0,
      toolTotalMs: 0,
    });
  });
});
