import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ComputerUseRuntime } from "../core/runtime.js";
import {
  ActInputSchema,
  ActOutputSchema,
  ObservationOutputSchema,
  ObserveInputSchema,
} from "../protocol.js";
import { PRODUCT_VERSION } from "../version.js";
import { handleAct, handleObserve } from "./handlers.js";

export function createComputerUseServer(runtime: ComputerUseRuntime): McpServer {
  const server = new McpServer({
    name: "universal-computer-use",
    version: PRODUCT_VERSION,
  });

  server.registerTool(
    "computer_observe",
    {
      description:
        "Capture the primary display and establish the only current actionable snapshot.",
      inputSchema: ObserveInputSchema,
      outputSchema: ObservationOutputSchema,
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
        "Execute one screenshot-bound desktop action and return a fresh primary-display screenshot.",
      inputSchema: ActInputSchema,
      outputSchema: ActOutputSchema,
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
