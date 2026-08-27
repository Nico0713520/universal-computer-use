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
    browser_reported_origin_css: Point | null;
    screen_css: Readonly<{ width: number; height: number }> | null;
  }>;
}>;
type HarnessState = Readonly<{
  clicks: number;
  double_clicks: number;
  context_menus: number;
  moves: number;
  text: string;
  keypresses: number;
  last_key: string | null;
  scroll: Readonly<{ top: number; left: number; events: number }>;
  drop: Readonly<{ count: number; last_source: string | null }>;
}>;
type Observation = Readonly<{
  snapshotId: string;
  width: number;
  height: number;
  png: Buffer;
}>;

const E2E_ENABLED = process.env.CUA_E2E === "1";
const FIXTURE_SCRIPT = resolve("tests/fixtures/desktop-harness/server.mjs");
const MCP_SCRIPT = resolve("dist/mcp/main.js");

let harnessProcess: ChildProcess | undefined;
let harnessUrl = "";
let browserProcess: ChildProcess | undefined;
let browserProfile = "";
let mcpClient: Client | undefined;
let mcpTransport: StdioClientTransport | undefined;

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
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
  harnessProcess = child;
  if (child.stdout === null || child.stderr === null) {
    throw new Error("desktop harness stdio was not piped");
  }
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stderr = "";
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const line = await Promise.race([
    new Promise<string>((resolvePromise) => {
      let pending = "";
      child.stdout.on("data", (chunk: string) => {
        pending += chunk;
        const newline = pending.indexOf("\n");
        if (newline >= 0) resolvePromise(pending.slice(0, newline));
      });
    }),
    once(child, "exit").then(([code]) => {
      throw new Error(`desktop harness exited before ready (${String(code)}): ${stderr}`);
    }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("desktop harness start timeout")), 5_000);
    }),
  ]);
  const ready = JSON.parse(line) as { url?: unknown };
  if (typeof ready.url !== "string" || !ready.url.startsWith("http://127.0.0.1:")) {
    throw new Error(`invalid desktop harness ready message: ${line}`);
  }
  return ready.url;
}

async function browserExecutable(): Promise<string> {
  const configured = process.env.CUA_E2E_BROWSER;
  const candidates = configured === undefined
    ? process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : process.platform === "win32"
        ? [
            join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
            join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
            join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
          ]
        : []
    : [configured];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next explicitly reviewed browser location.
    }
  }
  throw new Error("Chrome or Edge is required; set CUA_E2E_BROWSER to its executable path");
}

