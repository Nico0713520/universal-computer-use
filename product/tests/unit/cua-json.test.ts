import { readFile } from "node:fs/promises";

import type { ToolResult } from "@trycua/cua-driver";
import { describe, expect, it } from "vitest";

import {
  parseAppList,
  parseDesktopObservation,
  parseHealth,
  parseLaunchResult,
  parseWindowList,
  parseWindowState,
} from "../../src/engine/cua-json.js";
import type { InternalAppTarget, InternalWindowTarget } from "../../src/target-registry.js";

const fixtureUrls = {
  apps: new URL("../fixtures/cua/0.22.2/list-apps.json", import.meta.url),
  windows: new URL("../fixtures/cua/0.22.2/list-windows.json", import.meta.url),
  windowState: new URL("../fixtures/cua/0.22.2/window-state.json", import.meta.url),
  health: new URL("../fixtures/cua/0.22.2/health-report.json", import.meta.url),
} as const;

async function fixture(url: URL): Promise<unknown> {
  return JSON.parse(await readFile(url, "utf8")) as unknown;
}

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

function target(): InternalWindowTarget {
  return {
    windowRef: "win_abcdefghijklmnop",
    appRef: "app_abcdefghijklmnop",
    nativeKey: "window:7",
    ownerKey: "pid:42",
    appName: "Calculator",
    title: "Calculator",
    bounds: { x: 100, y: 100, width: 460, height: 816 },
    focused: true,
    isOnScreen: true,
    onCurrentSpace: true,
    capabilities: ["observe", "click"],
    native: { platform: "macos", pid: 42, window_id: 7 },
  };
}

function appTarget(): InternalAppTarget {
  return {
    appRef: "app_abcdefghijklmnop",
    nativeKey: "bundle:com.apple.calculator",
    displayName: "Calculator",
    running: false,
    capabilities: ["launch", "windows"],
    native: { platform: "macos", bundle_id: "com.apple.calculator", name: "Calculator" },
  };
}

function windowState(): Record<string, unknown> {
  return {
    window_id: 7,
    pid: 42,
    snapshot_id: "s1a2b3c4",
    element_count: 2,
    returned_element_count: 2,
    elements_complete: false,
    elements: [
      {
        element_index: 0,
        element_token: "s1a2b3c4:0",
        role: "AXWindow",
        label: "Calculator",
        frame: { x: 100, y: 100, w: 460, h: 816 },
        depth: 0,
      },
      {
        element_index: 1,
        element_token: "s1a2b3c4:1",
        role: "AXButton",
        label: "7",
        value: "7",
        frame: { x: 110, y: 610, w: 100, h: 80 },
        parent_index: 0,
        depth: 1,
        enabled: true,
      },
    ],
    screenshot_width: 920,
    screenshot_height: 1632,
    screenshot_mime_type: "image/png",
    screenshot_frame_valid: true,
    window_bounds: { x: 100, y: 100, width: 460, height: 816 },
  };
}

