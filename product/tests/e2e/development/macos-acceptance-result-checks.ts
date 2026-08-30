import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { hasPng, structured } from "./macos-acceptance-support.js";

const FIXTURE_LABELS = [
  "Semantic Alpha",
  "Unique text value",
  "Toggle pixel overlay",
] as const;

function freshSnapshot(result: CallToolResult, groundingSnapshot: string): boolean {
  const state = structured(result);
  return typeof state.snapshot_id === "string" &&
    state.snapshot_id !== groundingSnapshot &&
    state.consumed_snapshot_id === groundingSnapshot;
}

export function buildSemanticSetValueRequest(
  snapshotId: string,
  elementRef: string,
  value: string,
): Readonly<{
  snapshot_id: string;
  action: Readonly<{ type: "set_value"; element_ref: string; value: string }>;
  next_observation: Readonly<{ mode: "semantic" }>;
}> {
  return {
    snapshot_id: snapshotId,
    action: { type: "set_value", element_ref: elementRef, value },
    next_observation: { mode: "semantic" },
  };
}

export function validEmptyTextGrounding(
  oracle: Readonly<{ text: string; text_write_count: number }>,
  element: Readonly<{ elementRef: string; value?: string | number | boolean }>,
): boolean {
  // Cua 0.22.2 intentionally omits an empty AXValue. The independent fixture
  // oracle proves emptiness; a conflicting published value is still rejected.
  return oracle.text === "" && oracle.text_write_count === 0 &&
    (element.value === undefined || element.value === "");
}

export function buildForegroundPositiveControlRequest(
  snapshotId: string,
): Readonly<{
  snapshot_id: string;
  action: Readonly<{ type: "keypress"; keys: readonly ["cmd", "tab"] }>;
}> {
  return {
    snapshot_id: snapshotId,
    action: { type: "keypress", keys: ["cmd", "tab"] },
  };
}

export function buildBackgroundSemanticClickRequest(
  snapshotId: string,
  elementRef: string,
  delivery: "background" | "foreground",
): Readonly<{
  snapshot_id: string;
  action: Readonly<{ type: "click"; element_ref: string }>;
  delivery: "background" | "foreground";
  next_observation: Readonly<{ mode: "semantic" }>;
}> {
  return {
    snapshot_id: snapshotId,
    action: { type: "click", element_ref: elementRef },
    delivery,
    next_observation: { mode: "semantic" },
  };
}

export function validBackgroundSemanticExecution(
  result: CallToolResult,
  groundingSnapshot: string,
): boolean {
  const state = structured(result);
  const honestNextState = (
    state.observation_mode === "semantic" &&
    state.visual_status === "not_requested" &&
    !hasPng(result)
  ) || (
    state.observation_mode === "visual_recovery" &&
    state.visual_status === "available" &&
    hasPng(result)
  );
  return result.isError !== true &&
    freshSnapshot(result, groundingSnapshot) &&
    state.action_result?.status === "executed" &&
    (state.action_result.effect === "confirmed" || state.action_result.effect === "unverifiable") &&
    state.action_result.delivery === "background" &&
    (state.verification?.status === "satisfied" || state.verification?.status === "not_requested") &&
    state.action_result.error_code === undefined &&
    honestNextState;
}

function containsFixtureControls(result: CallToolResult): boolean {
  const elements = structured(result).elements;
  return Array.isArray(elements) && elements.length > 0 && elements.length <= 150 &&
    FIXTURE_LABELS.every((label) =>
      elements.filter((element) => element.label === label && typeof element.element_ref === "string").length === 1);
}

export function validFixtureObserve(result: CallToolResult, visual: boolean): boolean {
  const state = structured(result);
  return result.isError !== true &&
    typeof state.snapshot_id === "string" &&
    state.observation_mode === (visual ? "visual" : "semantic") &&
    state.visual_status === (visual ? "available" : "not_requested") &&
    (visual ? hasPng(result) : !hasPng(result)) &&
    containsFixtureControls(result);
}

export function validSemanticSetValueResult(
  result: CallToolResult,
  expected: Readonly<{
    groundingSnapshot: string;
    nonce: string;
    oracleText: string;
    oracleWriteCount: number;
  }>,
): boolean {
  const state = structured(result);
  const matchingValues = (state.elements ?? []).filter((element) => element.value === expected.nonce);
  return result.isError !== true &&
    freshSnapshot(result, expected.groundingSnapshot) &&
    state.action_result?.status === "executed" &&
    state.action_result.effect === "confirmed" &&
    state.action_result.delivery === "background" &&
    state.verification?.status === "satisfied" &&
    state.observation_mode === "semantic" &&
    state.visual_status === "not_requested" &&
    !hasPng(result) &&
    matchingValues.length === 1 &&
    expected.oracleText === expected.nonce &&
    expected.oracleWriteCount === 1;
}

export function validPixelActionResult(
  result: CallToolResult,
  expected: Readonly<{
    groundingSnapshot: string;
    beforeClicks: number;
    afterClicks: number;
  }>,
): boolean {
  const state = structured(result);
  return result.isError !== true &&
    freshSnapshot(result, expected.groundingSnapshot) &&
    state.action_result?.status === "executed" &&
    state.action_result.delivery === "foreground" &&
    state.observation_mode === "visual" &&
    state.visual_status === "available" &&
    hasPng(result) &&
    expected.afterClicks === expected.beforeClicks + 1;
}
