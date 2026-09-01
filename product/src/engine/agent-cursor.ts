import type { CuaDriverLike, ToolResult } from "@trycua/cua-driver";
import { z } from "zod";

import { ComputerUseError } from "../errors.js";
import type { CursorVisibility } from "./cursor-policy.js";

export const AGENT_CURSOR_THEME = Object.freeze({
  theme_id: "cua.default",
  reduced_motion: "auto",
} as const);

export const AGENT_CURSOR_MOTION = Object.freeze({
  glide_duration_ms: 80,
  dwell_after_click_ms: 40,
  idle_hide_ms: 700,
} as const);

export type AgentCursorSdk = Pick<CuaDriverLike, "callTool">;
export type AgentCursorPreparation = "ready" | "degraded";
export type AgentCursorReadbackWaiter = (delayMs: number) => Promise<void>;

type ConfirmedCursorState = boolean | "unknown";

const INITIAL_CURSOR_READBACK_DELAYS_MS = Object.freeze([
  10,
  20,
  40,
  80,
  100,
  150,
] as const);

const EnabledOutputSchema = z.object({
  session: z.string().min(1),
  enabled: z.boolean(),
}).passthrough();

const CursorStateReadbackSchema = z.object({
  session: z.string().min(1),
  enabled: z.boolean(),
  theme: z.object({
    id: z.string().min(1),
    reduced_motion: z.string().min(1),
  }).passthrough(),
  motion: z.object({
    glide_duration_ms: z.number().finite(),
    dwell_after_click_ms: z.number().finite(),
    idle_hide_ms: z.number().finite(),
  }).passthrough(),
}).passthrough();

const CursorStateSchema = z.object({
  session: z.string().min(1),
  enabled: z.boolean(),
  theme: z.object({
    id: z.literal(AGENT_CURSOR_THEME.theme_id),
    reduced_motion: z.literal(AGENT_CURSOR_THEME.reduced_motion),
  }).passthrough(),
  motion: z.object({
    glide_duration_ms: z.literal(AGENT_CURSOR_MOTION.glide_duration_ms),
    dwell_after_click_ms: z.literal(AGENT_CURSOR_MOTION.dwell_after_click_ms),
    idle_hide_ms: z.literal(AGENT_CURSOR_MOTION.idle_hide_ms),
  }).passthrough(),
}).passthrough();

function initializationFailure(): ComputerUseError {
  return new ComputerUseError(
    "engine_contract_changed",
    "Cua did not initialize the Adaptive Cursor for every UCU session",
    "doctor",
    false,
    { diagnosticReason: "cursor_initialization_failed" },
  );
}

function transitionFailure(): ComputerUseError {
  return new ComputerUseError(
    "engine_contract_changed",
    "Cua could not hide the Adaptive Cursor before a quiet operation",
    "doctor",
    false,
    { diagnosticReason: "cursor_transition_failed" },
  );
}

function assertSessions(sessions: readonly string[]): void {
  if (
    sessions.length === 0 ||
    sessions.some((session) => session.length === 0) ||
    new Set(sessions).size !== sessions.length
  ) {
    throw initializationFailure();
  }
}

function parseStructured(result: ToolResult): unknown {
  if (result.isError) throw initializationFailure();
  try {
    return JSON.parse(result.structuredJson ?? "") as unknown;
  } catch {
    throw initializationFailure();
  }
}

