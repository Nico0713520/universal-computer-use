import { describe, expect, it } from "vitest";

import { classifyCuaErrorCode } from "../../src/engine/cua-error-code.js";

describe("shared Cua error-code classification", () => {
  it.each([
    ["screen_recording_permission_required", { kind: "permission", permission: "screen_recording" }],
    ["accessibility_permission_required", { kind: "permission", permission: "accessibility" }],
    ["permission_required", { kind: "permission", permission: "unknown" }],
    ["desktop_locked", { kind: "interactive_session" }],
    ["session_0", { kind: "interactive_session" }],
    ["background_uipi_blocked", { kind: "explicit_refusal" }],
    ["foreground_required", { kind: "explicit_refusal" }],
    ["permission_denied", { kind: "explicit_refusal" }],
    ["new_unclassified_error", { kind: "unclassified" }],
    [undefined, { kind: "unclassified" }],
  ] as const)("classifies %s once for observation and action adapters", (code, expected) => {
    expect(classifyCuaErrorCode(code)).toEqual(expected);
  });
});
