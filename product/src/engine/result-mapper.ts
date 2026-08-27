import {
  ActionDeliveryMode,
  ActionEffect,
  ActionEscalationReason,
  ActionRoute,
  type ToolResult,
} from "@trycua/cua-driver";

import type { EngineExecution } from "./port.js";

const PERMISSION_ERROR_CODES = new Set([
  "permission_required",
  "accessibility_permission_required",
  "screen_recording_permission_required",
]);

const INTERACTIVE_SESSION_ERROR_CODES = new Set([
  "desktop_locked",
  "session_0",
]);

const EXPLICIT_REFUSAL_ERROR_CODES = new Set([
  "background_uipi_blocked",
  "foreground_required",
  "permission_denied",
]);

function failed(errorCode: EngineExecution["errorCode"] = "action_failed"): EngineExecution {
  return {
    status: "failed",
    effect: "unverifiable",
    route: "unknown",
    delivery: "unknown",
    errorCode,
  };
}

function refused(): EngineExecution {
  return {
    status: "refused",
    effect: "refused",
    route: "unknown",
    delivery: "unknown",
    errorCode: "action_refused",
  };
}

function mapErrorCode(errorCode: string | undefined): EngineExecution {
  if (errorCode !== undefined && PERMISSION_ERROR_CODES.has(errorCode)) {
    return failed("permission_required");
  }
  if (errorCode !== undefined && INTERACTIVE_SESSION_ERROR_CODES.has(errorCode)) {
    return failed("interactive_session_required");
  }
  if (errorCode !== undefined && EXPLICIT_REFUSAL_ERROR_CODES.has(errorCode)) {
    return refused();
  }
  return failed();
}

function mapEffect(effect: ActionEffect): EngineExecution["effect"] | undefined {
  switch (effect) {
    case ActionEffect.Confirmed:
      return "confirmed";
    case ActionEffect.Partial:
      return "partial";
    case ActionEffect.Unverifiable:
      return "unverifiable";
    case ActionEffect.SuspectedNoop:
      return "suspected_noop";
    case ActionEffect.Refused:
      return "refused";
    default:
      return undefined;
  }
}

function mapRoute(route: ActionRoute): EngineExecution["route"] | undefined {
  switch (route) {
    case ActionRoute.Accessibility:
      return "accessibility";
    case ActionRoute.SyntheticEvents:
      return "synthetic_events";
    case ActionRoute.GlobalInput:
      return "global_input";
    case ActionRoute.SystemApi:
      return "system_api";
    case ActionRoute.Dom:
      return "dom";
    case ActionRoute.TrustedInput:
      return "trusted_input";
    default:
      return undefined;
  }
}

function mapDelivery(
  mode: ActionDeliveryMode | undefined,
): EngineExecution["delivery"] | undefined {
  switch (mode) {
    case undefined:
    case ActionDeliveryMode.Unknown:
      return "unknown";
    case ActionDeliveryMode.Background:
      return "background";
    case ActionDeliveryMode.Foreground:
      return "foreground";
    case ActionDeliveryMode.NotApplicable:
      return "not_applicable";
    default:
      return undefined;
  }
}

export function mapCuaResult(result: ToolResult): EngineExecution {
  if (result.isError) return mapErrorCode(result.errorCode);
  if (result.action === undefined) return failed();

  const effect = mapEffect(result.action.effect);
  const route = mapRoute(result.action.route);
  const delivery = mapDelivery(result.action.delivery?.mode);
  if (effect === undefined || route === undefined || delivery === undefined) return failed();

  const permissionRequired =
    result.action.escalation?.reason === ActionEscalationReason.PermissionRequired;
  const status = effect === "refused" ? "refused" : "executed";

  return {
    status,
    effect,
    route,
    delivery,
    ...(permissionRequired
      ? { errorCode: "permission_required" }
      : effect === "refused"
        ? { errorCode: "action_refused" }
        : {}),
  };
}
