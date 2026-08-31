import { readFile } from "node:fs/promises";

import {
  ActionDeliveryMode,
  ActionEffect,
  ActionRoute,
  CaptureScope,
  CuaDriver,
  DriverError,
  EffectiveScope,
  type ToolResult,
} from "@trycua/cua-driver";
import { describe, expect, it, vi } from "vitest";

import { CuaEngine } from "../../src/engine/cua.js";
import {
  AGENT_CURSOR_MOTION,
  AGENT_CURSOR_THEME,
} from "../../src/engine/agent-cursor.js";
import { loadEngineLock } from "../../src/engine/lock.js";
import { createRuntimeConnector } from "../../src/engine/runtime-startup.js";
import { TargetRegistry } from "../../src/target-registry.js";
import { fakeSdk } from "../helpers/fake-cua-sdk.js";

function result(value: unknown, images: ToolResult["images"] = []): ToolResult {
  return {
    text: "fixture",
    images,
    structuredJson: JSON.stringify(value),
    isError: false,
    degraded: false,
    rawJson: "{}",
  };
}

async function lockedFixture(name: "list-apps" | "list-windows" | "window-state" | "health-report"): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL(`../fixtures/cua/0.22.2/${name}.json`, import.meta.url), "utf8"),
  ) as unknown;
}

