import type { EngineExecution, EngineWindowAction } from "../engine/port.js";
import type { SnapshotObserveOptions } from "../snapshot-store.js";
import type { VerificationResult } from "./verifier.js";

export type ObservationMode = "visual" | "semantic" | "visual_recovery";

export type InitialObservationDecision = Readonly<{
  options: SnapshotObserveOptions;
  observationMode: ObservationMode;
  semanticCandidate: boolean;
  hasResolvedExpectation: boolean;
}>;

export type FinalObservationDecision = Readonly<{
  options: SnapshotObserveOptions;
  observationMode: ObservationMode;
  requiresVisualRecovery: boolean;
}>;

function semanticAddress(action: EngineWindowAction): boolean {
  switch (action.type) {
    case "click":
    case "double_click":
    case "right_click":
    case "scroll":
      return action.address.kind === "element";
    case "set_value":
    case "invoke_menu":
      return true;
    case "type_text":
    case "keypress":
      return action.address?.kind !== "coordinate";
    case "drag":
    case "wait":
      return false;
  }
}

export function decideInitialObservation(input: Readonly<{
  consumedOptions: SnapshotObserveOptions;
  requestedMode?: "visual" | "semantic";
  action: EngineWindowAction;
  execution: EngineExecution;
  hasResolvedExpectation: boolean;
}>): InitialObservationDecision {
  const wantsSemantic = input.requestedMode === "semantic" ||
    (input.requestedMode === undefined && !input.consumedOptions.includeScreenshot);
  const safe = wantsSemantic &&
    semanticAddress(input.action) &&
    input.execution.status === "executed" &&
    (input.execution.effect === "confirmed" || input.hasResolvedExpectation) &&
    (input.execution.route === "accessibility" || input.execution.route === "system_api") &&
    (input.execution.delivery === "background" || input.execution.delivery === "not_applicable") &&
    input.execution.escalation === undefined;
  return {
    options: { ...input.consumedOptions, includeScreenshot: !safe },
    observationMode: safe ? "semantic" : wantsSemantic ? "visual_recovery" : "visual",
    semanticCandidate: safe,
    hasResolvedExpectation: input.hasResolvedExpectation,
  };
}

export function decideFinalObservation(input: Readonly<{
  initial: InitialObservationDecision;
  verification: VerificationResult;
  finalExecution: EngineExecution;
}>): FinalObservationDecision {
  const verified = !input.initial.hasResolvedExpectation ||
    (input.verification.status === "satisfied" &&
      input.finalExecution.status === "executed" &&
      input.finalExecution.effect === "confirmed");
  const recover = input.initial.semanticCandidate && !verified;
  return {
    options: recover
      ? { ...input.initial.options, includeScreenshot: true }
      : input.initial.options,
    observationMode: recover ? "visual_recovery" : input.initial.observationMode,
    requiresVisualRecovery: recover,
  };
}
