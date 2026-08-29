import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { loadEngineLock } from "../../../src/engine/lock.js";
import { PRODUCT_VERSION, PROTOCOL_VERSION } from "../../../src/version.js";
import { AcceptanceRecorder } from "./acceptance-recorder.js";

const REAL_ACCEPTANCE = process.env.CUA_DEVELOPMENT_ACCEPTANCE === "1";
const FIXTURE_SCRIPT = resolve("tests/fixtures/desktop-harness/server.mjs");
const MCP_SCRIPT = resolve("dist/mcp/main.js");
const EVIDENCE_SCHEMA = new URL("./evidence.schema.json", import.meta.url);
const WINDOW_TITLE = "Computer Use Deterministic Desktop Harness";
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

type HarnessState = Readonly<{ clicks: number; double_clicks: number }>;
type PublicBounds = Readonly<{ x: number; y: number; width: number; height: number }>;
type PublicElement = Readonly<{
  element_ref?: unknown;
  label?: unknown;
  bounds?: PublicBounds;
}>;
type PublicWindow = Readonly<{ window_ref?: unknown; title?: unknown }>;
type StructuredResult = Readonly<{
  snapshot_id?: unknown;
  consumed_snapshot_id?: unknown;
  coordinate_space?: unknown;
  visual_status?: unknown;
  windows?: readonly PublicWindow[];
  elements?: readonly PublicElement[];
  code?: unknown;
}>;
type Connection = Readonly<{ client: Client; transport: StdioClientTransport }>;

async function stopProcess(child: ChildProcess | undefined): Promise<void> {
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await Promise.race([
      once(child, "exit"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("acceptance_cleanup_process_alive")), 2_000)),
    ]);
  }
}

async function startFixture(): Promise<Readonly<{ child: ChildProcess; url: string }>> {
  const child = spawn(process.execPath, [FIXTURE_SCRIPT], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (child.stdout === null || child.stderr === null) throw new Error("fixture_stdio_unavailable");
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
      throw new Error(`fixture_exited_before_ready:${String(code)}:${stderr}`);
    }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("fixture_start_timeout")), 5_000)),
  ]);
  const ready = JSON.parse(line) as { url?: unknown };
  if (typeof ready.url !== "string" || !ready.url.startsWith("http://127.0.0.1:")) {
    throw new Error("fixture_ready_message_invalid");
  }
  return { child, url: ready.url };
}

