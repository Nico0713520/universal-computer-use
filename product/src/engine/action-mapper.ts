import { ComputerUseError } from "../errors.js";
import type { EngineAction, EngineWindowAction, EngineWindowAddress } from "./port.js";
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

function windowAddressArgs(
  address: EngineWindowAddress | undefined,
  target: Readonly<{ pid: number; windowId: number }>,
  delivery: "background" | "foreground",
): Record<string, unknown> {
  if (address?.kind === "element") {
    return {
      ...(delivery === "foreground" ? { pid: target.pid, window_id: target.windowId } : {}),
      element_token: address.token,
      delivery_mode: delivery,
    };
  }
  return {
    pid: target.pid,
    window_id: target.windowId,
    ...(address === undefined ? {} : { x: address.x, y: address.y }),
    delivery_mode: delivery,
  };
}

function mapWindowAction(
  action: EngineWindowAction,
  target: Readonly<{ pid: number; windowId: number }>,
  delivery: "background" | "foreground",
  session: string,
): MappedAction {
  switch (action.type) {
    case "click":
    case "double_click":
    case "right_click": {
      const elementAddressed = action.address.kind === "element";
      const tool = elementAddressed
        ? action.type === "click" ? "click" : action.type
        : "click";
      const button = action.type === "right_click" ? "right" : "left";
      const count = action.type === "double_click" ? 2 : 1;
      return {
        tool,
        args: {
          session,
          ...windowAddressArgs(action.address, target, delivery),
          ...(elementAddressed ? {} : { button, count }),
        },
      };
    }
    case "drag":
      return {
        tool: "drag",
        args: {
          session,
          pid: target.pid,
          window_id: target.windowId,
          from_x: action.fromX,
          from_y: action.fromY,
          to_x: action.toX,
          to_y: action.toY,
          ...(action.durationMs === undefined ? {} : { duration_ms: action.durationMs }),
          delivery_mode: delivery,
        },
      };
    case "scroll":
      return {
        tool: "scroll",
        args: {
          session,
          ...windowAddressArgs(action.address, target, delivery),
          direction: action.direction,
          amount: action.amount,
          by: action.by ?? "line",
        },
      };
    case "set_value":
      return {
        tool: "set_value",
        args: { session, element_token: action.address.token, value: action.value },
      };
    case "type_text":
      return {
        tool: "type_text",
        args: { session, ...windowAddressArgs(action.address, target, delivery), text: action.text },
      };
    case "keypress": {
      const addressing = windowAddressArgs(action.address, target, delivery);
      return action.keys.length === 1
        ? { tool: "press_key", args: { session, ...addressing, key: action.keys[0] } }
        : { tool: "hotkey", args: { session, ...addressing, keys: action.keys } };
    }
    case "invoke_menu":
      return {
        tool: "invoke_menu",
        args: { session, pid: target.pid, window_id: target.windowId, path: action.path },
      };
    case "wait":
      return { waitMs: action.ms };
  }
}

function mapDesktopAction(action: ComputerAction, session: string): MappedAction {
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

export function mapAction(action: ComputerAction | EngineAction, session: string): MappedAction {
  if (!("target" in action)) return mapDesktopAction(action, session);
  const engineAction = action as EngineAction;
  if (engineAction.target.kind === "desktop") {
    return mapDesktopAction((engineAction as Extract<EngineAction, { target: { kind: "desktop" } }>).action, session);
  }
  if (engineAction.target.kind === "app") {
    const launch = engineAction as Extract<EngineAction, { target: { kind: "app" } }>;
    const native = launch.target.app.native;
    const bundleId = native.bundle_id;
    const name = native.name;
    if (typeof bundleId !== "string" && typeof name !== "string") return unsupported(launch.action.type);
    return {
      tool: "launch_app",
      args: {
        session,
        ...(typeof bundleId === "string" ? { bundle_id: bundleId } : { name }),
      },
    };
  }
  const windowAction = engineAction as Extract<EngineAction, { target: { kind: "window" } }>;
  return mapWindowAction(windowAction.action, windowAction.target, windowAction.delivery ?? "background", session);
}
