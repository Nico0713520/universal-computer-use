import type { ToolResult } from "@trycua/cua-driver";
import { describe, expect, it } from "vitest";

import {
  disableAndVerifyAgentCursor,
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

function sdkWith(
  respond: (name: string, input: Record<string, unknown>) => ToolResult,
): AgentCursorSdk & Readonly<{ calls: Call[] }> {
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

function healthySdk(): AgentCursorSdk & Readonly<{ calls: Call[] }> {
  const enabled = new Map<string, boolean>();
  return sdkWith((name, input) => {
    const session = String(input.session);
    if (name === "set_agent_cursor_enabled") {
      enabled.set(session, input.enabled === true);
      return result({ session, enabled: enabled.get(session) });
    }
    if (name === "get_agent_cursor_state") {
      return result({ session, enabled: enabled.get(session) ?? true });
    }
    throw new Error(`unexpected tool: ${name}`);
  });
}

describe("Cua Agent Cursor policy", () => {
  it("disables and verifies every supplied session before returning", async () => {
    const sdk = healthySdk();

    await disableAndVerifyAgentCursor(sdk, ["desktop", "window"]);

    expect(sdk.calls).toEqual([
      {
        name: "set_agent_cursor_enabled",
        input: { session: "desktop", enabled: false },
      },
      {
        name: "set_agent_cursor_enabled",
        input: { session: "window", enabled: false },
      },
      {
        name: "get_agent_cursor_state",
        input: { session: "desktop" },
      },
      {
        name: "get_agent_cursor_state",
        input: { session: "window" },
      },
    ]);
  });

  it("rejects a set-tool error without attempting readback", async () => {
    const sdk = sdkWith((name, input) => result({ session: input.session }, name.startsWith("set_")));

    await expect(disableAndVerifyAgentCursor(sdk, ["desktop", "window"]))
      .rejects.toMatchObject({
        code: "engine_contract_changed",
        recovery: "doctor",
        retryable: false,
        diagnosticReason: "cursor_initialization_failed",
      });

    expect(sdk.calls.map(({ name }) => name)).toEqual([
      "set_agent_cursor_enabled",
      "set_agent_cursor_enabled",
    ]);
  });

  it.each([
    {
      name: "get-tool error",
      state: (session: string): ToolResult => result({ session }, true),
    },
    {
      name: "malformed JSON",
      state: (): ToolResult => ({ ...result({}), structuredJson: "{not-json" }),
    },
    {
      name: "wrong session",
      state: (): ToolResult => result({ session: "other", enabled: false }),
    },
    {
      name: "still enabled",
      state: (session: string): ToolResult => result({ session, enabled: true }),
    },
  ])("fails closed for $name", async ({ state }) => {
    const sdk = sdkWith((name, input) => {
      const session = String(input.session);
      return name === "set_agent_cursor_enabled"
        ? result({ session, enabled: false })
        : state(session);
    });

    await expect(disableAndVerifyAgentCursor(sdk, ["desktop", "window"]))
      .rejects.toMatchObject({
        code: "engine_contract_changed",
        diagnosticReason: "cursor_initialization_failed",
      });
  });

  it("rejects duplicate or blank session names before calling Cua", async () => {
    const sdk = healthySdk();

    await expect(disableAndVerifyAgentCursor(sdk, ["desktop", "desktop"]))
      .rejects.toMatchObject({ code: "engine_contract_changed" });
    await expect(disableAndVerifyAgentCursor(sdk, ["desktop", ""]))
      .rejects.toMatchObject({ code: "engine_contract_changed" });
    expect(sdk.calls).toEqual([]);
  });
});
