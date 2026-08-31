import { describe, expect, it } from "vitest";

import {
  decideFinalObservation,
  decideInitialObservation,
} from "../../src/core/observation-policy.js";
import type { EngineExecution, EngineWindowAction } from "../../src/engine/port.js";

const OPTIONS = Object.freeze({
  includeScreenshot: true,
  query: "button",
  maxElements: 80,
  maxDepth: 8,
});
const ELEMENT_CLICK: EngineWindowAction = {
  type: "click",
  address: { kind: "element", token: "private-token" },
};
const CONFIRMED: EngineExecution = {
  status: "executed",
  effect: "confirmed",
  route: "accessibility",
  delivery: "background",
};

describe("post-action observation policy", () => {
  it("keeps a confirmed background element action semantic", () => {
    expect(decideInitialObservation({
      consumedOptions: OPTIONS,
      requestedMode: "semantic",
      action: ELEMENT_CLICK,
      execution: CONFIRMED,
      hasResolvedExpectation: false,
    })).toEqual({
      options: { ...OPTIONS, includeScreenshot: false },
      observationMode: "semantic",
      semanticCandidate: true,
      hasResolvedExpectation: false,
    });
  });

  it.each([
    [{ type: "click", address: { kind: "coordinate", x: 20, y: 30 } }, CONFIRMED],
    [ELEMENT_CLICK, { ...CONFIRMED, route: "synthetic_events" }],
    [ELEMENT_CLICK, { ...CONFIRMED, delivery: "foreground" }],
    [ELEMENT_CLICK, { ...CONFIRMED, delivery: "unknown" }],
    [ELEMENT_CLICK, { ...CONFIRMED, status: "failed", effect: "unverifiable" }],
    [ELEMENT_CLICK, { ...CONFIRMED, status: "refused", effect: "refused" }],
    [{ type: "wait", ms: 0 }, CONFIRMED],
  ] as const)("recovers visual for unsafe action/result %#", (action, execution) => {
    expect(decideInitialObservation({
      consumedOptions: { ...OPTIONS, includeScreenshot: false },
      action: action as EngineWindowAction,
      execution: execution as EngineExecution,
      hasResolvedExpectation: false,
    })).toMatchObject({
      options: { includeScreenshot: true },
      observationMode: "visual_recovery",
      semanticCandidate: false,
    });
  });

  it("allows a resolved expectation to prove an initially unverifiable effect", () => {
    const initial = decideInitialObservation({
      consumedOptions: OPTIONS,
      requestedMode: "semantic",
      action: ELEMENT_CLICK,
      execution: { ...CONFIRMED, effect: "unverifiable" },
      hasResolvedExpectation: true,
    });
    expect(initial.semanticCandidate).toBe(true);
    expect(decideFinalObservation({
      initial,
      verification: { status: "satisfied" },
      finalExecution: CONFIRMED,
    })).toMatchObject({ observationMode: "semantic", requiresVisualRecovery: false });
    expect(decideFinalObservation({
      initial,
      verification: { status: "unsatisfied", reason: "predicate_unsatisfied" },
      finalExecution: { ...CONFIRMED, effect: "unverifiable" },
    })).toMatchObject({
      options: { includeScreenshot: true },
      observationMode: "visual_recovery",
      requiresVisualRecovery: true,
    });
  });

  it("keeps visual when requested or inherited and preserves element limits", () => {
    for (const requestedMode of ["visual", undefined] as const) {
      expect(decideInitialObservation({
        consumedOptions: OPTIONS,
        ...(requestedMode === undefined ? {} : { requestedMode }),
        action: ELEMENT_CLICK,
        execution: CONFIRMED,
        hasResolvedExpectation: false,
      })).toEqual({
        options: OPTIONS,
        observationMode: "visual",
        semanticCandidate: false,
        hasResolvedExpectation: false,
      });
    }
  });

  it("inherits semantic only from an existing no-screenshot snapshot", () => {
    expect(decideInitialObservation({
      consumedOptions: { ...OPTIONS, includeScreenshot: false },
      action: ELEMENT_CLICK,
      execution: CONFIRMED,
      hasResolvedExpectation: false,
    })).toMatchObject({ observationMode: "semantic", semanticCandidate: true });
  });

  it("gives escalation priority over an otherwise confirmed semantic route", () => {
    expect(decideInitialObservation({
      consumedOptions: OPTIONS,
      requestedMode: "semantic",
      action: ELEMENT_CLICK,
      execution: {
        ...CONFIRMED,
        escalation: { reason: "foreground_required", suggestedDelivery: "foreground" },
      },
      hasResolvedExpectation: false,
    })).toMatchObject({ observationMode: "visual_recovery", semanticCandidate: false });
  });

  it.each<EngineExecution["route"]>([
    "global_input",
    "trusted_input",
    "dom",
    "unknown",
  ])("recovers visual for the unsafe %s route", (route) => {
    expect(decideInitialObservation({
      consumedOptions: { ...OPTIONS, includeScreenshot: false },
      action: ELEMENT_CLICK,
      execution: { ...CONFIRMED, route },
      hasResolvedExpectation: false,
    })).toMatchObject({ observationMode: "visual_recovery", semanticCandidate: false });
  });

  it.each<EngineExecution["effect"]>([
    "partial",
    "unverifiable",
    "suspected_noop",
  ])("recovers visual for an executed but %s effect", (effect) => {
    expect(decideInitialObservation({
      consumedOptions: { ...OPTIONS, includeScreenshot: false },
      action: ELEMENT_CLICK,
      execution: { ...CONFIRMED, effect },
      hasResolvedExpectation: false,
    })).toMatchObject({ observationMode: "visual_recovery", semanticCandidate: false });
  });

  it("allows a confirmed system API action with not-applicable delivery", () => {
    expect(decideInitialObservation({
      consumedOptions: OPTIONS,
      requestedMode: "semantic",
      action: { type: "invoke_menu", path: ["File", "New"] },
      execution: { ...CONFIRMED, route: "system_api", delivery: "not_applicable" },
      hasResolvedExpectation: false,
    })).toMatchObject({ observationMode: "semantic", semanticCandidate: true });
  });

  it.each([
    [
      { status: "unknown", reason: "observation_unavailable" },
      CONFIRMED,
    ],
    [
      { status: "satisfied" },
      { ...CONFIRMED, effect: "unverifiable" },
    ],
  ] as const)("recovers visual when final expectation proof is insufficient %#", (verification, finalExecution) => {
    const initial = decideInitialObservation({
      consumedOptions: OPTIONS,
      requestedMode: "semantic",
      action: ELEMENT_CLICK,
      execution: { ...CONFIRMED, effect: "unverifiable" },
      hasResolvedExpectation: true,
    });
    expect(decideFinalObservation({
      initial,
      verification,
      finalExecution,
    })).toMatchObject({
      options: { includeScreenshot: true },
      observationMode: "visual_recovery",
      requiresVisualRecovery: true,
    });
  });
});
