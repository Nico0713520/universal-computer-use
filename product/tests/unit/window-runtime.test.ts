import { describe, expect, it } from "vitest";

import { ComputerUseRuntime } from "../../src/core/runtime.js";
import type { EngineExecution, EngineWindowObservation } from "../../src/engine/port.js";
import { ComputerUseError } from "../../src/errors.js";
import type { ComputerAction } from "../../src/protocol.js";
import { handleAct, handleObserve } from "../../src/mcp/handlers.js";
import { WindowFixtureEngine } from "../helpers/fake-window-engine.js";

function semanticObservation(
  observation: EngineWindowObservation,
  value?: string,
): EngineWindowObservation {
  return {
    ...observation,
    visualStatus: "not_requested",
    image: undefined,
    elements: observation.elements.map((element) => ({
      ...element,
      ...(value === undefined ? {} : { value }),
    })),
  };
}

async function discoverCalculator(runtime: ComputerUseRuntime): Promise<string> {
  const desktop = await runtime.observe({
    target: { kind: "desktop" },
    discover: { apps: true, windows: true, query: "calculator" },
  });
  expect(desktop.structured).toMatchObject({
    apps: [{ display_name: "Calculator", capabilities: ["launch", "windows"] }],
    windows: [{
      app_name: "Calculator",
      title: "Calculator",
      bounds: { coordinate_space: "desktop_logical" },
      capabilities: {
        elements: "available",
        window_screenshot: "available",
        background_actions: "available",
      },
    }],
    apps_truncated: false,
    windows_truncated: false,
  });
  expect(JSON.stringify(desktop.structured)).not.toMatch(/pid|window_id|bundle_id|launch_path/);
  const ref = "windows" in desktop.structured ? desktop.structured.windows?.[0]?.window_ref : undefined;
  expect(ref).toMatch(/^win_/);
  return ref!;
}

