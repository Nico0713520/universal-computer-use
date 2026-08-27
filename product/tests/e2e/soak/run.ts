import { execFile, spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { access, copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import type { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

type Point = Readonly<{ x: number; y: number }>;
type Layout = Readonly<{
  controls: Readonly<Record<string, Point>>;
  viewport: Readonly<{
    ready: boolean;
    screen_css: Readonly<{ width: number; height: number }> | null;
  }>;
}>;
type State = Readonly<{
  generation: number;
  clicks: number;
  text: string;
  keypresses: number;
  scroll: Readonly<{ events: number }>;
  drop: Readonly<{ count: number }>;
}>;
type Frame = Readonly<{
  snapshotId: string;
  width: number;
  height: number;
}>;
type Observation = Frame & Readonly<{
  platform: "macos" | "windows";
  engineVersion: string;
}>;
type VisualSession = Readonly<{
  fixture: Readonly<{ process: ChildProcess; url: string }>;
  browser: ChildProcess;
  profile: string;
  layout: Layout;
}>;

const execFileAsync = promisify(execFile);
const productDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const repositoryDirectory = resolve(productDirectory, "..");
const fixtureScript = resolve(productDirectory, "tests/fixtures/desktop-harness/server.mjs");
const mcpScript = resolve(productDirectory, "dist/mcp/main.js");
const privateMarker = "cua-soak-private-text";
let rejectSensitiveLog: ((error: Error) => void) | undefined;
const sensitiveLogFailure = new Promise<never>((_resolve, reject) => {
  rejectSensitiveLog = reject;
});
void sensitiveLogFailure.catch(() => undefined);

function fail(message: string): never {
  throw new Error(`soak_failed:${message}`);
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) fail(`${name}_invalid`);
  return value;
}

function coordinate(name: string): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value < 0) fail(`${name}_invalid`);
  return value;
}

async function stop(child: ChildProcess | undefined): Promise<void> {
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, "exit");
  child.kill("SIGTERM");
  await Promise.race([exit, new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000))]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function startFixture(): Promise<{ process: ChildProcess; url: string }> {
  const child = spawn(process.execPath, [fixtureScript], {
    cwd: productDirectory,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (child.stdout === null || child.stderr === null) fail("fixture_stdio_missing");
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let errorOutput = "";
  child.stderr.on("data", (chunk: string) => { errorOutput += chunk; });
  const readyLine = await Promise.race([
    new Promise<string>((resolvePromise) => {
      let pending = "";
      child.stdout?.on("data", (chunk: string) => {
        pending += chunk;
        const newline = pending.indexOf("\n");
        if (newline >= 0) resolvePromise(pending.slice(0, newline));
      });
    }),
    once(child, "exit").then(([code]) => fail(`fixture_exit_${String(code)}:${errorOutput}`)),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("fixture_start_timeout")), 5_000)),
  ]);
  const ready = JSON.parse(readyLine) as { url?: unknown };
  if (typeof ready.url !== "string" || !ready.url.startsWith("http://127.0.0.1:")) {
    fail("fixture_not_loopback");
  }
  return { process: child, url: ready.url };
}

