import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type Point = Readonly<{ x: number; y: number }>;
type Layout = Readonly<{
  canvas: Readonly<{ width: 1280; height: 800 }>;
  zoom: 1;
  coordinate_space: "css_pixels";
  controls: Readonly<Record<string, Point>>;
  viewport: Readonly<{
    ready: boolean;
    screen_css: Readonly<{ width: number; height: number }> | null;
  }>;
}>;
type HarnessState = Readonly<{
  clicks: number;
  drop: Readonly<{ count: number; last_source: string | null }>;
}>;
type Observation = Readonly<{ snapshotId: string; width: number; height: number }>;

const REAL_E2E = process.env.CUA_E2E === "1";
const FIXTURE_SCRIPT = resolve("tests/fixtures/desktop-harness/server.mjs");
const MCP_SCRIPT = resolve("dist/mcp/main.js");
const RUNNER = resolve("tests/e2e/macos/run.sh");

let harness: ChildProcess | undefined;
let browser: ChildProcess | undefined;
let browserProfile = "";
let harnessUrl = "";
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
  if (child.stdout === null || child.stderr === null) throw new Error("fixture stdio unavailable");
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stderr = "";
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const line = await Promise.race([
    new Promise<string>((resolvePromise) => {
      let pending = "";
      child.stdout?.on("data", (chunk: string) => {
        pending += chunk;
        const newline = pending.indexOf("\n");
        if (newline >= 0) resolvePromise(pending.slice(0, newline));
      });
    }),
    once(child, "exit").then(([code]) => {
      throw new Error(`fixture exited before ready (${String(code)}): ${stderr}`);
    }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("fixture start timeout")), 5_000)),
  ]);
  const ready = JSON.parse(line) as { url?: unknown };
  if (typeof ready.url !== "string" || !ready.url.startsWith("http://127.0.0.1:")) {
    throw new Error("fixture did not bind a loopback URL");
  }
  return ready.url;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${harnessUrl}${path}`, init);
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function layout(): Promise<Layout> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const current = await json<Layout>("/layout");
    if (current.viewport.ready && current.viewport.screen_css !== null) return current;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("fixture viewport did not become ready");
}

function positiveNumber(name: string): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
  return value;
}

function nonnegativeInteger(name: string): number {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a nonnegative integer`);
  return value;
}

function png(result: CallToolResult): void {
  const images = result.content.filter((item) => item.type === "image");
  expect(images).toHaveLength(1);
  const image = images[0];
  if (image?.type !== "image") throw new Error("missing image result");
  expect(image.mimeType).toBe("image/png");
  expect(Buffer.from(image.data, "base64").subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
}

async function observe(): Promise<Observation> {
  if (client === undefined) throw new Error("MCP client is not connected");
  const result = CallToolResultSchema.parse(
    await client.callTool({ name: "computer_observe", arguments: {} }),
  );
  expect(result.isError).not.toBe(true);
  png(result);
  const data = result.structuredContent as {
    snapshot_id?: unknown;
    screenshot?: { width?: unknown; height?: unknown };
  };
  if (
    typeof data.snapshot_id !== "string" ||
    typeof data.screenshot?.width !== "number" ||
    typeof data.screenshot.height !== "number"
  ) throw new Error("malformed observation");
  return { snapshotId: data.snapshot_id, width: data.screenshot.width, height: data.screenshot.height };
}

async function act(snapshotId: string, action: Record<string, unknown>): Promise<void> {
  if (client === undefined) throw new Error("MCP client is not connected");
  const result = CallToolResultSchema.parse(
    await client.callTool({ name: "computer_act", arguments: { snapshot_id: snapshotId, action } }),
  );
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({ consumed_snapshot_id: snapshotId });
  png(result);
}

function screenshotPoint(manifest: Layout, observed: Observation, controlId: string): Point {
  const control = manifest.controls[controlId];
  const screen = manifest.viewport.screen_css;
  if (control === undefined || screen === null) throw new Error(`missing ${controlId} coordinate`);
  const expectedScale = positiveNumber("CUA_E2E_BACKING_SCALE");
  const scaleX = observed.width / screen.width;
  const scaleY = observed.height / screen.height;
  expect(scaleX).toBeCloseTo(expectedScale, 2);
  expect(scaleY).toBeCloseTo(expectedScale, 2);
  return {
    x: nonnegativeInteger("CUA_E2E_CONTENT_ORIGIN_X_PX") + Math.round(control.x * scaleX),
    y: nonnegativeInteger("CUA_E2E_CONTENT_ORIGIN_Y_PX") + Math.round(control.y * scaleY),
  };
}

async function waitForState(predicate: (state: HarnessState) => boolean): Promise<HarnessState> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const state = await json<HarnessState>("/state");
    if (predicate(state)) return state;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("external oracle did not reach expected state");
}

