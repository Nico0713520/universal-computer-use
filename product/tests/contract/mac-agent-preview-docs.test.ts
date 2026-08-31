import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

async function read(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), "utf8");
}

describe("v0.2.6 Mac Agent Preview documentation", () => {
  it("states the preview, packaging, attribution, and serial-control boundaries", async () => {
    const [root, product, compatibility] = await Promise.all([
      read("../../../README.md"),
      read("../../README.md"),
      read("../../../docs/host-compatibility.md"),
    ]);
    const combined = [root, product, compatibility].join("\n");

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
    expect(combined).not.toMatch(/\bp(?:50|95)\b/i);
  });

  it("documents signed-daemon permissions, both doctor modes, and named manual host setup", async () => {
    const [macos, troubleshooting] = await Promise.all([
      read("../../../docs/installation/macos.md"),
      read("../../../docs/troubleshooting.md"),
    ]);
    const combined = `${macos}\n${troubleshooting}`;

    expect(combined).toContain("permissions status --json");
    expect(combined).toContain("signed CuaDriver");
    expect(combined).toContain("computer-use doctor\n");
    expect(combined).toContain("computer-use doctor --json");
    expect(macos).toContain("computer-use config --client hanaagent");
    expect(macos).toContain("computer-use config --client workbuddy");
    expect(macos).toContain("Restart the selected host and start a new conversation");
    expect(macos).toContain("direct stdio");
    expect(macos).toContain("Canonical Computer Use Skill");
    expect(combined).toContain("visible CuaDriver attribution");
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
});