async function fixtureJson<T>(url: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${url}${path}`, init);
  if (!response.ok) throw new Error(`fixture_http_${response.status}:${path}`);
  return response.json() as Promise<T>;
}

async function waitForFixture(url: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const layout = await fixtureJson<{ viewport?: { ready?: unknown } }>(url, "/layout");
    if (layout.viewport?.ready === true) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("fixture_viewport_timeout");
}

async function waitForState(
  url: string,
  predicate: (state: HarnessState) => boolean,
): Promise<HarnessState> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const state = await fixtureJson<HarnessState>(url, "/state");
    if (predicate(state)) return state;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error("fixture_effect_timeout");
}

async function launchBrowser(url: string): Promise<Readonly<{ child: ChildProcess; profile: string }>> {
  const executable = process.env.CUA_E2E_BROWSER;
  if (executable === undefined) throw new Error("acceptance_browser_missing");
  await access(executable);
  const profile = await mkdtemp(join(tmpdir(), "ucu-development-browser-"));
  const child = spawn(executable, [
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-features=Translate",
    "--disable-session-crashed-bubble",
    "--force-color-profile=srgb",
    "--force-renderer-accessibility",
    "--window-position=40,40",
    "--window-size=1280,800",
    `--app=${url}`,
  ], { stdio: "ignore" });
  return { child, profile };
}

async function connectClient(name: string): Promise<Connection> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_SCRIPT],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
}

async function closeConnection(connection: Connection | undefined): Promise<void> {
  if (connection === undefined) return;
  await connection.client.close();
  await connection.transport.close();
}

function structured(result: CallToolResult): StructuredResult {
  return result.structuredContent as StructuredResult;
}

function expectPng(result: CallToolResult): void {
  const images = result.content.filter((item) => item.type === "image");
  expect(images).toHaveLength(1);
  const image = images[0];
  if (image?.type !== "image") throw new Error("mcp_png_missing");
  expect(image.mimeType).toBe("image/png");
  expect(Buffer.from(image.data, "base64").subarray(0, PNG_MAGIC.length)).toEqual(PNG_MAGIC);
}

function requireSnapshot(result: CallToolResult): string {
  const snapshotId = structured(result).snapshot_id;
  if (typeof snapshotId !== "string") throw new Error("mcp_snapshot_missing");
  return snapshotId;
}

function requireWindow(result: CallToolResult): string {
  const candidates = (structured(result).windows ?? []).filter(
    (candidate) => candidate.title === WINDOW_TITLE,
  );
  expect(candidates).toHaveLength(1);
  const windowRef = candidates[0]?.window_ref;
  if (typeof windowRef !== "string") throw new Error("mcp_window_ref_missing");
  return windowRef;
}

function requireElement(result: CallToolResult, label: string): Readonly<{
  elementRef: string;
  bounds: PublicBounds;
}> {
  const candidate = (structured(result).elements ?? []).find((element) => element.label === label);
  if (typeof candidate?.element_ref !== "string" || candidate.bounds === undefined) {
    throw new Error(`mcp_element_missing:${label}`);
  }
  return { elementRef: candidate.element_ref, bounds: candidate.bounds };
}

async function callTool(
  client: Client,
  name: "computer_observe" | "computer_act",
  argumentsValue: Record<string, unknown>,
): Promise<CallToolResult> {
  return CallToolResultSchema.parse(await client.callTool({ name, arguments: argumentsValue }));
}

async function macosVersion(): Promise<string> {
  const child = spawn("/usr/bin/sw_vers", ["-productVersion"], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  const [code] = await once(child, "exit");
  if (code !== 0 || !/^\d+(?:\.\d+){1,3}$/.test(stdout.trim())) throw new Error("macos_version_unavailable");
  return stdout.trim();
}

describe("macOS development acceptance opt-in", () => {
  it("stays disabled unless the launcher marks the real lane", () => {
    if (!REAL_ACCEPTANCE) expect(process.env.CUA_DEVELOPMENT_EVIDENCE_PATH).toBeUndefined();
  });
});

describe.skipIf(!REAL_ACCEPTANCE)("macOS development acceptance through public MCP", () => {
  it("runs the complete stateful scenario", async () => {
    if (process.platform !== "darwin") throw new Error("acceptance_requires_darwin");
    const evidencePath = process.env.CUA_DEVELOPMENT_EVIDENCE_PATH;
    if (evidencePath === undefined || !evidencePath.startsWith("/")) {
      throw new Error("acceptance_evidence_path_missing");
    }
    await access(MCP_SCRIPT);

    const recorder = new AcceptanceRecorder();
    const lock = await loadEngineLock();
    let fixture: Awaited<ReturnType<typeof startFixture>> | undefined;
    let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
    let connection: Connection | undefined;
    let cleanupFailure: unknown;

    try {
      fixture = await startFixture();
      await fixtureJson(fixture.url, "/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      browser = await launchBrowser(fixture.url);
      await waitForFixture(fixture.url);

      connection = await recorder.measure("mcp_start", () => connectClient("ucu-development-acceptance-1"));
      expect(connection.client.getInstructions()).toContain("Observe before the first action");
      const tools = await connection.client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(["computer_observe", "computer_act"]);
      recorder.recordScenario("two_tool_inventory", true);

      const desktop = await recorder.measure("desktop_observe", () => callTool(
        connection!.client, "computer_observe", {},
      ));
      expect(desktop.isError).not.toBe(true);
      expectPng(desktop);
      const desktopSnapshot = requireSnapshot(desktop);
      recorder.recordScenario("desktop_png", true);

      const waited = await callTool(connection.client, "computer_act", {
        snapshot_id: desktopSnapshot,
        action: { type: "wait", ms: 0 },
      });
      expect(waited.isError).not.toBe(true);
      expectPng(waited);
      expect(structured(waited).consumed_snapshot_id).toBe(desktopSnapshot);
      expect(requireSnapshot(waited)).not.toBe(desktopSnapshot);
      recorder.recordScenario("fresh_snapshot", true);

      const stale = await callTool(connection.client, "computer_act", {
        snapshot_id: desktopSnapshot,
        action: { type: "wait", ms: 0 },
      });
      expect(stale.isError).toBe(true);
      expect(structured(stale).code).toBe("stale_snapshot");
      recorder.recordScenario("stale_snapshot_rejected", true);

      const discovered = await recorder.measure("window_discover", () => callTool(
        connection!.client,
        "computer_observe",
        { target: { kind: "desktop" }, discover: { windows: true, query: WINDOW_TITLE } },
      ));
      expect(discovered.isError).not.toBe(true);
      expectPng(discovered);
      const windowRef = requireWindow(discovered);
      recorder.recordScenario("exact_window_discovered", true);

      const windowState = await recorder.measure("window_observe", () => callTool(
        connection!.client,
        "computer_observe",
        {
          target: { kind: "window", window_ref: windowRef },
          include_screenshot: true,
          elements: { query: "Single click", max_elements: 100, max_depth: 10 },
        },
      ));
      expect(windowState.isError).not.toBe(true);
      expectPng(windowState);
      expect(structured(windowState)).toMatchObject({
        coordinate_space: "window_screenshot_pixels",
        visual_status: "available",
      });
      const windowSnapshot = requireSnapshot(windowState);
      const singleClick = requireElement(windowState, "Single click");
      recorder.recordScenario("window_png_and_element", true);

      const beforeElement = await fixtureJson<HarnessState>(fixture.url, "/state");
      const elementActed = await recorder.measure("element_action", () => callTool(
        connection!.client,
        "computer_act",
        {
          snapshot_id: windowSnapshot,
          action: { type: "click", element_ref: singleClick.elementRef },
          delivery: "background",
        },
      ));
      expect(elementActed.isError).not.toBe(true);
      expectPng(elementActed);
      await waitForState(fixture.url, (state) => state.clicks === beforeElement.clicks + 1);
      recorder.recordScenario("background_element_effect", true);

      const freshWindowSnapshot = requireSnapshot(elementActed);
      const freshSingleClick = requireElement(elementActed, "Single click");
      const coordinate = {
        x: Math.round(freshSingleClick.bounds.x + freshSingleClick.bounds.width / 2),
        y: Math.round(freshSingleClick.bounds.y + freshSingleClick.bounds.height / 2),
      };
      const beforeCoordinate = await fixtureJson<HarnessState>(fixture.url, "/state");
      const coordinateActed = await recorder.measure("coordinate_action", () => callTool(
        connection!.client,
        "computer_act",
        {
          snapshot_id: freshWindowSnapshot,
          action: { type: "click", ...coordinate },
          // Chromium may drop background CGEvents. The semantic action above
          // proves background delivery; this action isolates the pixel frame.
          delivery: "foreground",
        },
      ));
      expect(coordinateActed.isError).not.toBe(true);
      expectPng(coordinateActed);
      await waitForState(
        fixture.url,
        (state) => state.clicks === beforeCoordinate.clicks + 1,
      );
      recorder.recordScenario("window_coordinate_effect", true);

      const oldSnapshot = requireSnapshot(coordinateActed);
      const oldElementRef = requireElement(coordinateActed, "Single click").elementRef;
      await closeConnection(connection);
      connection = undefined;
      connection = await recorder.measure("mcp_reconnect", () => connectClient("ucu-development-acceptance-2"));

      const staleAfterReconnect = await callTool(connection.client, "computer_act", {
        snapshot_id: oldSnapshot,
        action: { type: "wait", ms: 0 },
      });
      expect(staleAfterReconnect.isError).toBe(true);
      expect(structured(staleAfterReconnect).code).toBe("stale_snapshot");

      const oldWindow = await callTool(connection.client, "computer_observe", {
        target: { kind: "window", window_ref: windowRef },
        include_screenshot: true,
      });
      expect(oldWindow.isError).toBe(true);
      expect(structured(oldWindow).code).toBe("window_not_found");

      const rediscovered = await callTool(connection.client, "computer_observe", {
        target: { kind: "desktop" },
        discover: { windows: true, query: WINDOW_TITLE },
      });
      const newWindowRef = requireWindow(rediscovered);
      expect(newWindowRef).not.toBe(windowRef);
      const newWindowState = await callTool(connection.client, "computer_observe", {
        target: { kind: "window", window_ref: newWindowRef },
        include_screenshot: true,
        elements: { query: "Single click", max_elements: 100, max_depth: 10 },
      });
      const oldElement = await callTool(connection.client, "computer_act", {
        snapshot_id: requireSnapshot(newWindowState),
        action: { type: "click", element_ref: oldElementRef },
        delivery: "background",
      });
      expect(oldElement.isError).toBe(true);
      expect(structured(oldElement).code).toBe("stale_element_ref");
      recorder.recordScenario("old_refs_rejected_after_reconnect", true);
    } finally {
      const cleanup = async (operation: () => Promise<void>): Promise<void> => {
        try {
          await operation();
        } catch (error) {
          cleanupFailure ??= error;
        }
      };
      await cleanup(() => closeConnection(connection));
      await cleanup(() => stopProcess(browser?.child));
      await cleanup(() => stopProcess(fixture?.child));
      if (browser !== undefined) {
        const browserProfile = browser.profile;
        await cleanup(() => rm(browserProfile, { recursive: true, force: true }));
      }
    }

    if (cleanupFailure !== undefined) throw cleanupFailure;
    if (process.arch !== "arm64" && process.arch !== "x64") {
      throw new Error("acceptance_architecture_unsupported");
    }
    const evidence = recorder.evidence({
      product_version: PRODUCT_VERSION,
      protocol_version: PROTOCOL_VERSION,
      engine_version: lock.version,
      macos_version: await macosVersion(),
      architecture: process.arch === "x64" ? "x86_64" : "arm64",
    }, true);
    const schema = JSON.parse(await readFile(EVIDENCE_SCHEMA, "utf8"));
    z.fromJSONSchema(schema as never).parse(evidence);
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
  }, 120_000);
});
