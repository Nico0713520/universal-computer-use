import { describe, expect, it } from "vitest";
import {
  ActInputSchema,
  ActOutputSchema,
  ObservationOutputSchema,
  ObserveInputSchema,
} from "../../src/protocol.js";
import { ComputerUseError, ERROR_CODES } from "../../src/errors.js";

describe("public protocol", () => {
  it("accepts an empty observe input and rejects unknown fields", () => {
    expect(ObserveInputSchema.parse({})).toEqual({});
    expect(() => ObserveInputSchema.parse({ display: "secondary" })).toThrow();
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

  it("validates versioned observation and action outputs", () => {
    const screenshot = { mime_type: "image/png", width: 2560, height: 1440 };
    expect(ObservationOutputSchema.parse({
      protocol_version: "1.0.0",
      session_id: "ses_123",
      snapshot_id: "snap_12345678",
      platform: "macos",
      display_id: "primary",
      screenshot,
      engine: { name: "cua-driver", version: "0.22.1" },
    })).toBeTruthy();
    expect(ActOutputSchema.parse({
      protocol_version: "1.0.0",
      session_id: "ses_123",
      consumed_snapshot_id: "snap_12345678",
      snapshot_id: "snap_87654321",
      action_result: {
        status: "executed",
        effect: "unverifiable",
        route: "global_input",
        delivery: "foreground",
      },
      screenshot,
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