async function launchBrowser(url: string): Promise<ChildProcess> {
  const executable = await browserExecutable();
  browserProfile = await mkdtemp(join(tmpdir(), "computer-use-e2e-browser-"));
  return spawn(
    executable,
    [
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
      `--app=${url}`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${harnessUrl}${path}`, init);
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function waitForLayout(): Promise<Layout> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const layout = await fetchJson<Layout>("/layout");
    if (layout.viewport.ready && layout.viewport.screen_css !== null) return layout;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("desktop harness did not report its measured content origin");
}

function measuredContentOrigin(): Point {
  const x = Number(process.env.CUA_E2E_CONTENT_ORIGIN_X_PX);
  const y = Number(process.env.CUA_E2E_CONTENT_ORIGIN_Y_PX);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
    throw new Error(
      "Task 11/12 runner must set measured CUA_E2E_CONTENT_ORIGIN_X_PX and CUA_E2E_CONTENT_ORIGIN_Y_PX",
    );
  }
  return { x, y };
}

function parsedImage(result: CallToolResult): Buffer {
  const images = result.content.filter((item) => item.type === "image");
  expect(images).toHaveLength(1);
  const image = images[0];
  if (image?.type !== "image") throw new Error("tool result did not contain an image");
  expect(image.mimeType).toBe("image/png");
  const bytes = Buffer.from(image.data, "base64");
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return bytes;
}

async function observe(): Promise<Observation> {
  if (mcpClient === undefined) throw new Error("MCP client is not connected");
  const result = CallToolResultSchema.parse(
    await mcpClient.callTool({ name: "computer_observe", arguments: {} }),
  );
  expect(result.isError).not.toBe(true);
  const structured = result.structuredContent as {
    snapshot_id?: unknown;
    screenshot?: { width?: unknown; height?: unknown };
  };
  if (
    typeof structured.snapshot_id !== "string" ||
    typeof structured.screenshot?.width !== "number" ||
    typeof structured.screenshot.height !== "number"
  ) throw new Error("computer_observe returned malformed structured content");
  return {
    snapshotId: structured.snapshot_id,
    width: structured.screenshot.width,
    height: structured.screenshot.height,
    png: parsedImage(result),
  };
}

async function act(snapshotId: string, action: Record<string, unknown>): Promise<CallToolResult> {
  if (mcpClient === undefined) throw new Error("MCP client is not connected");
  return CallToolResultSchema.parse(
    await mcpClient.callTool({
      name: "computer_act",
      arguments: { snapshot_id: snapshotId, action },
    }),
  );
}

function screenshotPoint(layout: Layout, observed: Observation, controlId: string): Point {
  const control = layout.controls[controlId];
  const screen = layout.viewport.screen_css;
  if (control === undefined || screen === null) {
    throw new Error(`missing coordinate data for ${controlId}`);
  }
  const origin = measuredContentOrigin();
  return {
    x: Math.round(origin.x + control.x * (observed.width / screen.width)),
    y: Math.round(origin.y + control.y * (observed.height / screen.height)),
  };
}

async function expectSuccessfulAction(
  layout: Layout,
  actionFor: (observed: Observation) => Record<string, unknown>,
  verify: (before: HarnessState, after: HarnessState) => void,
): Promise<void> {
  const before = await fetchJson<HarnessState>("/state");
  const observed = await observe();
  const result = await act(observed.snapshotId, actionFor(observed));
  expect(result.isError).not.toBe(true);
  parsedImage(result);
  expect(result.structuredContent).toMatchObject({ consumed_snapshot_id: observed.snapshotId });
  expect(result.structuredContent?.snapshot_id).not.toBe(observed.snapshotId);

  await expect.poll(() => fetchJson<HarnessState>("/state"), { timeout: 5_000 }).toSatisfy(
    (state: HarnessState) => {
      try {
        verify(before, state);
        return true;
      } catch {
        return false;
      }
    },
  );
  const after = await fetchJson<HarnessState>("/state");
  verify(before, after);
}

describe.skipIf(!E2E_ENABLED)("deterministic desktop harness through real stdio MCP", () => {
  beforeAll(async () => {
    if (process.env.CUA_E2E_MODE !== "development" && process.env.CUA_E2E_MODE !== "candidate") {
      throw new Error("CUA_E2E_MODE must be development or candidate");
    }
    await access(MCP_SCRIPT);
    harnessUrl = await startHarness();
    await fetchJson("/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    browserProcess = await launchBrowser(harnessUrl);
    await waitForLayout();
    measuredContentOrigin();

    mcpTransport = new StdioClientTransport({
      command: process.execPath,
      args: [MCP_SCRIPT],
      cwd: process.cwd(),
      stderr: "pipe",
    });
    mcpClient = new Client({ name: "desktop-harness-e2e", version: "1.0.0" });
    await mcpClient.connect(mcpTransport);
  }, 30_000);

  afterAll(async () => {
    await mcpClient?.close().catch(() => undefined);
    await mcpTransport?.close().catch(() => undefined);
    if (browserProcess !== undefined) await waitForExit(browserProcess);
    if (harnessProcess !== undefined) await waitForExit(harnessProcess);
    if (browserProfile !== "") await rm(browserProfile, { recursive: true, force: true });
  });

  it("executes all nine actions against external state oracles", async () => {
    const layout = await waitForLayout();
    expect(layout).toMatchObject({
      canvas: { width: 1280, height: 800 },
      zoom: 1,
      coordinate_space: "css_pixels",
    });
    expect(Object.keys(layout.controls).sort()).toEqual([
      "click-target",
      "context-target",
      "double-target",
      "drag-source",
      "drop-target",
      "scroll-target",
      "state-view",
      "static-target",
      "text-target",
    ]);

    await expectSuccessfulAction(
      layout,
      () => ({ type: "type", text: "cua-e2e" }),
      (_before, after) => expect(after.text).toBe("cua-e2e"),
    );
    await expectSuccessfulAction(
      layout,
      () => ({ type: "keypress", keys: ["ENTER"] }),
      (before, after) => {
        expect(after.keypresses).toBeGreaterThan(before.keypresses);
        expect(after.last_key).toBe("Enter");
      },
    );
    await expectSuccessfulAction(
      layout,
      (observed) => ({ type: "click", ...screenshotPoint(layout, observed, "click-target") }),
      (before, after) => expect(after.clicks).toBe(before.clicks + 1),
    );
    await expectSuccessfulAction(
      layout,
      (observed) => ({ type: "double_click", ...screenshotPoint(layout, observed, "double-target") }),
      (before, after) => expect(after.double_clicks).toBe(before.double_clicks + 1),
    );
    await expectSuccessfulAction(
      layout,
      (observed) => ({ type: "move", ...screenshotPoint(layout, observed, "static-target") }),
      (before, after) => expect(after.moves).toBeGreaterThan(before.moves),
    );
    await expectSuccessfulAction(
      layout,
      (observed) => {
        const from = screenshotPoint(layout, observed, "drag-source");
        const to = screenshotPoint(layout, observed, "drop-target");
        return { type: "drag", from_x: from.x, from_y: from.y, to_x: to.x, to_y: to.y, duration_ms: 700 };
      },
      (before, after) => {
        expect(after.drop.count).toBe(before.drop.count + 1);
        expect(after.drop.last_source).toBe("drag-source");
      },
    );
    await expectSuccessfulAction(
      layout,
      (observed) => ({
        type: "scroll",
        ...screenshotPoint(layout, observed, "scroll-target"),
        direction: "down",
        amount: 6,
        by: "line",
      }),
      (before, after) => {
        expect(after.scroll.events).toBeGreaterThan(before.scroll.events);
        expect(after.scroll.top).toBeGreaterThan(before.scroll.top);
      },
    );
    await expectSuccessfulAction(
      layout,
      (observed) => ({ type: "right_click", ...screenshotPoint(layout, observed, "context-target") }),
      (before, after) => expect(after.context_menus).toBe(before.context_menus + 1),
    );
    await expectSuccessfulAction(
      layout,
      () => ({ type: "wait", ms: 250 }),
      (before, after) => expect(after).toEqual(before),
    );
  }, 120_000);

  it("rejects a consumed snapshot without delivering another desktop action", async () => {
    const layout = await waitForLayout();
    const before = await fetchJson<HarnessState>("/state");
    const observed = await observe();
    const point = screenshotPoint(layout, observed, "click-target");
    const first = await act(observed.snapshotId, { type: "click", ...point });
    expect(first.isError).not.toBe(true);
    expect(first.structuredContent).toMatchObject({ consumed_snapshot_id: observed.snapshotId });
    expect(first.structuredContent?.snapshot_id).not.toBe(observed.snapshotId);
    await expect.poll(
      async () => (await fetchJson<HarnessState>("/state")).clicks,
      { timeout: 5_000 },
    ).toBe(before.clicks + 1);
    const afterFirst = await fetchJson<HarnessState>("/state");

    const stale = await act(observed.snapshotId, { type: "click", ...point });
    expect(stale).toMatchObject({
      isError: true,
      structuredContent: { code: "stale_snapshot" },
    });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    expect(await fetchJson<HarnessState>("/state")).toEqual(afterFirst);
  }, 30_000);
});
