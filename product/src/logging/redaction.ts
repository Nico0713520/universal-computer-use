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
  "type",
  "keypress",
  "wait",
] as const satisfies readonly ComputerAction["type"][];
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

export type MetadataLogEvent = Readonly<{
  sessionId?: string;
  snapshotId?: string;
  toolName?: ToolName;
  actionType?: ActionType;
  durationMs?: number;
  effect?: Effect;
  route?: Route;
  delivery?: Delivery;
  errorCode?: ComputerUseErrorCode;
}>;

export type MetadataLogRecord = Readonly<{
  timestamp: string;
  session_id_hash?: string;
  snapshot_id_hash?: string;
  tool_name?: ToolName;
  action_type?: ActionType;
  duration_ms?: number;
  effect?: Effect;
  route?: Route;
  delivery?: Delivery;
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
    duration_ms?: number;
    effect?: Effect;
    route?: Route;
    delivery?: Delivery;
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
  if (
    typeof input.durationMs === "number"
    && Number.isFinite(input.durationMs)
    && input.durationMs >= 0
  ) {
    output.duration_ms = input.durationMs;
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
  if (isMember(ERROR_CODES, input.errorCode)) {
    output.error_code = input.errorCode;
  }

  return output;
}
