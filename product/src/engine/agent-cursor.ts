import type { CuaDriverLike, ToolResult } from "@trycua/cua-driver";
import { z } from "zod";

import { ComputerUseError } from "../errors.js";

export type AgentCursorSdk = Pick<CuaDriverLike, "callTool">;

const DisabledCursorStateSchema = z.object({
  session: z.string().min(1),
  enabled: z.literal(false),
}).passthrough();

function contractFailure(): ComputerUseError {
  return new ComputerUseError(
    "engine_contract_changed",
    "Cua did not disable the Agent Cursor for every UCU session",
    "doctor",
    false,
    false,
    "cursor_initialization_failed",
  );
}

function assertDisabledState(result: ToolResult, expectedSession: string): void {
  if (result.isError) throw contractFailure();

  let value: unknown;
  try {
    value = JSON.parse(result.structuredJson ?? "");
  } catch {
    throw contractFailure();
  }
  const parsed = DisabledCursorStateSchema.safeParse(value);
  if (!parsed.success || parsed.data.session !== expectedSession) {
    throw contractFailure();
  }
}

function assertSessions(sessions: readonly string[]): void {
  if (
    sessions.length === 0 ||
    sessions.some((session) => session.length === 0) ||
    new Set(sessions).size !== sessions.length
  ) {
    throw contractFailure();
  }
}

export async function disableAndVerifyAgentCursor(
  sdk: AgentCursorSdk,
  sessions: readonly string[],
): Promise<void> {
  assertSessions(sessions);

  const configured = await Promise.all(sessions.map(async (session) => ({
    session,
    result: await sdk.callTool(
      "set_agent_cursor_enabled",
      JSON.stringify({ session, enabled: false }),
    ),
  })));
  if (configured.some(({ result }) => result.isError)) throw contractFailure();

  const states = await Promise.all(sessions.map(async (session) => ({
    session,
    result: await sdk.callTool(
      "get_agent_cursor_state",
      JSON.stringify({ session }),
    ),
  })));
  for (const { session, result } of states) assertDisabledState(result, session);
}
