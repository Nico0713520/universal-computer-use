import { describe, expect, it } from "vitest";

import { ComputerUseRuntime } from "../../src/core/runtime.js";
import type {
  EngineAction,
  EngineDesktopObservation,
  EngineExecution,
  EngineObservation,
  EngineObserveInput,
} from "../../src/engine/port.js";
import type { MetadataLogEvent, MetadataLogger } from "../../src/logging/logger.js";
import { WindowFixtureEngine } from "../helpers/fake-window-engine.js";

class TimedWindowEngine extends WindowFixtureEngine {
  constructor(
    private readonly advance: (milliseconds: number) => void,
  ) {
    super("available", ["old", "old", "new"], "AXTextField", "Name");
  }

  override async observe(signal: AbortSignal): Promise<EngineDesktopObservation>;
  override async observe(input: EngineObserveInput, signal: AbortSignal): Promise<EngineObservation>;
  override async observe(
    inputOrSignal: EngineObserveInput | AbortSignal,
    maybeSignal?: AbortSignal,
  ): Promise<EngineObservation> {
    const result = inputOrSignal instanceof AbortSignal
      ? await super.observe(inputOrSignal)
      : await super.observe(inputOrSignal, maybeSignal!);
    this.advance(3);
    return result;
  }

  override async execute(action: EngineAction, signal: AbortSignal): Promise<EngineExecution> {
    const result = await super.execute(action, signal);
    this.advance(5);
    return result;
  }
}

function recordingLogger(events: MetadataLogEvent[]): MetadataLogger {
  return {
    level: "metadata",
    log(event): void { events.push(event); },
  };
}