describe("Cua 0.22.2 raw JSON parsers", () => {
  it.each([
    "permission_required",
    "accessibility_permission_required",
    "screen_recording_permission_required",
  ])("preserves the %s desktop capture failure for doctor", (errorCode) => {
    const failure = result({});
    failure.isError = true;
    failure.errorCode = errorCode;

    expect(() => parseDesktopObservation(failure)).toThrowError(
      expect.objectContaining({
        code: "permission_required",
        recovery: "grant_permission",
        retryable: false,
      }),
    );
  });

  it.each(["desktop_locked", "session_0"])(
    "preserves the %s desktop failure as a non-interactive session",
    (errorCode) => {
      const failure = result({});
      failure.isError = true;
      failure.errorCode = errorCode;

      expect(() => parseDesktopObservation(failure)).toThrowError(
        expect.objectContaining({
          code: "interactive_session_required",
          recovery: "stop",
          retryable: false,
        }),
      );
    },
  );

  it("keeps native app/window identifiers internal while parsing locked discovery fixtures", async () => {
    const apps = parseAppList(result(await fixture(fixtureUrls.apps)), "macos");
    const windows = parseWindowList(
      result(await fixture(fixtureUrls.windows)),
      apps,
      "macos",
    );

    expect(apps[0]).toMatchObject({
      nativeKey: "bundle:com.apple.calculator",
      displayName: "Calculator",
      running: true,
      native: { pid: 42, bundle_id: "com.apple.calculator" },
    });
    expect(windows[0]).toMatchObject({
      nativeKey: "window:7",
      ownerKey: "pid:42",
      focused: true,
      isOnScreen: true,
      onCurrentSpace: true,
      native: { pid: 42, window_id: 7 },
    });
  });

  it("parses one proven PNG and snapshot-bound elements from the locked fixture", async () => {
    const parsed = parseWindowState(
      result(await fixture(fixtureUrls.windowState), [{ mimeType: "image/png", dataBase64: "cG5n" }]),
      target(),
      true,
    );

    expect(parsed).toMatchObject({
      platform: "macos",
      visualStatus: "available",
      upstreamSnapshotId: "s1a2b3c4",
      image: { width: 920, height: 1632, dataBase64: "cG5n" },
      elementsComplete: false,
      elements: [
        { index: 0, token: "s1a2b3c4:0", role: "AXWindow" },
        { index: 1, token: "s1a2b3c4:1", parentIndex: 0, label: "7", enabled: true },
      ],
    });
  });

  it("preserves semantic elements when a proven pixel frame is unavailable", () => {
    const state = windowState();
    delete state.screenshot_width;
    delete state.screenshot_height;
    delete state.screenshot_mime_type;
    delete state.window_bounds;
    state.screenshot_frame_valid = false;
    state.screenshot_error = { code: "px_frame_mismatch" };

    expect(parseWindowState(result(state), target(), true)).toMatchObject({
      visualStatus: "pixel_frame_unproven",
      elements: expect.arrayContaining([expect.objectContaining({ token: "s1a2b3c4:0" })]),
    });
  });

  it("fails closed on owner mismatch, duplicate images, and incoherent dimensions", () => {
    const refusal = result({
      code: "window_owner_pid_mismatch",
      pid: 42,
      window_id: 7,
      owner_pid: 99,
    });
    refusal.isError = true;
    expect(() => parseWindowState(refusal, target(), true)).toThrowError("window_owner_changed");

    expect(() => parseWindowState(result(windowState(), [
      { mimeType: "image/png", dataBase64: "a" },
      { mimeType: "image/png", dataBase64: "b" },
    ]), target(), true)).toThrowError("invalid window screenshot image set");

    const incoherent = windowState();
    incoherent.screenshot_width = 100;
    expect(() => parseWindowState(
      result(incoherent, [{ mimeType: "image/png", dataBase64: "cG5n" }]),
      target(),
      true,
    )).toThrowError("incoherent window screenshot dimensions");
  });

  it("requires all core health checks to pass", () => {
    const health = (sessionStatus: "pass" | "fail") => result({
      schema_version: "1",
      platform: "darwin",
      driver_version: "0.22.2",
      overall: sessionStatus === "pass" ? "ok" : "failed",
      checks: [
        { name: "binary_version", status: "pass", message: "ok" },
        { name: "platform_supported", status: "pass", message: "ok" },
        { name: "session_active", status: sessionStatus, message: "state" },
      ],
    });
    expect(parseHealth(health("pass"), "0.22.2")).toBe(true);
    expect(parseHealth(health("fail"), "0.22.2")).toBe(false);
    expect(parseHealth(health("pass"), "0.22.3")).toBe(false);
  });

  it("accepts the locked health fixture only for Cua 0.22.2", async () => {
    const health = result(await fixture(fixtureUrls.health));
    expect(parseHealth(health, "0.22.2")).toBe(true);
    expect(parseHealth(health, "0.22.3")).toBe(false);
  });

  it("fails closed when locked window bounds use the element-frame spelling", async () => {
    const raw = await fixture(fixtureUrls.windows) as {
      windows: Array<{ bounds: Record<string, unknown> }>;
    };
    raw.windows[0]!.bounds = { x: 100, y: 100, w: 460, h: 816 };
    const apps = parseAppList(result(await fixture(fixtureUrls.apps)), "macos");
    expect(() => parseWindowList(result(raw), apps, "macos"))
      .toThrowError("Cua returned invalid window list data");
  });

  it("normalizes launch proof and exact window candidates", () => {
    const launched = parseLaunchResult(result({
      pid: 42,
      bundle_id: "com.apple.calculator",
      name: "Calculator",
      launch_state: { requested: true, process_running: true, window_ready: true },
      windows: [{
        window_id: 7,
        pid: 42,
        app_name: "Calculator",
        title: "Calculator",
        bounds: { x: 100, y: 100, width: 460, height: 816 },
        z_index: 4,
        is_on_screen: true,
        on_current_space: true,
      }],
    }), appTarget());

    expect(launched).toMatchObject({
      status: "executed",
      effect: "confirmed",
      evidence: ["process_running", "window_ready"],
      launch: {
        processRunning: true,
        windowReady: true,
        windows: [{ native: { pid: 42, window_id: 7 } }],
      },
    });
  });
});
