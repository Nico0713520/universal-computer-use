import { describe, expect, it } from "vitest";

import { desiredCursorVisibility } from "../../src/engine/cursor-policy.js";
import type { EngineAction } from "../../src/engine/port.js";

const desktopPointerActions: readonly EngineAction[] = [
  { target: { kind: "desktop" }, action: { type: "click", x: 10, y: 20 } },
  { target: { kind: "desktop" }, action: { type: "double_click", x: 10, y: 20 } },
  { target: { kind: "desktop" }, action: { type: "right_click", x: 10, y: 20 } },
  { target: { kind: "desktop" }, action: { type: "move", x: 10, y: 20 } },
  {
    target: { kind: "desktop" },
    action: { type: "drag", from_x: 1, from_y: 2, to_x: 10, to_y: 20 },
  },
  {
    target: { kind: "desktop" },
    action: { type: "scroll", x: 10, y: 20, direction: "down", amount: 2 },
  },
];

function windowClick(
  delivery?: "background" | "foreground",
): EngineAction {
  return {
    target: { kind: "window", pid: 10, windowId: 20 },
    action: {
      type: "click",
      address: { kind: "coordinate", x: 30, y: 40 },
    },
    ...(delivery === undefined ? {} : { delivery }),
  };
}

const nonPointerActions: readonly EngineAction[] = [
  { target: { kind: "desktop" }, action: { type: "type", text: "hello" } },
  { target: { kind: "desktop" }, action: { type: "keypress", keys: ["enter"] } },
  { target: { kind: "desktop" }, action: { type: "wait", ms: 10 } },
  {
    target: { kind: "window", pid: 10, windowId: 20 },
    action: {
      type: "set_value",
      address: { kind: "element", token: "field" },
      value: "hello",
    },
  },
  {
    target: { kind: "window", pid: 10, windowId: 20 },
    action: { type: "invoke_menu", path: ["File", "New"] },
  },
  {
    target: {
      kind: "app",
      app: {
        appRef: "app_fixture",
        nativeKey: "native-app",
        displayName: "Fixture",
        running: false,
        capabilities: [],
        native: { platform: "macos", name: "Fixture" },
      },
    },
    action: { type: "launch_app" },
  },
];

describe("Adaptive Cursor policy", () => {
  it("shows every desktop pointer action in auto mode", () => {
    expect(desktopPointerActions.map((action) =>
      desiredCursorVisibility("auto", action)))
      .toEqual(desktopPointerActions.map(() => "show"));
  });

  it("shows only explicit foreground window pointer actions in auto mode", () => {
    expect(desiredCursorVisibility("auto", windowClick())).toBe("hide");
    expect(desiredCursorVisibility("auto", windowClick("background"))).toBe("hide");
    expect(desiredCursorVisibility("auto", windowClick("foreground"))).toBe("show");
  });

  it("shows background pointer actions in visible mode", () => {
    expect(desiredCursorVisibility("visible", windowClick("background"))).toBe("show");
  });

  it("hides every pointer action in hidden mode", () => {
    expect(desiredCursorVisibility("hidden", desktopPointerActions[0]!)).toBe("hide");
    expect(desiredCursorVisibility("hidden", windowClick("foreground"))).toBe("hide");
  });

  it("never presents non-pointer actions as Cursor movement", () => {
    for (const mode of ["auto", "visible", "hidden"] as const) {
      expect(nonPointerActions.map((action) => desiredCursorVisibility(mode, action)))
        .toEqual(nonPointerActions.map(() => "hide"));
    }
  });
});
