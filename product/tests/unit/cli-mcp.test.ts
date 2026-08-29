import process from "node:process";

import { describe, expect, it, vi } from "vitest";

import { runCli } from "../../src/cli/main.js";
import { CuaEngine } from "../../src/engine/cua.js";
import { loadEngineLock } from "../../src/engine/lock.js";
import { FakeEngine } from "../helpers/fake-engine.js";

describe("computer-use mcp", () => {
  it("uses production metadata logging without writing telemetry to MCP stdout", async () => {
    const stdout: string[] = [];
    const cliStderr: string[] = [];
    const processStderr: string[] = [];
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      processStderr.push(String(chunk));
      return true;
    });
    const engine = new FakeEngine();

    try {
      const exitCode = await runCli(
        ["mcp"],
        {
          stdout: { write: (value) => { stdout.push(value); } },
          stderr: { write: (value) => { cliStderr.push(value); } },
        },
        {
          loadLock: loadEngineLock,
          downloader: { async download() {} },
          runner: { async run() { return { code: 0, stdout: "", stderr: "" }; } },
          connectEngine: async () => engine as unknown as CuaEngine,
          nodeExecutablePath: process.execPath,
          mcpScriptPath: "/fixture/dist/mcp/main.js",
          productOwnedPaths: [],
          async isEngineInstalled() { return true; },
          async runMcpServer(runtime) {
            await runtime.observe();
            await runtime.close();
          },
        },
      );

      expect(exitCode).toBe(0);
      expect(stdout).toEqual([]);
      expect(cliStderr).toEqual([]);
      const logLines = processStderr.join("").trim().split("\n").filter(Boolean);
      expect(logLines).toHaveLength(1);
      const record = JSON.parse(logLines[0]!) as Record<string, unknown>;
      expect(record).toMatchObject({
        tool_name: "computer_observe",
        timings: {
          queue_wait_ms: expect.any(Number),
          post_action_observe_ms: expect.any(Number),
          projection_ms: expect.any(Number),
          tool_total_ms: expect.any(Number),
        },
      });
      expect(JSON.stringify(record)).not.toContain(engine.sessionId);
    } finally {
      stderrWrite.mockRestore();
    }
  });
});
