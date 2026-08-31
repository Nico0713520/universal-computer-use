#!/usr/bin/env node

import { access } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { CuaEngine } from "../engine/cua.js";
import { loadEngineLock, type EngineLock } from "../engine/lock.js";
import type { EnginePort } from "../engine/port.js";
import {
  boundedRuntimeStartupWait,
  createRuntimeConnector,
} from "../engine/runtime-startup.js";
import { ComputerUseError, ERROR_CODES } from "../errors.js";
import {
  connectProductionEngine,
  createProductionRuntime,
  runStdioServer,
} from "../mcp/main.js";
import { renderConfig, type ConfigClient } from "./config.js";
import { renderDoctorHuman } from "./doctor-output.js";
import { isDirectEntryPoint } from "./entrypoint.js";
import { runDoctor, type DoctorOptions } from "./doctor.js";
import { probeMacInteractiveSession } from "./interactive-session.js";
import { probeMacPermissions } from "./macos-permissions.js";
import {
  fetchDownloader,
  nodeProcessRunner,
  type Downloader,
  type ProcessRunner,
} from "./process-runner.js";
import { runSetup } from "./setup.js";
import { runUninstall } from "./uninstall.js";

type CliIo = Readonly<{
  stdout: { write(value: string): unknown };
  stderr: { write(value: string): unknown };
}>;

type CliDependencies = Readonly<{
  loadLock: () => Promise<EngineLock>;
  downloader: Downloader;
  runner: ProcessRunner;
  connectEngine: (lock: EngineLock) => Promise<EnginePort>;
  connectMcpEngine?: (lock: EngineLock) => Promise<EnginePort>;
  nodeExecutablePath: string;
  mcpScriptPath: string;
  productOwnedPaths: readonly string[];
  isEngineInstalled: () => Promise<boolean>;
  runMcpServer: typeof runStdioServer;
  doctorOptions?: DoctorOptions;
}>;

const mcpScriptPath = fileURLToPath(new URL("../mcp/main.js", import.meta.url));

function defaultEnginePath(): string {
  if (process.platform === "darwin") return "/Applications/CuaDriver.app";
  return join(
    process.env.LOCALAPPDATA ?? "",
    "Programs",
    "Cua",
    "cua-driver",
    "bin",
    "cua-driver.exe",
  );
}

function connectDiagnosticEngine(lock: EngineLock): Promise<CuaEngine> {
  // A CLI doctor invocation gets its own bounded startup attempt. Reusing the
  // MCP connector would reuse its cached promise and could report stale state.
  return createRuntimeConnector({
    platform: process.platform,
    connect: (candidate) => CuaEngine.connect(candidate),
    access,
    runner: nodeProcessRunner,
    wait: boundedRuntimeStartupWait,
    now: Date.now,
  })(lock);
}

const defaultDependencies: CliDependencies = {
  loadLock: loadEngineLock,
  downloader: fetchDownloader,
  runner: nodeProcessRunner,
  connectEngine: connectDiagnosticEngine,
  connectMcpEngine: connectProductionEngine,
  nodeExecutablePath: process.execPath,
  mcpScriptPath,
  // Task 9 owns host-specific Skill links. Until it creates a product-owned
  // manifest, safe uninstall deliberately removes no inferred user paths.
  productOwnedPaths: [],
  runMcpServer: runStdioServer,
  async isEngineInstalled() {
    try {
      await access(defaultEnginePath());
      return true;
    } catch {
      return false;
    }
  },
};

function usage(): string {
  return [
    "Usage:",
    "  computer-use setup [--development]",
    "  computer-use doctor [--json]",
    "  computer-use config --client generic|codex|kimi",
    "  computer-use uninstall [--engine]",
    "  computer-use mcp",
  ].join("\n");
}

function requireOnly(args: readonly string[], allowed: readonly string[]): void {
  if (args.some((arg) => !allowed.includes(arg)) || new Set(args).size !== args.length) {
    throw new Error(`invalid arguments\n${usage()}`);
  }
}

