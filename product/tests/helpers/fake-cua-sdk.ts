import {
  CaptureScope,
  EffectiveScope,
  type DriverMetadata,
  type EndSessionInput,
  type EndSessionOutput,
  type StartSessionInput,
  type StartSessionOutput,
  type ToolResult,
} from "@trycua/cua-driver";

import type { CuaSdkLike } from "../../src/engine/cua.js";

type FakeSdkOptions = Readonly<{
  driverVersion: string;
  tools: readonly string[];
  toolsJson?: string;
  desktopUnlocked?: boolean;
  effectiveScope?: EffectiveScope;
  toolResult?: ToolResult;
  toolResults?: Readonly<Record<string, ToolResult | readonly ToolResult[]>>;
}>;

export type FakeCuaSdk = CuaSdkLike & {
  readonly startSessionCalls: StartSessionInput[];
  readonly callToolCalls: Array<Readonly<{ name: string; argumentsJson: string }>>;
  readonly endSessionCalls: EndSessionInput[];
};

export function fakeSdk(options: FakeSdkOptions): FakeCuaSdk {
  const startSessionCalls: StartSessionInput[] = [];
  const callToolCalls: Array<Readonly<{ name: string; argumentsJson: string }>> = [];
  const endSessionCalls: EndSessionInput[] = [];
  const cursorEnabled = new Map<string, boolean>();
  const cursorTheme = new Map<string, Readonly<{
    id: string;
    reducedMotion: string;
  }>>();
  const cursorMotion = new Map<string, Readonly<{
    glideDurationMs: number;
    dwellAfterClickMs: number;
    idleHideMs: number;
  }>>();
  const perToolResults = new Map<string, ToolResult[]>(
    Object.entries(options.toolResults ?? {}).map(([name, value]) => [
      name,
      Array.isArray(value) ? [...value] : [value as ToolResult],
    ]),
  );

  return {
    startSessionCalls,
    callToolCalls,
    endSessionCalls,
    async metadata(): Promise<DriverMetadata> {
      return {
        driverVersion: options.driverVersion,
        contractVersion: "fixture",
        toolsListSchemaVersion: "fixture",
        capabilityVersion: "fixture",
        mcpProtocolVersion: "fixture",
        pid: 1,
        embedded: false,
      };
    },
    async listToolsJson(): Promise<string> {
      return options.toolsJson ?? JSON.stringify({ tools: options.tools.map((name) => ({ name })) });
    },
    async startSession(input: StartSessionInput): Promise<StartSessionOutput> {
      startSessionCalls.push(input);
      cursorEnabled.set(input.session ?? "implicit", true);
      return {
        state: {
          session: input.session ?? "implicit",
          captureScope: input.captureScope ?? CaptureScope.Auto,
          effectiveScope: options.effectiveScope ??
            (input.captureScope === CaptureScope.Window ? EffectiveScope.Window : EffectiveScope.Desktop),
          desktopUnlocked: options.desktopUnlocked ?? true,
        },
        active: true,
        revived: false,
      };
    },
    async callTool(name: string, argumentsJson: string): Promise<ToolResult> {
      callToolCalls.push({ name, argumentsJson });
      const queued = perToolResults.get(name);
      if (queued !== undefined && queued.length > 0) return queued.shift()!;
      if (name === "set_agent_cursor_enabled" || name === "get_agent_cursor_state") {
        const input = JSON.parse(argumentsJson) as { session?: unknown; enabled?: unknown };
        if (typeof input.session !== "string" || input.session.length === 0) {
          throw new Error("invalid_fake_cursor_session");
        }
        if (name === "set_agent_cursor_enabled") {
          if (typeof input.enabled !== "boolean") throw new Error("invalid_fake_cursor_enabled");
          cursorEnabled.set(input.session, input.enabled);
          return {
            text: "fixture",
            images: [],
            structuredJson: JSON.stringify({
              session: input.session,
              enabled: input.enabled,
            }),
            isError: false,
            degraded: false,
            rawJson: "{}",
          };
        }
        const enabled = cursorEnabled.get(input.session) ?? true;
        const theme = cursorTheme.get(input.session) ?? {
          id: "cua.default",
          reducedMotion: "auto",
        };
        const motion = cursorMotion.get(input.session) ?? {
          glideDurationMs: 0,
          dwellAfterClickMs: 80,
          idleHideMs: 20_000,
        };
        return {
          text: "fixture",
          images: [],
          structuredJson: JSON.stringify({
            session: input.session,
            enabled,
            position: null,
            theme: {
              id: theme.id,
              version: "2",
              profile: "cua-driver-actions-v2",
              reduced_motion: theme.reducedMotion,
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
              glide_duration_ms: motion.glideDurationMs,
              dwell_after_click_ms: motion.dwellAfterClickMs,
              idle_hide_ms: motion.idleHideMs,
              turn_radius: 80,
            },
          }),
          isError: false,
          degraded: false,
          rawJson: "{}",
        };
      }
      if (name === "set_agent_cursor_theme") {
        const input = JSON.parse(argumentsJson) as {
          session?: unknown;
          theme_id?: unknown;
          reduced_motion?: unknown;
        };
        if (
          typeof input.session !== "string" ||
          typeof input.theme_id !== "string" ||
          typeof input.reduced_motion !== "string"
        ) {
          throw new Error("invalid_fake_cursor_theme");
        }
        cursorTheme.set(input.session, {
          id: input.theme_id,
          reducedMotion: input.reduced_motion,
        });
        return {
          text: "fixture",
          images: [],
          structuredJson: JSON.stringify({
            session: input.session,
            theme: {
              id: input.theme_id,
              version: "2",
              profile: "cua-driver-actions-v2",
              reduced_motion: input.reduced_motion,
              fallback: null,
            },
          }),
          isError: false,
          degraded: false,
          rawJson: "{}",
        };
      }
      if (name === "set_agent_cursor_motion") {
        const input = JSON.parse(argumentsJson) as {
          session?: unknown;
          glide_duration_ms?: unknown;
          dwell_after_click_ms?: unknown;
          idle_hide_ms?: unknown;
        };
        if (
          typeof input.session !== "string" ||
          typeof input.glide_duration_ms !== "number" ||
          typeof input.dwell_after_click_ms !== "number" ||
          typeof input.idle_hide_ms !== "number"
        ) {
          throw new Error("invalid_fake_cursor_motion");
        }
        cursorMotion.set(input.session, {
          glideDurationMs: input.glide_duration_ms,
          dwellAfterClickMs: input.dwell_after_click_ms,
          idleHideMs: input.idle_hide_ms,
        });
        return {
          text: "fixture",
          images: [],
          structuredJson: JSON.stringify({
            session: input.session,
            motion: {
              start_handle: 0.3,
              end_handle: 0.3,
              arc_size: 0.25,
              arc_flow: 0,
              spring: 0.72,
              glide_duration_ms: input.glide_duration_ms,
              dwell_after_click_ms: input.dwell_after_click_ms,
              idle_hide_ms: input.idle_hide_ms,
              turn_radius: 80,
            },
          }),
          isError: false,
          degraded: false,
          rawJson: "{}",
        };
      }
      if (options.toolResult !== undefined) return options.toolResult;
      throw new Error("unexpected_sdk_call");
    },
    async endSession(input: EndSessionInput): Promise<EndSessionOutput> {
      endSessionCalls.push(input);
      return { session: input.session ?? "implicit", active: false };
    },
  };
}
