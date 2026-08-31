import type { ToolResult } from "@trycua/cua-driver";
import { describe, expect, it } from "vitest";

import {
  AGENT_CURSOR_MOTION,
  AGENT_CURSOR_THEME,
  AgentCursorController,
  type AgentCursorSdk,
} from "../../src/engine/agent-cursor.js";

type Call = Readonly<{ name: string; input: Record<string, unknown> }>;

function result(value: unknown, isError = false): ToolResult {
  return {
    text: "fixture",
    images: [],
    structuredJson: JSON.stringify(value),
    isError,
    degraded: false,
    rawJson: "{}",
  };
}

function cursorState(session: string, enabled: boolean): Record<string, unknown> {
  return {
    session,
    enabled,
    position: null,
    theme: {
      id: AGENT_CURSOR_THEME.theme_id,
      version: "2",
      profile: "cua-driver-actions-v2",
      reduced_motion: AGENT_CURSOR_THEME.reduced_motion,
      fallback: null,
    },
    visual_state: {
      requested_action: "idle",
      resolved_action: "idle",
      modifiers: [],
      phase: "idle",
      frame: 0,
      preempted_count: 0,
    },
    motion: {
      start_handle: 0.3,
      end_handle: 0.3,
      arc_size: 0.25,
      arc_flow: 0,
      spring: 0.72,
      ...AGENT_CURSOR_MOTION,
      turn_radius: 80,
    },
  };
}

function sdkWith(
  respond: (name: string, input: Record<string, unknown>) => ToolResult,
): AgentCursorSdk & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    async callTool(name, argumentsJson): Promise<ToolResult> {
      const input = JSON.parse(argumentsJson) as Record<string, unknown>;
      calls.push({ name, input });
      return respond(name, input);
    },
  };
}

function healthySdk(): AgentCursorSdk & { calls: Call[] } {
  const enabled = new Map<string, boolean>();
  return sdkWith((name, input) => {
    const session = String(input.session);
    if (name === "set_agent_cursor_theme") {
      return result({
        session,
        theme: {
          id: input.theme_id,
          version: "2",
          profile: "cua-driver-actions-v2",
          reduced_motion: input.reduced_motion,
          fallback: null,
        },
      });
    }
    if (name === "set_agent_cursor_motion") {
      return result({
        session,
        motion: {
          start_handle: 0.3,
          end_handle: 0.3,
          arc_size: 0.25,
          arc_flow: 0,
          spring: 0.72,
          ...AGENT_CURSOR_MOTION,
          turn_radius: 80,
        },
      });
    }
    if (name === "set_agent_cursor_enabled") {
      enabled.set(session, input.enabled === true);
      return result({ session, enabled: enabled.get(session) });
    }
    if (name === "get_agent_cursor_state") {
      return result(cursorState(session, enabled.get(session) ?? true));
    }
    throw new Error(`unexpected tool: ${name}`);
  });
}