async function fetchJson<T>(url: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${url}${path}`, init);
  if (!response.ok) fail(`fixture_http_${response.status}`);
  return response.json() as Promise<T>;
}

async function waitForLayout(url: string): Promise<Layout> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const layout = await fetchJson<Layout>(url, "/layout");
    if (layout.viewport.ready && layout.viewport.screen_css !== null) return layout;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  fail("browser_layout_timeout");
}

async function startVisualSession(browserExecutable: string): Promise<VisualSession> {
  const fixture = await startFixture();
  const profile = await mkdtemp(join(tmpdir(), "computer-use-soak-browser-"));
  const browser = spawn(browserExecutable, [
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-extensions",
    "--force-color-profile=srgb",
    "--window-position=40,40",
    "--window-size=1280,800",
    `--app=${fixture.url}`,
  ], { stdio: ["ignore", "ignore", "ignore"] });
  try {
    const layout = await waitForLayout(fixture.url);
    return { fixture, browser, profile, layout };
  } catch (error) {
    await stop(browser);
    await stop(fixture.process);
    await rm(profile, { recursive: true, force: true });
    throw error;
  }
}

async function closeVisualSession(session: VisualSession): Promise<void> {
  await stop(session.browser);
  await stop(session.fixture.process);
  await rm(session.profile, { recursive: true, force: true });
}

export async function replaceVisualSession<T>(
  current: T,
  dependencies: {
    reset(session: T): Promise<void>;
    close(session: T): Promise<void>;
    start(): Promise<T>;
  },
): Promise<T> {
  await dependencies.reset(current);
  await dependencies.close(current);
  return dependencies.start();
}

function png(result: CallToolResult): void {
  const images = result.content.filter((item) => item.type === "image");
  if (images.length !== 1 || images[0]?.type !== "image" || images[0].mimeType !== "image/png") {
    fail("malformed_png");
  }
  const bytes = Buffer.from(images[0].data, "base64");
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    fail("malformed_png");
  }
}

async function withDeadline<T>(operation: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      sensitiveLogFailure,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("unclassified_timeout")), 25_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function assertObservationIdentity(
  output: unknown,
  expectedPlatform: "macos" | "windows",
  lockedEngineVersion: string,
): { platform: "macos" | "windows"; engineVersion: string } {
  const value = output as {
    platform?: unknown;
    engine?: { name?: unknown; version?: unknown };
  };
  if (
    value?.platform !== expectedPlatform
    || value.engine?.name !== "cua-driver"
    || value.engine.version !== lockedEngineVersion
  ) fail("observation_engine_identity_mismatch");
  return {
    platform: value.platform as "macos" | "windows",
    engineVersion: value.engine.version as string,
  };
}

async function observe(
  client: Client,
  expectedPlatform: "macos" | "windows",
  lockedEngineVersion: string,
): Promise<Observation> {
  const result = CallToolResultSchema.parse(await withDeadline(
    client.callTool({ name: "computer_observe", arguments: {} }),
  ));
  if (result.isError === true) fail("observe_error");
  png(result);
  const output = result.structuredContent as {
    snapshot_id?: unknown;
    screenshot?: { width?: unknown; height?: unknown };
    platform?: unknown;
    engine?: { name?: unknown; version?: unknown };
  };
  if (
    typeof output.snapshot_id !== "string"
    || typeof output.screenshot?.width !== "number"
    || typeof output.screenshot.height !== "number"
  ) fail("observe_shape");
  const identity = assertObservationIdentity(output, expectedPlatform, lockedEngineVersion);
  return {
    snapshotId: output.snapshot_id,
    width: output.screenshot.width,
    height: output.screenshot.height,
    ...identity,
  };
}

async function act(
  client: Client,
  snapshotId: string,
  action: Record<string, unknown>,
): Promise<Frame> {
  const result = CallToolResultSchema.parse(await withDeadline(client.callTool({
    name: "computer_act",
    arguments: { snapshot_id: snapshotId, action },
  })));
  if (result.isError === true) fail("action_error");
  png(result);
  const output = result.structuredContent as {
    consumed_snapshot_id?: unknown;
    snapshot_id?: unknown;
    screenshot?: { width?: unknown; height?: unknown };
  };
  if (
    output.consumed_snapshot_id !== snapshotId
    || typeof output.snapshot_id !== "string"
    || output.snapshot_id === snapshotId
    || typeof output.screenshot?.width !== "number"
    || typeof output.screenshot.height !== "number"
  ) fail("fresh_snapshot_invariant");
  return { snapshotId: output.snapshot_id, width: output.screenshot.width, height: output.screenshot.height };
}

function point(layout: Layout, observation: Frame, id: string, origin: Point): Point {
  const control = layout.controls[id];
  const screen = layout.viewport.screen_css;
  if (control === undefined || screen === null) fail(`layout_${id}_missing`);
  return {
    x: Math.round(origin.x + control.x * (observation.width / screen.width)),
    y: Math.round(origin.y + control.y * (observation.height / screen.height)),
  };
}

async function rssMiB(pid: number): Promise<number> {
  if (process.platform === "darwin") {
    const result = await execFileAsync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" });
    const kib = Number(result.stdout.trim());
    if (!Number.isFinite(kib) || kib <= 0) fail("rss_measurement_invalid");
    return kib / 1024;
  }
  const script = `$p=Get-Process -Id ${pid}; [Console]::Write($p.WorkingSet64)`;
  const result = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
  const bytes = Number(result.stdout.trim());
  if (!Number.isFinite(bytes) || bytes <= 0) fail("rss_measurement_invalid");
  return bytes / (1024 * 1024);
}

export async function writeSoakEvidence(path: string, value: unknown): Promise<void> {
  const temporary = resolve(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await copyFile(temporary, path, constants.COPYFILE_EXCL);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function main(): Promise<void> {
  if (process.env.CUA_SOAK !== "1") {
    process.stdout.write("SKIP: CUA_SOAK=1 is required for the real desktop soak lane\n");
    return;
  }
  const platform = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : fail("unsupported_platform");
  if (platform === "macos" && process.env.CUA_MACOS_PREFLIGHT !== "passed") fail("macos_runner_gate_required");
  if (platform === "windows" && process.env.CUA_E2E_RUNNER_GATED !== "1") fail("windows_runner_gate_required");
  const browser = process.env.CUA_E2E_BROWSER;
  if (typeof browser !== "string" || !isAbsolute(browser)) fail("fixed_browser_required");
  await access(browser);
  const evidencePath = process.env.CUA_SOAK_EVIDENCE_OUT;
  if (typeof evidencePath !== "string" || !isAbsolute(evidencePath)) fail("evidence_path_required");
  const relativeEvidence = relative(repositoryDirectory, evidencePath);
  if (relativeEvidence === "" || (!relativeEvidence.startsWith(`..${sep}`) && relativeEvidence !== "..")) {
    fail("evidence_must_stay_outside_repository");
  }
  try {
    await access(evidencePath);
    fail("evidence_path_exists");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("soak_failed:")) throw error;
  }
  const origin = {
    x: coordinate("CUA_E2E_CONTENT_ORIGIN_X_PX"),
    y: coordinate("CUA_E2E_CONTENT_ORIGIN_Y_PX"),
  };
  const durationMinimum = positiveInteger("CUA_SOAK_DURATION_SECONDS", 1800);
  const actionMinimum = positiveInteger("CUA_SOAK_MIN_ACTIONS", 200);

  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  await execFileAsync(npx, ["--yes", "pnpm@9.0.4", "build"], { cwd: productDirectory });
  await access(mcpScript);
  const lock = JSON.parse(await readFile(resolve(productDirectory, "engine.lock.json"), "utf8"));
  let visual: VisualSession | undefined;
  let client: Client | undefined;
  let transport: StdioClientTransport | undefined;
  let stderr = "";
  let sensitiveLogEvents = 0;
  let actionsCompleted = 0;
  let completeCycles = 0;
  let rssWarm = 0;
  let started = 0;
  let observedEngineVersion: string | undefined;
  try {
    visual = await startVisualSession(browser);
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [mcpScript],
      cwd: productDirectory,
      stderr: "pipe",
    });
    const stderrStream = transport.stderr as Readable | null;
    stderrStream?.setEncoding("utf8");
    stderrStream?.on("data", (chunk) => {
      const text = String(chunk);
      stderr = `${stderr}${text}`.slice(-1_000_000);
      if (stderr.includes(privateMarker) || /"(?:text|keys|clipboard|prompt|environment)"\s*:/i.test(stderr) || stderr.includes("iVBOR")) {
        sensitiveLogEvents += 1;
        rejectSensitiveLog?.(new Error("soak_failed:sensitive_log_output"));
        rejectSensitiveLog = undefined;
      }
    });
    client = new Client({ name: "computer-use-soak", version: "1.0.0" });
    await client.connect(transport);
    const pid = transport.pid;
    if (pid === null) fail("mcp_pid_missing");
    started = Date.now();

    while ((Date.now() - started) / 1000 < durationMinimum || actionsCompleted < actionMinimum) {
      if (visual === undefined) fail("visual_session_missing");
      const cycleVisual: VisualSession = visual;
      const initialState = await fetchJson<State>(cycleVisual.fixture.url, "/state");
      const observation = await observe(client, platform, lock.version);
      observedEngineVersion = observation.engineVersion;
      let current: Frame = observation;
      const consumed = current.snapshotId;
      current = await act(client, current.snapshotId, { type: "click", ...point(cycleVisual.layout, current, "text-target", origin) });
      actionsCompleted += 1;
      const stale = CallToolResultSchema.parse(await withDeadline(client.callTool({
        name: "computer_act",
        arguments: { snapshot_id: consumed, action: { type: "wait", ms: 0 } },
      })));
      if (stale.isError !== true || (stale.structuredContent as { code?: unknown })?.code !== "stale_snapshot") {
        fail("stale_snapshot_accepted");
      }
      current = await act(client, current.snapshotId, { type: "type", text: privateMarker });
      actionsCompleted += 1;
      current = await act(client, current.snapshotId, { type: "keypress", keys: ["ENTER"] });
      actionsCompleted += 1;
      current = await act(client, current.snapshotId, { type: "click", ...point(cycleVisual.layout, current, "click-target", origin) });
      actionsCompleted += 1;
      current = await act(client, current.snapshotId, {
        type: "scroll",
        ...point(cycleVisual.layout, current, "scroll-target", origin),
        direction: "down",
        amount: 6,
        by: "line",
      });
      actionsCompleted += 1;
      const from = point(cycleVisual.layout, current, "drag-source", origin);
      const to = point(cycleVisual.layout, current, "drop-target", origin);
      current = await act(client, current.snapshotId, { type: "drag", from_x: from.x, from_y: from.y, to_x: to.x, to_y: to.y, duration_ms: 500 });
      actionsCompleted += 1;
      await act(client, current.snapshotId, { type: "wait", ms: 50 });
      actionsCompleted += 1;
      const finalState = await fetchJson<State>(cycleVisual.fixture.url, "/state");
      if (
        finalState.clicks !== initialState.clicks + 1
        || finalState.text !== privateMarker
        || finalState.keypresses <= initialState.keypresses
        || finalState.scroll.events <= initialState.scroll.events
        || finalState.drop.count !== initialState.drop.count + 1
      ) fail("coordinate_mismatch");
      visual = await replaceVisualSession(cycleVisual, {
        reset: async (session) => {
          const reset = await fetchJson<State>(session.fixture.url, "/reset", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          });
          if (
            reset.generation !== finalState.generation + 1
            || reset.clicks !== 0
            || reset.text !== ""
            || reset.scroll.events !== 0
            || reset.drop.count !== 0
          ) fail("fixture_reset_failed");
        },
        close: closeVisualSession,
        start: () => startVisualSession(browser),
      });
      completeCycles += 1;
      if (completeCycles === 1) rssWarm = await rssMiB(pid);
      if (sensitiveLogEvents > 0) fail("sensitive_log_output");
    }

    const rssFinal = await rssMiB(pid);
    const rssDelta = rssFinal - rssWarm;
    if (rssDelta > 150) fail("rss_growth_exceeded");
    const durationSeconds = Math.floor((Date.now() - started) / 1000);
    if (observedEngineVersion === undefined) fail("observation_engine_identity_missing");
    await writeSoakEvidence(evidencePath, {
      schema_version: 1,
      evidence_type: "computer-use-soak",
      platform,
      generated_at: new Date().toISOString(),
      engine_version: observedEngineVersion,
      duration_seconds: durationSeconds,
      actions_completed: actionsCompleted,
      complete_cycles: completeCycles,
      plugin_seam_failures: 0,
      stale_snapshot_acceptances: 0,
      coordinate_mismatches: 0,
      deadlocks: 0,
      unclassified_timeouts: 0,
      malformed_pngs: 0,
      sensitive_log_events: sensitiveLogEvents,
      rss_warm_mib: Number(rssWarm.toFixed(3)),
      rss_final_mib: Number(rssFinal.toFixed(3)),
      rss_delta_mib: Number(rssDelta.toFixed(3)),
      fixture_oracle: "loopback-http-state",
    });
    process.stdout.write(`PASS: ${platform} soak evidence written outside the repository\n`);
  } finally {
    await client?.close().catch(() => undefined);
    await transport?.close().catch(() => undefined);
    if (visual !== undefined) await closeVisualSession(visual);
    void stderr;
  }
}

function isDirectEntryPoint(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url;
}

if (isDirectEntryPoint()) {
  await main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