describe("macOS E2E runner opt-in", () => {
  it("skips without CUA_E2E instead of claiming real desktop evidence", async () => {
    await access(RUNNER);
    const child = spawn("/bin/bash", [RUNNER], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
    const [code] = await once(child, "exit");
    expect(code).toBe(0);
    expect(stdout).toMatch(/^SKIP: CUA_E2E=1 is required/m);
  });
});

describe.skipIf(!REAL_E2E)("macOS Retina screenshot/action coordinate frame", () => {
  beforeAll(async () => {
    if (process.platform !== "darwin") throw new Error("macOS lane requires Darwin");
    if (process.env.CUA_MACOS_PREFLIGHT !== "passed") {
      throw new Error("run tests/e2e/macos/run.sh; direct Vitest invocation is not evidence");
    }
    if (positiveNumber("CUA_E2E_BACKING_SCALE") <= 1) throw new Error("Retina scale must be greater than 1");
    await access(MCP_SCRIPT);
    harnessUrl = await startHarness();
    await json("/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    browserProfile = await mkdtemp(join(tmpdir(), "computer-use-macos-retina-"));
    const executable = process.env.CUA_E2E_BROWSER;
    if (executable === undefined) throw new Error("runner did not select Chrome");
    browser = spawn(executable, [
      `--user-data-dir=${browserProfile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-features=Translate",
      "--disable-session-crashed-bubble",
      "--force-color-profile=srgb",
      "--window-position=40,40",
      "--window-size=1280,800",
      `--app=${harnessUrl}`,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    await layout();
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [MCP_SCRIPT],
      cwd: process.cwd(),
      stderr: "pipe",
    });
    client = new Client({ name: "macos-retina-e2e", version: "1.0.0" });
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    await client?.close().catch(() => undefined);
    await transport?.close().catch(() => undefined);
    await stop(browser);
    await stop(harness);
    if (browserProfile !== "") await rm(browserProfile, { recursive: true, force: true });
  });

  it("delivers click and drag in the screenshot pixel frame for every requested iteration", async () => {
    const repeat = nonnegativeInteger("CUA_REPEAT");
    expect(repeat).toBeGreaterThan(0);
    const manifest = await layout();
    expect(manifest).toMatchObject({
      canvas: { width: 1280, height: 800 },
      zoom: 1,
      coordinate_space: "css_pixels",
    });

    for (let iteration = 0; iteration < repeat; iteration += 1) {
      const beforeClick = await json<HarnessState>("/state");
      const clickObservation = await observe();
      await act(clickObservation.snapshotId, {
        type: "click",
        ...screenshotPoint(manifest, clickObservation, "click-target"),
      });
      await waitForState((state) => state.clicks === beforeClick.clicks + 1);

      const beforeDrag = await json<HarnessState>("/state");
      const dragObservation = await observe();
      const from = screenshotPoint(manifest, dragObservation, "drag-source");
      const to = screenshotPoint(manifest, dragObservation, "drop-target");
      await act(dragObservation.snapshotId, {
        type: "drag",
        from_x: from.x,
        from_y: from.y,
        to_x: to.x,
        to_y: to.y,
        duration_ms: 700,
      });
      await waitForState(
        (state) => state.drop.count === beforeDrag.drop.count + 1 && state.drop.last_source === "drag-source",
      );
    }
  }, 300_000);
});
