import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import process from "node:process";

import { describe, expect, it, vi } from "vitest";

import { runCli } from "../../src/cli/main.js";
import { loadEngineLock } from "../../src/engine/lock.js";
import { FakeEngine } from "../helpers/fake-engine.js";

describe("computer-use setup command diagnostic wiring", () => {
  it("uses the shared signed permission adapter and independent diagnostic connector without GUI", async () => {
    const lock = structuredClone(await loadEngineLock());
    const bytes = new Map<string, string>();
    for (const file of lock.platforms.macos.installer_files) {
      const value = `fixture:${file.name}`;
      bytes.set(file.name, value);
      file.sha256 = createHash("sha256").update(value).digest("hex");
    }

    const runs: Array<{
      command: string;
      args: readonly string[];
      timeoutMs: number;
      terminateTree?: boolean;
      terminationGraceMs?: number;
    }> = [];
    const runner = {
      async run(
        command: string,
        args: string[],
        options: {
          timeoutMs: number;
          terminateTree?: boolean;
          terminationGraceMs?: number;
        },
      ) {
        runs.push({ command, args, ...options });
        if (command === "/usr/bin/codesign" && args.includes("-dv")) {
          return {
            code: 0,
            stdout: "Identifier=com.trycua.driver",
            stderr: "",
          };
        }
        if (command === "/usr/bin/osascript") {
          return {
            code: 0,
            stdout: JSON.stringify({ bundleIdentifier: "com.apple.Finder" }),
            stderr: "",
          };
        }
        if (
          command === "/Applications/CuaDriver.app/Contents/MacOS/cua-driver" &&
          args.join(" ") === "permissions status --json"
        ) {
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
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    };
    const engine = new FakeEngine({ platform: "macos" });
    const connectEngine = vi.fn(async () => engine);
    const connectMcpEngine = vi.fn(async () => {
      throw new Error("MCP connector must not diagnose setup");
    });
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runCli(
      ["setup", "--development"],
      {
        stdout: { write(value: string) { stdout.push(value); } },
        stderr: { write(value: string) { stderr.push(value); } },
      },
      {
        loadLock: async () => lock,
        downloader: {
          async download(url, destination) {
            const name = url.pathname.split("/").at(-1) ?? "";
            await writeFile(destination, bytes.get(name) ?? "unexpected", { flag: "wx" });
          },
        },
        runner,
        async accessRuntimePath() {},
        connectEngine,
        connectMcpEngine,
        nodeExecutablePath: process.execPath,
        mcpScriptPath: "/fixture/dist/mcp/main.js",
        productOwnedPaths: [],
        async isEngineInstalled() { return true; },
        async runMcpServer() {},
        doctorOptions: { platform: "darwin", arch: "arm64" },
      },
    );

    expect(exitCode).toBe(0);
    expect(connectEngine).toHaveBeenCalledOnce();
    expect(connectMcpEngine).not.toHaveBeenCalled();
    expect(engine.observations).toBe(1);
    expect(engine.closes).toBe(1);
    expect(runs.find(({ command }) => command === "/bin/bash")).toMatchObject({
      timeoutMs: 1_200_000,
      terminateTree: true,
      terminationGraceMs: 5_000,
    });
    const daemonLaunch = runs.find(({ command }) => command === "/usr/bin/open");
    expect(daemonLaunch).toMatchObject({ timeoutMs: 30_000 });
    expect(daemonLaunch).not.toHaveProperty("terminateTree");
    expect(daemonLaunch).not.toHaveProperty("terminationGraceMs");
    const permissionGrant = runs.find(({ args }) => args.join(" ") === "permissions grant");
    expect(permissionGrant).toMatchObject({ timeoutMs: 120_000 });
    expect(permissionGrant).not.toHaveProperty("terminateTree");
    expect(permissionGrant).not.toHaveProperty("terminationGraceMs");
    expect(runs).toContainEqual({
      command: "/Applications/CuaDriver.app/Contents/MacOS/cua-driver",
      args: ["permissions", "status", "--json"],
      timeoutMs: 10_000,
    });
    expect(JSON.parse(stdout[0]!) as Record<string, unknown>).toMatchObject({
      ok: true,
      doctor: {
        ok: true,
        permissions: "granted",
        cleanup: { status: "succeeded" },
      },
    });
    expect(stderr.join("\n")).toContain("computer-use config --client generic");
  });
});