describe("window observation runtime", () => {
  it("rejects a desktop next-observation preference before consuming the snapshot", async () => {
    const engine = new WindowFixtureEngine();
    const runtime = new ComputerUseRuntime(engine);
    const desktop = await runtime.observe();
    const input = {
      snapshot_id: desktop.structured.snapshot_id,
      action: { type: "wait" as const, ms: 0 },
      next_observation: { mode: "semantic" as const },
    };

    const conflict = await handleAct(runtime, input);
    expect(conflict).toMatchObject({
      isError: true,
      structuredContent: {
        code: "next_observation_target_conflict",
        recovery: "observe_again",
        retryable: true,
      },
    });
    expect(conflict.structuredContent).not.toHaveProperty("snapshot_consumed");
    expect(engine.executions).toHaveLength(0);

    await expect(runtime.act({
      snapshot_id: desktop.structured.snapshot_id,
      action: { type: "wait", ms: 0 },
    })).resolves.toMatchObject({ structured: { next_state: "available" } });
    expect(engine.executions).toHaveLength(1);
    await runtime.close();
  });

  it("discovers opaque targets then returns a precise window snapshot", async () => {
    const runtime = new ComputerUseRuntime(new WindowFixtureEngine());
    const windowRef = await discoverCalculator(runtime);

    const observed = await runtime.observe({
      target: { kind: "window", window_ref: windowRef },
      include_screenshot: true,
      elements: { max_elements: 100, max_depth: 10 },
    });

    expect(observed.structured).toMatchObject({
      target: { kind: "window", window_ref: windowRef, app_name: "Calculator", title: "Calculator" },
      coordinate_space: "window_screenshot_pixels",
      visual_status: "available",
      screenshot: { width: 920, height: 1632 },
      elements: [{
        role: "button",
        label: "7",
        bounds: { x: 20, y: 1020, width: 200, height: 160 },
        enabled: true,
        actions: ["click", "double_click", "right_click"],
      }],
      elements_truncated: false,
    });
    expect(observed.image).toEqual({ mimeType: "image/png", dataBase64: "d2luZG93" });
    expect(JSON.stringify(observed.structured)).not.toMatch(/private|element_token|snapshot_id":"private/);
    await runtime.close();
  });

  it("keeps semantic element actions but removes all pixel claims when capture degrades", async () => {
    const runtime = new ComputerUseRuntime(new WindowFixtureEngine("capture_unavailable"));
    const windowRef = await discoverCalculator(runtime);

    const observed = await handleObserve(runtime, {
      target: { kind: "window", window_ref: windowRef },
      include_screenshot: true,
    });

    expect(observed.isError).not.toBe(true);
    expect(observed.structuredContent).toMatchObject({
      visual_status: "capture_unavailable",
      elements: [{ role: "button", label: "7", actions: ["click", "double_click", "right_click"] }],
    });
    expect(observed.structuredContent).not.toHaveProperty("screenshot");
    expect((observed.structuredContent?.elements as unknown[])[0]).not.toHaveProperty("bounds");
    expect(observed.content.every((item) => item.type !== "image")).toBe(true);
    await runtime.close();
  });

  it("resolves one element ref to its private token and reobserves the same window", async () => {
    const engine = new WindowFixtureEngine();
    const runtime = new ComputerUseRuntime(engine);
    const windowRef = await discoverCalculator(runtime);
    const observed = await runtime.observe({
      target: { kind: "window", window_ref: windowRef },
      include_screenshot: true,
    });
    if (!("elements" in observed.structured)) throw new Error("expected window elements");
    const elementRef = observed.structured.elements[0]!.element_ref;

    const acted = await runtime.act({
      snapshot_id: observed.structured.snapshot_id,
      action: { type: "click", element_ref: elementRef },
      delivery: "background",
    });

    expect(engine.executions).toEqual([{
      target: { kind: "window", pid: 42, windowId: 7 },
      action: { type: "click", address: { kind: "element", token: "private-element-token" } },
      delivery: "background",
    }]);
    expect(acted.structured).toMatchObject({
      next_state: "available",
      target: { kind: "window", window_ref: windowRef },
      visual_status: "available",
      elements: [{ role: "button", label: "7" }],
    });
    await runtime.close();
  });

  it("publishes a confirmed background element action with one semantic next observation", async () => {
    const engine = new WindowFixtureEngine();
    engine.execution = {
      status: "executed",
      effect: "confirmed",
      route: "accessibility",
      delivery: "background",
      evidence: ["predicate_satisfied"],
    };
    engine.observations.push(semanticObservation(engine.observations[0]!));
    const runtime = new ComputerUseRuntime(engine);
    const windowRef = await discoverCalculator(runtime);
    const observed = await runtime.observe({ target: { kind: "window", window_ref: windowRef } });
    if (!("elements" in observed.structured)) throw new Error("expected window elements");

    const acted = await runtime.act({
      snapshot_id: observed.structured.snapshot_id,
      action: { type: "click", element_ref: observed.structured.elements[0]!.element_ref },
      delivery: "background",
      next_observation: { mode: "semantic" },
    });

    expect(engine.executions).toHaveLength(1);
    expect(engine.observeInputs.map(({ includeScreenshot }) => includeScreenshot)).toEqual([true, false]);
    expect(acted.structured).toMatchObject({
      observation_mode: "semantic",
      visual_status: "not_requested",
      action_result: { status: "executed", effect: "confirmed" },
    });
    expect(acted.structured).not.toHaveProperty("screenshot");
    expect(acted.image).toBeUndefined();
    if (!("snapshot_id" in acted.structured)) throw new Error("expected available next state");
    expect(acted.structured.snapshot_id).not.toBe(observed.structured.snapshot_id);
    await runtime.close();
  });

  it("auto-verifies set_value by readback without repeating the mutation", async () => {
    const engine = new WindowFixtureEngine("available", ["old", "new"], "AXTextField", "Name");
    const runtime = new ComputerUseRuntime(engine);
    const windowRef = await discoverCalculator(runtime);
    const observed = await runtime.observe({ target: { kind: "window", window_ref: windowRef } });
    if (!("elements" in observed.structured)) throw new Error("expected window elements");

    const acted = await runtime.act({
      snapshot_id: observed.structured.snapshot_id,
      action: { type: "set_value", element_ref: observed.structured.elements[0]!.element_ref, value: "new" },
    });

    expect(engine.executions).toHaveLength(1);
    expect(acted.structured).toMatchObject({
      action_result: {
        status: "executed",
        effect: "confirmed",
        evidence: expect.arrayContaining(["value_readback", "predicate_satisfied"]),
      },
      verification: { status: "satisfied" },
    });
    await runtime.close();
  });

  it("uses implicit set_value readback before publishing a semantic next state", async () => {
    const engine = new WindowFixtureEngine("available", ["old", "new"], "AXTextField", "Name");
    engine.observations[1] = semanticObservation(engine.observations[1]!, "new");
    engine.execution = {
      status: "executed",
      effect: "confirmed",
      route: "accessibility",
      delivery: "background",
    };
    const runtime = new ComputerUseRuntime(engine);
    const windowRef = await discoverCalculator(runtime);
    const observed = await runtime.observe({ target: { kind: "window", window_ref: windowRef } });
    if (!("elements" in observed.structured)) throw new Error("expected window elements");

    const acted = await runtime.act({
      snapshot_id: observed.structured.snapshot_id,
      action: {
        type: "set_value",
        element_ref: observed.structured.elements[0]!.element_ref,
        value: "new",
      },
      next_observation: { mode: "semantic" },
    });

    expect(engine.observeInputs.map(({ includeScreenshot }) => includeScreenshot)).toEqual([true, false]);
    expect(acted.structured).toMatchObject({
      observation_mode: "semantic",
      visual_status: "not_requested",
      verification: { status: "satisfied" },
      action_result: {
        status: "executed",
        effect: "confirmed",
        evidence: expect.arrayContaining(["value_readback", "predicate_satisfied"]),
      },
      elements: [{ value: "new" }],
    });
    await runtime.close();
  });

  it("publishes only one final visual recovery snapshot after semantic verification fails", async () => {
    const engine = new WindowFixtureEngine("available", ["old", "old", "final"], "AXTextField", "Name");
    engine.observations[1] = semanticObservation(engine.observations[1]!, "old");
    engine.execution = {
      status: "executed",
      effect: "confirmed",
      route: "accessibility",
      delivery: "background",
    };
    const runtime = new ComputerUseRuntime(engine);
    const windowRef = await discoverCalculator(runtime);
    const observed = await runtime.observe({ target: { kind: "window", window_ref: windowRef } });
    if (!("elements" in observed.structured)) throw new Error("expected window elements");

    const acted = await runtime.act({
      snapshot_id: observed.structured.snapshot_id,
      action: {
        type: "set_value",
        element_ref: observed.structured.elements[0]!.element_ref,
        value: "new",
      },
      expect: {
        element: {
          element_ref: observed.structured.elements[0]!.element_ref,
          value_equals: "new",
        },
        timeout_ms: 0,
      },
      next_observation: { mode: "semantic" },
    });

    expect(engine.observeInputs.map(({ includeScreenshot }) => includeScreenshot)).toEqual([true, false, true]);
    expect(acted.structured).toMatchObject({
      observation_mode: "visual_recovery",
      visual_status: "available",
      verification: { status: "unsatisfied" },
      elements: [{ value: "final" }],
    });
    expect(acted.image).toBeDefined();
    await runtime.close();
  });

  it("visually recovers when semantic verification cannot find the expected element", async () => {
    const engine = new WindowFixtureEngine("available", ["old", "old", "final"], "AXTextField", "Name");
    engine.observations[1] = {
      ...semanticObservation(engine.observations[1]!, "old"),
      elements: [{ ...engine.observations[1]!.elements[0]!, label: "Different field" }],
    };
    engine.execution = {
      status: "executed",
      effect: "confirmed",
      route: "accessibility",
      delivery: "background",
    };
    const runtime = new ComputerUseRuntime(engine);
    const windowRef = await discoverCalculator(runtime);
    const observed = await runtime.observe({ target: { kind: "window", window_ref: windowRef } });
    if (!("elements" in observed.structured)) throw new Error("expected window elements");
    const elementRef = observed.structured.elements[0]!.element_ref;

    const acted = await runtime.act({
      snapshot_id: observed.structured.snapshot_id,
      action: { type: "click", element_ref: elementRef },
      expect: { element: { element_ref: elementRef, value_equals: "new" }, timeout_ms: 0 },
      next_observation: { mode: "semantic" },
    });

    expect(engine.observeInputs.map(({ includeScreenshot }) => includeScreenshot)).toEqual([true, false, true]);
    expect(acted.structured).toMatchObject({
      observation_mode: "visual_recovery",
      verification: { status: "unknown", reason: "element_missing" },
      elements: [{ value: "final" }],
    });
    await runtime.close();
  });

  it("visually recovers when verification is satisfied but the final effect remains unconfirmed", async () => {
    const engine = new WindowFixtureEngine("available", ["new", "new", "final"], "AXTextField", "Name");
    engine.observations[1] = semanticObservation(engine.observations[1]!, "new");
    engine.execution = {
      status: "executed",
      effect: "unverifiable",
      route: "accessibility",
      delivery: "background",
    };
    const runtime = new ComputerUseRuntime(engine);
    const windowRef = await discoverCalculator(runtime);
    const observed = await runtime.observe({ target: { kind: "window", window_ref: windowRef } });
    if (!("elements" in observed.structured)) throw new Error("expected window elements");
    const elementRef = observed.structured.elements[0]!.element_ref;

    const acted = await runtime.act({
      snapshot_id: observed.structured.snapshot_id,
      action: { type: "click", element_ref: elementRef },
      expect: { element: { element_ref: elementRef, value_equals: "new" }, timeout_ms: 0 },
      next_observation: { mode: "semantic" },
    });

    expect(engine.observeInputs.map(({ includeScreenshot }) => includeScreenshot)).toEqual([true, false, true]);
    expect(acted.structured).toMatchObject({
      observation_mode: "visual_recovery",
      verification: { status: "satisfied" },
      action_result: { effect: "unverifiable" },
      elements: [{ value: "final" }],
    });
    await runtime.close();
  });

  it.each([
    {
      name: "coordinate",
      action: (_elementRef: string): ComputerAction => ({ type: "click", x: 20, y: 30 }),
      execution: { status: "executed", effect: "confirmed", route: "accessibility", delivery: "background" },
    },
    {
      name: "wait",
      action: (_elementRef: string): ComputerAction => ({ type: "wait", ms: 0 }),
      execution: { status: "executed", effect: "confirmed", route: "system_api", delivery: "not_applicable" },
    },
    {
      name: "foreground",
      action: (elementRef: string): ComputerAction => ({ type: "click", element_ref: elementRef }),
      execution: { status: "executed", effect: "confirmed", route: "accessibility", delivery: "foreground" },
    },
    {
      name: "unknown delivery",
      action: (elementRef: string): ComputerAction => ({ type: "click", element_ref: elementRef }),
      execution: { status: "executed", effect: "confirmed", route: "accessibility", delivery: "unknown" },
    },
    {
      name: "unsafe route",
      action: (elementRef: string): ComputerAction => ({ type: "click", element_ref: elementRef }),
      execution: { status: "executed", effect: "confirmed", route: "synthetic_events", delivery: "background" },
    },
    {
      name: "failed",
      action: (elementRef: string): ComputerAction => ({ type: "click", element_ref: elementRef }),
      execution: { status: "failed", effect: "unverifiable", route: "accessibility", delivery: "background" },
    },
    {
      name: "refused",
      action: (elementRef: string): ComputerAction => ({ type: "click", element_ref: elementRef }),
      execution: { status: "refused", effect: "refused", route: "accessibility", delivery: "background", errorCode: "action_refused" },
    },
  ] as const)("uses visual recovery for $name semantic requests", async ({ action, execution }) => {
    const engine = new WindowFixtureEngine();
    engine.execution = execution as EngineExecution;
    const runtime = new ComputerUseRuntime(engine);
    const windowRef = await discoverCalculator(runtime);
    const observed = await runtime.observe({ target: { kind: "window", window_ref: windowRef } });
    if (!("elements" in observed.structured)) throw new Error("expected window elements");

    const acted = await runtime.act({
      snapshot_id: observed.structured.snapshot_id,
      action: action(observed.structured.elements[0]!.element_ref),
      next_observation: { mode: "semantic" },
    });

    expect(engine.observeInputs.at(-1)?.includeScreenshot).toBe(true);
    expect(acted.structured).toMatchObject({ observation_mode: "visual_recovery" });
    await runtime.close();
  });

  it("preserves a visual window loop when no next-observation preference is supplied", async () => {
    const engine = new WindowFixtureEngine();
    const runtime = new ComputerUseRuntime(engine);
    const windowRef = await discoverCalculator(runtime);
    const observed = await runtime.observe({ target: { kind: "window", window_ref: windowRef } });
    if (!("elements" in observed.structured)) throw new Error("expected window elements");

    const acted = await runtime.act({
      snapshot_id: observed.structured.snapshot_id,
      action: { type: "click", element_ref: observed.structured.elements[0]!.element_ref },
    });

    expect(engine.observeInputs.at(-1)?.includeScreenshot).toBe(true);
    expect(acted.structured).toMatchObject({ observation_mode: "visual", visual_status: "available" });
    await runtime.close();
  });

  it("uses a screenshot-only engine read for an explicitly requested visual next state", async () => {
    const engine = new WindowFixtureEngine();
    const runtime = new ComputerUseRuntime(engine);
    const windowRef = await discoverCalculator(runtime);
    const observed = await runtime.observe({ target: { kind: "window", window_ref: windowRef } });
    if (!("elements" in observed.structured)) throw new Error("expected window elements");

    const acted = await runtime.act({
      snapshot_id: observed.structured.snapshot_id,
      action: { type: "click", element_ref: observed.structured.elements[0]!.element_ref },
      next_observation: { mode: "visual" },
    });

    expect(engine.observeInputs.at(-1)).toMatchObject({
      includeScreenshot: true,
      maxElements: 0,
      maxDepth: 0,
    });
    expect(acted.structured).toMatchObject({
      observation_mode: "visual",
      visual_status: "available",
      elements: [],
    });
    await runtime.close();
  });

  it("rejects every coordinate keyboard form on a semantic snapshot before execution", async () => {
    const engine = new WindowFixtureEngine();
    engine.observations[0] = semanticObservation(engine.observations[0]!);
    const runtime = new ComputerUseRuntime(engine);
    const windowRef = await discoverCalculator(runtime);
    const observed = await runtime.observe({
      target: { kind: "window", window_ref: windowRef },
      include_screenshot: false,
    });

    for (const action of [
      { type: "type" as const, x: 10, y: 10, text: "hello" },
      { type: "type_text" as const, x: 10, y: 10, text: "hello" },
      { type: "keypress" as const, x: 10, y: 10, keys: ["ENTER"] },
    ]) {
      await expect(runtime.act({
        snapshot_id: observed.structured.snapshot_id,
        action,
      })).rejects.toMatchObject({ code: "pixel_frame_unproven" });
    }
    expect(engine.executions).toHaveLength(0);
    await runtime.close();
  });

  it.each(["engine_contract_changed", "engine_unhealthy"] as const)(
    "fails closed with a consumed snapshot when post-action observation reports %s",
    async (code) => {
      const engine = new WindowFixtureEngine();
      const runtime = new ComputerUseRuntime(engine);
      const windowRef = await discoverCalculator(runtime);
      const observed = await runtime.observe({ target: { kind: "window", window_ref: windowRef } });
      if (!("elements" in observed.structured)) throw new Error("expected window elements");
      engine.observationErrors.push(new ComputerUseError(code, code, "doctor", false));
      const input = {
        snapshot_id: observed.structured.snapshot_id,
        action: { type: "click" as const, element_ref: observed.structured.elements[0]!.element_ref },
      };

      await expect(runtime.act(input)).rejects.toMatchObject({ code, snapshotConsumed: true });
      expect(engine.executions).toHaveLength(1);
      await expect(runtime.act(input)).rejects.toMatchObject({ code: "stale_snapshot" });
      await runtime.close();
    },
  );

  it("does not upgrade an already-satisfied predicate or retry an unsatisfied mutation", async () => {
    const preSatisfiedEngine = new WindowFixtureEngine("available", ["new", "new"], "AXTextField", "Name");
    const firstRuntime = new ComputerUseRuntime(preSatisfiedEngine);
    const firstRef = await discoverCalculator(firstRuntime);
    const first = await firstRuntime.observe({ target: { kind: "window", window_ref: firstRef } });
    if (!("elements" in first.structured)) throw new Error("expected window elements");
    const firstElement = first.structured.elements[0]!.element_ref;
    const preSatisfied = await firstRuntime.act({
      snapshot_id: first.structured.snapshot_id,
      action: { type: "click", element_ref: firstElement },
      expect: { element: { element_ref: firstElement, value_equals: "new" }, timeout_ms: 0 },
    });
    expect(preSatisfied.structured).toMatchObject({
      action_result: { effect: "unverifiable", evidence: [] },
      verification: { status: "satisfied" },
    });
    expect(preSatisfiedEngine.executions).toHaveLength(1);
    await firstRuntime.close();

    const unsatisfiedEngine = new WindowFixtureEngine("available", ["old", "old"], "AXTextField", "Name");
    const secondRuntime = new ComputerUseRuntime(unsatisfiedEngine);
    const secondRef = await discoverCalculator(secondRuntime);
    const second = await secondRuntime.observe({ target: { kind: "window", window_ref: secondRef } });
    if (!("elements" in second.structured)) throw new Error("expected window elements");
    const secondElement = second.structured.elements[0]!.element_ref;
    const unsatisfied = await secondRuntime.act({
      snapshot_id: second.structured.snapshot_id,
      action: { type: "set_value", element_ref: secondElement, value: "new" },
      expect: { element: { element_ref: secondElement, value_equals: "new" }, timeout_ms: 0 },
    });
    expect(unsatisfied.structured).toMatchObject({
      action_result: { status: "executed", effect: "unverifiable", error_code: "verification_unsatisfied" },
      verification: { status: "unsatisfied", reason: "predicate_unsatisfied" },
    });
    expect(unsatisfiedEngine.executions).toHaveLength(1);
    await secondRuntime.close();
  });

  it("launches by opaque app ref and migrates only one unambiguous ready window", async () => {
    const engine = new WindowFixtureEngine();
    const runtime = new ComputerUseRuntime(engine);
    const desktop = await runtime.observe({ target: { kind: "desktop" }, discover: { apps: true } });
    if (!("apps" in desktop.structured)) throw new Error("expected apps");

    const launched = await runtime.act({
      snapshot_id: desktop.structured.snapshot_id,
      action: { type: "launch_app", app_ref: desktop.structured.apps![0]!.app_ref },
    });

    expect(engine.executions).toHaveLength(1);
    expect(launched.structured).toMatchObject({
      target: { kind: "window", app_name: "Calculator" },
      action_result: {
        status: "executed",
        effect: "confirmed",
        evidence: expect.arrayContaining(["process_running", "window_ready"]),
      },
    });
    await runtime.close();
  });

  it.each([
    { name: "ready-window", launchWindowCount: 1, channel: "window" },
    { name: "desktop-fallback", launchWindowCount: 0, channel: "desktop" },
  ] as const)("fails closed when $name launch observation changes engine contract", async ({ launchWindowCount, channel }) => {
    const engine = new WindowFixtureEngine("available", ["7"], "AXButton", "7", launchWindowCount);
    engine.healthResults.push(false);
    const critical = new ComputerUseError("engine_contract_changed", "changed", "doctor", false);
    if (channel === "window") engine.observationErrors.push(critical);
    const runtime = new ComputerUseRuntime(engine);
    const desktop = await runtime.observe({ target: { kind: "desktop" }, discover: { apps: true } });
    if (channel === "desktop") engine.desktopObservationErrors.push(critical);
    if (!("apps" in desktop.structured)) throw new Error("expected apps");
    const input = {
      snapshot_id: desktop.structured.snapshot_id,
      action: { type: "launch_app" as const, app_ref: desktop.structured.apps![0]!.app_ref },
    };

    await expect(runtime.act(input)).rejects.toMatchObject({
      code: "engine_contract_changed",
      snapshotConsumed: true,
    });
    expect(engine.executions).toHaveLength(1);
    await expect(runtime.act(input)).rejects.toMatchObject({ code: "stale_snapshot" });

    const fresh = await runtime.observe();
    await expect(runtime.act({
      snapshot_id: fresh.structured.snapshot_id,
      action: { type: "wait", ms: 0 },
    })).rejects.toMatchObject({ code: "engine_unhealthy" });
    expect(engine.executions).toHaveLength(1);
    await runtime.close();
  });

  it("returns a fresh desktop and bounded candidates when launch has zero or multiple windows", async () => {
    const zeroEngine = new WindowFixtureEngine("available", ["7"], "AXButton", "7", 0);
    const zeroRuntime = new ComputerUseRuntime(zeroEngine);
    const zeroDesktop = await zeroRuntime.observe({ target: { kind: "desktop" }, discover: { apps: true } });
    if (!("apps" in zeroDesktop.structured)) throw new Error("expected apps");
    const zero = await zeroRuntime.act({
      snapshot_id: zeroDesktop.structured.snapshot_id,
      action: { type: "launch_app", app_ref: zeroDesktop.structured.apps![0]!.app_ref },
    });
    expect(zero.structured).toMatchObject({
      target: { kind: "desktop" },
      action_result: { effect: "partial", error_code: "window_not_ready", evidence: ["process_running"] },
    });
    expect(zeroEngine.executions).toHaveLength(1);
    await zeroRuntime.close();

    const manyEngine = new WindowFixtureEngine("available", ["7"], "AXButton", "7", 2);
    const manyRuntime = new ComputerUseRuntime(manyEngine);
    const manyDesktop = await manyRuntime.observe({ target: { kind: "desktop" }, discover: { apps: true } });
    if (!("apps" in manyDesktop.structured)) throw new Error("expected apps");
    const many = await manyRuntime.act({
      snapshot_id: manyDesktop.structured.snapshot_id,
      action: { type: "launch_app", app_ref: manyDesktop.structured.apps![0]!.app_ref },
    });
    expect(many.structured).toMatchObject({
      target: { kind: "desktop" },
      action_result: { effect: "partial", error_code: "window_target_ambiguous" },
      windows: [{ app_name: "Calculator" }, { app_name: "Calculator" }],
      windows_truncated: false,
    });
    expect(manyEngine.executions).toHaveLength(1);
    await manyRuntime.close();
  });
});
