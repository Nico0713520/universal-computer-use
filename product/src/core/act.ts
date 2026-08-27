import { ComputerUseError } from "../errors.js";
import type { EngineExecution, EngineObservation, EnginePort } from "../engine/port.js";
import type { ActEnvelope, ComputerAction } from "../protocol.js";
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
      : action.type === "click" ||
          action.type === "double_click" ||
          action.type === "right_click" ||
          action.type === "move" ||
          action.type === "scroll"
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

export function toActEnvelope(
  engine: EnginePort,
  consumedId: string,
  snapshot: SnapshotRecord,
  result: EngineExecution,
  value: EngineObservation,
): ActEnvelope {
  return {
    structured: {
      protocol_version: PROTOCOL_VERSION,
      session_id: engine.sessionId,
      consumed_snapshot_id: consumedId,
      snapshot_id: snapshot.id,
      action_result: {
        status: result.status,
        effect: result.effect,
        route: result.route,
        delivery: result.delivery,
        ...(result.errorCode === undefined ? {} : { error_code: result.errorCode }),
      },
      screenshot: {
        mime_type: "image/png",
        width: value.image.width,
        height: value.image.height,
      },
    },
    image: { mimeType: "image/png", dataBase64: value.image.dataBase64 },
  };
}
