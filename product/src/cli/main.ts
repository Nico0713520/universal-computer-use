#!/usr/bin/env node

import { access } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { CuaEngine } from "../engine/cua.js";
import {
  resolveCursorMode,
  type CursorMode,
} from "../engine/cursor-mode.js";
import { loadEngineLock, type EngineLock } from "../engine/lock.js";
import type { EnginePort } from "../engine/port.js";
import {
  boundedRuntimeStartupWait,
  createRuntimeConnector,
} from "../engine/runtime-startup.js";
import { ComputerUseError } from "../errors.js";
import {
  connectProductionEngine,
  createProductionRuntime,
  runStdioServer,
} from "../mcp/main.js";
import { renderConfig, type ConfigClient } from "./config.js";
import { createDoctorDependencyAdapter } from "./doctor-dependencies.js";
import { renderDoctorHuman } from "./doctor-output.js";
import { redactProxyEnvironmentValues } from "./env-proxy.js";
import {
  isDirectEntryPoint,
  runDirectCliEntrypoint,
} from "./entrypoint.js";
import { runDoctor, type DoctorOptions } from "./doctor.js";
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
  accessRuntimePath: (path: string) => Promise<void>;
  connectEngine: (
    lock: EngineLock,
    options?: Readonly<{ cursorMode: CursorMode }>,
  ) => Promise<EnginePort>;
  connectMcpEngine?: (
    lock: EngineLock,
    options?: Readonly<{ cursorMode: CursorMode }>,
  ) => Promise<EnginePort>;
  nodeExecutablePath: string;
  mcpScriptPath: string;
  mcpScriptExists?: () => Promise<boolean>;
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

function connectDiagnosticEngine(
  lock: EngineLock,
  options: Readonly<{ cursorMode: CursorMode }> = { cursorMode: "auto" },
): Promise<CuaEngine> {
  // A CLI doctor invocation gets its own bounded startup attempt. Reusing the
  // MCP connector would reuse its cached promise and could report stale state.
  return createRuntimeConnector({
    platform: process.platform,
    connect: (candidate) => CuaEngine.connect(candidate, options),
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
  accessRuntimePath: access,
  connectEngine: connectDiagnosticEngine,
  connectMcpEngine: connectProductionEngine,
  nodeExecutablePath: process.execPath,
  mcpScriptPath,
  async mcpScriptExists() {
    try {
      await access(mcpScriptPath);
      return true;
    } catch {
      return false;
    }
  },
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
    "  computer-use doctor [--json] [--cursor auto|visible|hidden]",
    "  computer-use config --client generic|codex|kimi|hanaagent|workbuddy [--cursor auto|visible|hidden]",
    "  computer-use uninstall [--engine]",
    "  computer-use mcp [--cursor auto|visible|hidden]",
  ].join("\n");
}

function requireOnly(args: readonly string[], allowed: readonly string[]): void {
  if (args.some((arg) => !allowed.includes(arg)) || new Set(args).size !== args.length) {
    throw new Error(`invalid arguments\n${usage()}`);
  }
}

function parseDoctorArgs(args: readonly string[]): Readonly<{
  json: boolean;
  cursorMode: CursorMode;
}> {
  let json = false;
  let cursorValue: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      if (json) throw new Error(`invalid arguments\n${usage()}`);
      json = true;
      continue;
    }
    if (argument === "--cursor") {
      if (cursorValue !== undefined || index + 1 >= args.length) {
        throw new Error(`invalid arguments\n${usage()}`);
      }
      cursorValue = args[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`invalid arguments\n${usage()}`);
  }
  return {
    json,
    cursorMode: resolveCursorMode(
      cursorValue === undefined ? [] : ["--cursor", cursorValue],
      process.env,
    ),
  };
}

export async function runCli(
  argv: readonly string[],
  io: CliIo = { stdout: process.stdout, stderr: process.stderr },
  dependencies: CliDependencies = defaultDependencies,
): Promise<number> {
  const [command, ...args] = argv;
  const doctorDependencies = createDoctorDependencyAdapter({
    connectEngine: dependencies.connectEngine,
    accessRuntimePath: dependencies.accessRuntimePath,
    runner: dependencies.runner,
  });
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
            doctorDependencies(lock),
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
    const doctorArguments = parseDoctorArgs(args);
    const lock = await dependencies.loadLock();
    const report = await runDoctor(
      {
        ...dependencies.doctorOptions,
        cursorMode: doctorArguments.cursorMode,
      },
      doctorDependencies(lock),
    );
    io.stdout.write(
      doctorArguments.json
        ? `${JSON.stringify(report)}\n`
        : `${renderDoctorHuman(report)}\n`,
    );
    return report.ok ? 0 : 1;
  }

  if (command === "config") {
    if (
      (args.length !== 2 && args.length !== 4) ||
      args[0] !== "--client" ||
      (args.length === 4 && args[2] !== "--cursor")
    ) {
      throw new Error(usage());
    }
    const client = args[1];
    if (
      client !== "generic" &&
      client !== "codex" &&
      client !== "kimi" &&
      client !== "hanaagent" &&
      client !== "workbuddy"
    ) {
      throw new Error(`unsupported config client: ${client}`);
    }
    if (!(await (dependencies.mcpScriptExists?.() ?? Promise.resolve(true)))) {
      throw new Error(
        "MCP build output is missing. Run the package build before generating host configuration.",
      );
    }
    const output = renderConfig(
      client satisfies ConfigClient,
      dependencies.nodeExecutablePath,
      dependencies.mcpScriptPath,
      resolveCursorMode(args.slice(2), {}),
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
    const cursorMode = resolveCursorMode(args, process.env);
    const lock = await dependencies.loadLock();
    const engine = await (dependencies.connectMcpEngine ?? dependencies.connectEngine)(
      lock,
      { cursorMode },
    );
    await dependencies.runMcpServer(createProductionRuntime(engine));
    return 0;
  }

  throw new Error(usage());
}

export function serializeCliFailure(
  error: unknown,
  environment: NodeJS.ProcessEnv = process.env,
): Readonly<{
  ok: false;
  error: Readonly<{
    code: string;
    message: string;
    recovery?: ComputerUseError["recovery"];
    retryable?: boolean;
    diagnostic_reason?: ComputerUseError["diagnosticReason"];
  }>;
}> {
  if (error instanceof ComputerUseError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: redactProxyEnvironmentValues(error.message, environment),
        recovery: error.recovery,
        retryable: error.retryable,
        ...(error.diagnosticReason === undefined
          ? {}
          : { diagnostic_reason: error.diagnosticReason }),
      },
    };
  }
  return {
    ok: false,
    error: {
      code: "command_failed",
      message: redactProxyEnvironmentValues(
        error instanceof Error ? error.message : String(error),
        environment,
      ),
    },
  };
}

const directEntrypointPath = process.argv[1];
if (
  directEntrypointPath !== undefined &&
  isDirectEntryPoint(directEntrypointPath, import.meta.url)
) {
  void runDirectCliEntrypoint(
    {
      argv: process.argv.slice(2),
      execArgv: process.execArgv,
      environment: process.env,
      nodeExecutablePath: process.execPath,
      entrypointPath: directEntrypointPath,
    },
    { runCli },
  )
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `${JSON.stringify(serializeCliFailure(error))}\n`,
      );
      process.exitCode = 1;
    });
}
