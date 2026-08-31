import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

async function read(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), "utf8");
}

describe("v0.2.7 Mac Agent Preview documentation", () => {
  it("states the preview, packaging, attribution, and serial-control boundaries", async () => {
    const [root, product, compatibility, troubleshooting] = await Promise.all([
      read("../../../README.md"),
      read("../../README.md"),
      read("../../../docs/host-compatibility.md"),
      read("../../../docs/troubleshooting.md"),
    ]);
    const combined = [root, product, compatibility, troubleshooting].join("\n");

    expect(root).toContain("Mac Agent Preview");
    expect(root).toContain("not a public Beta");
    expect(root).toContain("There is no one-click installer, DMG, or notarized public package");
    expect(product).toContain("Mac Agent Preview (Developer Preview)");
    expect(combined).toContain("direct stdio");
    expect(combined).toContain("Canonical Computer Use Skill");
    expect(combined).toContain("exactly two tools");
    expect(combined).toContain("does not include an internal vision model");
    expect(combined).toContain("Multi-Agent concurrent control is deferred");
    expect(combined).toContain("one host at a time");
    expect(combined).toContain("Adaptive Cursor");
    expect(combined).toContain("`auto`");
    expect(combined).toContain("`visible`");
    expect(combined).toContain("`hidden`");
    expect(combined).toContain("no artificial post-action delay");
    expect(combined).not.toMatch(/\bp(?:50|95)\b|faster path|faster route|quicker path|lower latency|more performant/i);
  });

  it("documents signed-daemon permissions, both doctor modes, and named manual host setup", async () => {
    const [macos, troubleshooting] = await Promise.all([
      read("../../../docs/installation/macos.md"),
      read("../../../docs/troubleshooting.md"),
    ]);
    const combined = `${macos}\n${troubleshooting}`;

    expect(combined).toContain("permissions status --json");
    expect(combined).toContain("local app verification");
    expect(combined).toContain("driver-daemon attribution");
    expect(combined).toContain("before any Cua connection, session, tool, cursor operation");
    expect(combined).toContain("runtime_missing");
    expect(combined).toContain("computer-use doctor\n");
    expect(combined).toContain("computer-use doctor --json");
    expect(macos).toContain("computer-use config --client hanaagent");
    expect(macos).toContain("computer-use config --client workbuddy");
    expect(macos).toContain("Restart the selected host and start a new conversation");
    expect(macos).toContain("direct stdio");
    expect(macos).toContain("Canonical Computer Use Skill");
    expect(combined).toContain("visible CuaDriver attribution");
    expect(combined).toContain("one bounded startup attempt");
    expect(combined).toContain("before any diagnostic session or MCP request");
    expect(combined).toContain("does not install or upgrade");
    expect(combined).toContain("never restarts Cua after an MCP session starts");
    expect(combined).not.toMatch(/doctor[^\n.]*(?:do not start the Runtime|no startup repair)/iu);
  });

  it("keeps named hosts unverified until exact-commit external reports pass", async () => {
    const compatibility = await read("../../../docs/host-compatibility.md");

    expect(compatibility).toMatch(/^\| Codex \| not-tested \|/m);
    expect(compatibility).toMatch(/^\| HanaAgent \| not-tested \|/m);
    expect(compatibility).toMatch(/^\| WorkBuddy \| experimental \|/m);
    expect(compatibility).toContain("exact-commit external report");
    expect(compatibility).not.toMatch(/^\| (?:Codex|HanaAgent|WorkBuddy) \| verified \|/m);
  });

  it("uses the silent public prompt renderer in package-facing docs", async () => {
    const [root, product] = await Promise.all([
      read("../../../README.md"),
      read("../../README.md"),
    ]);

    for (const document of [root, product]) {
      expect(document).toContain("pnpm --silent host:test-prompt");
      expect(document).not.toMatch(/(?<!\-silent )pnpm host:test-prompt/);
    }
  });

  it("documents an executable exact-source Windows development install instead of a registry release", async () => {
    const windows = await read("../../../docs/installation/windows.md");

    expect(windows).toContain("$commit = \"<40-lowercase-hex-commit>\"");
    expect(windows).toContain("@(\"checkout\", \"--detach\", $commit)");
    expect(windows).toContain("@(\"rev-parse\", \"HEAD\")");
    expect(windows).toContain("$ErrorActionPreference = \"Stop\"");
    expect(windows).toContain("function Invoke-NativeChecked");
    expect(windows).toContain("if ($LASTEXITCODE -ne 0)");
    expect(windows).toContain("@(\"status\", \"--porcelain\")");
    expect(windows).toContain("@(\"--yes\", \"pnpm@9.0.4\", \"build\")");
    expect(windows).toContain("@(\"pack\", \"--json\")");
    expect(windows).toContain("$packJsonText = $packJson -join [Environment]::NewLine");
    expect(windows).toContain("$packResult = @($packJsonText | ConvertFrom-Json)");
    expect(windows).toContain("$packagePath");
    expect(windows).toContain("Test-Path -LiteralPath $packagePath");
    expect(windows).not.toContain("npm install --global .\\universal-computer-use-plugin-0.2.7.tgz");
    expect(windows).toContain("@(\"setup\", \"--development\")");
    expect(windows).toContain("@(\"doctor\", \"--json\")");
    expect(windows).not.toContain("npm install --global @universal-computer-use/plugin");
    expect(windows).not.toMatch(/^computer-use setup$/m);
    expect(windows).not.toContain("npm update --global @universal-computer-use/plugin");
  });
});