describe("Cua Agent Cursor controller", () => {
  it("configures and verifies both sessions before returning", async () => {
    const sdk = healthySdk();

    await AgentCursorController.initialize(sdk, ["UCU-D-a1b2", "UCU-W-a1b2"]);

    expect(sdk.calls).toEqual([
      ...["UCU-D-a1b2", "UCU-W-a1b2"].map((session) => ({
        name: "set_agent_cursor_theme",
        input: { session, ...AGENT_CURSOR_THEME },
      })),
      ...["UCU-D-a1b2", "UCU-W-a1b2"].map((session) => ({
        name: "set_agent_cursor_motion",
        input: { session, ...AGENT_CURSOR_MOTION },
      })),
      ...["UCU-D-a1b2", "UCU-W-a1b2"].map((session) => ({
        name: "set_agent_cursor_enabled",
        input: { session, enabled: false },
      })),
      ...["UCU-D-a1b2", "UCU-W-a1b2"].map((session) => ({
        name: "get_agent_cursor_state",
        input: { session },
      })),
    ]);
  });

  it("does not call Cua when a verified session already has the desired state", async () => {
    const sdk = healthySdk();
    const controller = await AgentCursorController.initialize(sdk, ["desktop", "window"]);
    sdk.calls.length = 0;

    await expect(controller.prepare("desktop", "hide")).resolves.toBe("ready");

    expect(sdk.calls).toEqual([]);
  });

  it("enables once and caches a verified visible state", async () => {
    const sdk = healthySdk();
    const controller = await AgentCursorController.initialize(sdk, ["desktop", "window"]);
    sdk.calls.length = 0;

    await expect(controller.prepare("desktop", "show")).resolves.toBe("ready");
    await expect(controller.prepare("desktop", "show")).resolves.toBe("ready");

    expect(sdk.calls).toEqual([{
      name: "set_agent_cursor_enabled",
      input: { session: "desktop", enabled: true },
    }]);
  });

  it("degrades a failed show and makes the next hide explicit", async () => {
    const sdk = healthySdk();
    const controller = await AgentCursorController.initialize(sdk, ["desktop", "window"]);
    sdk.calls.length = 0;
    const originalCallTool = sdk.callTool.bind(sdk);
    let failNextEnable = true;
    sdk.callTool = async (name, argumentsJson, options): Promise<ToolResult> => {
      const input = JSON.parse(argumentsJson) as Record<string, unknown>;
      if (failNextEnable && name === "set_agent_cursor_enabled" && input.enabled === true) {
        failNextEnable = false;
        sdk.calls.push({ name, input });
        return result({ code: "cursor_failed" }, true);
      }
      return originalCallTool(name, argumentsJson, options);
    };

    await expect(controller.prepare("desktop", "show")).resolves.toBe("degraded");
    await expect(controller.prepare("desktop", "hide")).resolves.toBe("ready");

    expect(sdk.calls).toEqual([
      {
        name: "set_agent_cursor_enabled",
        input: { session: "desktop", enabled: true },
      },
      {
        name: "set_agent_cursor_enabled",
        input: { session: "desktop", enabled: false },
      },
    ]);
  });

  it("fails closed when a required hide cannot be confirmed", async () => {
    const sdk = healthySdk();
    const controller = await AgentCursorController.initialize(sdk, ["desktop", "window"]);
    await controller.prepare("desktop", "show");
    sdk.calls.length = 0;
    const originalCallTool = sdk.callTool.bind(sdk);
    sdk.callTool = async (name, argumentsJson, options): Promise<ToolResult> => {
      const input = JSON.parse(argumentsJson) as Record<string, unknown>;
      if (name === "set_agent_cursor_enabled" && input.enabled === false) {
        sdk.calls.push({ name, input });
        return result({ code: "cursor_failed" }, true);
      }
      return originalCallTool(name, argumentsJson, options);
    };

    await expect(controller.prepare("desktop", "hide")).rejects.toMatchObject({
      code: "engine_contract_changed",
      recovery: "doctor",
      diagnosticReason: "cursor_transition_failed",
    });
  });

  it("fails initialization before later stages when a configuration tool errors", async () => {
    const sdk = sdkWith((name, input) => result(
      { session: input.session },
      name === "set_agent_cursor_theme",
    ));

    await expect(AgentCursorController.initialize(sdk, ["desktop", "window"]))
      .rejects.toMatchObject({
        code: "engine_contract_changed",
        diagnosticReason: "cursor_initialization_failed",
      });

    expect(sdk.calls.map(({ name }) => name)).toEqual([
      "set_agent_cursor_theme",
      "set_agent_cursor_theme",
    ]);
  });

  it.each([
    {
      name: "malformed JSON",
      state: (): ToolResult => ({ ...result({}), structuredJson: "{not-json" }),
    },
    {
      name: "wrong session",
      state: (): ToolResult => result(cursorState("other", false)),
    },
    {
      name: "still enabled",
      state: (session: string): ToolResult => result(cursorState(session, true)),
    },
    {
      name: "wrong motion",
      state: (session: string): ToolResult => result({
        ...cursorState(session, false),
        motion: {
          ...(cursorState(session, false).motion as Record<string, unknown>),
          glide_duration_ms: 900,
        },
      }),
    },
  ])("fails initialization for $name", async ({ state }) => {
    const sdk = healthySdk();
    const originalCallTool = sdk.callTool.bind(sdk);
    sdk.callTool = async (name, argumentsJson, options): Promise<ToolResult> => {
      const input = JSON.parse(argumentsJson) as Record<string, unknown>;
      if (name === "get_agent_cursor_state") {
        sdk.calls.push({ name, input });
        return state(String(input.session));
      }
      return originalCallTool(name, argumentsJson, options);
    };

    await expect(AgentCursorController.initialize(sdk, ["desktop", "window"]))
      .rejects.toMatchObject({
        code: "engine_contract_changed",
        diagnosticReason: "cursor_initialization_failed",
      });
  });

  it("rejects duplicate or blank session names before calling Cua", async () => {
    const sdk = healthySdk();

    await expect(AgentCursorController.initialize(sdk, ["desktop", "desktop"]))
      .rejects.toMatchObject({ code: "engine_contract_changed" });
    await expect(AgentCursorController.initialize(sdk, ["desktop", ""]))
      .rejects.toMatchObject({ code: "engine_contract_changed" });
    expect(sdk.calls).toEqual([]);
  });
});
