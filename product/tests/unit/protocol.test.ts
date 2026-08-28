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
      protocol_version: "1.1.0",
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
      protocol_version: "1.1.0",
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
      protocol_version: "1.1.0",
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
