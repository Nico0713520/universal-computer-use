import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const artifactUrls = {
  workbuddyManifest: new URL(
    "../../integrations/workbuddy/.codebuddy-plugin/plugin.json",
    import.meta.url,
  ),
  workbuddyMcpExample: new URL(
    "../../integrations/workbuddy/mcp.example.json",
    import.meta.url,
  ),
  deepseekPackage: new URL(
    "../../integrations/deepseek-harness/package.json",
    import.meta.url,
  ),
  deepseekModule: new URL("../../integrations/deepseek-harness/index.js", import.meta.url),
  deepseekCordis: new URL(
    "../../integrations/deepseek-harness/cordis.patch.yml",
    import.meta.url,
  ),
  canonicalSkill: new URL("../../skills/computer-use/SKILL.md", import.meta.url),
  compatibility: new URL("../../../docs/host-compatibility.md", import.meta.url),
} as const;

const publicTools = ["computer_observe", "computer_act"];
const canonicalSkillReference = "../../skills/computer-use/SKILL.md";

async function readArtifacts() {
  const entries = await Promise.all(
    Object.entries(artifactUrls).map(async ([name, url]) => [
      name,
      (await readFile(url, "utf8")).replace(/\r\n/g, "\n"),
    ]),
  );
  return Object.fromEntries(entries) as Record<keyof typeof artifactUrls, string>;
}

describe("experimental host adapters", () => {
  it("keeps WorkBuddy as a data-only wrapper around the canonical MCP and Skill", async () => {
    const artifacts = await readArtifacts();
    const manifest = JSON.parse(artifacts.workbuddyManifest) as Record<string, unknown>;
    const mcp = JSON.parse(artifacts.workbuddyMcpExample) as Record<string, unknown>;

    expect(manifest).toMatchObject({
      name: "computer-use",
      version: "0.2.6",
      status: "experimental",
      computerUse: {
        skill: canonicalSkillReference,
        tools: publicTools,
      },
    });
    expect(mcp).toEqual({
      mcpServers: {
        "computer-use": {
          command: "/replace/with/absolute/path/to/node",
          args: [
            "/replace/with/absolute/path/to/universal-computer-use/product/dist/mcp/main.js",
          ],
        },
      },
    });
  });

  it("keeps the DeepSeek Harness module dependency-free and declarative", async () => {
    const artifacts = await readArtifacts();
    const packageManifest = JSON.parse(artifacts.deepseekPackage) as Record<string, unknown>;
    const adapter = (await import(artifactUrls.deepseekModule.href)) as {
      default: {
        status: string;
        skill: string;
        tools: string[];
        mcpServers: Record<string, { command: string; args: string[] }>;
      };
    };

    expect(packageManifest).toMatchObject({
      name: "@universal-computer-use/deepseek-harness-adapter",
      private: true,
      type: "module",
      main: "index.js",
      status: "experimental",
    });
    expect(packageManifest).not.toHaveProperty("dependencies");
    expect(packageManifest).not.toHaveProperty("devDependencies");
    expect(adapter.default).toEqual({
      status: "experimental",
      skill: canonicalSkillReference,
      tools: publicTools,
      mcpServers: {
        "computer-use": {
          command: "computer-use-mcp",
          args: [],
        },
      },
    });
  });

  it("keeps the Cordis patch limited to the same executable, Skill and two tools", async () => {
    const { deepseekCordis } = await readArtifacts();

    expect(deepseekCordis).toContain("status: experimental");
    expect(deepseekCordis).toContain(`skill: ${canonicalSkillReference}`);
    expect(deepseekCordis).toContain("command: computer-use-mcp");
    expect(deepseekCordis.match(/^\s*- computer_(?:observe|act)$/gm)).toEqual([
      "    - computer_observe",
      "    - computer_act",
    ]);
    expect(deepseekCordis.match(/^\s*command:/gm)).toHaveLength(1);
  });

  it("references the existing canonical Skill instead of copying its loop", async () => {
    const artifacts = await readArtifacts();

    expect(artifacts.canonicalSkill).toContain("## Control loop");
    for (const content of [
      artifacts.workbuddyManifest,
      artifacts.workbuddyMcpExample,
      artifacts.deepseekPackage,
      artifacts.deepseekModule,
      artifacts.deepseekCordis,
    ]) {
      expect(content).not.toContain("## Control loop");
      expect(content).not.toContain("Before your first action call");
    }
    expect(artifacts.workbuddyManifest).toContain(canonicalSkillReference);
    expect(artifacts.deepseekModule).toContain(canonicalSkillReference);
    expect(artifacts.deepseekCordis).toContain(canonicalSkillReference);
  });

  it("contains no model, credential, analyzer, subprocess or alternate protocol surface", async () => {
    const artifacts = await readArtifacts();
    const adapterContent = [
      artifacts.workbuddyManifest,
      artifacts.workbuddyMcpExample,
      artifacts.deepseekPackage,
      artifacts.deepseekModule,
      artifacts.deepseekCordis,
    ].join("\n");

    for (const forbidden of [
      /api[_ -]?key/i,
      /tokenhub/i,
      /base[_ -]?url/i,
      /model[_ -]?(?:client|endpoint|name)/i,
      /["']model["']\s*:/i,
      /\bvision\b/i,
      /provider[_ -]?sdk/i,
      /image[_ -]?(?:analy[sz]er|classifier)/i,
      /internal[_ -]?loop/i,
      /actions\s*\[\s*\]/i,
      /action[_ -]?schema/i,
      /computer_verify/i,
      /child_process/i,
      /\bspawn\s*\(/i,
      /\bexec(?:File)?\s*\(/i,
    ]) {
      expect(adapterContent).not.toMatch(forbidden);
    }
  });

  it("labels both unevidenced hosts experimental in the compatibility matrix", async () => {
    const { compatibility } = await readArtifacts();
    const rows = compatibility
      .split(/\r?\n/)
      .filter((line) => /^\| (WorkBuddy|DeepSeek Harness) \|/.test(line))
      .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));

    expect(rows.map((row) => [row[0], row[1]])).toEqual([
      ["WorkBuddy", "experimental"],
      ["DeepSeek Harness", "experimental"],
    ]);
    for (const row of rows) {
      expect(row).toHaveLength(9);
      expect(row[2]).toBe("—");
      expect(row[4]).toBe("—");
      expect(row[5]).toBe("not-tested");
      expect(row[6]).toBe("not-tested");
      expect(row[7]).toBe("not-tested");
      expect(row[8]).toMatch(
        row[0] === "WorkBuddy"
          ? /exact-commit external|host loading/i
          : /declaration-only|host loading/i,
      );
    }
    expect(compatibility).not.toMatch(/\| (?:WorkBuddy|DeepSeek Harness) \| verified \|/);
  });
});