export async function runCli(
  argv: readonly string[],
  io: CliIo = { stdout: process.stdout, stderr: process.stderr },
  dependencies: CliDependencies = defaultDependencies,
): Promise<number> {
  const [command, ...args] = argv;
  if (command === undefined) throw new Error(usage());
  if (command === "--help" || command === "-h") {
    requireOnly(args, []);
    io.stdout.write(`${usage()}\n`);
    return 0;
  }

  if (command === "setup") {
    requireOnly(args, ["--development"]);
    const development = args.includes("--development");
    const lock = await dependencies.loadLock();
    const report = await runSetup(
      { development },
      {
        lock,
        downloader: dependencies.downloader,
        runner: dependencies.runner,
        runDoctor: () =>
          runDoctor(
            dependencies.doctorOptions ?? {},
            {
              lock,
              connectEngine: dependencies.connectEngine,
              probeInteractiveSession: () =>
                probeMacInteractiveSession(dependencies.runner),
              probeMacPermissions: () =>
                probeMacPermissions(dependencies.runner),
            },
          ),
      },
    );
    if (report.warning !== undefined) {
      io.stderr.write(`${JSON.stringify(report.warning)}\n`);
    }
    io.stdout.write(`${JSON.stringify(report)}\n`);
    io.stderr.write(`${report.config_command}\n`);
    return 0;
  }

  if (command === "doctor") {
    requireOnly(args, ["--json"]);
    const lock = await dependencies.loadLock();
    const report = await runDoctor(
      dependencies.doctorOptions ?? {},
      {
        lock,
        connectEngine: dependencies.connectEngine,
        probeInteractiveSession: () =>
          probeMacInteractiveSession(dependencies.runner),
        probeMacPermissions: () => probeMacPermissions(dependencies.runner),
      },
    );
    io.stdout.write(
      args.includes("--json")
        ? `${JSON.stringify(report)}\n`
        : `${renderDoctorHuman(report)}\n`,
    );
    return report.ok ? 0 : 1;
  }

  if (command === "config") {
    if (args.length !== 2 || args[0] !== "--client") throw new Error(usage());
    const client = args[1];
    if (client !== "generic" && client !== "codex" && client !== "kimi") {
      throw new Error(`unsupported config client: ${client}`);
    }
    const output = renderConfig(
      client satisfies ConfigClient,
      dependencies.nodeExecutablePath,
      dependencies.mcpScriptPath,
    );
    io.stdout.write(output.stdout);
    io.stderr.write(output.stderr);
    return 0;
  }

  if (command === "uninstall") {
    requireOnly(args, ["--engine"]);
    const lock = await dependencies.loadLock();
    const report = await runUninstall(
      { engine: args.includes("--engine") },
      {
        lock,
        downloader: dependencies.downloader,
        runner: dependencies.runner,
        productOwnedPaths: dependencies.productOwnedPaths,
        isEngineInstalled: dependencies.isEngineInstalled,
      },
    );
    io.stdout.write(`${JSON.stringify(report)}\n`);
    return 0;
  }

  if (command === "mcp") {
    requireOnly(args, []);
    const lock = await dependencies.loadLock();
    const engine = await (dependencies.connectMcpEngine ?? dependencies.connectEngine)(lock);
    await dependencies.runMcpServer(createProductionRuntime(engine));
    return 0;
  }

  throw new Error(usage());
}

function errorCode(error: unknown): string {
  if (error instanceof ComputerUseError) return error.code;
  if (error instanceof Error && ERROR_CODES.some((code) => error.message.includes(code))) {
    return ERROR_CODES.find((code) => error.message.includes(code)) ?? "command_failed";
  }
  return "command_failed";
}

if (isDirectEntryPoint(process.argv[1], import.meta.url)) {
  void runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `${JSON.stringify({ ok: false, error: { code: errorCode(error), message: error instanceof Error ? error.message : String(error) } })}\n`,
      );
      process.exitCode = 1;
    });
}
