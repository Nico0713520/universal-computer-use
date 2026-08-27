import {
  ActionDeliveryMode,
  ActionEffect,
  ActionEscalationReason,
  ActionEscalationTarget,
  ActionRoute,
  type ActionResult,
  type ToolResult,
} from "@trycua/cua-driver";
import { describe, expect, it } from "vitest";

import { mapCuaResult } from "../../src/engine/result-mapper.js";

function resultWith(partial: Partial<ToolResult>): ToolResult {
  return {
    text: "fixture",
    images: [],
    isError: false,
    degraded: false,
    rawJson: "{}",
    ...partial,
  };
}

function actionWith(partial: Partial<ActionResult>): ActionResult {
  return {
    effect: ActionEffect.Unverifiable,
    route: ActionRoute.GlobalInput,
    delivery: { mode: ActionDeliveryMode.Foreground },
    ...partial,
  };
}

describe("Cua result mapping", () => {
  it.each([
    [ActionEffect.Confirmed, "confirmed", "executed"],
    [ActionEffect.Partial, "partial", "executed"],
    [ActionEffect.Unverifiable, "unverifiable", "executed"],
    [ActionEffect.SuspectedNoop, "suspected_noop", "executed"],
    [ActionEffect.Refused, "refused", "refused"],
  ] as const)("preserves action effect %s without inventing success", (effect, expected, status) => {
    const action = actionWith({
      effect,
      ...(effect === ActionEffect.Refused ? { delivery: undefined } : {}),
    });

    expect(mapCuaResult(resultWith({ action }))).toEqual({
      status,
      effect: expected,
      route: "global_input",
      delivery: effect === ActionEffect.Refused ? "unknown" : "foreground",
      ...(effect === ActionEffect.Refused ? { errorCode: "action_refused" } : {}),
    });
  });

  it.each([
    [ActionRoute.Accessibility, "accessibility"],
    [ActionRoute.SyntheticEvents, "synthetic_events"],
    [ActionRoute.GlobalInput, "global_input"],
    [ActionRoute.SystemApi, "system_api"],
    [ActionRoute.Dom, "dom"],
    [ActionRoute.TrustedInput, "trusted_input"],
  ] as const)("preserves action route %s", (route, expected) => {
    expect(mapCuaResult(resultWith({ action: actionWith({ route }) }))).toMatchObject({
      route: expected,
    });
  });

  it.each([
    [ActionDeliveryMode.Background, "background"],
    [ActionDeliveryMode.Foreground, "foreground"],
    [ActionDeliveryMode.NotApplicable, "not_applicable"],
    [ActionDeliveryMode.Unknown, "unknown"],
  ] as const)("preserves action delivery %s", (mode, expected) => {
    expect(mapCuaResult(resultWith({
      action: actionWith({ delivery: { mode } }),
    }))).toMatchObject({ delivery: expected });
  });

  it("uses unknown when Cua reports no attempted delivery", () => {
    expect(mapCuaResult(resultWith({
      action: actionWith({ delivery: undefined }),
    }))).toMatchObject({ delivery: "unknown" });
  });

  it("turns a permission escalation into the stable permission error", () => {
    const action = actionWith({
      effect: ActionEffect.Refused,
      delivery: undefined,
      escalation: {
        target: ActionEscalationTarget.Session,
        reason: ActionEscalationReason.PermissionRequired,
      },
    });

    expect(mapCuaResult(resultWith({ action }))).toEqual({
      status: "refused",
      effect: "refused",
      route: "global_input",
      delivery: "unknown",
      errorCode: "permission_required",
    });
  });

  it.each([
    ["permission_required", "failed", "permission_required"],
    ["accessibility_permission_required", "failed", "permission_required"],
    ["screen_recording_permission_required", "failed", "permission_required"],
    ["desktop_locked", "failed", "interactive_session_required"],
    ["session_0", "failed", "interactive_session_required"],
    ["background_uipi_blocked", "refused", "action_refused"],
    ["foreground_required", "refused", "action_refused"],
    ["permission_denied", "refused", "action_refused"],
    ["new_unclassified_error", "failed", "action_failed"],
  ] as const)(
    "maps Cua error code %s to %s without calling it runtime_unavailable",
    (errorCode, status, stableCode) => {
      expect(mapCuaResult(resultWith({ isError: true, errorCode }))).toEqual({
        status,
        effect: status === "refused" ? "refused" : "unverifiable",
        route: "unknown",
        delivery: "unknown",
        errorCode: stableCode,
      });
    },
  );

  it("fails closed when an error has no code or a successful action has no ActionResult", () => {
    const expected = {
      status: "failed",
      effect: "unverifiable",
      route: "unknown",
      delivery: "unknown",
      errorCode: "action_failed",
    };

    expect(mapCuaResult(resultWith({ isError: true }))).toEqual(expected);
    expect(mapCuaResult(resultWith({ action: undefined }))).toEqual(expected);
  });

  it("fails closed on enum values outside the locked Cua contract", () => {
    expect(mapCuaResult(resultWith({
      action: actionWith({ effect: 99 as ActionEffect }),
    }))).toMatchObject({ status: "failed", errorCode: "action_failed" });
    expect(mapCuaResult(resultWith({
      action: actionWith({ route: 99 as ActionRoute }),
    }))).toMatchObject({ status: "failed", errorCode: "action_failed" });
    expect(mapCuaResult(resultWith({
      action: actionWith({ delivery: { mode: 99 as ActionDeliveryMode } }),
    }))).toMatchObject({ status: "failed", errorCode: "action_failed" });
  });
});
