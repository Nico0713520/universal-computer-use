import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const artifactUrls = {
  generic: new URL("../../integrations/generic/mcp.json", import.meta.url),
  codex: new URL("../../integrations/codex/README.md", import.meta.url),
  kimi: new URL("../../integrations/kimi/README.md", import.meta.url),
  compatibility: new URL("../../../docs/host-compatibility.md", import.meta.url),
} as const;

async function readArtifacts(): Promise<Record<keyof typeof artifactUrls, string>> {
  const entries = await Promise.all(
    Object.entries(artifactUrls).map(async ([name, url]) => [name, await readFile(url, "utf8")]),
  );
  return Object.fromEntries(entries) as Record<keyof typeof artifactUrls, string>;
}

describe("host integration artifacts", () => {
  it("ships one portable generic MCP launch configuration", async () => {
    const { generic } = await readArtifacts();

    expect(JSON.parse(generic)).toEqual({
      mcpServers: {
        "computer-use": {
          command: "computer-use-mcp",
          args: [],
        },
      },
    });
  });

  it.each(["codex", "kimi"] as const)(
    "%s installs the canonical Skill and generates an absolute production command",
    async (host) => {
      const artifacts = await readArtifacts();
      const readme = artifacts[host];

      expect(readme).toContain("../../skills/computer-use/SKILL.md");
      expect(readme).toContain(`computer-use config --client ${host}`);
      expect(readme).toContain("absolute Node executable");
      expect(readme).toContain("absolute MCP script");
      expect(readme).toContain("computer_observe");
      expect(readme).toContain("computer_act");
      expect(readme).not.toContain("## Control loop");
    },
  );

  it("keeps model-provider configuration out of every integration artifact", async () => {
    const artifacts = await readArtifacts();
    const combined = Object.values(artifacts).join("\n");

    for (const forbidden of [
      /api[_ -]?key/i,
      /tokenhub/i,
      /base[_ -]?url/i,
      /model[_ -]?endpoint/i,
      /provider[_ -]?sdk/i,
      /["']model["']\s*:/i,
    ]) {
      expect(combined).not.toMatch(forbidden);
    }
  });

  it("uses the frozen compatibility vocabulary and records every evidence dimension", async () => {
    const { compatibility } = await readArtifacts();
    const rows = compatibility
      .split(/\r?\n/)
      .filter((line) => /^\| (Generic MCP|Codex|Kimi) \|/.test(line))
      .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row[0])).toEqual(["Generic MCP", "Codex", "Kimi"]);
    for (const row of rows) {
      expect(row).toHaveLength(9);
      expect(["verified", "experimental", "not-compatible", "not-tested"]).toContain(row[1]);
    }
    for (const heading of [
      "Evidence date",
      "OS",
      "Host version",
      "Image delivery",
      "Continuous loop",
      "Automatic mode",
      "Limitation",
    ]) {
      expect(compatibility).toContain(heading);
    }
    expect(compatibility).not.toMatch(/\| verified \|/);
  });
});
