import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

import { createMetadataLogger } from "../../src/logging/logger.js";
import { createComputerUseServer } from "../../src/mcp/server.js";
import { fixtureRuntime } from "../helpers/fake-engine.js";

describe("metadata logging public surface", () => {
  it("does not add logging data or tools to MCP responses", async () => {
    const logLines: string[] = [];
    const logger = createMetadataLogger({ write: (line) => logLines.push(line) });
    logger.log({
      sessionId: "private-session",
      snapshotId: "private-snapshot",
      toolName: "computer_observe",
      durationMs: 12,
    });

    const { runtime } = fixtureRuntime({ dataBase64: "cG5nLWZpeHR1cmU=" });
    const server = createComputerUseServer(runtime);
    const client = new Client({ name: "logging-contract-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const { tools } = await client.listTools();
      expect(tools.map(({ name }) => name)).toEqual([
        "computer_observe",
        "computer_act",
      ]);

      const observed = CallToolResultSchema.parse(
        await client.callTool({ name: "computer_observe", arguments: {} }),
      );
      expect(Object.keys(observed).sort()).toEqual(["content", "structuredContent"]);
      expect(observed.content.map(({ type }) => type)).toEqual(["text", "image"]);
      expect(Object.keys(observed.structuredContent ?? {}).sort()).toEqual([
        "coordinate_space",
        "display_id",
        "engine",
        "platform",
        "protocol_version",
        "screenshot",
        "session_id",
        "snapshot_id",
        "target",
      ]);
      expect(JSON.stringify(observed)).not.toContain("session_id_hash");
      expect(JSON.stringify(observed)).not.toContain("timestamp");
      expect(logLines).toHaveLength(1);
    } finally {
      await client.close();
      await server.close();
      await runtime.close();
    }
  });
});
