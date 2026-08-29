import { describe, expect, it } from "vitest";
import {
  ActInputSchema,
  ActOutputSchema,
  AppRefSchema,
  ElementRefSchema,
  ObservationOutputSchema,
  ObserveInputSchema,
  WindowRefSchema,
} from "../../src/protocol.js";
import { ComputerUseError, ERROR_CODES } from "../../src/errors.js";

function windowObservation(overrides: Record<string, unknown> = {}) {
  return {
    protocol_version: "1.2.0",
    session_id: "ses_123",
    snapshot_id: "snap_12345678",
    platform: "macos",
    target: {
      kind: "window",
      window_ref: "win_abcdefghijklmnop",
      app_ref: "app_abcdefghijklmnop",
      app_name: "Calculator",
      title: "Calculator",
    },
    coordinate_space: "window_screenshot_pixels",
    observation_mode: "semantic",
    visual_status: "not_requested",
    elements: [],
    elements_truncated: false,
    engine: { name: "cua-driver", version: "0.22.2" },
    ...overrides,
  };
}

describe("public protocol", () => {
  it("accepts an empty observe input and rejects unknown fields", () => {
    expect(ObserveInputSchema.parse({})).toEqual({});
    expect(() => ObserveInputSchema.parse({ display: "secondary" })).toThrow();
  });

  it("accepts bounded desktop discovery and precise window observation", () => {
    expect(ObserveInputSchema.parse({
      target: { kind: "desktop" },
      discover: {
        apps: true,
        windows: true,
        query: "Calculator",
        window_app_ref: "app_abcdefghijklmnop",
      },
    })).toMatchObject({ discover: { apps: true, windows: true } });

    expect(ObserveInputSchema.parse({
      target: { kind: "window", window_ref: "win_abcdefghijklmnop" },
      include_screenshot: false,
      elements: { query: "display", max_elements: 100, max_depth: 10 },
    })).toMatchObject({ target: { kind: "window" }, include_screenshot: false });

    expect(() => ObserveInputSchema.parse({
      target: { kind: "desktop" },
      discover: { apps: false, windows: false },
    })).toThrow();
    expect(() => ObserveInputSchema.parse({
      target: { kind: "window", window_ref: "win_abcdefghijklmnop" },
      discover: { windows: true },
    })).toThrow();
  });

  it("exports opaque ref formats without accepting native identifiers", () => {
    expect(AppRefSchema.parse("app_abcdefghijklmnop")).toBeTruthy();
    expect(WindowRefSchema.parse("win_abcdefghijklmnop")).toBeTruthy();
    expect(ElementRefSchema.parse("el_abcdefghijklmnop")).toBeTruthy();
    expect(() => AppRefSchema.parse("com.apple.Calculator")).toThrow();
    expect(() => WindowRefSchema.parse("42")).toThrow();
  });

  it("accepts exactly one action", () => {
    expect(ActInputSchema.parse({
      snapshot_id: "snap_12345678",
      action: { type: "click", x: 20, y: 30 },
    })).toBeTruthy();
    expect(() => ActInputSchema.parse({
      snapshot_id: "snap_12345678",
      actions: [],
    })).toThrow();
  });

  it("accepts only a strict adaptive next-observation preference", () => {
    expect(ActInputSchema.parse({
      snapshot_id: "snap_12345678",
      action: { type: "wait", ms: 0 },
      next_observation: { mode: "semantic" },
    }).next_observation).toEqual({ mode: "semantic" });

    for (const invalid of [
      { mode: "fast" },
      {},
      { mode: "visual", extra: true },
    ]) {
      expect(() => ActInputSchema.parse({
        snapshot_id: "snap_12345678",
        action: { type: "wait", ms: 0 },
        next_observation: invalid,
      })).toThrow();
    }
  });

  it("keeps semantic window observations image-free", () => {
    expect(ObservationOutputSchema.parse(windowObservation())).not.toHaveProperty("screenshot");
    expect(() => ObservationOutputSchema.parse(windowObservation({
      visual_status: "available",
      screenshot: { mime_type: "image/png", width: 100, height: 100 },
    }))).toThrow();
  });

  it.each([
    { type: "click", x: 1, y: 2 },
    { type: "double_click", x: 1, y: 2 },
    { type: "right_click", x: 1, y: 2 },
    { type: "move", x: 1, y: 2 },
    { type: "drag", from_x: 1, from_y: 2, to_x: 3, to_y: 4, duration_ms: 500 },
    { type: "scroll", x: 1, y: 2, direction: "down", amount: 3, by: "line" },
    { type: "type", text: "hello" },
    { type: "keypress", keys: ["cmd", "shift", "p"] },
    { type: "wait", ms: 100 },
  ])("accepts the v1 $type action", (action) => {
    expect(ActInputSchema.parse({ snapshot_id: "snap_12345678", action })).toBeTruthy();
  });

  it.each([
    { action: { type: "click", element_ref: "el_abcdefghijklmnop" }, delivery: "background" },
    { action: { type: "scroll", element_ref: "el_abcdefghijklmnop", direction: "down", amount: 3 }, delivery: "foreground" },
    { action: { type: "set_value", element_ref: "el_abcdefghijklmnop", value: "hello" } },
    { action: { type: "type_text", element_ref: "el_abcdefghijklmnop", text: "hello" }, delivery: "background" },
    { action: { type: "type_text", x: 10, y: 20, text: "hello" }, delivery: "foreground" },
    { action: { type: "keypress", element_ref: "el_abcdefghijklmnop", keys: ["ENTER"] }, delivery: "background" },
    { action: { type: "invoke_menu", path: ["File", "New"] } },
    { action: { type: "launch_app", app_ref: "app_abcdefghijklmnop" } },
  ])("accepts one bounded v0.2 action", ({ action, delivery }) => {
    expect(ActInputSchema.parse({
      snapshot_id: "snap_12345678",
      action,
      ...(delivery === undefined ? {} : { delivery }),
    })).toBeTruthy();
  });

  it("accepts one existing-element expectation and rejects unsafe combinations", () => {
    expect(ActInputSchema.parse({
      snapshot_id: "snap_12345678",
      action: { type: "set_value", element_ref: "el_abcdefghijklmnop", value: "hello" },
      expect: {
        element: { element_ref: "el_abcdefghijklmnop", value_equals: "hello" },
        timeout_ms: 5000,
      },
    })).toBeTruthy();

    expect(() => ActInputSchema.parse({
      snapshot_id: "snap_12345678",
      action: { type: "click", element_ref: "el_abcdefghijklmnop", x: 1, y: 2 },
    })).toThrow();
    expect(() => ActInputSchema.parse({
      snapshot_id: "snap_12345678",
      action: { type: "launch_app", app_ref: "app_abcdefghijklmnop" },
      expect: { element: { element_ref: "el_abcdefghijklmnop", enabled: true } },
    })).toThrow();
    expect(() => ActInputSchema.parse({
      snapshot_id: "snap_12345678",
      action: { type: "set_value", element_ref: "el_abcdefghijklmnop", value: "hello" },
      expect: { element: { element_ref: "el_abcdefghijklmnop", value_equals: "different" } },
    })).toThrow();
  });

  it("validates versioned observation and action outputs", () => {
    const screenshot = { mime_type: "image/png", width: 2560, height: 1440 };
    expect(ObservationOutputSchema.parse({
      protocol_version: "1.2.0",
      session_id: "ses_123",
      snapshot_id: "snap_12345678",
      platform: "macos",
      display_id: "primary",
      target: { kind: "desktop", display_id: "primary" },
      coordinate_space: "desktop_screenshot_pixels",
      screenshot,
      engine: { name: "cua-driver", version: "0.22.2" },
    })).toBeTruthy();
    expect(ActOutputSchema.parse({
      next_state: "available",
      protocol_version: "1.2.0",
      session_id: "ses_123",
      consumed_snapshot_id: "snap_12345678",
      snapshot_id: "snap_87654321",
      target: { kind: "desktop", display_id: "primary" },
      coordinate_space: "desktop_screenshot_pixels",
      action_result: {
        status: "executed",
        effect: "unverifiable",
        route: "global_input",
        delivery: "foreground",
        evidence: [],
      },
      verification: { status: "not_requested" },
      screenshot,
    })).toBeTruthy();

    expect(ActOutputSchema.parse({
      next_state: "unavailable",
      protocol_version: "1.2.0",
      session_id: "ses_123",
      consumed_snapshot_id: "snap_12345678",
      action_result: {
        status: "executed",
        effect: "unverifiable",
        route: "accessibility",
        delivery: "background",
        evidence: [],
      },
      verification: { status: "unknown", reason: "observation_unavailable" },
      next_observation_error: { code: "target_lost", recovery: "observe_desktop" },
    })).toBeTruthy();
    expect(() => ObservationOutputSchema.parse({ protocol_version: "2.0.0" })).toThrow();
  });

  it("publishes only bounded opaque discovery metadata", () => {
    const output = {
      protocol_version: "1.2.0",
      session_id: "ses_123",
      snapshot_id: "snap_12345678",
      platform: "macos",
      display_id: "primary",
      target: { kind: "desktop", display_id: "primary" },
      coordinate_space: "desktop_screenshot_pixels",
      screenshot: { mime_type: "image/png", width: 1920, height: 1080 },
      engine: { name: "cua-driver", version: "0.22.2" },
      apps: [{
        app_ref: "app_abcdefghijklmnop",
        display_name: "Calculator",
        running: true,
        capabilities: ["launch", "windows"],
      }],
      apps_truncated: false,
      windows: [{
        window_ref: "win_abcdefghijklmnop",
        app_ref: "app_abcdefghijklmnop",
        app_name: "Calculator",
        title: "Calculator",
        bounds: { x: 100, y: 100, width: 460, height: 816, coordinate_space: "desktop_logical" },
        is_on_screen: true,
        on_current_space: true,
        capabilities: {
          elements: "available",
          window_screenshot: "available",
          background_actions: "unknown",
        },
      }],
      windows_truncated: false,
    } as const;

    expect(ObservationOutputSchema.parse(output)).toEqual(output);
    expect(() => ObservationOutputSchema.parse({
      ...output,
      windows: [{ ...output.windows[0], pid: 42 }],
    })).toThrow();
    expect(() => ObservationOutputSchema.parse({
      ...output,
      windows: [{ ...output.windows[0], capabilities: ["click"] }],
    })).toThrow();
  });

  it("requires honest element and action-result evidence", () => {
    const windowObservation = {
      protocol_version: "1.2.0",
      session_id: "ses_123",
      snapshot_id: "snap_12345678",
      platform: "macos",
      target: {
        kind: "window",
        window_ref: "win_abcdefghijklmnop",
        app_ref: "app_abcdefghijklmnop",
        app_name: "Calculator",
        title: "Calculator",
      },
      coordinate_space: "window_screenshot_pixels",
      observation_mode: "semantic",
      visual_status: "not_requested",
      elements: [{
        element_ref: "el_abcdefghijklmnop",
        role: "button",
        label: "7",
        actions: ["click"],
      }],
      elements_truncated: false,
      engine: { name: "cua-driver", version: "0.22.2" },
    } as const;
    expect(ObservationOutputSchema.parse(windowObservation)).toEqual(windowObservation);
    expect(() => ObservationOutputSchema.parse({
      ...windowObservation,
      elements: [{ ...windowObservation.elements[0], label: undefined }],
    })).toThrow();
    expect(() => ObservationOutputSchema.parse({
      ...windowObservation,
      elements: [{ ...windowObservation.elements[0], value: null }],
    })).toThrow();

    const baseAction = {
      next_state: "unavailable",
      protocol_version: "1.2.0",
      session_id: "ses_123",
      consumed_snapshot_id: "snap_12345678",
      action_result: {
        status: "executed",
        effect: "confirmed",
        route: "accessibility",
        delivery: "background",
        evidence: ["value_readback"],
      },
      verification: { status: "satisfied" },
      next_observation_error: { code: "target_lost", recovery: "observe_desktop" },
    } as const;
    expect(ActOutputSchema.parse(baseAction)).toEqual(baseAction);
    expect(() => ActOutputSchema.parse({
      ...baseAction,
      action_result: { ...baseAction.action_result, evidence: ["cua_said_ok"] },
    })).toThrow();
  });

  it("enforces bounded coordinates, text, keys, wait, scroll, and drag duration", () => {
    const parseAction = (action: unknown) => ActInputSchema.parse({
      snapshot_id: "snap_12345678",
      action,
    });

    expect(() => parseAction({ type: "click", x: -1, y: 0 })).toThrow();
    expect(() => parseAction({ type: "move", x: Number.POSITIVE_INFINITY, y: 0 })).toThrow();
    expect(() => parseAction({ type: "type", text: "x".repeat(20_001) })).toThrow();
    expect(() => parseAction({ type: "keypress", keys: [] })).toThrow();
    expect(() => parseAction({ type: "keypress", keys: Array(9).fill("a") })).toThrow();
    expect(() => parseAction({ type: "keypress", keys: ["not a key"] })).toThrow();
    expect(() => parseAction({ type: "keypress", keys: ["ENTER"] })).not.toThrow();
    expect(() => parseAction({ type: "wait", ms: 15_001 })).toThrow();
    expect(() => parseAction({
      type: "drag",
      from_x: 1,
      from_y: 1,
      to_x: 2,
      to_y: 2,
      duration_ms: 10_001,
    })).toThrow();
    expect(() => parseAction({
      type: "scroll",
      x: 1,
      y: 1,
      direction: "down",
      amount: 51,
    })).toThrow();
  });

  it("exposes only the frozen stable error codes with recovery metadata", () => {
    expect(ERROR_CODES).toEqual([
      "runtime_missing",
      "runtime_unavailable",
      "engine_version_mismatch",
      "engine_not_development_eligible",
      "engine_not_release_eligible",
      "permission_required",
      "unsupported_platform",
      "interactive_session_required",
      "stale_snapshot",
      "next_observation_target_conflict",
      "coordinate_out_of_bounds",
      "action_timeout",
      "action_refused",
      "action_failed",
      "capture_failed",
      "unsupported_action",
      "stale_app_ref",
      "app_not_found",
      "window_not_found",
      "window_not_ready",
      "window_target_ambiguous",
      "window_owner_changed",
      "target_lost",
      "stale_element_ref",
      "element_target_conflict",
      "element_unavailable",
      "pixel_frame_unproven",
      "background_unavailable",
      "foreground_required",
      "verification_unsatisfied",
      "verification_unknown",
      "engine_unhealthy",
      "engine_contract_changed",
    ]);

    const error = new ComputerUseError(
      "stale_snapshot",
      "Observe again before acting",
      "observe_again",
      true,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      code: "stale_snapshot",
      message: "Observe again before acting",
      recovery: "observe_again",
      retryable: true,
    });
  });
});
