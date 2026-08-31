import {
  ActionDeliveryMode,
  ActionEffect,
  ActionRoute,
  type ToolResult,
} from "@trycua/cua-driver";
import { describe, expect, it } from "vitest";

import { mapAction } from "../../src/engine/action-mapper.js";
import { CuaEngine } from "../../src/engine/cua.js";
import { loadEngineLock } from "../../src/engine/lock.js";
import type { EngineAction } from "../../src/engine/port.js";
import type { ComputerAction } from "../../src/protocol.js";
import { fakeSdk } from "../helpers/fake-cua-sdk.js";

describe("Cua action mapping", () => {
  const session = "ucu_session";

  it.each([
    {
      action: { type: "click", x: 10, y: 20 },
      tool: "click",
      argumentsJson:
        '{"session":"ucu_session","target":{"kind":"desktop","display_id":"primary"},"x":10,"y":20,"button":"left","count":1}',
    },
    {
      action: { type: "double_click", x: 10, y: 20 },
      tool: "click",
      argumentsJson:
        '{"session":"ucu_session","target":{"kind":"desktop","display_id":"primary"},"x":10,"y":20,"button":"left","count":2}',
    },
    {
      action: { type: "right_click", x: 10, y: 20 },
      tool: "click",
      argumentsJson:
        '{"session":"ucu_session","target":{"kind":"desktop","display_id":"primary"},"x":10,"y":20,"button":"right","count":1}',
    },
    {
      action: { type: "move", x: 10, y: 20 },
      tool: "move_cursor",
      argumentsJson:
        '{"session":"ucu_session","target":{"kind":"desktop","display_id":"primary"},"x":10,"y":20}',
    },
    {
      action: {
        type: "drag",
        from_x: 1,
        from_y: 2,
        to_x: 3,
        to_y: 4,
        duration_ms: 200,
      },
      tool: "drag",
      argumentsJson:
        '{"session":"ucu_session","target":{"kind":"desktop","display_id":"primary"},"from_x":1,"from_y":2,"to_x":3,"to_y":4,"duration_ms":200}',
    },
    {
      action: {
        type: "scroll",
        x: 10,
        y: 20,
        direction: "down",
        amount: 5,
        by: "line",
      },
      tool: "scroll",
      argumentsJson:
        '{"session":"ucu_session","target":{"kind":"desktop","display_id":"primary"},"x":10,"y":20,"direction":"down","amount":5,"by":"line"}',
    },
    {
      action: { type: "type", text: "hello" },
      tool: "type_text",
      argumentsJson:
        '{"session":"ucu_session","target":{"kind":"desktop","display_id":"primary"},"text":"hello"}',
    },
    {
      action: { type: "keypress", keys: ["enter"] },
      tool: "press_key",
      argumentsJson:
        '{"session":"ucu_session","target":{"kind":"desktop","display_id":"primary"},"key":"enter"}',
    },
    {
      action: { type: "keypress", keys: ["cmd", "s"] },
      tool: "hotkey",
      argumentsJson:
        '{"session":"ucu_session","target":{"kind":"desktop","display_id":"primary"},"keys":["cmd","s"]}',
    },
  ] satisfies Array<{
    action: ComputerAction;
    tool: string;
    argumentsJson: string;
  }>)("maps $action.type to exact $tool wire JSON", ({ action, tool, argumentsJson }) => {
    const mapped = mapAction(action, session);

    expect("waitMs" in mapped).toBe(false);
    if ("waitMs" in mapped) throw new Error("expected a Cua call");
    expect(mapped.tool).toBe(tool);
    expect(JSON.stringify(mapped.args)).toBe(argumentsJson);
  });

  it("keeps wait local instead of creating a Cua call", () => {
    expect(mapAction({ type: "wait", ms: 250 }, session)).toEqual({ waitMs: 250 });
  });

  it("omits an optional drag duration and defaults scroll units to lines", () => {
    expect(mapAction({
      type: "drag",
      from_x: 1,
      from_y: 2,
      to_x: 3,
      to_y: 4,
    }, session)).toEqual({
      tool: "drag",
      args: {
        session,
        target: { kind: "desktop", display_id: "primary" },
        from_x: 1,
        from_y: 2,
        to_x: 3,
        to_y: 4,
      },
    });
    expect(mapAction({
      type: "scroll",
      x: 10,
      y: 20,
      direction: "up",
      amount: 2,
    }, session)).toMatchObject({
      args: { by: "line" },
    });
  });

  it("executes the mapped wire call and normalizes its ToolResult", async () => {
    const lock = await loadEngineLock();
    const toolResult: ToolResult = {
      text: "clicked",
      images: [],
      isError: false,
      action: {
        effect: ActionEffect.Unverifiable,
        route: ActionRoute.GlobalInput,
        delivery: { mode: ActionDeliveryMode.Foreground },
      },
      degraded: false,
      rawJson: "{}",
    };
    const sdk = fakeSdk({
      driverVersion: lock.version,
      tools: [...lock.required_tools],
      toolResult,
    });
    const engine = await CuaEngine.fromSdk(sdk, lock);
    sdk.callToolCalls.length = 0;

    await expect(engine.execute(
      { target: { kind: "desktop" }, action: { type: "click", x: 10, y: 20 } },
      new AbortController().signal,
    )).resolves.toEqual({
      status: "executed",
      effect: "unverifiable",
      route: "global_input",
      delivery: "foreground",
    });
    expect(sdk.callToolCalls).toEqual([{
      name: "click",
      argumentsJson:
        `{"session":"${engine.sessionId}","target":{"kind":"desktop","display_id":"primary"},"x":10,"y":20,"button":"left","count":1}`,
    }]);
  });

  it("executes wait locally and rejects cancellation with AbortError", async () => {
    const lock = await loadEngineLock();
    const sdk = fakeSdk({
      driverVersion: lock.version,
      tools: [...lock.required_tools],
    });
    const engine = await CuaEngine.fromSdk(sdk, lock);
    sdk.callToolCalls.length = 0;

    await expect(engine.execute(
      { target: { kind: "desktop" }, action: { type: "wait", ms: 0 } },
      new AbortController().signal,
    )).resolves.toEqual({
      status: "executed",
      effect: "confirmed",
      route: "system_api",
      delivery: "not_applicable",
    });
    expect(sdk.callToolCalls).toHaveLength(0);

    const controller = new AbortController();
    const pending = engine.execute({ target: { kind: "desktop" }, action: { type: "wait", ms: 1_000 } }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(sdk.callToolCalls).toHaveLength(0);
  });

  it.each([
    {
      input: {
        target: { kind: "window", pid: 42, windowId: 7 },
        action: { type: "click", address: { kind: "element", token: "private-token" } },
        delivery: "background",
      },
      tool: "click",
      args: {
        session,
        pid: 42,
        window_id: 7,
        element_token: "private-token",
        delivery_mode: "background",
      },
    },
    {
      input: {
        target: { kind: "window", pid: 42, windowId: 7 },
        action: { type: "click", address: { kind: "coordinate", x: 20, y: 30 } },
        delivery: "foreground",
      },
      tool: "click",
      args: { session, pid: 42, window_id: 7, x: 20, y: 30, button: "left", count: 1, delivery_mode: "foreground" },
    },
    {
      input: {
        target: { kind: "window", pid: 42, windowId: 7 },
        action: { type: "set_value", address: { kind: "element", token: "private-token" }, value: "hello" },
      },
      tool: "set_value",
      args: { session, pid: 42, window_id: 7, element_token: "private-token", value: "hello" },
    },
    {
      input: {
        target: { kind: "window", pid: 42, windowId: 7 },
        action: { type: "type_text", address: { kind: "element", token: "private-token" }, text: "hello" },
        delivery: "background",
      },
      tool: "type_text",
      args: {
        session,
        pid: 42,
        window_id: 7,
        element_token: "private-token",
        text: "hello",
        delivery_mode: "background",
      },
    },
    {
      input: {
        target: { kind: "window", pid: 42, windowId: 7 },
        action: { type: "invoke_menu", path: ["File", "New"] },
      },
      tool: "invoke_menu",
      args: { session, pid: 42, window_id: 7, path: ["File", "New"] },
    },
    {
      input: {
        target: {
          kind: "app",
          app: {
            appRef: "app_abcdefghijklmnop",
            nativeKey: "bundle:com.apple.calculator",
            displayName: "Calculator",
            running: false,
            capabilities: ["launch", "windows"],
            native: { platform: "macos", bundle_id: "com.apple.calculator", name: "Calculator" },
          },
        },
        action: { type: "launch_app" },
      },
      tool: "launch_app",
      args: { session, bundle_id: "com.apple.calculator" },
    },
  ] satisfies Array<{ input: EngineAction; tool: string; args: Record<string, unknown> }>) (
    "maps one precise window $input.action.type without a focus-helper call",
    ({ input, tool, args }) => {
      expect(mapAction(input, session)).toEqual({ tool, args });
    },
  );
});
