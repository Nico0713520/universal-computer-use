import { describe, expect, it, vi } from "vitest";

import { runCli, serializeCliFailure } from "../../src/cli/main.js";
import { loadEngineLock } from "../../src/engine/lock.js";
import { FakeEngine } from "../helpers/fake-engine.js";

const nodeExecutablePath = "/opt/node/bin/node";
const mcpScriptPath = "/opt/universal-computer-use/dist/mcp/main.js";

function commandFixture(
  mcpScriptBuilt = true,
  builtMcpScriptPath = mcpScriptPath,
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const runner = { run: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })) };
  const dependencies = {
    loadLock: loadEngineLock,
    downloader: { async download() {} },
    runner,
    async accessRuntimePath() {},
    connectEngine: vi.fn(async () => new FakeEngine()),
    nodeExecutablePath,
    mcpScriptPath: builtMcpScriptPath,
    mcpScriptExists: vi.fn(async () => mcpScriptBuilt),
    productOwnedPaths: [],
    async isEngineInstalled() { return true; },
    async runMcpServer() {},
  };
  return {
    stdout,
    stderr,
    runner,
    dependencies,
    io: {
      stdout: { write(value: string) { stdout.push(value); } },
      stderr: { write(value: string) { stderr.push(value); } },
    },
  };
}

describe("computer-use config command", () => {
  it("lists all five supported config clients in help", async () => {
    const stdout: string[] = [];

    await runCli(["--help"], {
      stdout: { write(value: string) { stdout.push(value); } },
      stderr: { write() {} },
    });

    expect(stdout.join("")).toContain(
      "computer-use config --client generic|codex|kimi|hanaagent|workbuddy",
    );
  });

  it.each(["hanaagent", "workbuddy"] as const)(
    "prints clean %s JSON without running or editing anything",
    async (client) => {
      const fixture = commandFixture();

      const exitCode = await runCli(
        ["config", "--client", client],
        fixture.io,
        fixture.dependencies,
      );

      expect(exitCode).toBe(0);
      expect(fixture.stdout).toHaveLength(1);
      expect(JSON.parse(fixture.stdout[0]!)).toEqual({
        mcpServers: {
          "computer-use": {
            command: nodeExecutablePath,
            args: [mcpScriptPath],
          },
        },
      });
      expect(fixture.stderr.join("").toLowerCase()).toContain(client);
      expect(fixture.runner.run).not.toHaveBeenCalled();
    },
  );

  it("fails closed when the built MCP entrypoint is missing", async () => {
    const sensitivePath = "/Users/alice/secret/path/dist/mcp/main.js";
    const fixture = commandFixture(false, sensitivePath);

    let failure: unknown;
    try {
      await runCli(
        ["config", "--client", "hanaagent"],
        fixture.io,
        fixture.dependencies,
      );
    } catch (error) {
      failure = error;
    }
    const serialized = serializeCliFailure(failure);

    expect(serialized).toEqual({
      ok: false,
      error: {
        code: "command_failed",
        message: "MCP build output is missing. Run the package build before generating host configuration.",
      },
    });
    expect(JSON.stringify(serialized)).not.toMatch(/\/Users\/alice|secret|\/path|mcp\.main\.js/iu);
    expect(fixture.stdout).toEqual([]);
    expect(fixture.stderr).toEqual([]);
    expect(fixture.runner.run).not.toHaveBeenCalled();
  });

  it("rejects unknown clients without polluting stdout", async () => {
    const fixture = commandFixture();

    await expect(
      runCli(["config", "--client", "unknown"], fixture.io, fixture.dependencies),
    ).rejects.toThrow("unsupported config client: unknown");
    expect(fixture.stdout).toEqual([]);
    expect(fixture.stderr).toEqual([]);
  });
});
