import process from "node:process";

import { describe, expect, it, vi } from "vitest";

import { runCli } from "../../src/cli/main.js";
import { loadEngineLock } from "../../src/engine/lock.js";
import { FakeEngine } from "../helpers/fake-engine.js";

function commandFixture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const dependencies = {
    loadLock: loadEngineLock,
    downloader: { async download() {} },
    runner: {
      async run(command: string) {
        if (command === "/usr/bin/osascript") {
          return {
            code: 0,
            stdout: JSON.stringify({ bundleIdentifier: "com.apple.Finder" }),
            stderr: "",
          };
        }
        return {
          code: 0,
          stdout: JSON.stringify({
            accessibility: true,
            screen_recording: true,
            source: {
              attribution: "driver-daemon",
              bundle_id: "com.trycua.driver",
            },
          }),
          stderr: "",
        };
      },
    },
    connectEngine: vi.fn(async () => new FakeEngine({ platform: "macos" })),
    nodeExecutablePath: process.execPath,
    mcpScriptPath: "/fixture/dist/mcp/main.js",
    productOwnedPaths: [],
    async isEngineInstalled() { return true; },
    async runMcpServer() {},
    doctorOptions: { platform: "darwin" as const, arch: "arm64" },
  };
  return {
    stdout,
    stderr,
    dependencies,
    io: {
      stdout: { write(value: string) { stdout.push(value); } },
      stderr: { write(value: string) { stderr.push(value); } },
    },
  };
}

describe("computer-use doctor command", () => {
  it("prints concise human guidance for bare doctor", async () => {
    const fixture = commandFixture();

    const exitCode = await runCli(
      ["doctor"],
      fixture.io,
      fixture.dependencies,
    );

    expect(exitCode).toBe(0);
    expect(fixture.stdout.join("")).toContain("Computer Use 检查：通过");
    expect(fixture.stdout.join("")).not.toMatch(/^\s*\{/u);
    expect(fixture.stderr).toEqual([]);
  });

  it("keeps doctor --json stdout as one machine-readable report", async () => {
    const fixture = commandFixture();

    const exitCode = await runCli(
      ["doctor", "--json"],
      fixture.io,
      fixture.dependencies,
    );

    expect(exitCode).toBe(0);
    expect(fixture.stderr).toEqual([]);
    expect(fixture.stdout).toHaveLength(1);
    const report = JSON.parse(fixture.stdout[0]!) as Record<string, unknown>;
    expect(report).toMatchObject({
      ok: true,
      permissions: "granted",
      permission_details: {
        accessibility: "granted",
        screen_recording: "granted",
        source: "driver-daemon",
      },
    });
    expect(fixture.stdout[0]).not.toContain("Computer Use 检查");
  });

  it("rejects duplicate or unknown doctor flags", async () => {
    const fixture = commandFixture();

    await expect(
      runCli(["doctor", "--json", "--json"], fixture.io, fixture.dependencies),
    ).rejects.toThrow("invalid arguments");
    await expect(
      runCli(["doctor", "--verbose"], fixture.io, fixture.dependencies),
    ).rejects.toThrow("invalid arguments");
    expect(fixture.stdout).toEqual([]);
  });
});
