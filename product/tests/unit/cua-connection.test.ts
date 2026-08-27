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
import { fakeSdk } from "../helpers/fake-cua-sdk.js";

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
});
