import { readFile } from "node:fs/promises";

import {
  CaptureScope,
  CuaDriver,
  EffectiveScope,
  type ToolResult,
} from "@trycua/cua-driver";
import { describe, expect, it, vi } from "vitest";

import { CuaEngine } from "../../src/engine/cua.js";
import { loadEngineLock } from "../../src/engine/lock.js";
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

  it("rejects a daemon version that differs from the lock", async () => {
    const lock = await loadEngineLock();
    const sdk = fakeSdk({ driverVersion: "0.22.0", tools: [...lock.required_tools] });

    await expect(CuaEngine.fromSdk(sdk, lock)).rejects.toMatchObject({
      code: "engine_version_mismatch",
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

  it("starts one explicitly desktop-scoped session", async () => {
    const lock = await loadEngineLock();
    const sdk = fakeSdk({
      driverVersion: lock.version,
      tools: [...lock.required_tools],
    });

    const engine = await CuaEngine.fromSdk(sdk, lock);

    expect(engine.sessionId).toMatch(/^ucu_/);
    expect(sdk.startSessionCalls).toHaveLength(1);
    expect(sdk.startSessionCalls[0]).toMatchObject({
      session: engine.sessionId,
      captureScope: CaptureScope.Desktop,
    });

    await engine.close();
    expect(sdk.endSessionCalls).toEqual([{ session: engine.sessionId }]);
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
    });
    expect(sdk.endSessionCalls).toHaveLength(1);
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
        list_apps: result({ apps: [{
          pid: 42,
          name: "Calculator",
          bundle_id: "com.apple.calculator",
          active: true,
          running: true,
          launch_path: "/System/Applications/Calculator.app",
        }] }),
        list_windows: result({ windows: [{
          window_id: 7,
          pid: 42,
          app_name: "Calculator",
          title: "Calculator",
          bounds: { x: 100, y: 100, width: 460, height: 816 },
          z_index: 1,
          is_on_screen: true,
          on_current_space: true,
        }] }),
      },
    });
    const engine = await CuaEngine.fromSdk(sdk, lock);

    const discovery = await engine.discover({ apps: true, windows: true }, new AbortController().signal);

    expect(discovery.apps[0]).toMatchObject({ displayName: "Calculator", native: { pid: 42 } });
    expect(discovery.windows[0]).toMatchObject({ title: "Calculator", native: { window_id: 7 } });
    expect(sdk.callToolCalls).toEqual([
      { name: "list_apps", argumentsJson: "{}" },
      { name: "list_windows", argumentsJson: "{}" },
    ]);
  });

  it("observes one exact registered window without exposing its native ids", async () => {
    const lock = await loadEngineLock();
    const sdk = fakeSdk({
      driverVersion: lock.version,
      tools: [...lock.required_tools],
      toolResults: {
        get_window_state: result({
          window_id: 7,
          pid: 42,
          snapshot_id: "native-snapshot",
          element_count: 1,
          returned_element_count: 1,
          elements_complete: true,
          elements: [{
            element_index: 0,
            element_token: "native-snapshot:0",
            role: "AXButton",
            label: "7",
            frame: { x: 10, y: 20, w: 100, h: 80 },
            depth: 0,
            enabled: true,
          }],
          screenshot_width: 920,
          screenshot_height: 1632,
          screenshot_mime_type: "image/png",
          screenshot_frame_valid: true,
          window_bounds: { x: 100, y: 100, width: 460, height: 816 },
        }, [{ mimeType: "image/png", dataBase64: "cG5n" }]),
      },
    });
    const engine = await CuaEngine.fromSdk(sdk, lock);
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
      elements: [{ token: "native-snapshot:0", label: "7" }],
    });
    expect(sdk.callToolCalls).toEqual([{
      name: "get_window_state",
      argumentsJson: JSON.stringify({
        session: engine.sessionId,
        pid: 42,
        window_id: 7,
        include_screenshot: true,
        query: "7",
        max_elements: 25,
        max_depth: 6,
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

    await expect(engine.health(new AbortController().signal)).resolves.toBe(true);
    expect(sdk.callToolCalls).toEqual([{
      name: "health_report",
      argumentsJson: JSON.stringify({ include: ["binary_version", "platform_supported", "session_active"] }),
    }]);
  });
});
