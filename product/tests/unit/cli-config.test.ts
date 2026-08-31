import { describe, expect, it } from "vitest";

import { renderConfig } from "../../src/cli/config.js";

const nodeExecutable = "/opt/node/bin/node";
const mcpScript = "/opt/universal-computer-use/dist/mcp/main.js";

describe("config", () => {
  it("prints deterministic generic JSON to stdout only", () => {
    const output = renderConfig("generic", nodeExecutable, mcpScript);

    expect(output.stdout).toBe(
      `${JSON.stringify(
        {
          mcpServers: {
            "computer-use": { command: nodeExecutable, args: [mcpScript] },
          },
        },
        null,
        2,
      )}\n`,
    );
    expect(JSON.parse(output.stdout)).toEqual({
      mcpServers: {
        "computer-use": { command: nodeExecutable, args: [mcpScript] },
      },
    });
    expect(output.stderr).toBe(
      "This plugin uses the host Agent's current multimodal model; it does not configure a model or API key.\n",
    );
  });

  it.each([
    ["codex", `codex mcp add computer-use -- "${nodeExecutable}" "${mcpScript}"\n`],
    ["kimi", `kimi mcp add computer-use -- "${nodeExecutable}" "${mcpScript}"\n`],
  ] as const)("prints the exact %s registration command", (client, expected) => {
    const output = renderConfig(client, nodeExecutable, mcpScript);
    expect(output.stdout).toBe(expected);
    expect(output.stderr).toBe(
      "This plugin uses the host Agent's current multimodal model; it does not configure a model or API key.\n",
    );
  });

  it.each(["hanaagent", "workbuddy"] as const)(
    "prints absolute stdio JSON and named manual-registration guidance for %s",
    (client) => {
      const output = renderConfig(client, nodeExecutable, mcpScript);

      expect(JSON.parse(output.stdout)).toEqual({
        mcpServers: {
          "computer-use": {
            command: nodeExecutable,
            args: [mcpScript],
          },
        },
      });
      expect(output.stdout).toBe(
        `${JSON.stringify(
          {
            mcpServers: {
              "computer-use": {
                command: nodeExecutable,
                args: [mcpScript],
              },
            },
          },
          null,
          2,
        )}\n`,
      );
      expect(output.stdout).not.toMatch(
        /model|api[_ -]?key|credential|CuaDriver|cua-driver|Control loop/i,
      );
      const guidance = output.stderr.toLowerCase();
      expect(guidance).toContain(client);
      expect(guidance).toContain("manual");
      expect(guidance).toContain("restart");
      expect(guidance).toContain("new conversation");
      expect(output.stderr).toContain("skills/computer-use/SKILL.md");
      expect(output.stderr).toContain("computer_observe");
      expect(output.stderr).toContain("computer_act");
      expect(output.stderr).not.toContain(nodeExecutable);
      expect(output.stderr).not.toContain(mcpScript);
    },
  );

  it("keeps Windows backslashes intact while quoting two independent argv", () => {
    expect(
      renderConfig(
        "codex",
        "C:\\Program Files\\nodejs\\node.exe",
        "C:\\Program Files\\computer-use\\dist\\mcp\\main.js",
      ).stdout,
    ).toBe(
      'codex mcp add computer-use -- "C:\\Program Files\\nodejs\\node.exe" "C:\\Program Files\\computer-use\\dist\\mcp\\main.js"\n',
    );
  });

  it.each([
    ["node", "node", mcpScript],
    ["MCP script", nodeExecutable, "dist/mcp/main.js"],
  ])("rejects a non-absolute %s path", (_label, nodePath, scriptPath) => {
    expect(() => renderConfig("generic", nodePath, scriptPath)).toThrow(
      "absolute Node executable and MCP script paths required",
    );
  });
});
