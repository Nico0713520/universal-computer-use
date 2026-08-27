#!/usr/bin/env node

import { resolve } from "node:path";
import process from "node:process";
import type { Readable, Writable } from "node:stream";
import { pathToFileURL } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { ComputerUseRuntime } from "../core/runtime.js";
import { CuaEngine } from "../engine/cua.js";
import { loadEngineLock } from "../engine/lock.js";
import { ComputerUseError } from "../errors.js";
import { createComputerUseServer } from "./server.js";

type StdioOptions = Readonly<{
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Pick<Writable, "write">;
}>;

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

async function runDefaultServer(): Promise<void> {
  const lock = await loadEngineLock();
  const engine = await CuaEngine.connect(lock);
  await runStdioServer(new ComputerUseRuntime(engine));
}

function isDirectEntryPoint(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url;
}

if (isDirectEntryPoint()) {
  void runDefaultServer().catch((error: unknown) => {
    const code =
      error instanceof ComputerUseError ? error.code : "runtime_unavailable";
    process.stderr.write(`computer-use-mcp: ${code}\n`);
    process.exitCode = 1;
  });
}
