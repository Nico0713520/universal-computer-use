import { ComputerUseError } from "../errors.js";
import type { EngineExecution, EngineObservation, EnginePort } from "../engine/port.js";
import type { ActionResult, ActEnvelope, ComputerAction } from "../protocol.js";
import type { SnapshotRecord } from "../snapshot-store.js";
import { PROTOCOL_VERSION } from "../version.js";

export function assertCoordinates(
  action: ComputerAction,
  snapshot: SnapshotRecord,
): void {
  const points: readonly (readonly [number, number])[] =
    action.type === "drag"
      ? [
          [action.from_x, action.from_y],
          [action.to_x, action.to_y],
        ]
      : (action.type === "click" ||
          action.type === "double_click" ||
          action.type === "right_click" ||
          action.type === "move" ||
          action.type === "scroll") && "x" in action
        ? [[action.x, action.y]]
        : [];

  for (const [x, y] of points) {
    if (x < 0 || y < 0 || x >= snapshot.width || y >= snapshot.height) {
      throw new ComputerUseError(
        "coordinate_out_of_bounds",
        "Coordinate is outside the current screenshot",
        "observe_again",
        true,
      );
    }
  }
}

export function failedExecution(error: unknown): EngineExecution {
  return {
    status: "failed",
    effect: "unverifiable",
    route: "unknown",
    delivery: "unknown",
    errorCode: error instanceof ComputerUseError ? error.code : "action_failed",
  };
}

function publicActionErrorCode(
  code: string | undefined,
  fallback: "action_refused" | "action_failed",
): NonNullable<ActionResult["error_code"]> {
  switch (code) {
    case "action_refused":
    case "action_failed":
    case "action_timeout":
    case "unsupported_action":
    case "element_unavailable":
    case "background_unavailable":
    case "foreground_required":
    case "window_owner_changed":
    case "target_lost":
      return code;
    default:
      return fallback;
  }
}

export function toActEnvelope(
  engine: EnginePort,
  consumedId: string,
  snapshot: SnapshotRecord,
  result: EngineExecution,
  value: EngineObservation,
): ActEnvelope {
  const common = {
    route: result.route,
    delivery: result.delivery,
    evidence: [],
  };
  const actionResult: ActionResult = result.status === "executed"
    ? {
        ...common,
        status: "executed" as const,
        effect: result.effect === "refused" ? "unverifiable" as const : result.effect,
        ...(result.errorCode === undefined ? {} : { error_code: publicActionErrorCode(result.errorCode, "action_failed") }),
      }
    : result.status === "refused"
      ? {
          ...common,
          status: "refused" as const,
          effect: "refused" as const,
          error_code: publicActionErrorCode(result.errorCode, "action_refused"),
        }
      : {
          ...common,
          status: "failed" as const,
          effect: "unverifiable" as const,
          error_code: publicActionErrorCode(result.errorCode, "action_failed"),
        };

  return {
    structured: {
      next_state: "available",
      protocol_version: PROTOCOL_VERSION,
      session_id: engine.sessionId,
      consumed_snapshot_id: consumedId,
      snapshot_id: snapshot.id,
      target: { kind: "desktop", display_id: "primary" },
      coordinate_space: "desktop_screenshot_pixels",
      action_result: actionResult,
      verification: { status: "not_requested" },
      screenshot: {
        mime_type: "image/png",
        width: value.image.width,
        height: value.image.height,
      },
    },
    image: { mimeType: "image/png", dataBase64: value.image.dataBase64 },
  };
}
