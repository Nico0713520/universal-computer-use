import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const sourceMapUrl = new URL("../../../docs/upstream-sources.md", import.meta.url);

async function readSourceMap(): Promise<string> {
  return readFile(sourceMapUrl, "utf8");
}

describe("upstream source map", () => {
  it("pins every reviewed source and its SPDX license", async () => {
    const sourceMap = await readSourceMap();

    expect(sourceMap).toContain("c60ef6ad2db8774fb342938843e2f17f26c68240");
    expect(sourceMap).toContain("90295148d34dac8e5a1307bac917e08171af5839");
    expect(sourceMap).toContain("c2ad42e3eb9b27830db41a3e6f51ca7179d9b168");
    expect(sourceMap).toContain("10cdae4a3c30a29c6e96c8ec14e6bf1c5f02940e");
    expect(sourceMap).toMatch(/## Cua Driver[\s\S]*?SPDX：`MIT`[\s\S]*?## UI-TARS Desktop/);
    expect(sourceMap).toMatch(
      /## UI-TARS Desktop[\s\S]*?SPDX：`Apache-2\.0`[\s\S]*?## OpenAI Agents SDK/,
    );
    expect(sourceMap).toMatch(/## OpenAI Agents SDK[\s\S]*?SPDX：`MIT`/);
  });

  it("declares the complete adoption vocabulary and bans floating or native-copy policy", async () => {
    const sourceMap = await readSourceMap();

    for (const label of [
      "dependency",
      "adapt",
      "test-pattern",
      "reference-only",
      "forbidden",
    ]) {
      expect(sourceMap).toContain(`\`${label}\``);
    }
    expect(sourceMap).not.toContain("copy Cua Rust");
    expect(sourceMap).not.toContain("follow latest");
  });
});
