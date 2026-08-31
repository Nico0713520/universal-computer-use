import {
  ActionDeliveryMode,
  ActionEffect,
  ActionEvidenceKind,
  ActionEscalationReason,
  ActionEscalationTarget,
  ActionRoute,
  type ToolResult,
} from "@trycua/cua-driver";

import type { EngineExecution } from "./port.js";
import { classifyCuaErrorCode } from "./cua-error-code.js";

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
  const classification = classifyCuaErrorCode(errorCode);
  if (classification.kind === "permission") {
    return failed("permission_required");
  }
  if (classification.kind === "interactive_session") {
    return failed("interactive_session_required");
  }
  if (classification.kind === "explicit_refusal") {
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

function mapEvidence(action: NonNullable<ToolResult["action"]>): readonly string[] {
  return (action.evidence ?? []).flatMap((evidence) =>
    evidence.kind === ActionEvidenceKind.ValueReadback ? ["value_readback"] : []);
}

function mapEscalation(
  action: NonNullable<ToolResult["action"]>,
): EngineExecution["escalation"] | undefined {
  const escalation = action.escalation;
  if (escalation === undefined || escalation.reason === ActionEscalationReason.PermissionRequired) return undefined;
  const suggestedDelivery = escalation.target === ActionEscalationTarget.Foreground
    ? { suggestedDelivery: "foreground" as const }
    : {};
  if (escalation.reason === ActionEscalationReason.EffectUnconfirmed ||
      escalation.reason === ActionEscalationReason.SuspectedNoop) {
    return { reason: "effect_unconfirmed", ...suggestedDelivery };
  }
  if (escalation.target === ActionEscalationTarget.Foreground &&
      escalation.reason === ActionEscalationReason.RouteUnavailable) {
    return { reason: "background_unavailable", suggestedDelivery: "foreground" };
  }
  if (escalation.target === ActionEscalationTarget.Foreground &&
      escalation.reason === ActionEscalationReason.DeliveryFailed) {
    return { reason: "foreground_required", suggestedDelivery: "foreground" };
  }
  return { reason: "effect_unconfirmed", ...suggestedDelivery };
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
  const evidence = mapEvidence(result.action);
  const deliveredCount = result.action.delivery?.deliveredCount;
  const escalation = mapEscalation(result.action);

  return {
    status,
    effect,
    route,
    delivery,
    ...(evidence.length === 0 ? {} : { evidence }),
    ...(deliveredCount === undefined ? {} : { deliveredCount }),
    ...(escalation === undefined ? {} : { escalation }),
    ...(permissionRequired
      ? { errorCode: "permission_required" }
      : effect === "refused"
        ? { errorCode: "action_refused" }
        : {}),
  };
}
