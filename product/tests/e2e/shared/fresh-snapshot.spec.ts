import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const E2E_ENABLED = process.env.CUA_E2E === "1";
const FIXTURE_SCRIPT = resolve("tests/fixtures/desktop-harness/server.mjs");
const MCP_SCRIPT = resolve("dist/mcp/main.js");

let harness: ChildProcess | undefined;
let browser: ChildProcess | undefined;
let profile = "";
let url = "";
let client: Client | undefined;
let transport: StdioClientTransport | undefined;

async function stop(child: ChildProcess | undefined): Promise<void> {
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000))]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function startHarness(): Promise<string> {
  const child = spawn(process.execPath, [FIXTURE_SCRIPT], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  harness = child;
  if (child.stdout === null) throw new Error("desktop harness stdout was not piped");
  child.stdout.setEncoding("utf8");
  let pending = "";
  const ready = await Promise.race([
    new Promise<string>((resolvePromise) => {
      child.stdout?.on("data", (chunk: string) => {
        pending += chunk;
        const newline = pending.indexOf("\n");
        if (newline >= 0) resolvePromise(pending.slice(0, newline));
      });
    }),
    once(child, "exit").then(([code]) => {
      throw new Error(`desktop harness exited before ready (${String(code)})`);
    }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("desktop harness start timeout")), 5_000)),
  ]);
  const message = JSON.parse(ready) as { url?: unknown };
  if (typeof message.url !== "string") throw new Error("desktop harness returned no URL");
  return message.url;
}

async function findBrowser(): Promise<string> {
  const candidates = process.env.CUA_E2E_BROWSER !== undefined
    ? [process.env.CUA_E2E_BROWSER]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : process.platform === "win32"
        ? [
            join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
            join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
          ]
        : [];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through known locations.
    }
  }
  throw new Error("Chrome or Edge is required; set CUA_E2E_BROWSER");
}

async function waitUntilReady(): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${url}/layout`);
    const layout = await response.json() as { viewport?: { ready?: unknown } };
    if (layout.viewport?.ready === true) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("desktop harness browser did not become ready");
}

function png(result: CallToolResult): Buffer {
  const image = result.content.find((item) => item.type === "image");
  if (image?.type !== "image" || image.mimeType !== "image/png") {
    throw new Error("expected one PNG ImageContent block");
  }
  const bytes = Buffer.from(image.data, "base64");
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return bytes;
}

describe.skipIf(!E2E_ENABLED)("fresh snapshots on a motionless desktop", () => {
  beforeAll(async () => {
    if (process.env.CUA_E2E_MODE !== "development" && process.env.CUA_E2E_MODE !== "candidate") {
      throw new Error("CUA_E2E_MODE must be development or candidate");
    }
    await access(MCP_SCRIPT);
    url = await startHarness();
    await fetch(`${url}/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    profile = await mkdtemp(join(tmpdir(), "computer-use-static-e2e-"));
    browser = spawn(
      await findBrowser(),
      [
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-extensions",
        "--force-color-profile=srgb",
        "--window-position=40,40",
        "--window-size=1280,800",
        `--app=${url}`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    await waitUntilReady();

    transport = new StdioClientTransport({
      command: process.execPath,
      args: [MCP_SCRIPT],
      cwd: process.cwd(),
      stderr: "pipe",
    });
    client = new Client({ name: "fresh-snapshot-e2e", version: "1.0.0" });
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    await client?.close().catch(() => undefined);
    await transport?.close().catch(() => undefined);
    await stop(browser);
    await stop(harness);
    if (profile !== "") await rm(profile, { recursive: true, force: true });
  });

  it("returns a new ID after wait even when the PNG hash is unchanged", async () => {
    if (client === undefined) throw new Error("MCP client is not connected");
    const layoutResponse = await fetch(`${url}/layout`);
    const layout = await layoutResponse.json() as { controls?: Record<string, unknown> };
    expect(layout.controls).toHaveProperty("static-target");

    const observed = CallToolResultSchema.parse(
      await client.callTool({ name: "computer_observe", arguments: {} }),
    );
    expect(observed.isError).not.toBe(true);
    const beforeId = String(observed.structuredContent?.snapshot_id);
    const beforePng = png(observed);

    const acted = CallToolResultSchema.parse(
      await client.callTool({
        name: "computer_act",
        arguments: { snapshot_id: beforeId, action: { type: "wait", ms: 250 } },
      }),
    );
    expect(acted.isError).not.toBe(true);
    const afterId = String(acted.structuredContent?.snapshot_id);
    const afterPng = png(acted);
    expect(afterId).not.toBe(beforeId);

    const hashes = [beforePng, afterPng].map((bytes) => createHash("sha256").update(bytes).digest("hex"));
    // Equal hashes are valid: freshness is represented only by the new snapshot ID.
    expect(hashes).toEqual([
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.stringMatching(/^[a-f0-9]{64}$/),
    ]);
  }, 30_000);
});
