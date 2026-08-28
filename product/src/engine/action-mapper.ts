import { ComputerUseError } from "../errors.js";
import type { ComputerAction } from "../protocol.js";

export type CuaCall = Readonly<{
  tool: string;
  args: Record<string, unknown>;
}>;

export type MappedAction = CuaCall | Readonly<{ waitMs: number }>;

const DESKTOP_TARGET = Object.freeze({
  kind: "desktop",
  display_id: "primary",
});

function desktopArgs(session: string): Record<string, unknown> {
  return { session, target: DESKTOP_TARGET };
}

function unsupported(type: string): never {
  throw new ComputerUseError(
    "unsupported_action",
    `${type} requires the v0.2 target-aware execution path`,
    "stop",
    false,
  );
}

export function mapAction(action: ComputerAction, session: string): MappedAction {
  switch (action.type) {
    case "click":
      if (!("x" in action)) return unsupported(action.type);
      return {
        tool: "click",
        args: {
          ...desktopArgs(session),
          x: action.x,
          y: action.y,
          button: "left",
          count: 1,
        },
      };
    case "double_click":
      if (!("x" in action)) return unsupported(action.type);
      return {
        tool: "click",
        args: {
          ...desktopArgs(session),
          x: action.x,
          y: action.y,
          button: "left",
          count: 2,
        },
      };
    case "right_click":
      if (!("x" in action)) return unsupported(action.type);
      return {
        tool: "click",
        args: {
          ...desktopArgs(session),
          x: action.x,
          y: action.y,
          button: "right",
          count: 1,
        },
      };
    case "move":
      return {
        tool: "move_cursor",
        args: { ...desktopArgs(session), x: action.x, y: action.y },
      };
    case "drag":
      return {
        tool: "drag",
        args: {
          ...desktopArgs(session),
          from_x: action.from_x,
          from_y: action.from_y,
          to_x: action.to_x,
          to_y: action.to_y,
          ...(action.duration_ms === undefined
            ? {}
            : { duration_ms: action.duration_ms }),
        },
      };
    case "scroll":
      if (!("x" in action)) return unsupported(action.type);
      return {
        tool: "scroll",
        args: {
          ...desktopArgs(session),
          x: action.x,
          y: action.y,
          direction: action.direction,
          amount: action.amount,
          by: action.by ?? "line",
        },
      };
    case "type":
      return {
        tool: "type_text",
        args: { ...desktopArgs(session), text: action.text },
      };
    case "type_text":
      if ("element_ref" in action || "x" in action) return unsupported(action.type);
      return {
        tool: "type_text",
        args: { ...desktopArgs(session), text: action.text },
      };
    case "keypress":
      if ("element_ref" in action || "x" in action) return unsupported(action.type);
      return action.keys.length === 1
        ? {
            tool: "press_key",
            args: { ...desktopArgs(session), key: action.keys[0] },
          }
        : {
            tool: "hotkey",
            args: { ...desktopArgs(session), keys: action.keys },
          };
    case "wait":
      return { waitMs: action.ms };
    case "set_value":
    case "invoke_menu":
    case "launch_app":
      return unsupported(action.type);
  }
}