function boundedCursorReadbackWait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function verifyInitializedCursors(
  sdk: AgentCursorSdk,
  sessions: readonly string[],
  waitForReadback: AgentCursorReadbackWaiter,
): Promise<void> {
  let pendingSessions = [...sessions];
  for (const delayMs of [0, ...INITIAL_CURSOR_READBACK_DELAYS_MS]) {
    if (delayMs > 0) await waitForReadback(delayMs);
    const round = new AbortController();
    let states: Array<{ session: string; converged: boolean }>;
    try {
      states = await Promise.all(pendingSessions.map(async (session) => {
        const result = await sdk.callTool(
          "get_agent_cursor_state",
          JSON.stringify({ session }),
          { signal: round.signal },
        );
        const value = parseStructured(result);
        const readback = CursorStateReadbackSchema.safeParse(value);
        if (
          !readback.success ||
          readback.data.session !== session ||
          readback.data.enabled
        ) {
          throw initializationFailure();
        }
        return {
          session,
          converged: CursorStateSchema.safeParse(value).success,
        };
      }));
    } catch (error) {
      round.abort();
      throw error;
    }
    const unconvergedSessions = states
      .filter(({ converged }) => !converged)
      .map(({ session }) => session);
    if (unconvergedSessions.length === 0) return;
    pendingSessions = unconvergedSessions;
  }
  throw initializationFailure();
}

async function runInitializationStage(
  sdk: AgentCursorSdk,
  sessions: readonly string[],
  tool: string,
  input: Record<string, unknown>,
): Promise<void> {
  const stage = new AbortController();
  try {
    await Promise.all(sessions.map(async (session) => {
      const result = await sdk.callTool(
        tool,
        JSON.stringify({ session, ...input }),
        { signal: stage.signal },
      );
      if (result.isError) throw initializationFailure();
    }));
  } catch (error) {
    stage.abort();
    throw error;
  }
}

function verifiedEnabledOutput(
  result: ToolResult,
  session: string,
  enabled: boolean,
): boolean {
  if (result.isError) return false;
  let value: unknown;
  try {
    value = JSON.parse(result.structuredJson ?? "") as unknown;
  } catch {
    return false;
  }
  const parsed = EnabledOutputSchema.safeParse(value);
  return parsed.success &&
    parsed.data.session === session &&
    parsed.data.enabled === enabled;
}

export class AgentCursorController {
  private readonly states: Map<string, ConfirmedCursorState>;

  private constructor(
    private readonly sdk: AgentCursorSdk,
    sessions: readonly string[],
  ) {
    this.states = new Map(sessions.map((session) => [session, false]));
  }

  static async initialize(
    sdk: AgentCursorSdk,
    sessions: readonly string[],
    waitForReadback: AgentCursorReadbackWaiter = boundedCursorReadbackWait,
  ): Promise<AgentCursorController> {
    assertSessions(sessions);

    await runInitializationStage(
      sdk,
      sessions,
      "set_agent_cursor_theme",
      AGENT_CURSOR_THEME,
    );
    await runInitializationStage(
      sdk,
      sessions,
      "set_agent_cursor_motion",
      AGENT_CURSOR_MOTION,
    );
    await runInitializationStage(
      sdk,
      sessions,
      "set_agent_cursor_enabled",
      { enabled: false },
    );

    await verifyInitializedCursors(sdk, sessions, waitForReadback);

    return new AgentCursorController(sdk, sessions);
  }

  async prepare(
    session: string,
    visibility: CursorVisibility,
    signal?: AbortSignal,
  ): Promise<AgentCursorPreparation> {
    if (!this.states.has(session)) throw transitionFailure();
    const enabled = visibility === "show";
    if (this.states.get(session) === enabled) return "ready";

    const result = await this.sdk.callTool(
      "set_agent_cursor_enabled",
      JSON.stringify({ session, enabled }),
      signal === undefined ? undefined : { signal },
    );
    if (!verifiedEnabledOutput(result, session, enabled)) {
      this.states.set(session, "unknown");
      if (enabled) return "degraded";
      throw transitionFailure();
    }

    this.states.set(session, enabled);
    return "ready";
  }
}

// Compatibility seam for callers migrating from the v0.2.6 bootstrap.
export async function disableAndVerifyAgentCursor(
  sdk: AgentCursorSdk,
  sessions: readonly string[],
): Promise<void> {
  await AgentCursorController.initialize(sdk, sessions);
}