describe("Cua daemon connection", () => {
  it("maps a daemon connection failure to runtime_unavailable", async () => {
    const lock = await loadEngineLock();
    vi.spyOn(CuaDriver, "connect").mockImplementationOnce(() => {
      throw new Error("socket unavailable");
    });

    await expect(CuaEngine.connect(lock)).rejects.toMatchObject({
      code: "runtime_unavailable",
      recovery: "doctor",
      retryable: true,
    });
  });

  it("maps an asynchronous transport failure during metadata to runtime_unavailable", async () => {
    const lock = await loadEngineLock();
    const sdk = fakeSdk({ driverVersion: lock.version, tools: [...lock.required_tools] });
    vi.spyOn(sdk, "metadata").mockRejectedValueOnce(
      new DriverError.Transport({ socketPath: "/private/fixture.sock", reason: "closed" }),
    );
    vi.spyOn(CuaDriver, "connect").mockReturnValueOnce(sdk as never);

    await expect(CuaEngine.connect(lock)).rejects.toMatchObject({
      code: "runtime_unavailable",
      recovery: "doctor",
      retryable: true,
    });
  });

  it("maps a transport loss during Cursor bootstrap to runtime_unavailable", async () => {
    const lock = await loadEngineLock();
    const sdk = fakeSdk({ driverVersion: lock.version, tools: [...lock.required_tools] });
    vi.spyOn(sdk, "callTool").mockRejectedValueOnce(
      new DriverError.Transport({ socketPath: "/private/fixture.sock", reason: "closed" }),
    );
    vi.spyOn(CuaDriver, "connect").mockReturnValueOnce(sdk as never);

    await expect(CuaEngine.connect(lock)).rejects.toMatchObject({
      code: "runtime_unavailable",
      recovery: "doctor",
      retryable: true,
    });
    expect(sdk.endSessionCalls).toHaveLength(2);
  });

  it("preserves a rejected startSession transport failure for connection recovery", async () => {
    const lock = await loadEngineLock();
    const sdk = fakeSdk({ driverVersion: lock.version, tools: [...lock.required_tools] });
    vi.spyOn(sdk, "startSession").mockRejectedValueOnce(
      new DriverError.Transport({ socketPath: "/private/fixture.sock", reason: "closed" }),
    );
    vi.spyOn(CuaDriver, "connect").mockReturnValueOnce(sdk as never);

    await expect(CuaEngine.connect(lock)).rejects.toMatchObject({
      code: "runtime_unavailable",
      recovery: "doctor",
      retryable: true,
      diagnosticReason: "runtime_startup_failed",
    });
    expect(sdk.endSessionCalls).toHaveLength(1);
  });

  it("runs bounded startup recovery after startSession loses its transport", async () => {
    const lock = await loadEngineLock();
    const failing = fakeSdk({ driverVersion: lock.version, tools: [...lock.required_tools] });
    const healthy = fakeSdk({ driverVersion: lock.version, tools: [...lock.required_tools] });
    vi.spyOn(failing, "startSession").mockRejectedValueOnce(
      new DriverError.Transport({ socketPath: "/private/fixture.sock", reason: "closed" }),
    );
    vi.spyOn(CuaDriver, "connect")
      .mockReturnValueOnce(failing as never)
      .mockReturnValueOnce(healthy as never);
    const runner = {
      run: vi.fn(async (command: string, args: readonly string[]) => ({
        code: 0,
        stdout: command === "/usr/bin/codesign" && args.includes("-dv")
          ? "Identifier=com.trycua.driver"
          : "",
        stderr: "",
      })),
    };
    const connector = createRuntimeConnector({
      platform: "darwin",
      connect: (candidate) => CuaEngine.connect(candidate),
      access: vi.fn(async () => undefined),
      runner,
      wait: vi.fn(async () => undefined),
      now: () => 0,
    });

    const engine = await connector(lock);

    expect(runner.run).toHaveBeenCalledWith(
      "/usr/bin/open",
      ["-g", "/Applications/CuaDriver.app", "--args", "serve"],
      { timeoutMs: 30_000 },
    );
    expect(failing.endSessionCalls).toHaveLength(1);
    await engine.close();
  });

  it("classifies a non-transport startSession rejection as session initialization failure", async () => {
    const lock = await loadEngineLock();
    const sdk = fakeSdk({ driverVersion: lock.version, tools: [...lock.required_tools] });
    vi.spyOn(sdk, "startSession").mockRejectedValueOnce(new Error("invalid scope"));

    await expect(CuaEngine.fromSdk(sdk, lock)).rejects.toMatchObject({
      code: "engine_version_mismatch",
      recovery: "setup",
      retryable: false,
      diagnosticReason: "session_initialization_failed",
    });
    expect(sdk.endSessionCalls).toHaveLength(1);
  });

  it("rejects a daemon version that differs from the lock", async () => {
    const lock = await loadEngineLock();
    const sdk = fakeSdk({ driverVersion: "0.22.0", tools: [...lock.required_tools] });

    await expect(CuaEngine.fromSdk(sdk, lock)).rejects.toMatchObject({
      code: "engine_version_mismatch",
      diagnosticReason: "runtime_version_mismatch",
    });
  });

  it("rejects a daemon missing one required tool", async () => {
    const lock = await loadEngineLock();
    const sdk = fakeSdk({
      driverVersion: lock.version,
      tools: lock.required_tools.filter((name) => name !== "drag"),
    });

    await expect(CuaEngine.fromSdk(sdk, lock)).rejects.toMatchObject({
      code: "engine_version_mismatch",
    });
  });

  it("rejects a malformed tool inventory as a contract mismatch", async () => {
    const lock = await loadEngineLock();
    const sdk = fakeSdk({
      driverVersion: lock.version,
      tools: [...lock.required_tools],
      toolsJson: "{not-json",
    });

    await expect(CuaEngine.fromSdk(sdk, lock)).rejects.toMatchObject({
      code: "engine_version_mismatch",
    });
  });

  it("rejects an invalid tool inventory shape as a contract mismatch", async () => {
    const lock = await loadEngineLock();
    const sdk = fakeSdk({
      driverVersion: lock.version,
      tools: [...lock.required_tools],
      toolsJson: "null",
    });

    await expect(CuaEngine.fromSdk(sdk, lock)).rejects.toMatchObject({
      code: "engine_version_mismatch",
    });
  });

  it("starts separate desktop and window sessions so neither Cua scope disables the other", async () => {
    const lock = await loadEngineLock();
    const sdk = fakeSdk({
      driverVersion: lock.version,
      tools: [...lock.required_tools],
    });

    const engine = await CuaEngine.fromSdk(sdk, lock);

    expect(engine.sessionId).toMatch(/^ucu_/);
    expect(sdk.startSessionCalls).toHaveLength(2);
    expect(sdk.startSessionCalls[0]).toMatchObject({
      session: engine.sessionId,
      captureScope: CaptureScope.Desktop,
    });
    expect(sdk.startSessionCalls[1]).toMatchObject({
      captureScope: CaptureScope.Window,
    });
    expect(sdk.startSessionCalls[1]?.session).not.toBe(engine.sessionId);

    await engine.close();
    expect(sdk.endSessionCalls).toEqual([
      { session: sdk.startSessionCalls[1]?.session },
      { session: engine.sessionId },
    ]);
  });

  it("configures and verifies the Adaptive Cursor for both internal sessions", async () => {
    const lock = await loadEngineLock();
    const sdk = fakeSdk({
      driverVersion: lock.version,
      tools: [...lock.required_tools],
    });

    const engine = await CuaEngine.fromSdk(sdk, lock);
    const sessions = sdk.startSessionCalls.map(({ session }) => session as string);

    expect(sdk.callToolCalls).toEqual([
      ...sessions.map((session) => ({
        name: "set_agent_cursor_theme",
        argumentsJson: JSON.stringify({ session, ...AGENT_CURSOR_THEME }),
      })),
      ...sessions.map((session) => ({
        name: "set_agent_cursor_motion",
        argumentsJson: JSON.stringify({ session, ...AGENT_CURSOR_MOTION }),
      })),
      ...sessions.map((session) => ({
        name: "set_agent_cursor_enabled",
        argumentsJson: JSON.stringify({ session, enabled: false }),
      })),
      ...sessions.map((session) => ({
        name: "get_agent_cursor_state",
        argumentsJson: JSON.stringify({ session }),
      })),
    ]);

    await engine.close();
  });

  it("cleans both sessions when one Cursor configuration call fails", async () => {
    const lock = await loadEngineLock();
    const sdk = fakeSdk({
      driverVersion: lock.version,
      tools: [...lock.required_tools],
      toolResults: {
        set_agent_cursor_enabled: [
          result({ session: "desktop", enabled: false }),
          { ...result({ code: "cursor_failed" }), isError: true },
        ],
      },
    });

    await expect(CuaEngine.fromSdk(sdk, lock)).rejects.toMatchObject({
      code: "engine_contract_changed",
      diagnosticReason: "cursor_initialization_failed",
    });

    const sessions = sdk.startSessionCalls.map(({ session }) => session as string);
    expect(sdk.endSessionCalls).toEqual([
      { session: sessions[1] },
      { session: sessions[0] },
    ]);
    expect(sdk.callToolCalls.map(({ name }) => name)).toEqual([
      "set_agent_cursor_theme",
      "set_agent_cursor_theme",
      "set_agent_cursor_motion",
      "set_agent_cursor_motion",
      "set_agent_cursor_enabled",
      "set_agent_cursor_enabled",
    ]);
  });

  it("cleans both sessions when Cursor readback remains enabled", async () => {
    const lock = await loadEngineLock();
    const sdk = fakeSdk({
      driverVersion: lock.version,
      tools: [...lock.required_tools],
    });
    const originalCallTool = sdk.callTool.bind(sdk);
    vi.spyOn(sdk, "callTool").mockImplementation(async (name, argumentsJson) => {
      const input = JSON.parse(argumentsJson) as { session: string };
      if (name === "get_agent_cursor_state") {
        sdk.callToolCalls.push({ name, argumentsJson });
        const readbackIndex = sdk.callToolCalls.filter((call) => call.name === name).length;
        return result({
          session: input.session,
          enabled: readbackIndex === 2,
          position: null,
          theme: {
            id: AGENT_CURSOR_THEME.theme_id,
            version: "2",
            profile: "cua-driver-actions-v2",
            reduced_motion: AGENT_CURSOR_THEME.reduced_motion,
            fallback: null,
          },
          visual_state: {
            requested_action: "idle",
            resolved_action: "idle",
            modifiers: [],
            phase: "idle",
            frame: 0,
            preempted_count: 0,
          },
          motion: {
            start_handle: 0.3,
            end_handle: 0.3,
            arc_size: 0.25,
            arc_flow: 0,
            spring: 0.72,
            ...AGENT_CURSOR_MOTION,
            turn_radius: 80,
          },
        });
      }
      return originalCallTool(name, argumentsJson);
    });

    await expect(CuaEngine.fromSdk(sdk, lock)).rejects.toMatchObject({
      code: "engine_contract_changed",
    });

    const sessions = sdk.startSessionCalls.map(({ session }) => session as string);
    expect(sdk.endSessionCalls).toEqual([
      { session: sessions[1] },
      { session: sessions[0] },
    ]);
  });

  it("rejects a session that does not establish desktop scope", async () => {
    const lock = await loadEngineLock();
    const sdk = fakeSdk({
      driverVersion: lock.version,
      tools: [...lock.required_tools],
      effectiveScope: EffectiveScope.Window,
    });

    await expect(CuaEngine.fromSdk(sdk, lock)).rejects.toMatchObject({
      code: "engine_version_mismatch",
      diagnosticReason: "session_initialization_failed",
    });
    expect(sdk.endSessionCalls).toHaveLength(2);
  });

  it("rejects and cleans up when Cua does not establish window scope", async () => {
    const lock = await loadEngineLock();
    const sdk = fakeSdk({
      driverVersion: lock.version,
      tools: [...lock.required_tools],
      effectiveScope: EffectiveScope.Desktop,
    });

    await expect(CuaEngine.fromSdk(sdk, lock)).rejects.toMatchObject({
      code: "engine_version_mismatch",
      diagnosticReason: "session_initialization_failed",
    });
    expect(sdk.endSessionCalls).toHaveLength(2);
  });

  it("parses the screenshot dimensions declared by desktop state", async () => {
    const lock = await loadEngineLock();
    const toolResult = JSON.parse(
      await readFile(new URL("../fixtures/cua/desktop-state.json", import.meta.url), "utf8"),
    ) as ToolResult;
    const sdk = fakeSdk({
      driverVersion: lock.version,
      tools: [...lock.required_tools],
      toolResult,
    });
    const engine = await CuaEngine.fromSdk(sdk, lock);
    sdk.callToolCalls.length = 0;

    await expect(engine.observe(new AbortController().signal)).resolves.toEqual({
      image: {
        mimeType: "image/png",
        dataBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
        width: 2560,
        height: 1440,
      },
      platform: "macos",
      scaleFactor: 2,
    });
    expect(sdk.callToolCalls).toEqual([
      {
        name: "get_desktop_state",
        argumentsJson: JSON.stringify({ session: engine.sessionId }),
      },
    ]);
  });

  it("maps a failed Cua observation envelope to capture_failed", async () => {
    const lock = await loadEngineLock();
    const toolResult = JSON.parse(
      await readFile(new URL("../fixtures/cua/desktop-state.json", import.meta.url), "utf8"),
    ) as ToolResult;
    toolResult.isError = true;
    toolResult.errorCode = "capture_denied";
    const sdk = fakeSdk({
      driverVersion: lock.version,
      tools: [...lock.required_tools],
      toolResult,
    });
    const engine = await CuaEngine.fromSdk(sdk, lock);

    await expect(engine.observe(new AbortController().signal)).rejects.toMatchObject({
      code: "capture_failed",
    });
  });

  it("maps a missing screenshot image to capture_failed", async () => {
    const lock = await loadEngineLock();
    const toolResult = JSON.parse(
      await readFile(new URL("../fixtures/cua/desktop-state.json", import.meta.url), "utf8"),
    ) as ToolResult;
    toolResult.images = [];
    const sdk = fakeSdk({
      driverVersion: lock.version,
      tools: [...lock.required_tools],
      toolResult,
    });
    const engine = await CuaEngine.fromSdk(sdk, lock);

    await expect(engine.observe(new AbortController().signal)).rejects.toMatchObject({
      code: "capture_failed",
    });
  });

  it("maps a non-PNG screenshot image to capture_failed", async () => {
    const lock = await loadEngineLock();
    const toolResult = JSON.parse(
      await readFile(new URL("../fixtures/cua/desktop-state.json", import.meta.url), "utf8"),
    ) as ToolResult;
    toolResult.images[0].mimeType = "image/jpeg";
    const sdk = fakeSdk({
      driverVersion: lock.version,
      tools: [...lock.required_tools],
      toolResult,
    });
    const engine = await CuaEngine.fromSdk(sdk, lock);

    await expect(engine.observe(new AbortController().signal)).rejects.toMatchObject({
      code: "capture_failed",
    });
  });

  it("maps malformed desktop JSON to capture_failed", async () => {
    const lock = await loadEngineLock();
    const toolResult = JSON.parse(
      await readFile(new URL("../fixtures/cua/desktop-state.json", import.meta.url), "utf8"),
    ) as ToolResult;
    toolResult.structuredJson = "{not-json";
    const sdk = fakeSdk({
      driverVersion: lock.version,
      tools: [...lock.required_tools],
      toolResult,
    });
    const engine = await CuaEngine.fromSdk(sdk, lock);

    await expect(engine.observe(new AbortController().signal)).rejects.toMatchObject({
      code: "capture_failed",
    });
  });

  it.each([
    "screenshot_width",
    "screenshot_height",
    "screen_width",
    "screen_height",
  ] as const)("maps zero %s metadata to capture_failed", async (field) => {
    const lock = await loadEngineLock();
    const toolResult = JSON.parse(
      await readFile(new URL("../fixtures/cua/desktop-state.json", import.meta.url), "utf8"),
    ) as ToolResult;
    const structured = JSON.parse(toolResult.structuredJson ?? "") as Record<string, unknown>;
    structured[field] = 0;
    toolResult.structuredJson = JSON.stringify(structured);
    const sdk = fakeSdk({
      driverVersion: lock.version,
      tools: [...lock.required_tools],
      toolResult,
    });
    const engine = await CuaEngine.fromSdk(sdk, lock);

    await expect(engine.observe(new AbortController().signal)).rejects.toMatchObject({
      code: "capture_failed",
    });
  });

  it("rejects desktop metadata from an unsupported platform", async () => {
    const lock = await loadEngineLock();
    const toolResult = JSON.parse(
      await readFile(new URL("../fixtures/cua/desktop-state.json", import.meta.url), "utf8"),
    ) as ToolResult;
    const structured = JSON.parse(toolResult.structuredJson ?? "") as Record<string, unknown>;
    structured.platform = "linux";
    toolResult.structuredJson = JSON.stringify(structured);
    const sdk = fakeSdk({
      driverVersion: lock.version,
      tools: [...lock.required_tools],
      toolResult,
    });
    const engine = await CuaEngine.fromSdk(sdk, lock);

    await expect(engine.observe(new AbortController().signal)).rejects.toMatchObject({
      code: "capture_failed",
    });
  });

  it("maps an invalid scale factor to capture_failed", async () => {
    const lock = await loadEngineLock();
    const toolResult = JSON.parse(
      await readFile(new URL("../fixtures/cua/desktop-state.json", import.meta.url), "utf8"),
    ) as ToolResult;
    const structured = JSON.parse(toolResult.structuredJson ?? "") as Record<string, unknown>;
    structured.scale_factor = 0;
    toolResult.structuredJson = JSON.stringify(structured);
    const sdk = fakeSdk({
      driverVersion: lock.version,
      tools: [...lock.required_tools],
      toolResult,
    });
    const engine = await CuaEngine.fromSdk(sdk, lock);

    await expect(engine.observe(new AbortController().signal)).rejects.toMatchObject({
      code: "capture_failed",
    });
  });

  it("discovers native apps and windows through the 0.22.2 tools", async () => {
    const lock = await loadEngineLock();
    const sdk = fakeSdk({
      driverVersion: lock.version,
      tools: [...lock.required_tools],
      toolResults: {
        list_apps: result(await lockedFixture("list-apps")),
        list_windows: result(await lockedFixture("list-windows")),
      },
    });
    const engine = await CuaEngine.fromSdk(sdk, lock);
    sdk.callToolCalls.length = 0;

    const discovery = await engine.discover({ apps: true, windows: true }, new AbortController().signal);

    expect(discovery.apps[0]).toMatchObject({ displayName: "Calculator", native: { pid: 42 } });
    expect(discovery.windows[0]).toMatchObject({ title: "Calculator", native: { window_id: 7 } });
    expect(sdk.callToolCalls).toEqual([
      { name: "list_apps", argumentsJson: "{}" },
      { name: "list_windows", argumentsJson: "{}" },
    ]);
  });

  it("ignores zero-sized system windows without losing valid discovery results", async () => {
    const lock = await loadEngineLock();
    const sdk = fakeSdk({
      driverVersion: lock.version,
      tools: [...lock.required_tools],
      toolResults: {
        list_apps: result({ apps: [{
          pid: 42,
          name: "Calculator",
          bundle_id: "com.apple.calculator",
          running: true,
        }] }),
        list_windows: result({ windows: [{
          window_id: 99,
          pid: 100,
          app_name: "System Helper",
          title: "",
          bounds: { x: 0, y: 0, width: 0, height: 0 },
          z_index: 2,
          is_on_screen: false,
        }, {
          window_id: 7,
          pid: 42,
          app_name: "Calculator",
          title: "Calculator",
          bounds: { x: 100, y: 100, width: 460, height: 816 },
          z_index: 1,
          is_on_screen: true,
        }] }),
      },
    });
    const engine = await CuaEngine.fromSdk(sdk, lock);

    const discovery = await engine.discover({ apps: true, windows: true }, new AbortController().signal);

    expect(discovery.windows).toHaveLength(1);
    expect(discovery.windows[0]).toMatchObject({
      title: "Calculator",
      bounds: { width: 460, height: 816 },
    });
  });

  it("requests apps and windows concurrently for one window discovery", async () => {
    const lock = await loadEngineLock();
    const sdk = fakeSdk({ driverVersion: lock.version, tools: [...lock.required_tools] });
    const engine = await CuaEngine.fromSdk(sdk, lock);
    let inFlight = 0;
    let maxInFlight = 0;
    vi.spyOn(sdk, "callTool").mockImplementation(async (name) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      if (name === "list_apps") return result({ apps: [] });
      if (name === "list_windows") return result({ windows: [] });
      throw new Error(`unexpected tool: ${name}`);
    });

    await engine.discover({ apps: true, windows: true }, new AbortController().signal);

    expect(maxInFlight).toBe(2);
  });

  it("observes one exact registered window without exposing its native ids", async () => {
    const lock = await loadEngineLock();
    const sdk = fakeSdk({
      driverVersion: lock.version,
      tools: [...lock.required_tools],
      toolResults: {
        get_window_state: result(
          await lockedFixture("window-state"),
          [{ mimeType: "image/png", dataBase64: "cG5n" }],
        ),
      },
    });
    const engine = await CuaEngine.fromSdk(sdk, lock);
    sdk.callToolCalls.length = 0;
    const registry = new TargetRegistry({ token: () => "abcdefghijklmnop" });
    const [window] = registry.registerWindows([{
      nativeKey: "window:7",
      ownerKey: "pid:42",
      app: {
        nativeKey: "bundle:com.apple.calculator",
        displayName: "Calculator",
        running: true,
        capabilities: ["launch", "windows"],
        native: { platform: "macos", pid: 42 },
      },
      title: "Calculator",
      bounds: { x: 100, y: 100, width: 460, height: 816 },
      focused: true,
      capabilities: ["observe", "click"],
      native: { platform: "macos", pid: 42, window_id: 7 },
    }]);
    expect(window).toBeDefined();

    const observation = await engine.observe({
      target: { kind: "window", window: window! },
      includeScreenshot: true,
      query: "7",
      maxElements: 25,
      maxDepth: 6,
    }, new AbortController().signal);

    expect(observation).toMatchObject({
      visualStatus: "available",
      upstreamSnapshotId: "s1a2b3c4",
      elements: expect.arrayContaining([
        expect.objectContaining({ token: "s1a2b3c4:1", label: "7" }),
      ]),
    });
    expect(sdk.callToolCalls).toEqual([{
      name: "get_window_state",
      argumentsJson: JSON.stringify({
        session: sdk.startSessionCalls[1]?.session,
        pid: 42,
        window_id: 7,
        include_screenshot: true,
        query: "7",
        max_elements: 25,
        max_depth: 6,
      }),
    }]);
  });

  it("routes an exact background window action through the window-scoped session", async () => {
    const lock = await loadEngineLock();
    const clickResult = result({});
    clickResult.action = {
      effect: ActionEffect.Confirmed,
      route: ActionRoute.Accessibility,
      delivery: { mode: ActionDeliveryMode.Background, deliveredCount: 1 },
    };
    const sdk = fakeSdk({
      driverVersion: lock.version,
      tools: [...lock.required_tools],
      toolResults: { click: clickResult },
    });
    const engine = await CuaEngine.fromSdk(sdk, lock);
    sdk.callToolCalls.length = 0;

    await expect(engine.execute({
      target: { kind: "window", pid: 42, windowId: 7 },
      action: { type: "click", address: { kind: "element", token: "private-token" } },
      delivery: "background",
    }, new AbortController().signal)).resolves.toMatchObject({
      status: "executed",
      effect: "confirmed",
      route: "accessibility",
      delivery: "background",
    });
    expect(sdk.callToolCalls).toEqual([{
      name: "click",
      argumentsJson: JSON.stringify({
        session: sdk.startSessionCalls[1]?.session,
        pid: 42,
        window_id: 7,
        element_token: "private-token",
        delivery_mode: "background",
      }),
    }]);
  });

  it("accepts health only when the version and core checks pass", async () => {
    const lock = await loadEngineLock();
    const sdk = fakeSdk({
      driverVersion: lock.version,
      tools: [...lock.required_tools],
      toolResults: {
        health_report: result({
          schema_version: "1",
          platform: "darwin",
          driver_version: lock.version,
          overall: "ok",
          checks: [
            { name: "binary_version", status: "pass", message: "ok" },
            { name: "platform_supported", status: "pass", message: "ok" },
            { name: "session_active", status: "pass", message: "ok" },
          ],
        }),
      },
    });
    const engine = await CuaEngine.fromSdk(sdk, lock);
    sdk.callToolCalls.length = 0;

    await expect(engine.health(new AbortController().signal)).resolves.toBe(true);
    expect(sdk.callToolCalls).toEqual([{
      name: "health_report",
      argumentsJson: JSON.stringify({ include: ["binary_version", "platform_supported", "session_active"] }),
    }]);
  });

  it("launches one opaque app through the background Cua route", async () => {
    const lock = await loadEngineLock();
    const sdk = fakeSdk({
      driverVersion: lock.version,
      tools: [...lock.required_tools],
      toolResults: {
        launch_app: result({
          pid: 42,
          bundle_id: "com.apple.calculator",
          name: "Calculator",
          launch_state: { requested: true, process_running: true, window_ready: false },
          windows: [],
        }),
      },
    });
    const engine = await CuaEngine.fromSdk(sdk, lock);
    sdk.callToolCalls.length = 0;
    const registry = new TargetRegistry({ token: () => "abcdefghijklmnop" });
    const [app] = registry.registerApps([{
      nativeKey: "bundle:com.apple.calculator",
      displayName: "Calculator",
      running: false,
      capabilities: ["launch", "windows"],
      native: { platform: "macos", bundle_id: "com.apple.calculator", name: "Calculator" },
    }]);

    await expect(engine.execute({
      target: { kind: "app", app: app! },
      action: { type: "launch_app" },
    }, new AbortController().signal)).resolves.toMatchObject({
      status: "executed",
      effect: "partial",
      evidence: ["process_running"],
      errorCode: "window_not_ready",
    });
    expect(sdk.callToolCalls).toEqual([{
      name: "launch_app",
      argumentsJson: JSON.stringify({
        session: sdk.startSessionCalls[1]?.session,
        bundle_id: "com.apple.calculator",
      }),
    }]);
  });
});
