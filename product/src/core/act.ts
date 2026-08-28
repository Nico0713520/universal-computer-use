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

  if (points.length > 0 &&
      (snapshot.visualStatus !== "available" || snapshot.width === undefined || snapshot.height === undefined)) {
    throw new ComputerUseError(
      "pixel_frame_unproven",
      "The current snapshot has no proven pixel frame",
      "use_element",
      false,
    );
  }

  for (const [x, y] of points) {
    if (x < 0 || y < 0 || x >= snapshot.width! || y >= snapshot.height!) {
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

function toActionResult(result: EngineExecution): ActionResult {
  const common = {
    route: result.route,
    delivery: result.delivery,
    evidence: [],
  };
  return result.status === "executed"
    ? {
        ...common,
        status: "executed",
        effect: result.effect === "refused" ? "unverifiable" : result.effect,
        ...(result.errorCode === undefined ? {} : { error_code: publicActionErrorCode(result.errorCode, "action_failed") }),
      }
    : result.status === "refused"
      ? {
          ...common,
          status: "refused",
          effect: "refused",
          error_code: publicActionErrorCode(result.errorCode, "action_refused"),
        }
      : {
          ...common,
          status: "failed",
          effect: "unverifiable",
          error_code: publicActionErrorCode(result.errorCode, "action_failed"),
        };
}

export function toActEnvelope(
  engine: EnginePort,
  consumedId: string,
  snapshot: SnapshotRecord,
  result: EngineExecution,
  value: EngineObservation,
): ActEnvelope {
  return {
    structured: {
      next_state: "available",
      protocol_version: PROTOCOL_VERSION,
      session_id: engine.sessionId,
      consumed_snapshot_id: consumedId,
      snapshot_id: snapshot.id,
      target: { kind: "desktop", display_id: "primary" },
      coordinate_space: "desktop_screenshot_pixels",
      action_result: toActionResult(result),
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

export function toUnavailableActEnvelope(
  engine: EnginePort,
  consumedId: string,
  result: EngineExecution,
  code: "target_lost" | "capture_failed" | "window_owner_changed",
): ActEnvelope {
  return {
    structured: {
      next_state: "unavailable",
      protocol_version: PROTOCOL_VERSION,
      session_id: engine.sessionId,
      consumed_snapshot_id: consumedId,
      action_result: toActionResult(result),
      verification: { status: "not_requested" },
      next_observation_error: { code, recovery: "observe_desktop" },
    },
  };
}
