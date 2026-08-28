import { afterEach, describe, expect, it, vi } from "vitest";

import { ComputerUseError } from "../../src/errors.js";
import type { ActInput, ComputerAction } from "../../src/protocol.js";
import { fixtureRuntime } from "../helpers/fake-engine.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ComputerUseRuntime.act", () => {
  it.each<ComputerAction>([
    { type: "click", x: 100, y: 20 },
    { type: "double_click", x: 10, y: 80 },
    { type: "right_click", x: 100, y: 80 },
    { type: "move", x: 10, y: 80 },
    {
      type: "drag",
      from_x: 1,
      from_y: 2,
      to_x: 100,
      to_y: 4,
      duration_ms: 200,
    },
    {
      type: "scroll",
      x: 100,
      y: 20,
      direction: "down",
      amount: 5,
      by: "line",
    },
  ])("rejects out-of-bounds $type coordinates without consuming", async (action) => {
    const { runtime, engine } = fixtureRuntime({ width: 100, height: 80 });
    const observed = await runtime.observe();

    await expect(
      runtime.act({ snapshot_id: observed.structured.snapshot_id, action }),
    ).rejects.toMatchObject({
      code: "coordinate_out_of_bounds",
      recovery: "observe_again",
      retryable: true,
    });
    expect(engine.executions).toHaveLength(0);

    const retry = await runtime.act({
      snapshot_id: observed.structured.snapshot_id,
      action: { type: "wait", ms: 0 },
    });
    expect(retry.structured.consumed_snapshot_id).toBe(observed.structured.snapshot_id);
  });

  it("consumes before action and returns a new screenshot after failure", async () => {
    const { runtime, engine } = fixtureRuntime({ actionError: "action_failed" });
    const observed = await runtime.observe();

    const result = await runtime.act({
      snapshot_id: observed.structured.snapshot_id,
      action: { type: "click", x: 10, y: 10 },
    });

    expect(result.structured.action_result).toEqual({
      status: "failed",
      effect: "unverifiable",
      route: "unknown",
      delivery: "unknown",
      evidence: [],
      error_code: "action_failed",
    });
    expect(result.structured.next_state).toBe("available");
    if (result.structured.next_state !== "available") throw new Error("expected next observation");
    expect(result.structured.snapshot_id).not.toBe(observed.structured.snapshot_id);
    await expect(
      runtime.act({
        snapshot_id: observed.structured.snapshot_id,
        action: { type: "wait", ms: 0 },
      }),
    ).rejects.toMatchObject({ code: "stale_snapshot" });
    expect(engine.observations).toBe(2);
    expect(engine.executions).toHaveLength(1);
  });

  it.each<ComputerAction>([
    { type: "type", text: "hello" },
    { type: "keypress", keys: ["cmd", "s"] },
    { type: "wait", ms: 0 },
  ])("executes coordinate-free $type actions", async (action) => {
    const { runtime, engine } = fixtureRuntime({ width: 1, height: 1 });
    const observed = await runtime.observe();

    const result = await runtime.act({
      snapshot_id: observed.structured.snapshot_id,
      action,
    });

    expect(result.structured.action_result.status).toBe("executed");
    expect(engine.executions).toEqual([action]);
  });

  it("recaptures immediately without an implicit post-action delay", async () => {
    const timer = vi.spyOn(globalThis, "setTimeout");
    const { runtime, engine } = fixtureRuntime();
    const observed = await runtime.observe();
    timer.mockClear();

    await runtime.act({
      snapshot_id: observed.structured.snapshot_id,
      action: { type: "click", x: 10, y: 10 },
    });

    expect(engine.events).toEqual(["observe", "execute:click", "observe"]);
    expect(timer.mock.calls.map((call) => call[1])).toEqual([20_000, 20_000]);
  });

  it("maps an unknown action throw to a failed result and still recaptures", async () => {
    const { runtime } = fixtureRuntime({ actionError: new Error("transport detail") });
    const observed = await runtime.observe();

    const result = await runtime.act({
      snapshot_id: observed.structured.snapshot_id,
      action: { type: "wait", ms: 0 },
    });

    expect(result.structured.action_result.error_code).toBe("action_failed");
    expect(result.structured.next_state).toBe("available");
    if (result.structured.next_state !== "available") throw new Error("expected next observation");
    expect(result.structured.snapshot_id).not.toBe(observed.structured.snapshot_id);
  });

  it("retries one explicitly retryable capture failure after the action", async () => {
    const { runtime, engine } = fixtureRuntime({
      observationSequence: ["success", "capture_failed", "success"],
    });
    const observed = await runtime.observe();

    const result = await runtime.act({
      snapshot_id: observed.structured.snapshot_id,
      action: { type: "click", x: 10, y: 10 },
    });

    expect(result.structured.next_state).toBe("available");
    if (result.structured.next_state !== "available") throw new Error("expected next observation");
    expect(result.structured.snapshot_id).not.toBe(observed.structured.snapshot_id);
    expect(engine.observations).toBe(3);
    expect(engine.executions).toHaveLength(1);
  });

  it("does not create a snapshot or repeat the action when both recaptures fail", async () => {
    const { runtime, engine } = fixtureRuntime({
      observationSequence: ["success", "capture_failed", "capture_failed"],
    });
    const observed = await runtime.observe();

    await expect(
      runtime.act({
        snapshot_id: observed.structured.snapshot_id,
        action: { type: "click", x: 10, y: 10 },
      }),
    ).rejects.toMatchObject({ code: "capture_failed" });
    expect(engine.observations).toBe(3);
    expect(engine.executions).toHaveLength(1);
    await expect(
      runtime.act({
        snapshot_id: observed.structured.snapshot_id,
        action: { type: "wait", ms: 0 },
      }),
    ).rejects.toMatchObject({ code: "stale_snapshot" });
  });

  it.each([
    new ComputerUseError(
      "capture_failed",
      "permanent capture failure",
      "observe_again",
      false,
    ),
    new ComputerUseError(
      "action_failed",
      "wrong failure class",
      "observe_again",
      true,
    ),
  ])("does not retry a recapture error unless it is retryable capture_failed", async (error) => {
    const { runtime, engine } = fixtureRuntime({
      observationSequence: ["success", error, "success"],
    });
    const observed = await runtime.observe();

    await expect(
      runtime.act({
        snapshot_id: observed.structured.snapshot_id,
        action: { type: "wait", ms: 0 },
      }),
    ).rejects.toBe(error);
    expect(engine.observations).toBe(2);
    expect(engine.executions).toHaveLength(1);
  });

  it("times out one action at exactly twenty seconds without replaying it", async () => {
    vi.useFakeTimers();
    const { runtime, engine } = fixtureRuntime({ hangAction: true });
    const observed = await runtime.observe();

    const pending = runtime.act({
      snapshot_id: observed.structured.snapshot_id,
      action: { type: "click", x: 10, y: 10 },
    });
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await vi.advanceTimersByTimeAsync(19_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    const result = await pending;
    expect(result.structured.action_result).toEqual({
      status: "failed",
      effect: "unverifiable",
      route: "unknown",
      delivery: "unknown",
      evidence: [],
      error_code: "action_timeout",
    });
    expect(engine.executions).toHaveLength(1);
    expect(engine.observations).toBe(2);
  });

  it("executes only one of two concurrent actions bound to the same snapshot", async () => {
    const { runtime, engine } = fixtureRuntime();
    const observed = await runtime.observe();
    const input: ActInput = {
      snapshot_id: observed.structured.snapshot_id,
      action: { type: "click", x: 10, y: 10 },
    };

    const [first, second] = await Promise.allSettled([
      runtime.act(input),
      runtime.act(input),
    ]);

    expect(first.status).toBe("fulfilled");
    expect(second).toMatchObject({
      status: "rejected",
      reason: { code: "stale_snapshot" },
    });
    expect(engine.executions).toHaveLength(1);
  });

  it("serializes observe behind an action in public invocation order", async () => {
    vi.useFakeTimers();
    const { runtime, engine } = fixtureRuntime({ hangAction: true });
    const observed = await runtime.observe();

    const action = runtime.act({
      snapshot_id: observed.structured.snapshot_id,
      action: { type: "click", x: 10, y: 10 },
    });
    const observation = runtime.observe();
    await Promise.resolve();

    expect(engine.events).toEqual(["observe", "execute:click"]);
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(action).resolves.toMatchObject({
      structured: { action_result: { error_code: "action_timeout" } },
    });
    await expect(observation).resolves.toMatchObject({
      structured: { display_id: "primary" },
    });
    expect(engine.events).toEqual([
      "observe",
      "execute:click",
      "observe",
      "observe",
    ]);
  });

  it("closes idempotently through the FIFO and aborts the active lifecycle", async () => {
    vi.useFakeTimers();
    const { runtime, engine } = fixtureRuntime({ hangAction: true });
    const observed = await runtime.observe();
    const action = runtime.act({
      snapshot_id: observed.structured.snapshot_id,
      action: { type: "click", x: 10, y: 10 },
    });
    const actionOutcome = action.then(
      () => undefined,
      (error: unknown) => error,
    );
    await Promise.resolve();
    expect(engine.events).toEqual(["observe", "execute:click"]);

    const firstClose = runtime.close();
    const secondClose = runtime.close();

    expect(secondClose).toBe(firstClose);
    await expect(actionOutcome).resolves.toMatchObject({
      code: "runtime_unavailable",
      recovery: "stop",
      retryable: false,
    });
    await expect(firstClose).resolves.toBeUndefined();
    expect(engine.executions).toHaveLength(1);
    expect(engine.observations).toBe(1);
    expect(engine.closes).toBe(1);
    expect(engine.events).toEqual(["observe", "execute:click", "close"]);

    await expect(runtime.observe()).rejects.toMatchObject({
      code: "runtime_unavailable",
    });
    expect(engine.observations).toBe(1);
  });
});
