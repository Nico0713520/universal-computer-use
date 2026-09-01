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

  it("waits for readback-only convergence without repeating configuration", async () => {
    const sdk = healthySdk();
    const originalCallTool = sdk.callTool.bind(sdk);
    let readbacks = 0;
    const waits: number[] = [];
    sdk.callTool = async (name, argumentsJson, options): Promise<ToolResult> => {
      const input = JSON.parse(argumentsJson) as Record<string, unknown>;
      if (name === "get_agent_cursor_state") {
        sdk.calls.push({ name, input });
        readbacks += 1;
        if (readbacks === 1) {
          return result({
            ...cursorState(String(input.session), false),
            motion: {
              ...(cursorState(String(input.session), false).motion as Record<string, unknown>),
              glide_duration_ms: 0,
              dwell_after_click_ms: 80,
              idle_hide_ms: 20_000,
            },
          });
        }
        return result(cursorState(String(input.session), false));
      }
      return originalCallTool(name, argumentsJson, options);
    };

    const outcome = AgentCursorController.initialize(
      sdk,
      ["desktop"],
      async (delayMs) => {
        waits.push(delayMs);
      },
    );

    await expect(outcome).resolves.toBeInstanceOf(AgentCursorController);
    expect(waits).toEqual([10]);
    expect(sdk.calls.map(({ name }) => name)).toEqual([
      "set_agent_cursor_theme",
      "set_agent_cursor_motion",
      "set_agent_cursor_enabled",
      "get_agent_cursor_state",
      "get_agent_cursor_state",
    ]);
  });

  it("uses the exact bounded convergence schedule without repeating configuration", async () => {
    const sdk = healthySdk();
    const originalCallTool = sdk.callTool.bind(sdk);
    const waits: number[] = [];
    sdk.callTool = async (name, argumentsJson, options): Promise<ToolResult> => {
      const input = JSON.parse(argumentsJson) as Record<string, unknown>;
      if (name === "get_agent_cursor_state") {
        sdk.calls.push({ name, input });
        return result({
          ...cursorState(String(input.session), false),
          motion: {
            ...(cursorState(String(input.session), false).motion as Record<string, unknown>),
            glide_duration_ms: 0,
            dwell_after_click_ms: 80,
            idle_hide_ms: 20_000,
          },
        });
      }
      return originalCallTool(name, argumentsJson, options);
    };

    const outcome = AgentCursorController.initialize(
      sdk,
      ["desktop"],
      async (delayMs) => {
        waits.push(delayMs);
      },
    ).then(
      () => ({ status: "ready" as const }),
      (error: unknown) => ({ status: "failed" as const, error }),
    );

    await expect(outcome).resolves.toMatchObject({
      status: "failed",
      error: {
        code: "engine_contract_changed",
        diagnosticReason: "cursor_initialization_failed",
      },
    });
    expect(waits).toEqual([10, 20, 40, 80, 100, 150]);
    expect(sdk.calls.filter(({ name }) => name === "get_agent_cursor_state")).toHaveLength(7);
    expect(sdk.calls.filter(({ name }) => name === "set_agent_cursor_theme")).toHaveLength(1);
    expect(sdk.calls.filter(({ name }) => name === "set_agent_cursor_motion")).toHaveLength(1);
    expect(sdk.calls.filter(({ name }) => name === "set_agent_cursor_enabled")).toHaveLength(1);
  });

  it("does not leave another session polling after one session fails closed", async () => {
    const sdk = healthySdk();
    const originalCallTool = sdk.callTool.bind(sdk);
    const waits: number[] = [];
    sdk.callTool = async (name, argumentsJson, options): Promise<ToolResult> => {
      const input = JSON.parse(argumentsJson) as Record<string, unknown>;
      if (name === "get_agent_cursor_state") {
        sdk.calls.push({ name, input });
        if (input.session === "desktop") return result({ malformed: true });
        return result({
          ...cursorState(String(input.session), false),
          motion: {
            ...(cursorState(String(input.session), false).motion as Record<string, unknown>),
            glide_duration_ms: 0,
          },
        });
      }
      return originalCallTool(name, argumentsJson, options);
    };

    await expect(
      AgentCursorController.initialize(
        sdk,
        ["desktop", "window"],
        async (delayMs) => {
          waits.push(delayMs);
        },
      ),
    ).rejects.toMatchObject({
      code: "engine_contract_changed",
      diagnosticReason: "cursor_initialization_failed",
    });

    expect(waits).toEqual([]);
    expect(sdk.calls.filter(({ name }) => name === "get_agent_cursor_state")).toHaveLength(2);
  });

  it("aborts a hanging same-round read as soon as another session fails closed", async () => {
    const sdk = healthySdk();
    const originalCallTool = sdk.callTool.bind(sdk);
    const abortedSessions: string[] = [];
    let releaseWindow!: () => void;
    let markWindowStarted!: () => void;
    const windowStarted = new Promise<void>((resolve) => {
      markWindowStarted = resolve;
    });
    sdk.callTool = async (name, argumentsJson, options): Promise<ToolResult> => {
      const input = JSON.parse(argumentsJson) as Record<string, unknown>;
      if (name !== "get_agent_cursor_state") {
        return originalCallTool(name, argumentsJson, options);
      }
      sdk.calls.push({ name, input });
      if (input.session === "desktop") return result({ malformed: true });
      return new Promise<ToolResult>((resolve, reject) => {
        releaseWindow = () => resolve(result(cursorState("window", false)));
        markWindowStarted();
        options?.signal?.addEventListener("abort", () => {
          abortedSessions.push(String(input.session));
          reject(new Error("cursor read aborted"));
        }, { once: true });
      });
    };

    const outcome = AgentCursorController.initialize(sdk, ["desktop", "window"])
      .then(
        () => ({ status: "ready" as const }),
        (error: unknown) => ({ status: "failed" as const, error }),
      );
    await windowStarted;
    await Promise.resolve();
    await Promise.resolve();
    const abortedBeforeRelease = [...abortedSessions];
    releaseWindow();

    await expect(outcome).resolves.toMatchObject({
      status: "failed",
      error: {
        code: "engine_contract_changed",
        diagnosticReason: "cursor_initialization_failed",
      },
    });
    expect(abortedBeforeRelease).toEqual(["window"]);
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

  it("aborts a hanging same-stage configuration when its peer fails", async () => {
    const sdk = healthySdk();
    const originalCallTool = sdk.callTool.bind(sdk);
    const abortedSessions: string[] = [];
    let releaseWindow!: () => void;
    let markWindowStarted!: () => void;
    const windowStarted = new Promise<void>((resolve) => {
      markWindowStarted = resolve;
    });
    sdk.callTool = async (name, argumentsJson, options): Promise<ToolResult> => {
      const input = JSON.parse(argumentsJson) as Record<string, unknown>;
      if (name !== "set_agent_cursor_theme") {
        return originalCallTool(name, argumentsJson, options);
      }
      sdk.calls.push({ name, input });
      if (input.session === "desktop") {
        return result({ code: "theme_failed" }, true);
      }
      return new Promise<ToolResult>((resolve, reject) => {
        releaseWindow = () => resolve(result({ session: "window" }));
        markWindowStarted();
        options?.signal?.addEventListener("abort", () => {
          abortedSessions.push(String(input.session));
          reject(new Error("theme aborted"));
        }, { once: true });
      });
    };

    const outcome = AgentCursorController.initialize(sdk, ["desktop", "window"])
      .then(
        () => ({ status: "ready" as const }),
        (error: unknown) => ({ status: "failed" as const, error }),
      );
    await windowStarted;
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    const abortedBeforeRelease = [...abortedSessions];
    releaseWindow();

    await expect(outcome).resolves.toMatchObject({
      status: "failed",
      error: {
        code: "engine_contract_changed",
        diagnosticReason: "cursor_initialization_failed",
      },
    });
    expect(abortedBeforeRelease).toEqual(["window"]);
    expect(sdk.calls.filter(({ name }) => name === "set_agent_cursor_motion")).toEqual([]);
  });

  it.each([
    {
      name: "malformed JSON",
      state: (): ToolResult => ({ ...result({}), structuredJson: "{not-json" }),
    },
    {
      name: "tool error",
      state: (): ToolResult => result({ code: "cursor_failed" }, true),
    },
    {
      name: "wrong session",
      state: (): ToolResult => result(cursorState("other", false)),
    },
    {
      name: "still enabled",
      state: (session: string): ToolResult => result(cursorState(session, true)),
    },
  ])("fails initialization immediately for $name", async ({ state }) => {
    const sdk = healthySdk();
    const originalCallTool = sdk.callTool.bind(sdk);
    const waits: number[] = [];
    sdk.callTool = async (name, argumentsJson, options): Promise<ToolResult> => {
      const input = JSON.parse(argumentsJson) as Record<string, unknown>;
      if (name === "get_agent_cursor_state") {
        sdk.calls.push({ name, input });
        return state(String(input.session));
      }
      return originalCallTool(name, argumentsJson, options);
    };

    const outcome = AgentCursorController.initialize(
      sdk,
      ["desktop"],
      async (delayMs) => {
        waits.push(delayMs);
      },
    ).then(
      () => ({ status: "ready" as const }),
      (error: unknown) => ({ status: "failed" as const, error }),
    );

    await expect(outcome).resolves.toMatchObject({
      status: "failed",
      error: {
        code: "engine_contract_changed",
        diagnosticReason: "cursor_initialization_failed",
      },
    });
    expect(waits).toEqual([]);
    expect(sdk.calls.filter(({ name }) => name === "get_agent_cursor_state")).toHaveLength(1);
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
