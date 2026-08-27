import { describe, expect, it } from "vitest";

import { renderConfig } from "../../src/cli/config.js";

const binary = "/opt/universal-computer-use/bin/computer-use-mcp";

describe("config", () => {
  it("prints deterministic generic JSON to stdout only", () => {
    const output = renderConfig("generic", binary);

    expect(output.stdout).toBe(
      `${JSON.stringify(
        {
          mcpServers: {
            "computer-use": { command: binary, args: [] },
          },
        },
        null,
        2,
      )}\n`,
    );
    expect(JSON.parse(output.stdout)).toEqual({
      mcpServers: {
        "computer-use": { command: binary, args: [] },
      },
    });
    expect(output.stderr).toContain("host Agent's current multimodal model");
  });

  it.each([
    ["codex", `codex mcp add computer-use -- ${binary}\n`],
    ["kimi", `kimi mcp add computer-use -- ${binary}\n`],
  ] as const)("prints the exact %s registration command", (client, expected) => {
    const output = renderConfig(client, binary);
    expect(output.stdout).toBe(expected);
    expect(output.stderr).not.toContain(binary);
  });

  it("rejects a non-absolute MCP executable path", () => {
    expect(() => renderConfig("generic", "dist/mcp/main.js")).toThrow(
      "absolute MCP executable path required",
    );
  });
});
