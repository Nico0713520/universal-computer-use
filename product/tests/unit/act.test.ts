import { afterEach, describe, expect, it, vi } from "vitest";

import { assertCoordinates } from "../../src/core/act.js";
import { ComputerUseRuntime } from "../../src/core/runtime.js";
import { ComputerUseError } from "../../src/errors.js";
import type {
  EngineAction,
  EngineDesktopObservation,
  EngineDiscoverInput,
  EngineDiscovery,
  EngineExecution,
  EngineObservation,
  EngineObserveInput,
  EnginePort,
} from "../../src/engine/port.js";
import type { ActInput, ComputerAction } from "../../src/protocol.js";
import { SnapshotStore, type SnapshotRecord } from "../../src/snapshot-store.js";
import { TargetRegistry } from "../../src/target-registry.js";
import { fixtureRuntime } from "../helpers/fake-engine.js";

class SemanticGuardEngine implements EnginePort {
  readonly name = "cua-driver" as const;
  readonly version = "0.22.2";
  readonly sessionId = "semantic-guard-session";
  readonly executions: EngineAction[] = [];

  async discover(_input: EngineDiscoverInput, _signal: AbortSignal): Promise<EngineDiscovery> {
    return { apps: [], windows: [] };
  }

  async observe(signal: AbortSignal): Promise<EngineDesktopObservation>;
  async observe(input: EngineObserveInput, signal: AbortSignal): Promise<EngineObservation>;
  async observe(
    inputOrSignal: EngineObserveInput | AbortSignal,
    maybeSignal?: AbortSignal,
  ): Promise<EngineObservation> {
    const signal = inputOrSignal instanceof AbortSignal ? inputOrSignal : maybeSignal!;
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    if (inputOrSignal instanceof AbortSignal || inputOrSignal.target.kind === "desktop") {
      return {
        platform: "macos",
        scaleFactor: 1,
        image: { mimeType: "image/png", dataBase64: "cG5n", width: 100, height: 80 },
      };
    }
    const base = {
      platform: "macos" as const,
      target: inputOrSignal.target.window,
      elements: [],
      elementsComplete: true,
    };
    return "includeScreenshot" in inputOrSignal && inputOrSignal.includeScreenshot
      ? {
          ...base,
          visualStatus: "available",
          image: { mimeType: "image/png", dataBase64: "d2luZG93", width: 100, height: 80 },
        }
      : { ...base, visualStatus: "not_requested" };
  }

  async execute(action: EngineAction, _signal: AbortSignal): Promise<EngineExecution> {
    this.executions.push(action);
    return {
      status: "executed",
      effect: "confirmed",
      route: "system_api",
      delivery: "not_applicable",
    };
  }

  async health(_signal: AbortSignal): Promise<boolean> { return true; }
  async close(): Promise<void> {}
}

function semanticWindowRuntime(): Readonly<{
  runtime: ComputerUseRuntime;
  engine: SemanticGuardEngine;
  snapshot: SnapshotRecord;
}> {
  const engine = new SemanticGuardEngine();
  const snapshotTokens = ["semanticSnapshotToken1", "semanticSnapshotToken2"];
  const snapshots = new SnapshotStore(() => 1, () => snapshotTokens.shift()!);
  const targets = new TargetRegistry({
    now: () => 1,
    token: (() => {
      const tokens = ["semanticAppToken1", "semanticWindowToken1"];
      return () => tokens.shift()!;
    })(),
  });
  const app = {
    nativeKey: "bundle:semantic-guard",
    displayName: "Semantic Guard",
    running: true,
    capabilities: ["windows"] as const,
    native: { platform: "macos", pid: 42 },
  };
  const window = targets.registerWindows([{
    nativeKey: "window:7",
    ownerKey: "pid:42",
    app,
    title: "Semantic Guard",
    bounds: { x: 0, y: 0, width: 100, height: 80 },
    focused: false,
    capabilities: ["observe", "keypress"] as const,
    native: { platform: "macos", pid: 42, window_id: 7 },
  }])[0]!;
  const snapshot = snapshots.create({
    sessionId: engine.sessionId,
    target: { kind: "window", windowRef: window.windowRef },
    observationMode: "semantic",
    visual: { status: "not_requested" },
    coordinateSpace: "window_screenshot_pixels",
    windowTarget: {
      windowRef: window.windowRef,
      appRef: window.appRef,
      nativeKey: window.nativeKey,
      ownerKey: window.ownerKey,
    },
    elements: [],
    observeOptions: { includeScreenshot: false, maxElements: 150, maxDepth: 12 },
  });
  return {
    runtime: new ComputerUseRuntime(engine, snapshots, targets),
    engine,
    snapshot,
  };
}

