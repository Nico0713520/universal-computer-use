#!/usr/bin/env node

import { access } from "node:fs/promises";
import process from "node:process";
import type { Readable, Writable } from "node:stream";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { ComputerUseRuntime } from "../core/runtime.js";
import { CuaEngine } from "../engine/cua.js";
import {
  resolveCursorMode,
  type CursorMode,
} from "../engine/cursor-mode.js";
import { loadEngineLock } from "../engine/lock.js";
import type { EnginePort } from "../engine/port.js";
import {
  boundedRuntimeStartupWait,
  createRuntimeConnector,
} from "../engine/runtime-startup.js";
import { ComputerUseError } from "../errors.js";
import { createMetadataLogger, type MetadataLogger } from "../logging/logger.js";
import { nodeProcessRunner } from "../cli/process-runner.js";
import { isDirectEntryPoint } from "../cli/entrypoint.js";
import { createComputerUseServer } from "./server.js";

type StdioOptions = Readonly<{
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Pick<Writable, "write">;
}>;

export function createProductionRuntime(
  engine: EnginePort,
  logger: MetadataLogger = createMetadataLogger(),
): ComputerUseRuntime {
  return new ComputerUseRuntime(engine, undefined, undefined, { logger });
}

const productionConnectors = new Map<
  CursorMode,
  ReturnType<typeof createRuntimeConnector<CuaEngine>>
>();

export function connectProductionEngine(
  lock: Awaited<ReturnType<typeof loadEngineLock>>,
  options: Readonly<{ cursorMode: CursorMode }> = { cursorMode: "auto" },
): Promise<CuaEngine> {
  let connector = productionConnectors.get(options.cursorMode);
  if (connector === undefined) {
    connector = createRuntimeConnector({
      platform: process.platform,
      connect: (candidate) => CuaEngine.connect(candidate, options),
      access,
      runner: nodeProcessRunner,
      wait: boundedRuntimeStartupWait,
      now: Date.now,
    });
    productionConnectors.set(options.cursorMode, connector);
  }
  return connector(lock);
}

export async function runStdioServer(
  runtime: ComputerUseRuntime,
  options: StdioOptions = {},
): Promise<void> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const transport = new StdioServerTransport(stdin, stdout);
  const server = createComputerUseServer(runtime);

  let resolveDone!: () => void;
  let rejectDone!: (error: unknown) => void;
  const done = new Promise<void>((resolvePromise, rejectPromise) => {
    resolveDone = resolvePromise;
    rejectDone = rejectPromise;
  });
  let shutdownPromise: Promise<void> | undefined;

  const removeListeners = (): void => {
    stdin.off("end", onInputClosed);
    stdin.off("close", onInputClosed);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  };
  const shutdown = (): Promise<void> => {
    if (shutdownPromise !== undefined) return shutdownPromise;

    removeListeners();
    const runtimeClose = runtime.close();
    const serverClose = server.close();
    shutdownPromise = Promise.all([runtimeClose, serverClose]).then(() => undefined);
    void shutdownPromise.then(resolveDone, rejectDone);
    return shutdownPromise;
  };
  const onInputClosed = (): void => {
    void shutdown();
  };
  const onSignal = (): void => {
    void shutdown();
  };

  stdin.once("end", onInputClosed);
  stdin.once("close", onInputClosed);
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  server.server.onclose = onInputClosed;
  server.server.onerror = () => {
    stderr.write("computer-use-mcp: transport error\n");
  };

  try {
    await server.connect(transport);
  } catch (error) {
    removeListeners();
    await runtime.close();
    throw error;
  }

  stderr.write("computer-use-mcp: ready on stdio\n");
  if ("readableEnded" in stdin && stdin.readableEnded === true) {
    void shutdown();
  }
  await done;
}

type DefaultServerDependencies = Readonly<{
  loadLock: typeof loadEngineLock;
  connectEngine: typeof connectProductionEngine;
  runServer: typeof runStdioServer;
}>;

export async function runDefaultServer(
  dependencies: DefaultServerDependencies = {
    loadLock: loadEngineLock,
    connectEngine: connectProductionEngine,
    runServer: runStdioServer,
  },
  options: Readonly<{ cursorMode: CursorMode }> = { cursorMode: "auto" },
): Promise<void> {
  const lock = await dependencies.loadLock();
  const engine = await dependencies.connectEngine(lock, options);
  await dependencies.runServer(createProductionRuntime(engine));
}

if (isDirectEntryPoint(process.argv[1], import.meta.url)) {
  void runDefaultServer(
    undefined,
    { cursorMode: resolveCursorMode(process.argv.slice(2), process.env) },
  ).catch((error: unknown) => {
    const code =
      error instanceof ComputerUseError ? error.code : "runtime_unavailable";
    process.stderr.write(`computer-use-mcp: ${code}\n`);
    process.exitCode = 1;
  });
}
