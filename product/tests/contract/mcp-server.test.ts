import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Ajv2020 } from "ajv/dist/2020.js";

import type { ComputerUseRuntime } from "../../src/core/runtime.js";
import { ComputerUseError } from "../../src/errors.js";
import { handleAct } from "../../src/mcp/handlers.js";
import { createComputerUseServer } from "../../src/mcp/server.js";
import {
  ActOutputSchema,
  McpErrorOutputSchema,
  ObservationOutputSchema,
} from "../../src/protocol.js";
import { fixtureRuntime } from "../helpers/fake-engine.js";

const closeCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.allSettled(closeCallbacks.splice(0).map((close) => close()));
  vi.useRealTimers();
});

async function connectedClient(runtime: ComputerUseRuntime): Promise<Client> {
  const server = createComputerUseServer(runtime);
  const client = new Client({ name: "contract-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closeCallbacks.push(async () => {
    await client.close();
    await server.close();
    await runtime.close();
  });
  return client;
}

describe("computer use MCP contract", () => {
  it("lists exactly the two public tools with truthful annotations", async () => {
    const { runtime } = fixtureRuntime();
    const client = await connectedClient(runtime);

    const { tools } = await client.listTools();

    expect(tools.map(({ name }) => name)).toEqual([
      "computer_observe",
      "computer_act",
    ]);
    expect(tools[0]?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
    expect(tools[1]?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
    expect(tools[0]?.inputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        target: expect.any(Object),
        discover: expect.any(Object),
      },
    });

    for (const [index, tool] of tools.entries()) {
      if (tool.outputSchema === undefined) throw new Error(`${tool.name} did not publish an output schema`);
      expect(tool.outputSchema).toMatchObject({
        type: "object",
        oneOf: expect.any(Array),
      });
      expect((tool.outputSchema.oneOf as unknown[])).toHaveLength(index === 0 ? 5 : 6);
      expect((tool.outputSchema.oneOf as Array<{ required?: string[] }>).at(-1)?.required)
        .toEqual(["code", "recovery", "retryable"]);
      const output = z.fromJSONSchema(tool.outputSchema as never);
      expect(output.safeParse({}).success).toBe(false);
      expect(output.safeParse({
        code: "stale_snapshot",
        recovery: "observe_again",
        retryable: true,
        protocol_version: "1.2.0",
      }).success).toBe(false);
      expect(output.safeParse({
        code: "stale_snapshot",
        recovery: "observe_again",
        retryable: true,
        snapshot_id: "snap_12345678",
      }).success).toBe(false);
    }
  });

  it("publishes exact JSON Schema branches that match runtime output validation", async () => {
    const { runtime } = fixtureRuntime();
    const client = await connectedClient(runtime);
    const { tools } = await client.listTools();
    if (tools[0]?.outputSchema === undefined || tools[1]?.outputSchema === undefined) {
      throw new Error("both tools must publish output schemas");
    }
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    const validateObserve = ajv.compile({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      oneOf: tools[0].outputSchema.oneOf,
    });
    const validateAct = ajv.compile({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      oneOf: tools[1].outputSchema.oneOf,
    });
    const screenshot = { mime_type: "image/png", width: 100, height: 80 };
    const target = {
      kind: "window",
      window_ref: "win_abcdefghijklmnop",
      app_ref: "app_abcdefghijklmnop",
      app_name: "Calculator",
      title: "Calculator",
    } as const;
    const observeBase = {
      protocol_version: "1.2.0",
      session_id: "ses_123",
      snapshot_id: "snap_12345678",
      platform: "macos",
      engine: { name: "cua-driver", version: "0.22.2" },
    } as const;
    const windowBase = {
      ...observeBase,
      target,
      coordinate_space: "window_screenshot_pixels",
      elements: [],
      elements_truncated: false,
    } as const;
    const desktop = {
      ...observeBase,
      display_id: "primary",
      target: { kind: "desktop", display_id: "primary" },
      coordinate_space: "desktop_screenshot_pixels",
      screenshot,
    } as const;
    const safeError = {
      code: "stale_snapshot",
      recovery: "observe_again",
      retryable: true,
    } as const;
    const observations = [
      { ...windowBase, observation_mode: "visual", visual_status: "available", screenshot },
      { ...windowBase, observation_mode: "visual", visual_status: "capture_unavailable" },
      { ...windowBase, observation_mode: "semantic", visual_status: "not_requested" },
      desktop,
      safeError,
    ] as const;
    for (const output of observations) {
      const runtimeValid = "code" in output
        ? McpErrorOutputSchema.safeParse(output).success
        : ObservationOutputSchema.safeParse(output).success;
      expect(runtimeValid, JSON.stringify(output)).toBe(true);
      expect(validateObserve(output), JSON.stringify(validateObserve.errors)).toBe(true);
    }

    const actionBase = {
      protocol_version: "1.2.0",
      session_id: "ses_123",
      consumed_snapshot_id: "snap_87654321",
      action_result: {
        status: "executed",
        effect: "confirmed",
        route: "accessibility",
        delivery: "background",
        evidence: ["value_readback"],
      },
      verification: { status: "satisfied" },
    } as const;
    const windowActionBase = {
      ...actionBase,
      next_state: "available",
      snapshot_id: "snap_12345678",
      target,
      coordinate_space: "window_screenshot_pixels",
      elements: [],
      elements_truncated: false,
    } as const;
    const actions = [
      { ...windowActionBase, observation_mode: "visual", visual_status: "available", screenshot },
      { ...windowActionBase, observation_mode: "visual_recovery", visual_status: "pixel_frame_unproven" },
      { ...windowActionBase, observation_mode: "semantic", visual_status: "not_requested" },
      {
        ...actionBase,
        next_state: "available",
        snapshot_id: "snap_12345678",
        target: { kind: "desktop", display_id: "primary" },
        coordinate_space: "desktop_screenshot_pixels",
        screenshot,
      },
      {
        ...actionBase,
        next_state: "unavailable",
        next_observation_error: { code: "target_lost", recovery: "observe_desktop" },
      },
      safeError,
    ] as const;
    for (const output of actions) {
      const runtimeValid = "code" in output
        ? McpErrorOutputSchema.safeParse(output).success
        : ActOutputSchema.safeParse(output).success;
      expect(runtimeValid, JSON.stringify(output)).toBe(true);
      expect(validateAct(output), JSON.stringify(validateAct.errors)).toBe(true);
    }

    for (const invalid of [
      {},
      { ...desktop, observation_mode: "visual" },
      {
        ...windowBase,
        observation_mode: "semantic",
        visual_status: "available",
        screenshot,
      },
    ]) {
      expect(ObservationOutputSchema.safeParse(invalid).success).toBe(false);
      expect(validateObserve(invalid)).toBe(false);
    }
    for (const invalid of [
      {},
      {
        ...actionBase,
        next_state: "unavailable",
        next_observation_error: { code: "target_lost", recovery: "observe_desktop" },
        observation_mode: "visual",
      },
      {
        ...windowActionBase,
        observation_mode: "semantic",
        visual_status: "available",
        screenshot,
      },
    ]) {
      expect(ActOutputSchema.safeParse(invalid).success).toBe(false);
      expect(validateAct(invalid)).toBe(false);
    }
  });

  it("publishes a self-contained safe control loop in MCP initialization", async () => {
    const { runtime } = fixtureRuntime();
    const client = await connectedClient(runtime);
    const instructions = client.getInstructions();

    expect(instructions).toBeTypeOf("string");
    const opening = instructions!.slice(0, 512);
    for (const phrase of [
      "Observe before the first action",
      "exact window",
      "one action",
      "latest snapshot",
      "computer_act returns",
      "Never blindly retry",
      "Stop",
    ]) {
      expect(opening).toContain(phrase);
    }
    expect(instructions).not.toMatch(/embedded model|bypass|computer_verify/i);
  });

  it("returns matching structured data and one PNG image for observe and act", async () => {
    const { runtime } = fixtureRuntime({ dataBase64: "cG5nLWZpeHR1cmU=" });
    const client = await connectedClient(runtime);

    const observed = CallToolResultSchema.parse(
      await client.callTool({
        name: "computer_observe",
        arguments: {},
      }),
    );
    expect(observed.isError, JSON.stringify(observed)).not.toBe(true);
    expect(observed.content).toHaveLength(2);
    expect(observed.content[0]).toEqual({
      type: "text",
      text: JSON.stringify(observed.structuredContent),
    });
    expect(observed.content[1]).toEqual({
      type: "image",
      mimeType: "image/png",
      data: "cG5nLWZpeHR1cmU=",
    });
    expect(observed.structuredContent).toMatchObject({
      protocol_version: "1.2.0",
      session_id: "fixture-session",
      platform: "macos",
      display_id: "primary",
      screenshot: { mime_type: "image/png", width: 100, height: 80 },
      engine: { name: "cua-driver", version: "0.22.2" },
    });

    const snapshotId = String(observed.structuredContent?.snapshot_id);
    const acted = CallToolResultSchema.parse(
      await client.callTool({
        name: "computer_act",
        arguments: {
          snapshot_id: snapshotId,
          action: { type: "click", x: 10, y: 10 },
        },
      }),
    );
    expect(acted.isError).not.toBe(true);
    expect(acted.content).toHaveLength(2);
    expect(acted.content[0]).toEqual({
      type: "text",
      text: JSON.stringify(acted.structuredContent),
    });
    expect(acted.content[1]).toEqual({
      type: "image",
      mimeType: "image/png",
      data: "cG5nLWZpeHR1cmU=",
    });
    expect(acted.structuredContent).toMatchObject({
      protocol_version: "1.2.0",
      session_id: "fixture-session",
      consumed_snapshot_id: snapshotId,
      action_result: {
        status: "executed",
        effect: "unverifiable",
        route: "unknown",
        delivery: "unknown",
      },
      screenshot: { mime_type: "image/png", width: 100, height: 80 },
    });
    expect(acted.structuredContent?.snapshot_id).not.toBe(snapshotId);
  });

  it("delivers safe runtime errors through the declared MCP output schema", async () => {
    const { runtime } = fixtureRuntime();
    const client = await connectedClient(runtime);
    // SDK 1.30 caches output validators only after tools/list. Real hosts list
    // tools before calling them, so the regression must exercise that order.
    await client.listTools();
    const observed = CallToolResultSchema.parse(await client.callTool({
      name: "computer_observe",
      arguments: {},
    }));
    const snapshotId = String(observed.structuredContent?.snapshot_id);
    const first = CallToolResultSchema.parse(await client.callTool({
      name: "computer_act",
      arguments: { snapshot_id: snapshotId, action: { type: "wait", ms: 0 } },
    }));
    expect(first.isError).not.toBe(true);

    const stale = CallToolResultSchema.parse(await client.callTool({
      name: "computer_act",
      arguments: { snapshot_id: snapshotId, action: { type: "wait", ms: 0 } },
    }));

    expect(stale).toMatchObject({
      isError: true,
      structuredContent: {
        code: "stale_snapshot",
        recovery: "observe_again",
        retryable: true,
      },
    });
  });

  it("rejects actions arrays before the runtime can execute anything", async () => {
    const { runtime, engine } = fixtureRuntime();
    const client = await connectedClient(runtime);

    const result = CallToolResultSchema.parse(
      await client.callTool({
        name: "computer_act",
        arguments: {
          snapshot_id: "snap_12345678",
          actions: [{ type: "click", x: 10, y: 10 }],
        },
      }),
    );

    expect(result.isError).toBe(true);
    expect(engine.executions).toHaveLength(0);
    expect(engine.observations).toBe(0);
  });

  it("publishes snapshot consumption only after the phase boundary", async () => {
    const { runtime, engine } = fixtureRuntime({ hangAction: true });
    const observed = await runtime.observe();
    const snapshotId = observed.structured.snapshot_id;

    const outOfBounds = await handleAct(runtime, {
      snapshot_id: snapshotId,
      action: { type: "click", x: 100, y: 10 },
    });
    expect(outOfBounds.isError).toBe(true);
    expect(outOfBounds.structuredContent).not.toHaveProperty("snapshot_consumed");

    vi.useFakeTimers();
    const pending = handleAct(runtime, {
      snapshot_id: snapshotId,
      action: { type: "click", x: 10, y: 10 },
    });
    await vi.advanceTimersByTimeAsync(20_000);
    const timedOut = await pending;
    expect(timedOut).toMatchObject({
      isError: true,
      structuredContent: {
        code: "action_timeout",
        snapshot_consumed: true,
      },
    });
    expect(engine.executions).toHaveLength(1);

    const stale = await handleAct(runtime, {
      snapshot_id: snapshotId,
      action: { type: "wait", ms: 0 },
    });
    expect(stale).toMatchObject({ isError: true, structuredContent: { code: "stale_snapshot" } });
  });

  it("preserves the action result when only the next observation fails", async () => {
    const { runtime, engine } = fixtureRuntime({
      observationSequence: ["success", "capture_failed", "capture_failed"],
    });
    const observed = await runtime.observe();

    const result = await handleAct(runtime, {
      snapshot_id: observed.structured.snapshot_id,
      action: { type: "click", x: 10, y: 10 },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      next_state: "unavailable",
      action_result: { status: "executed" },
      verification: { status: "not_requested" },
      next_observation_error: { code: "capture_failed", recovery: "observe_desktop" },
    });
    expect(result.content.every((item) => item.type !== "image")).toBe(true);
    expect(engine.executions).toHaveLength(1);
  });

  it("returns stable safe fields for ComputerUseError without message or stack", async () => {
    const secret = "do-not-echo-private-input";
    const error = new ComputerUseError(
      "permission_required",
      `Permission denied while handling ${secret}`,
      "grant_permission",
      false,
    );
    const { runtime } = fixtureRuntime({ observationSequence: [error] });
    const client = await connectedClient(runtime);
    await client.listTools();

    const result = CallToolResultSchema.parse(
      await client.callTool({
        name: "computer_observe",
        arguments: {},
      }),
    );

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        code: "permission_required",
        recovery: "grant_permission",
        retryable: false,
      },
    });
    expect(result.content).toEqual([
      {
        type: "text",
        text: JSON.stringify({
          code: "permission_required",
          recovery: "grant_permission",
          retryable: false,
        }),
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("stack");
  });

  it("closes the runtime when its MCP transport closes", async () => {
    const { runtime, engine } = fixtureRuntime();
    const client = await connectedClient(runtime);

    await client.close();

    await vi.waitFor(() => {
      expect(engine.closes).toBe(1);
    });
  });
});
