import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("repository checkout portability", () => {
  it("keeps executable and imported project text LF-only on every checkout", async () => {
    const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
    const portableFiles = [
      ".github/workflows/computer-use-ci.yml",
      "product/package.json",
      "product/scripts/verify-release.mjs",
      "product/tests/e2e/macos/run.sh",
      "product/tests/e2e/windows/run.ps1",
      "product/skills/computer-use/SKILL.md",
      "product/tests/contract/release.test.ts",
    ];
    const { stdout } = await execFileAsync(
      "git",
      ["check-attr", "eol", "--", ...portableFiles],
      { cwd: repositoryRoot },
    );

    const attributes = stdout.trim().split(/\r?\n/);
    expect(attributes).toHaveLength(portableFiles.length);
    expect(attributes.every((line) => line.endsWith(": eol: lf"))).toBe(true);
  });
});