function semanticSnapshot(): SnapshotRecord {
  return {
    id: "snap_semantic123",
    sessionId: "session-test",
    target: { kind: "window", windowRef: "win_semantic123456" },
    visualStatus: "not_requested",
    observationMode: "semantic",
    coordinateSpace: "window_screenshot_pixels",
    windowTarget: {
      windowRef: "win_semantic123456",
      appRef: "app_semantic123456",
      nativeKey: "window:1",
      ownerKey: "pid:1",
    },
    observeOptions: { includeScreenshot: false, maxElements: 150, maxDepth: 12 },
    createdAtMs: 1,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ComputerUseRuntime.act", () => {
  it.each<ComputerAction>([
    { type: "type", x: 10, y: 11, text: "once" },
    { type: "type_text", x: 10, y: 11, text: "once" },
    { type: "keypress", x: 10, y: 11, keys: ["enter"] },
    { type: "click", x: 10, y: 11 },
    { type: "scroll", x: 10, y: 11, direction: "down", amount: 1 },
    { type: "drag", from_x: 10, from_y: 11, to_x: 20, to_y: 21 },
  ])("rejects coordinate action $type without a proven pixel frame", (action) => {
    expect(() => assertCoordinates(action, semanticSnapshot())).toThrowError(
      expect.objectContaining({ code: "pixel_frame_unproven" }),
    );
  });

  it.each<ComputerAction>([
    { type: "type", x: 10, y: 11, text: "once" },
    { type: "type_text", x: 10, y: 11, text: "once" },
    { type: "keypress", x: 10, y: 11, keys: ["enter"] },
    { type: "click", x: 10, y: 11 },
    { type: "scroll", x: 10, y: 11, direction: "down", amount: 1 },
    { type: "drag", from_x: 10, from_y: 11, to_x: 20, to_y: 21 },
  ])("rejects semantic-snapshot coordinate $type before execution without consuming", async (action) => {
    const { runtime, engine, snapshot } = semanticWindowRuntime();

    await expect(runtime.act({ snapshot_id: snapshot.id, action })).rejects.toMatchObject({
      code: "pixel_frame_unproven",
    });
    expect(engine.executions).toHaveLength(0);
    await expect(runtime.act({
      snapshot_id: snapshot.id,
      action: { type: "wait", ms: 0 },
    })).resolves.toMatchObject({
      structured: { consumed_snapshot_id: snapshot.id },
    });
    expect(engine.executions).toHaveLength(1);
    await runtime.close();
  });

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
    expect(engine.executions).toEqual([{ target: { kind: "desktop" }, action }]);
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

    await expect(runtime.act({
      snapshot_id: observed.structured.snapshot_id,
      action: { type: "click", x: 10, y: 10 },
    })).resolves.toMatchObject({
      structured: {
        next_state: "unavailable",
        next_observation_error: { code: "capture_failed" },
      },
    });
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

    const pending = runtime.act({
      snapshot_id: observed.structured.snapshot_id,
      action: { type: "wait", ms: 0 },
    });
    if (error.code === "capture_failed") {
      await expect(pending).resolves.toMatchObject({
        structured: { next_state: "unavailable" },
      });
    } else {
      await expect(pending).rejects.toBe(error);
    }
    expect(engine.observations).toBe(2);
    expect(engine.executions).toHaveLength(1);
  });

  it("returns a consumed error when one action times out without replaying it", async () => {
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

    await expect(pending).rejects.toMatchObject({
      code: "action_timeout",
      snapshotConsumed: true,
    });
    expect(engine.executions).toHaveLength(1);
    expect(engine.observations).toBe(1);
  });

  it("enforces the hard action deadline when the engine ignores AbortSignal", async () => {
    vi.useFakeTimers();
    const { runtime, engine } = fixtureRuntime({ ignoreActionAbort: true });
    const observed = await runtime.observe();
    const pending = runtime.act({
      snapshot_id: observed.structured.snapshot_id,
      action: { type: "click", x: 10, y: 10 },
    });
    const outcome = pending.then(
      () => ({ settled: true, error: undefined }),
      (error: unknown) => ({ settled: true, error }),
    );

    await vi.advanceTimersByTimeAsync(20_000);
    const marker = await Promise.race([
      outcome,
      Promise.resolve({ settled: false, error: undefined }),
    ]);

    expect(marker.settled).toBe(true);
    expect(marker.error).toMatchObject({ code: "action_timeout", snapshotConsumed: true });
    expect(engine.executions).toHaveLength(1);
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
    await expect(action).rejects.toMatchObject({
      code: "action_timeout",
      snapshotConsumed: true,
    });
    await expect(observation).resolves.toMatchObject({
      structured: { display_id: "primary" },
    });
    expect(engine.events).toEqual([
      "observe",
      "execute:click",
      "observe",
    ]);
  });

  it("does not consume or mutate while unhealthy and resumes only after health passes", async () => {
    const { runtime, engine } = fixtureRuntime({
      actionErrorSequence: ["engine_contract_changed", undefined],
      healthSequence: [false, true],
    });
    const first = await runtime.observe();
    await expect(runtime.act({
      snapshot_id: first.structured.snapshot_id,
      action: { type: "click", x: 10, y: 10 },
    })).rejects.toMatchObject({ code: "engine_contract_changed", snapshotConsumed: true });

    const fresh = await runtime.observe();
    const input: ActInput = {
      snapshot_id: fresh.structured.snapshot_id,
      action: { type: "click", x: 10, y: 10 },
    };
    await expect(runtime.act(input)).rejects.toMatchObject({ code: "engine_unhealthy" });
    expect(engine.executions).toHaveLength(1);

    await expect(runtime.act(input)).resolves.toMatchObject({
      structured: { action_result: { status: "executed" } },
    });
    expect(engine.executions).toHaveLength(2);
  });

  it.each(["engine_contract_changed", "engine_unhealthy"] as const)(
    "fails closed when desktop post-action observation reports %s",
    async (code) => {
      const critical = new ComputerUseError(code, code, "doctor", false);
      const { runtime, engine } = fixtureRuntime({
        observationSequence: ["success", critical, "success"],
        healthSequence: [false, true],
      });
      const observed = await runtime.observe();
      const firstInput = {
        snapshot_id: observed.structured.snapshot_id,
        action: { type: "wait" as const, ms: 0 },
      };

      await expect(runtime.act(firstInput)).rejects.toMatchObject({ code, snapshotConsumed: true });
      expect(engine.executions).toHaveLength(1);
      await expect(runtime.act(firstInput)).rejects.toMatchObject({ code: "stale_snapshot" });

      const fresh = await runtime.observe();
      const retryInput = {
        snapshot_id: fresh.structured.snapshot_id,
        action: { type: "wait" as const, ms: 0 },
      };
      await expect(runtime.act(retryInput)).rejects.toMatchObject({ code: "engine_unhealthy" });
      expect(engine.executions).toHaveLength(1);
      await expect(runtime.act(retryInput)).resolves.toMatchObject({
        structured: { action_result: { status: "executed" } },
      });
      expect(engine.executions).toHaveLength(2);
      await runtime.close();
    },
  );

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
