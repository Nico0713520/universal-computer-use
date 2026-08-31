import { createHmac, randomBytes } from "node:crypto";

import { ERROR_CODES, type ComputerUseErrorCode } from "../errors.js";
import type { ActOutput, ComputerAction } from "../protocol.js";

const TOOL_NAMES = ["computer_observe", "computer_act"] as const;
const ACTION_TYPES = [
  "click",
  "double_click",
  "right_click",
  "move",
  "drag",
  "scroll",
  "set_value",
  "type",
  "type_text",
  "keypress",
  "invoke_menu",
  "launch_app",
  "wait",
] as const satisfies readonly ComputerAction["type"][];
const OBSERVATION_MODES = ["visual", "semantic", "visual_recovery"] as const;
const EFFECTS = [
  "confirmed",
  "partial",
  "unverifiable",
  "suspected_noop",
  "refused",
] as const satisfies readonly ActOutput["action_result"]["effect"][];
const ROUTES = [
  "accessibility",
  "synthetic_events",
  "global_input",
  "system_api",
  "dom",
  "trusted_input",
  "unknown",
] as const satisfies readonly ActOutput["action_result"]["route"][];
const DELIVERIES = [
  "background",
  "foreground",
  "not_applicable",
  "unknown",
] as const satisfies readonly ActOutput["action_result"]["delivery"][];

const PROCESS_SALT = randomBytes(32);

type ToolName = typeof TOOL_NAMES[number];
type ActionType = ComputerAction["type"];
type Effect = ActOutput["action_result"]["effect"];
type Route = ActOutput["action_result"]["route"];
type Delivery = ActOutput["action_result"]["delivery"];
type ObservationMode = typeof OBSERVATION_MODES[number];

export type MetadataTimings = Readonly<{
  queueWaitMs?: number;
  engineExecuteMs?: number;
  postActionObserveMs?: number;
  projectionMs?: number;
  toolTotalMs?: number;
}>;

export type MetadataTimingRecord = Readonly<{
  queue_wait_ms?: number;
  engine_execute_ms?: number;
  post_action_observe_ms?: number;
  projection_ms?: number;
  tool_total_ms?: number;
}>;

export type MetadataLogEvent = Readonly<{
  sessionId?: string;
  snapshotId?: string;
  toolName?: ToolName;
  actionType?: ActionType;
  timings?: MetadataTimings;
  observationMode?: ObservationMode;
  effect?: Effect;
  route?: Route;
  delivery?: Delivery;
  cursorVisual?: "degraded";
  errorCode?: ComputerUseErrorCode;
}>;

export type MetadataLogRecord = Readonly<{
  timestamp: string;
  session_id_hash?: string;
  snapshot_id_hash?: string;
  tool_name?: ToolName;
  action_type?: ActionType;
  timings?: MetadataTimingRecord;
  observation_mode?: ObservationMode;
  effect?: Effect;
  route?: Route;
  delivery?: Delivery;
  cursor_visual?: "degraded";
  error_code?: ComputerUseErrorCode;
}>;

function isMember<const T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

function pseudonym(kind: "session" | "snapshot", value: string): string {
  return createHmac("sha256", PROCESS_SALT)
    .update(kind)
    .update("\0")
    .update(value)
    .digest("hex");
}

/**
 * Projects an event onto the frozen metadata allowlist. Unknown objects are
 * never serialized, so sensitive values are dropped at every nesting depth.
 */
export function redactMetadataEvent(
  event: MetadataLogEvent,
  timestamp = new Date(),
): MetadataLogRecord {
  const input: Record<string, unknown> =
    typeof event === "object" && event !== null
      ? event as Record<string, unknown>
      : {};
  const output: {
    timestamp: string;
    session_id_hash?: string;
    snapshot_id_hash?: string;
    tool_name?: ToolName;
    action_type?: ActionType;
    timings?: MetadataTimingRecord;
    observation_mode?: ObservationMode;
    effect?: Effect;
    route?: Route;
    delivery?: Delivery;
    cursor_visual?: "degraded";
    error_code?: ComputerUseErrorCode;
  } = { timestamp: timestamp.toISOString() };

  if (typeof input.sessionId === "string" && input.sessionId.length > 0) {
    output.session_id_hash = pseudonym("session", input.sessionId);
  }
  if (typeof input.snapshotId === "string" && input.snapshotId.length > 0) {
    output.snapshot_id_hash = pseudonym("snapshot", input.snapshotId);
  }
  if (isMember(TOOL_NAMES, input.toolName)) {
    output.tool_name = input.toolName;
  }
  if (isMember(ACTION_TYPES, input.actionType)) {
    output.action_type = input.actionType;
  }
  const timingFields = [
    ["queueWaitMs", "queue_wait_ms"],
    ["engineExecuteMs", "engine_execute_ms"],
    ["postActionObserveMs", "post_action_observe_ms"],
    ["projectionMs", "projection_ms"],
    ["toolTotalMs", "tool_total_ms"],
  ] as const;
  const timingInput: Record<string, unknown> =
    typeof input.timings === "object" && input.timings !== null
      ? input.timings as Record<string, unknown>
      : {};
  const timings: Record<string, number> = {};
  for (const [inputName, outputName] of timingFields) {
    const value = timingInput[inputName];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      timings[outputName] = Math.ceil(value);
    }
  }
  if (Object.keys(timings).length > 0) {
    output.timings = timings;
  }
  if (isMember(OBSERVATION_MODES, input.observationMode)) {
    output.observation_mode = input.observationMode;
  }
  if (isMember(EFFECTS, input.effect)) {
    output.effect = input.effect;
  }
  if (isMember(ROUTES, input.route)) {
    output.route = input.route;
  }
  if (isMember(DELIVERIES, input.delivery)) {
    output.delivery = input.delivery;
  }
  if (input.cursorVisual === "degraded") {
    output.cursor_visual = "degraded";
  }
  if (isMember(ERROR_CODES, input.errorCode)) {
    output.error_code = input.errorCode;
  }

  return output;
}
