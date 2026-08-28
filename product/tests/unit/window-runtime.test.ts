import { describe, expect, it } from "vitest";

import { ComputerUseRuntime } from "../../src/core/runtime.js";
import type {
  EngineDesktopObservation,
  EngineDiscoverInput,
  EngineDiscovery,
  EngineExecution,
  EngineObservation,
  EngineObserveInput,
  EnginePort,
  EngineWindowObservation,
} from "../../src/engine/port.js";
import type { ComputerAction } from "../../src/protocol.js";
import { handleObserve } from "../../src/mcp/handlers.js";

class WindowFixtureEngine implements EnginePort {
  readonly name = "cua-driver" as const;
  readonly version = "0.22.2";
  readonly sessionId = "window-fixture-session";
  constructor(private readonly visualStatus: EngineWindowObservation["visualStatus"] = "available") {}

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
    const base = {
      platform: "macos" as const,
      target: input.target.window,
      upstreamSnapshotId: "private-upstream-snapshot",
      elementsComplete: true,
      elements: [{
        index: 0,
        token: "private-element-token",
        role: "AXButton",
        label: "7",
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

  async execute(_action: ComputerAction, _signal: AbortSignal): Promise<EngineExecution> {
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
        actions: ["click"],
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
      elements: [{ role: "button", label: "7", actions: ["click"] }],
    });
    expect(observed.structuredContent).not.toHaveProperty("screenshot");
    expect((observed.structuredContent?.elements as unknown[])[0]).not.toHaveProperty("bounds");
    expect(observed.content.every((item) => item.type !== "image")).toBe(true);
    await runtime.close();
  });
});
