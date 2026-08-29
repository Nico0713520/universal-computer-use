import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ComputerUseRuntime } from "../core/runtime.js";
import {
  ActInputSchema,
  ActToolMcpOutputSchema,
  ObserveInputSchema,
  ObserveToolMcpOutputSchema,
} from "../protocol.js";
import { PRODUCT_VERSION } from "../version.js";
import { handleAct, handleObserve } from "./handlers.js";
import { MCP_SERVER_INSTRUCTIONS } from "./instructions.js";

export function createComputerUseServer(runtime: ComputerUseRuntime): McpServer {
  const server = new McpServer({
    name: "universal-computer-use",
    version: PRODUCT_VERSION,
  }, {
    instructions: MCP_SERVER_INSTRUCTIONS,
  });

  server.registerTool(
    "computer_observe",
    {
      description:
        "Observe the requested desktop or exact-window target state and create a one-use actionable snapshot.",
      inputSchema: ObserveInputSchema,
      outputSchema: ObserveToolMcpOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (input) => handleObserve(runtime, input),
  );

  server.registerTool(
    "computer_act",
    {
      description:
        "Execute one snapshot-bound action and return the fresh target state; next_observation may request a safe semantic next state.",
      inputSchema: ActInputSchema,
      outputSchema: ActToolMcpOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (input) => handleAct(runtime, input),
  );

  server.server.onclose = () => {
    void runtime.close().catch(() => undefined);
  };

  return server;
}
