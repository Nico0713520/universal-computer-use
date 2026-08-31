import process from "node:process";

import { describe, expect, it, vi } from "vitest";

import { runCli } from "../../src/cli/main.js";
import type { ProcessRunner } from "../../src/cli/process-runner.js";
import { loadEngineLock } from "../../src/engine/lock.js";
import { FakeEngine } from "../helpers/fake-engine.js";

function commandFixture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const runner: ProcessRunner = {
    async run(command) {
      if (command === "/usr/bin/osascript") {
        return {
          code: 0,
          stdout: JSON.stringify({ bundleIdentifier: "com.apple.Finder" }),
          stderr: "",
        };
      }
      if (command === "/usr/bin/codesign") {
        return {
          code: 0,
          stdout: "",
          stderr: "Identifier=com.trycua.driver",
        };
      }
      if (command === "/usr/sbin/spctl") {
        return { code: 0, stdout: "", stderr: "" };
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
  };
  const dependencies = {
    loadLock: loadEngineLock,
    downloader: { async download() {} },
    runner,
    connectEngine: vi.fn(async () => new FakeEngine({ platform: "macos" })),
    nodeExecutablePath: process.execPath,
    mcpScriptPath: "/fixture/dist/mcp/main.js",
    productOwnedPaths: [],
    async accessRuntimePath() {},
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
  it("reports a missing fixed macOS app before signature, permission, or Runtime connection", async () => {
    const fixture = commandFixture();
    const engine = new FakeEngine({ platform: "macos" });
    const runs: string[] = [];
    fixture.dependencies.connectEngine = vi.fn(async () => engine);
    fixture.dependencies.runner = {
      async run(command, args) {
        runs.push(`${command} ${args.join(" ")}`);
        return {
          code: 0,
          stdout: JSON.stringify({ bundleIdentifier: "com.apple.Finder" }),
          stderr: "",
        };
      },
    };
    fixture.dependencies.accessRuntimePath = vi.fn(async () => {
      throw new Error("ENOENT");
    });

    const exitCode = await runCli(["doctor", "--json"], fixture.io, fixture.dependencies);

    expect(exitCode).toBe(1);
    expect(JSON.parse(fixture.stdout[0]!)).toMatchObject({
      ok: false,
      engine_connected: false,
      error: {
        code: "runtime_missing",
        diagnostic_reason: "runtime_missing",
      },
    });
    expect(fixture.dependencies.connectEngine).not.toHaveBeenCalled();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatch(/^\/usr\/bin\/osascript /u);
    expect(engine.observations).toBe(0);
  });

  it("short-circuits permission and observation when the local CuaDriver signature fails", async () => {
    const fixture = commandFixture();
    const engine = new FakeEngine({ platform: "macos" });
    const runs: string[] = [];
    fixture.dependencies.connectEngine = vi.fn(async () => engine);
    fixture.dependencies.runner = {
      async run(command, args) {
        runs.push(`${command} ${args.join(" ")}`);
        if (command === "/usr/bin/osascript") {
          return {
            code: 0,
            stdout: JSON.stringify({ bundleIdentifier: "com.apple.Finder" }),
            stderr: "",
          };
        }
        if (command === "/usr/bin/codesign") {
          return { code: 1, stdout: "", stderr: "rejected" };
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
    };

    const exitCode = await runCli(["doctor", "--json"], fixture.io, fixture.dependencies);

    expect(exitCode).toBe(1);
    expect(JSON.parse(fixture.stdout[0]!)).toMatchObject({
      ok: false,
      error: {
        code: "engine_version_mismatch",
        diagnostic_reason: "runtime_signature_mismatch",
      },
    });
    expect(runs.some((value) => value.includes("permissions status --json"))).toBe(false);
    expect(fixture.dependencies.connectEngine).not.toHaveBeenCalled();
    expect(engine.observations).toBe(0);
  });

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

  it("accepts a cursor mode and reports the effective diagnostic mode", async () => {
    const fixture = commandFixture();
    const connectEngine = vi.fn(async () => new FakeEngine({ platform: "macos" }));
    fixture.dependencies.connectEngine = connectEngine;

    const exitCode = await runCli(
      ["doctor", "--json", "--cursor", "hidden"],
      fixture.io,
      fixture.dependencies,
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(fixture.stdout[0]!)).toMatchObject({
      cursor_mode: "hidden",
      cursor_ready: true,
    });
    expect(connectEngine).toHaveBeenCalledWith(expect.anything(), {
      cursorMode: "hidden",
    });
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
