import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

type JsonRpcMessage = Readonly<{
  id?: string | number;
  result?: unknown;
  error?: unknown;
}>;

let buildDirectory = "";
const liveChildren = new Set<ChildProcessWithoutNullStreams>();

beforeAll(async () => {
  const cacheDirectory = join(process.cwd(), "node_modules", ".cache");
  await mkdir(cacheDirectory, { recursive: true });
  buildDirectory = await mkdtemp(join(cacheDirectory, "stdio-smoke-"));
  const compiler = spawn(
    process.execPath,
    [
      join(process.cwd(), "node_modules", "typescript", "bin", "tsc"),
      "-p",
      "tsconfig.json",
      "--outDir",
      buildDirectory,
      "--declaration",
      "false",
      "--sourceMap",
      "false",
    ],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );
  let diagnostics = "";
  compiler.stdout.setEncoding("utf8");
  compiler.stdout.on("data", (chunk: string) => {
    diagnostics += chunk;
  });
  compiler.stderr.setEncoding("utf8");
  compiler.stderr.on("data", (chunk: string) => {
    diagnostics += chunk;
  });
  const [exitCode] = (await once(compiler, "exit")) as [number | null];
  if (exitCode !== 0) throw new Error(`stdio smoke compile failed:\n${diagnostics}`);
});

afterAll(async () => {
  if (buildDirectory !== "") {
    await rm(buildDirectory, { recursive: true, force: true });
  }
});

afterEach(async () => {
  await Promise.all(
    [...liveChildren].map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }),
  );
});

function childScript(): string {
  const runtimeUrl = pathToFileURL(join(buildDirectory, "core", "runtime.js")).href;
  const mainUrl = pathToFileURL(join(buildDirectory, "mcp", "main.js")).href;
  return String.raw`
  import { ComputerUseRuntime } from ${JSON.stringify(runtimeUrl)};
  import { runStdioServer } from ${JSON.stringify(mainUrl)};

  const engine = {
    name: "cua-driver",
    version: "0.22.1",
    sessionId: "stdio-fixture",
    async observe() { throw new Error("observe must not run in list-tools smoke"); },
    async execute() { throw new Error("execute must not run in list-tools smoke"); },
    async close() {},
  };

  await runStdioServer(new ComputerUseRuntime(engine));
`;
}

function spawnFixture(): ChildProcessWithoutNullStreams {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", childScript()],
    { cwd: process.cwd(), stdio: "pipe" },
  );
  liveChildren.add(child);
  child.once("exit", () => {
    liveChildren.delete(child);
  });
  return child;
}

describe("computer-use-mcp stdio entry point", () => {
  it("initializes, lists only two tools, and exits cleanly on stdin EOF", async () => {
    const child = spawnFixture();

    const stdoutLines: string[] = [];
    const parsedMessages: JsonRpcMessage[] = [];
    const parseFailures: string[] = [];
    const waiters = new Map<string | number, (message: JsonRpcMessage) => void>();
    let stdoutBuffer = "";
    let stderr = "";

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.length === 0) continue;
        stdoutLines.push(line);
        try {
          const message = JSON.parse(line) as JsonRpcMessage;
          parsedMessages.push(message);
          if (message.id !== undefined) {
            waiters.get(message.id)?.(message);
            waiters.delete(message.id);
          }
        } catch {
          parseFailures.push(line);
        }
      }
    });

    const response = (id: string | number): Promise<JsonRpcMessage> =>
      new Promise((resolve) => {
        const existing = parsedMessages.find((message) => message.id === id);
        if (existing !== undefined) resolve(existing);
        else waiters.set(id, resolve);
      });
    const send = (message: unknown): void => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "stdio-smoke", version: "1.0.0" },
      },
    });
    expect((await response(1)).error).toBeUndefined();

    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const listed = await response(2);
    expect(listed.error).toBeUndefined();
    expect(listed.result).toMatchObject({
      tools: [{ name: "computer_observe" }, { name: "computer_act" }],
    });

    child.stdin.end();
    const [exitCode, signal] = (await once(child, "exit")) as [
      number | null,
      NodeJS.Signals | null,
    ];

    expect({ exitCode, signal, stderr }).toMatchObject({
      exitCode: 0,
      signal: null,
    });
    expect(stderr).toBe("computer-use-mcp: ready on stdio\n");
    expect(stdoutBuffer).toBe("");
    expect(stdoutLines.length).toBeGreaterThanOrEqual(2);
    expect(parseFailures).toEqual([]);
  }, 5_000);

  it.skipIf(process.platform === "win32").each(["SIGINT", "SIGTERM"] as const)(
    "closes cleanly on %s without writing diagnostics to stdout",
    async (shutdownSignal) => {
      const child = spawnFixture();
      let stdout = "";
      let stderr = "";
      let signalReady!: () => void;
      const ready = new Promise<void>((resolve) => {
        signalReady = resolve;
      });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
        if (stderr.includes("ready on stdio")) signalReady();
      });

      await ready;
      const exited = once(child, "exit");
      expect(child.kill(shutdownSignal)).toBe(true);
      const [exitCode, signal] = (await exited) as [
        number | null,
        NodeJS.Signals | null,
      ];

      expect({ exitCode, signal }).toEqual({ exitCode: 0, signal: null });
      expect(
        stdout
          .split("\n")
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line) as unknown),
      ).toEqual([]);
    },
    5_000,
  );
});
