import type { CursorMode } from "./cursor-mode.js";
import type { EngineAction } from "./port.js";

export type CursorVisibility = "show" | "hide";

const POINTER_ACTIONS = new Set([
  "click",
  "double_click",
  "right_click",
  "move",
  "drag",
  "scroll",
]);

function isPointerAction(action: EngineAction): boolean {
  return action.target.kind !== "app" && POINTER_ACTIONS.has(action.action.type);
}

export function desiredCursorVisibility(
  mode: CursorMode,
  action: EngineAction,
): CursorVisibility {
  if (mode === "hidden" || !isPointerAction(action)) return "hide";
  if (mode === "visible") return "show";
  if (action.target.kind === "desktop") return "show";
  return "delivery" in action && action.delivery === "foreground"
    ? "show"
    : "hide";
}