describe("runtime timing metadata", () => {
  it("emits one bounded record per successful real runtime call and keeps timings out of responses", async () => {
    let now = 100;
    const events: MetadataLogEvent[] = [];
    const engine = new TimedWindowEngine((milliseconds) => { now += milliseconds; });
    const runtime = new ComputerUseRuntime(
      engine,
      undefined,
      undefined,
      { logger: recordingLogger(events), now: () => now },
    );

    const discovered = await runtime.observe({
      target: { kind: "desktop" },
      discover: { apps: true, windows: true, query: "calculator" },
    });
    if (!("windows" in discovered.structured)) throw new Error("expected windows");
    const windowRef = discovered.structured.windows?.[0]?.window_ref;
    if (windowRef === undefined) throw new Error("expected window ref");
    events.length = 0;

    const observed = await runtime.observe({
      target: { kind: "window", window_ref: windowRef },
      include_screenshot: true,
    });
    if (!("elements" in observed.structured)) throw new Error("expected elements");
    expect(events).toEqual([expect.objectContaining({
      toolName: "computer_observe",
      observationMode: "visual",
      timings: {
        queueWaitMs: 0,
        postActionObserveMs: 3,
        projectionMs: 0,
        toolTotalMs: 3,
      },
    })]);
    expect(JSON.stringify(observed)).not.toMatch(/timings|queue_wait_ms|tool_total_ms/);

    events.length = 0;
    const acted = await runtime.act({
      snapshot_id: observed.structured.snapshot_id,
      action: {
        type: "set_value",
        element_ref: observed.structured.elements[0]!.element_ref,
        value: "new",
      },
    });

    expect(engine.observeInputs).toHaveLength(3);
    expect(events).toEqual([expect.objectContaining({
      toolName: "computer_act",
      actionType: "set_value",
      effect: "confirmed",
      route: "unknown",
      delivery: "unknown",
      observationMode: "visual",
      timings: {
        queueWaitMs: 0,
        engineExecuteMs: 5,
        postActionObserveMs: 6,
        projectionMs: 0,
        toolTotalMs: 11,
      },
    })]);
    expect(JSON.stringify(acted)).not.toMatch(/timings|queue_wait_ms|engine_execute_ms|tool_total_ms/);
    await runtime.close();
  });

  it("emits one stable error code without serializing a failed call exception", async () => {
    let now = 0;
    const events: MetadataLogEvent[] = [];
    const engine = new TimedWindowEngine((milliseconds) => { now += milliseconds; });
    const runtime = new ComputerUseRuntime(
      engine,
      undefined,
      undefined,
      { logger: recordingLogger(events), now: () => now },
    );
    await expect(runtime.act({
      snapshot_id: "snap_abcdefghijklmnop",
      action: { type: "wait", ms: 0 },
    })).rejects.toMatchObject({ code: "stale_snapshot" });

    expect(events).toEqual([expect.objectContaining({
      toolName: "computer_act",
      actionType: "wait",
      errorCode: "stale_snapshot",
      timings: { queueWaitMs: 0, toolTotalMs: 0 },
    })]);
    expect(JSON.stringify(events)).not.toContain("No current snapshot exists");
    await runtime.close();
  });

  it("logs a non-throwing action failure from the final public envelope", async () => {
    let now = 0;
    const events: MetadataLogEvent[] = [];
    const engine = new TimedWindowEngine((milliseconds) => { now += milliseconds; });
    engine.execution = {
      status: "failed",
      effect: "unverifiable",
      route: "unknown",
      delivery: "unknown",
      errorCode: "action_failed",
    };
    const runtime = new ComputerUseRuntime(
      engine,
      undefined,
      undefined,
      { logger: recordingLogger(events), now: () => now },
    );
    const discovered = await runtime.observe({
      discover: { windows: true, query: "calculator" },
    });
    if (!("windows" in discovered.structured)) throw new Error("expected windows");
    const observed = await runtime.observe({
      target: { kind: "window", window_ref: discovered.structured.windows![0]!.window_ref },
    });
    if (!("elements" in observed.structured)) throw new Error("expected elements");
    events.length = 0;

    const acted = await runtime.act({
      snapshot_id: observed.structured.snapshot_id,
      action: { type: "click", element_ref: observed.structured.elements[0]!.element_ref },
    });

    expect(acted.structured).toMatchObject({
      action_result: { status: "failed", error_code: "action_failed" },
    });
    expect(events).toEqual([expect.objectContaining({ errorCode: "action_failed" })]);
    await runtime.close();
  });

  it("logs a degraded Cursor presentation without exposing it in the MCP result", async () => {
    const events: MetadataLogEvent[] = [];
    const engine = new TimedWindowEngine(() => undefined);
    engine.execution = {
      status: "executed",
      effect: "confirmed",
      route: "synthetic_events",
      delivery: "foreground",
      cursorVisual: "degraded",
    };
    const runtime = new ComputerUseRuntime(
      engine,
      undefined,
      undefined,
      { logger: recordingLogger(events) },
    );
    const discovered = await runtime.observe({ discover: { windows: true } });
    if (!("windows" in discovered.structured)) throw new Error("expected windows");
    const observed = await runtime.observe({
      target: { kind: "window", window_ref: discovered.structured.windows![0]!.window_ref },
    });
    if (!("elements" in observed.structured)) throw new Error("expected elements");
    events.length = 0;

    const acted = await runtime.act({
      snapshot_id: observed.structured.snapshot_id,
      action: { type: "click", element_ref: observed.structured.elements[0]!.element_ref },
      delivery: "foreground",
    });

    expect(events).toEqual([expect.objectContaining({ cursorVisual: "degraded" })]);
    expect(JSON.stringify(acted)).not.toContain("cursor_visual");
    await runtime.close();
  });

  it("does not turn a successful tool call into a failure when the metadata sink throws", async () => {
    const runtime = new ComputerUseRuntime(
      new TimedWindowEngine(() => undefined),
      undefined,
      undefined,
      {
        logger: {
          level: "metadata",
          log(): void { throw new Error("telemetry sink unavailable"); },
        },
      },
    );

    await expect(runtime.observe()).resolves.toMatchObject({
      structured: { target: { kind: "desktop" } },
    });
    await runtime.close();
  });

  it("preserves the original ComputerUseError when failure logging throws", async () => {
    const runtime = new ComputerUseRuntime(
      new TimedWindowEngine(() => undefined),
      undefined,
      undefined,
      {
        logger: {
          level: "metadata",
          log(): void { throw new Error("telemetry sink unavailable"); },
        },
      },
    );

    await expect(runtime.act({
      snapshot_id: "snap_abcdefghijklmnop",
      action: { type: "wait", ms: 0 },
    })).rejects.toMatchObject({ code: "stale_snapshot" });
    await runtime.close();
  });
});
