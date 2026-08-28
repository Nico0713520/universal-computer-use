import { describe, expect, it } from "vitest";

import { ComputerUseRuntime } from "../../src/core/runtime.js";
import type {
  EngineDesktopObservation,
  EngineAction,
  EngineDiscoverInput,
  EngineDiscovery,
  EngineExecution,
  EngineObservation,
  EngineObserveInput,
  EnginePort,
  EngineWindowObservation,
} from "../../src/engine/port.js";
import { handleObserve } from "../../src/mcp/handlers.js";

class WindowFixtureEngine implements EnginePort {
  readonly name = "cua-driver" as const;
  readonly version = "0.22.2";
  readonly sessionId = "window-fixture-session";
  readonly executions: EngineAction[] = [];
  constructor(
    private readonly visualStatus: EngineWindowObservation["visualStatus"] = "available",
    private readonly values: string[] = ["7"],
    private readonly elementRole = "AXButton",
    private readonly elementLabel = "7",
    private readonly launchWindowCount = 1,
  ) {}

  async discover(_input: EngineDiscoverInput, _signal: AbortSignal): Promise<EngineDiscovery> {
    const app = {
      nativeKey: "bundle:com.apple.calculator",
      displayName: "Calculator",
      running: true,
      active: false,
      capabilities: ["launch", "windows"] as const,
      native: { platform: "macos", pid: 42, bundle_id: "com.apple.calculator" },
    };
    return {
      apps: [app],
      windows: [{
        nativeKey: "window:7",
        ownerKey: "pid:42",
        app,
        title: "Calculator",
        bounds: { x: 100, y: 100, width: 460, height: 816 },
        focused: false,
        isOnScreen: true,
        onCurrentSpace: true,
        capabilities: ["observe", "click", "set_value", "type_text", "keypress"],
        native: { platform: "macos", pid: 42, window_id: 7, z_index: 2 },
      }],
    };
  }

  async observe(signal: AbortSignal): Promise<EngineDesktopObservation>;
  async observe(input: EngineObserveInput, signal: AbortSignal): Promise<EngineObservation>;
  async observe(
    inputOrSignal: EngineObserveInput | AbortSignal,
    maybeSignal?: AbortSignal,
  ): Promise<EngineObservation> {
    const input = inputOrSignal instanceof AbortSignal ? undefined : inputOrSignal;
    const signal = inputOrSignal instanceof AbortSignal ? inputOrSignal : maybeSignal!;
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    if (input === undefined || input.target.kind === "desktop") {
      return {
        platform: "macos",
        scaleFactor: 2,
        image: { mimeType: "image/png", dataBase64: "ZGVza3RvcA==", width: 1920, height: 1080 },
      };
    }
    const value = this.values.length > 1 ? this.values.shift()! : this.values[0]!;
    const base = {
      platform: "macos" as const,
      target: input.target.window,
      upstreamSnapshotId: "private-upstream-snapshot",
      elementsComplete: true,
      elements: [{
        index: 0,
        token: "private-element-token",
        role: this.elementRole,
        label: this.elementLabel,
        value,
        frame: { x: 110, y: 610, width: 100, height: 80 },
        depth: 0,
        enabled: true,
      }],
    };
    return this.visualStatus === "available"
      ? {
          ...base,
          visualStatus: "available",
          image: { mimeType: "image/png", dataBase64: "d2luZG93", width: 920, height: 1632 },
        }
      : { ...base, visualStatus: this.visualStatus };
  }

  async execute(action: EngineAction, _signal: AbortSignal): Promise<EngineExecution> {
    this.executions.push(action);
    if (action.target.kind === "app") {
      const launchedApp = action.target.app;
      const windows = Array.from({ length: this.launchWindowCount }, (_, index) => ({
        nativeKey: `window:${index + 7}`,
        ownerKey: "pid:42",
        app: launchedApp,
        title: `Calculator${index === 0 ? "" : ` ${index + 1}`}`,
        bounds: { x: 100 + index * 20, y: 100, width: 460, height: 816 },
        focused: false,
        isOnScreen: true,
        onCurrentSpace: true,
        capabilities: ["observe", "click"] as const,
        native: { platform: "macos", pid: 42, window_id: index + 7 },
      }));
      return {
        status: "executed",
        effect: windows.length === 1 ? "confirmed" : windows.length > 1 ? "partial" : "partial",
        route: "system_api",
        delivery: "background",
        evidence: ["process_running", ...(windows.length === 1 ? ["window_ready"] : [])],
        ...(windows.length === 0
          ? { errorCode: "window_not_ready" }
          : windows.length > 1
            ? { errorCode: "window_target_ambiguous" }
            : {}),
        launch: {
          requested: true,
          processRunning: true,
          windowReady: windows.length > 0,
          windows,
        },
      };
    }
    return { status: "executed", effect: "unverifiable", route: "unknown", delivery: "unknown" };
  }

  async health(_signal: AbortSignal): Promise<boolean> { return true; }
  async close(): Promise<void> {}
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
        background_actions: "unknown",
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
