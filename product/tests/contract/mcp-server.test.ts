import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ComputerUseRuntime } from "../../src/core/runtime.js";
import { ComputerUseError } from "../../src/errors.js";
import { handleAct } from "../../src/mcp/handlers.js";
import { createComputerUseServer } from "../../src/mcp/server.js";
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
    expect(observed.isError).not.toBe(true);
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
      protocol_version: "1.1.0",
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
      protocol_version: "1.1.0",
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
