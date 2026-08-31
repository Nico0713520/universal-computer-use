import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { access, copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import type { Stream } from "node:stream";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { AcceptanceTelemetryCollector } from "./macos-acceptance-telemetry.js";

export const WINDOW_TITLE = "Computer Use Deterministic Desktop Harness";
export const FOCUS_SENTINEL_BUNDLE_ID = "dev.universal-computer-use.acceptance-focus-sentinel";
export const FOCUS_SENTINEL_WINDOW_TITLE = "UCU Acceptance Focus Sentinel";
export const FOCUS_SENTINEL_TEXT_LABEL = "Native unique text value";
export const CHROME_BUNDLE_ID = "com.google.Chrome";

const FIXTURE_SCRIPT = resolve("tests/fixtures/desktop-harness/server.mjs");
const MCP_SCRIPT = resolve("dist/mcp/main.js");
const SENTINEL_SOURCE = resolve("tests/fixtures/focus-sentinel/main.swift");
const SENTINEL_PLIST = resolve("tests/fixtures/focus-sentinel/Info.plist");
const SWIFTC = "/usr/bin/swiftc";
const CODESIGN = "/usr/bin/codesign";
const OSASCRIPT = "/usr/bin/osascript";
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export type HarnessState = Readonly<{
  reset_generation: number;
  reset_ack_generation: number;
  clicks: number;
  pixel_clicks: number;
  semantic_sequence: readonly string[];
  text: string;
  text_write_count: number;
  overlay_enabled: boolean;
  overlay_clicks: number;
}>;

export type Point = Readonly<{ x: number; y: number }>;
export type FixtureLayout = Readonly<{
  controls?: Record<string, Point>;
  viewport?: {
    ready?: unknown;
    browser_css?: {
      outer_width?: unknown;
      outer_height?: unknown;
      inner_width?: unknown;
      inner_height?: unknown;
    } | null;
  };
}>;

export type PublicBounds = Readonly<{ x: number; y: number; width: number; height: number }>;
export type PublicApp = Readonly<{
  app_ref?: unknown;
  display_name?: unknown;
  running?: unknown;
}>;
export type PublicElement = Readonly<{
  element_ref?: unknown;
  role?: unknown;
  label?: unknown;
  value?: unknown;
  bounds?: PublicBounds;
  actions?: readonly unknown[];
}>;
export type PublicWindow = Readonly<{
  window_ref?: unknown;
  app_ref?: unknown;
  app_name?: unknown;
  title?: unknown;
  is_on_screen?: unknown;
  on_current_space?: unknown;
  minimized?: unknown;
}>;
export type StructuredResult = Readonly<{
  snapshot_id?: unknown;
  consumed_snapshot_id?: unknown;
  target?: { kind?: unknown; window_ref?: unknown; app_ref?: unknown };
  coordinate_space?: unknown;
  observation_mode?: unknown;
  visual_status?: unknown;
  next_state?: unknown;
  action_result?: {
    status?: unknown;
    effect?: unknown;
    route?: unknown;
    delivery?: unknown;
    evidence?: readonly unknown[];
    error_code?: unknown;
  };
  verification?: { status?: unknown; reason?: unknown };
  apps?: readonly PublicApp[];
  windows?: readonly PublicWindow[];
  elements?: readonly PublicElement[];
  screenshot?: { width?: unknown; height?: unknown };
  code?: unknown;
}>;

export type Connection = Readonly<{
  client: Client;
  transport: StdioClientTransport;
  pid: number;
  telemetry: AcceptanceTelemetryCollector;
}>;
export type FixtureProcess = Readonly<{ child: ChildProcess; url: string }>;
export type BrowserProcess = Readonly<{
  child: ChildProcess;
  pid: number;
  profile: string;
  bundleId: string;
}>;
export type FrontmostIdentity = Readonly<{ bundleIdentifier: string; processIdentifier: number }>;
export type FocusSentinelState = Readonly<{
  reset_generation: number;
  text: string;
  text_write_count: number;
}>;
export type FocusSentinel = Readonly<{
  child: ChildProcess;
  pid: number;
  temporaryRoot: string;
  appPath: string;
  state: { current: FocusSentinelState };
  stdoutListener: (chunk: string) => void;
}>;

export function parseFocusSentinelStateLine(line: string): FocusSentinelState | undefined {
  try {
    const value = JSON.parse(line) as Record<string, unknown>;
    if (value.event !== "state" || !Number.isSafeInteger(value.reset_generation) ||
        (value.reset_generation as number) < 0 || typeof value.text !== "string" ||
        !Number.isSafeInteger(value.text_write_count) || (value.text_write_count as number) < 0) {
      return undefined;
    }
    return {
      reset_generation: value.reset_generation as number,
      text: value.text,
      text_write_count: value.text_write_count as number,
    };
  } catch {
    return undefined;
  }
}

function attachFocusSentinelState(
  child: ChildProcess,
  initial: FocusSentinelState,
): Readonly<{
  state: { current: FocusSentinelState };
  stdoutListener: (chunk: string) => void;
}> {
  if (child.stdout === null) throw new Error("focus_sentinel_launch_failed:stdio_unavailable");
  const state = { current: initial };
  let pending = "";
  const stdoutListener = (chunk: string): void => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const next = parseFocusSentinelStateLine(line);
      if (next !== undefined && next.reset_generation >= state.current.reset_generation) {
        state.current = next;
      }
    }
  };
  child.stdout.on("data", stdoutListener);
  return { state, stdoutListener };
}

function childAlive(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (!childAlive(child)) return true;
  return new Promise<boolean>((resolvePromise) => {
    const timeout = setTimeout(() => finish(false), timeoutMs);
    const onExit = (): void => finish(true);
    const finish = (exited: boolean): void => {
      clearTimeout(timeout);
      child.off("exit", onExit);
      resolvePromise(exited);
    };
    child.once("exit", onExit);
  });
}

export async function stopOwnedProcess(child: ChildProcess | undefined): Promise<void> {
  if (child === undefined || !childAlive(child)) return;
  child.kill("SIGTERM");
  await waitForChildExit(child, 2_000);
  if (childAlive(child)) {
    child.kill("SIGKILL");
    if (!(await waitForChildExit(child, 2_000))) {
      throw new Error("acceptance_cleanup_process_alive");
    }
  }
}

async function waitForReadyLine(
  child: ChildProcess,
  timeoutMs: number,
  errorCode: string,
): Promise<string> {
  if (child.stdout === null || child.stderr === null) throw new Error(`${errorCode}:stdio_unavailable`);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stderr = "";
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  return new Promise<string>((resolvePromise, reject) => {
    let pending = "";
    const timeout = setTimeout(() => finish(new Error(`${errorCode}:ready_timeout`)), timeoutMs);
    const onData = (chunk: string): void => {
      pending += chunk;
      const newline = pending.indexOf("\n");
      if (newline >= 0) finish(undefined, pending.slice(0, newline));
    };
    const onExit = (code: number | null): void => {
      finish(new Error(`${errorCode}:exited:${String(code)}:${stderr}`));
    };
    const onError = (error: Error): void => {
      finish(new Error(`${errorCode}:spawn_error:${error.message}`));
    };
    const finish = (error?: Error, line?: string): void => {
      clearTimeout(timeout);
      child.stdout?.off("data", onData);
      child.off("exit", onExit);
      child.off("error", onError);
      if (error !== undefined) reject(error);
      else resolvePromise(line ?? "");
    };
    child.stdout?.on("data", onData);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

export async function startFixture(): Promise<FixtureProcess> {
  const child = spawn(process.execPath, [FIXTURE_SCRIPT], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const ready = JSON.parse(await waitForReadyLine(child, 5_000, "fixture_start")) as { url?: unknown };
    if (typeof ready.url !== "string" || !ready.url.startsWith("http://127.0.0.1:")) {
      throw new Error("fixture_ready_message_invalid");
    }
    return { child, url: ready.url };
  } catch (error) {
    await stopOwnedProcess(child).catch(() => undefined);
    throw error;
  }
}

export async function fixtureJson<T>(
  url: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${url}${path}`, init);
  if (!response.ok) throw new Error(`fixture_http_${response.status}:${path}`);
  return response.json() as Promise<T>;
}

export async function waitForFixture(url: string): Promise<FixtureLayout> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const layout = await fixtureJson<FixtureLayout>(url, "/layout");
    if (layout.viewport?.ready === true) return layout;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error("fixture_viewport_timeout");
}

export async function waitForState(
  url: string,
  predicate: (state: HarnessState) => boolean,
  errorCode = "fixture_effect_timeout",
): Promise<HarnessState> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const state = await fixtureJson<HarnessState>(url, "/state");
    if (predicate(state)) return state;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(errorCode);
}

export async function resetFixture(url: string): Promise<HarnessState> {
  const reset = await fixtureJson<HarnessState>(url, "/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  return waitForState(
    url,
    (state) => state.reset_generation === reset.reset_generation &&
      state.reset_ack_generation === reset.reset_generation,
    "fixture_reset_ack_timeout",
  );
}

export async function launchBrowser(url: string): Promise<BrowserProcess> {
  const executable = process.env.CUA_E2E_BROWSER ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  await access(executable);
  if (!executable.endsWith("/Google Chrome")) {
    throw new Error("acceptance_browser_bundle_unsupported");
  }
  const profile = await mkdtemp(join(tmpdir(), "ucu-development-browser-"));
  let child: ChildProcess | undefined;
  try {
    child = spawn(executable, [
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
    await once(child, "spawn");
    const pid = child.pid;
    if (pid === undefined) throw new Error("acceptance_browser_pid_unavailable");
    return { child, pid, profile, bundleId: CHROME_BUNDLE_ID };
  } catch (error) {
    await stopOwnedProcess(child).catch(() => undefined);
    await rm(profile, { recursive: true, force: true });
    throw error;
  }
}

export async function cleanupBrowser(browser: BrowserProcess | undefined): Promise<void> {
  if (browser === undefined) return;
  let failure: unknown;
  try {
    await stopOwnedProcess(browser.child);
  } catch (error) {
    failure = error;
  }
  try {
    await rm(browser.profile, { recursive: true, force: true });
  } catch (error) {
    failure ??= error;
  }
  if (failure !== undefined) throw failure;
}

export function attachAcceptanceTelemetry(
  transport: Readonly<{ stderr: Pick<Stream, "on"> | null }>,
): AcceptanceTelemetryCollector {
  const telemetry = new AcceptanceTelemetryCollector();
  transport.stderr?.on("data", (chunk: unknown) => {
    telemetry.ingest(typeof chunk === "string" ? chunk : String(chunk));
  });
  return telemetry;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export async function waitForOwnedPidExit(pid: number, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (pidAlive(pid)) {
    if (Date.now() >= deadline) throw new Error("acceptance_cleanup_mcp_process_alive");
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 25));
  }
}

export async function connectClient(name: string): Promise<Connection> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_SCRIPT],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const telemetry = attachAcceptanceTelemetry(transport);
  const client = new Client({ name, version: "1.0.0" });
  try {
    await client.connect(transport);
    const pid = transport.pid;
    if (pid === null) throw new Error("acceptance_mcp_pid_unavailable");
    return { client, transport, pid, telemetry };
  } catch (error) {
    const pid = transport.pid;
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    try {
      if (pid !== null) await waitForOwnedPidExit(pid);
    } finally {
      telemetry.clear();
    }
    throw error;
  }
}

export async function closeConnection(connection: Connection | undefined): Promise<void> {
  if (connection === undefined) return;
  let failure: unknown;
  try {
    await connection.client.close();
  } catch (error) {
    failure = error;
  }
  try {
    await connection.transport.close();
  } catch (error) {
    failure ??= error;
  }
  try {
    await waitForOwnedPidExit(connection.pid);
  } catch (error) {
    failure ??= error;
  }
  connection.telemetry.clear();
  if (failure !== undefined) throw failure;
}

export async function callTool(
  client: Client,
  name: "computer_observe" | "computer_act",
  argumentsValue: Record<string, unknown>,
): Promise<CallToolResult> {
  return CallToolResultSchema.parse(await client.callTool({ name, arguments: argumentsValue }));
}

export function structured(result: CallToolResult): StructuredResult {
  return result.structuredContent as StructuredResult;
}

export function hasPng(result: CallToolResult): boolean {
  const images = result.content.filter((item) => item.type === "image");
  if (images.length !== 1) return false;
  const image = images[0];
  if (image?.type !== "image" || image.mimeType !== "image/png") return false;
  return Buffer.from(image.data, "base64").subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC);
}

export function requireSnapshot(result: CallToolResult): string {
  const snapshotId = structured(result).snapshot_id;
  if (typeof snapshotId !== "string") throw new Error("mcp_snapshot_missing");
  return snapshotId;
}

export function requireWindow(result: CallToolResult, title = WINDOW_TITLE): string {
  const candidates = (structured(result).windows ?? []).filter((candidate) => candidate.title === title);
  if (candidates.length !== 1 || typeof candidates[0]?.window_ref !== "string") {
    throw new Error("mcp_window_ref_missing_or_ambiguous");
  }
  return candidates[0].window_ref;
}

export function requireElement(result: CallToolResult, label: string): Readonly<{
  elementRef: string;
  value?: string | number | boolean;
}> {
  const candidates = (structured(result).elements ?? []).filter((element) => element.label === label);
  const elementRef = candidates[0]?.element_ref;
  if (candidates.length !== 1 || typeof elementRef !== "string") {
    throw new Error(`mcp_element_missing_or_ambiguous:${label}`);
  }
  const candidate = candidates[0];
  return {
    elementRef,
    ...(typeof candidate.value === "string" || typeof candidate.value === "number" ||
        typeof candidate.value === "boolean" ? { value: candidate.value } : {}),
  };
}

export function fixedVisualPoint(
  layout: FixtureLayout,
  result: CallToolResult,
  controlId: string,
): Point {
  const control = layout.controls?.[controlId];
  const browser = layout.viewport?.browser_css;
  const screenshot = structured(result).screenshot;
  if (control === undefined || browser === null || browser === undefined || screenshot === undefined) {
    throw new Error(`fixture_visual_geometry_missing:${controlId}`);
  }
  const values = [
    browser.outer_width,
    browser.outer_height,
    browser.inner_width,
    browser.inner_height,
    screenshot.width,
    screenshot.height,
  ];
  if (!values.every((value) => typeof value === "number" && Number.isFinite(value) && value > 0)) {
    throw new Error(`fixture_visual_geometry_invalid:${controlId}`);
  }
  const [outerWidth, outerHeight, innerWidth, innerHeight, screenshotWidth, screenshotHeight] =
    values as number[];
  const contentLeft = (outerWidth - innerWidth) / 2;
  const contentTop = outerHeight - innerHeight;
  return {
    x: Math.round((contentLeft + control.x) * (screenshotWidth / outerWidth)),
    y: Math.round((contentTop + control.y) * (screenshotHeight / outerHeight)),
  };
}

async function runChecked(command: string, args: readonly string[], errorCode: string): Promise<void> {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  let code: number | null;
  try {
    [code] = await once(child, "exit");
  } catch (error) {
    throw new Error(`${errorCode}:spawn_error:${String(error)}`);
  }
  if (code !== 0) throw new Error(`${errorCode}:${stderr.trim()}`);
}

export async function frontmostIdentity(): Promise<FrontmostIdentity> {
  const script = [
    "ObjC.import('AppKit');",
    "const app = $.NSWorkspace.sharedWorkspace.frontmostApplication;",
    "JSON.stringify({bundleIdentifier: ObjC.unwrap(app.bundleIdentifier), processIdentifier: Number(app.processIdentifier)});",
  ].join(" ");
  const child = spawn(OSASCRIPT, ["-l", "JavaScript", "-e", script], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error("frontmost_oracle_unavailable");
  const parsed = JSON.parse(stdout) as { bundleIdentifier?: unknown; processIdentifier?: unknown };
  if (typeof parsed.bundleIdentifier !== "string" || !Number.isSafeInteger(parsed.processIdentifier)) {
    throw new Error("frontmost_oracle_invalid");
  }
  return {
    bundleIdentifier: parsed.bundleIdentifier,
    processIdentifier: parsed.processIdentifier as number,
  };
}

export function requireInteractiveSession(identity: FrontmostIdentity): void {
  if (identity.bundleIdentifier === "com.apple.loginwindow") {
    throw new Error("acceptance_preflight_interactive_session_required");
  }
}

export function backgroundTargetStayedCovered(
  before: FrontmostIdentity,
  after: FrontmostIdentity,
  backgroundTarget: FrontmostIdentity,
): boolean {
  const targetWasForeground =
    before.bundleIdentifier === backgroundTarget.bundleIdentifier &&
    before.processIdentifier === backgroundTarget.processIdentifier;
  const targetBecameForeground =
    after.bundleIdentifier === backgroundTarget.bundleIdentifier &&
    after.processIdentifier === backgroundTarget.processIdentifier;
  return !targetWasForeground && !targetBecameForeground;
}

export function buildOwnedApplicationActivationScript(identity: FrontmostIdentity): string {
  if (!Number.isSafeInteger(identity.processIdentifier) || identity.processIdentifier <= 0 ||
      identity.bundleIdentifier.length === 0) {
    throw new Error("owned_application_identity_invalid");
  }
  return [
    "ObjC.import('AppKit');",
    `const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${identity.processIdentifier});`,
    "if (!app) throw new Error('owned_application_missing');",
    "const bundle = ObjC.unwrap(app.bundleIdentifier);",
    `if (bundle !== ${JSON.stringify(identity.bundleIdentifier)}) throw new Error('owned_application_identity_mismatch');`,
    "if (!app.activateWithOptions($.NSApplicationActivateIgnoringOtherApps)) throw new Error('owned_application_activation_failed');",
  ].join(" ");
}

export async function activateOwnedApplication(identity: FrontmostIdentity): Promise<FrontmostIdentity> {
  await runChecked(
    OSASCRIPT,
    ["-l", "JavaScript", "-e", buildOwnedApplicationActivationScript(identity)],
    "owned_application_activation_failed",
  );
  return waitForFrontmost(identity);
}

export async function waitForFrontmost(
  expected: FrontmostIdentity | Readonly<{ bundleIdentifier: string }>,
): Promise<FrontmostIdentity> {
  const deadline = Date.now() + 5_000;
  let lastIdentity: FrontmostIdentity | undefined;
  while (Date.now() < deadline) {
    const identity = await frontmostIdentity();
    lastIdentity = identity;
    if (identity.bundleIdentifier === expected.bundleIdentifier &&
        (!("processIdentifier" in expected) || identity.processIdentifier === expected.processIdentifier)) {
      return identity;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  const expectedPid = "processIdentifier" in expected ? expected.processIdentifier : "any";
  const actual = lastIdentity === undefined
    ? "unknown"
    : `${lastIdentity.bundleIdentifier}/${lastIdentity.processIdentifier}`;
  throw new Error(
    `frontmost_oracle_mismatch:expected=${expected.bundleIdentifier}/${expectedPid}:actual=${actual}`,
  );
}

export async function startFocusSentinel(): Promise<FocusSentinel> {
  try {
    await Promise.all([access(SWIFTC), access(CODESIGN), access(OSASCRIPT)]);
  } catch {
    throw new Error("focus_sentinel_toolchain_unavailable");
  }
  const temporaryRoot = await mkdtemp(join(tmpdir(), "ucu-focus-sentinel-"));
  const appPath = join(temporaryRoot, "UCUAcceptanceFocusSentinel.app");
  const executableDirectory = join(appPath, "Contents", "MacOS");
  const executable = join(executableDirectory, "UCUAcceptanceFocusSentinel");
  let child: ChildProcess | undefined;
  try {
    await mkdir(executableDirectory, { recursive: true });
    await copyFile(SENTINEL_PLIST, join(appPath, "Contents", "Info.plist"));
    await runChecked(
      SWIFTC,
      [SENTINEL_SOURCE, "-framework", "AppKit", "-o", executable],
      "focus_sentinel_compile_failed",
    );
    await runChecked(
      CODESIGN,
      ["--force", "--sign", "-", "--timestamp=none", appPath],
      "focus_sentinel_codesign_failed",
    );
    child = spawn(executable, [], { stdio: ["ignore", "pipe", "pipe"] });
    const ready = JSON.parse(await waitForReadyLine(
      child,
      5_000,
      "focus_sentinel_launch_failed",
    )) as {
      ready?: unknown;
      pid?: unknown;
      reset_generation?: unknown;
      text?: unknown;
      text_write_count?: unknown;
    };
    if (ready.ready !== true || !Number.isSafeInteger(ready.pid) || ready.pid !== child.pid ||
        ready.reset_generation !== 0 || ready.text !== "" || ready.text_write_count !== 0) {
      throw new Error("focus_sentinel_identity_mismatch");
    }
    const pid = child.pid;
    if (pid === undefined) throw new Error("focus_sentinel_identity_mismatch");
    const tracked = attachFocusSentinelState(child, {
      reset_generation: 0,
      text: "",
      text_write_count: 0,
    });
    await waitForFrontmost({ bundleIdentifier: FOCUS_SENTINEL_BUNDLE_ID, processIdentifier: pid });
    return { child, pid, temporaryRoot, appPath, ...tracked };
  } catch (error) {
    await stopOwnedProcess(child).catch(() => undefined);
    await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function activateFocusSentinel(sentinel: FocusSentinel): Promise<FrontmostIdentity> {
  if (!childAlive(sentinel.child)) throw new Error("focus_sentinel_process_dead");
  sentinel.child.kill("SIGUSR1");
  return waitForFrontmost({
    bundleIdentifier: FOCUS_SENTINEL_BUNDLE_ID,
    processIdentifier: sentinel.pid,
  });
}

async function waitForFocusSentinelState(
  sentinel: FocusSentinel,
  predicate: (state: FocusSentinelState) => boolean,
  errorCode: string,
): Promise<FocusSentinelState> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!childAlive(sentinel.child)) throw new Error("focus_sentinel_process_dead");
    if (predicate(sentinel.state.current)) return sentinel.state.current;
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error(errorCode);
}

export async function resetFocusSentinelText(sentinel: FocusSentinel): Promise<FocusSentinelState> {
  if (!childAlive(sentinel.child)) throw new Error("focus_sentinel_process_dead");
  const previousGeneration = sentinel.state.current.reset_generation;
  if (!sentinel.child.kill("SIGUSR2")) throw new Error("focus_sentinel_reset_failed");
  return waitForFocusSentinelState(
    sentinel,
    (state) => state.reset_generation > previousGeneration && state.text === "" &&
      state.text_write_count === 0,
    "focus_sentinel_reset_timeout",
  );
}

export async function waitForFocusSentinelText(
  sentinel: FocusSentinel,
  expected: string,
): Promise<FocusSentinelState> {
  return waitForFocusSentinelState(
    sentinel,
    (state) => state.text === expected,
    "focus_sentinel_text_timeout",
  );
}

export async function cleanupFocusSentinel(sentinel: FocusSentinel | undefined): Promise<void> {
  if (sentinel === undefined) return;
  sentinel.child.stdout?.off("data", sentinel.stdoutListener);
  let failure: unknown;
  try {
    await stopOwnedProcess(sentinel.child);
  } catch (error) {
    failure = error;
  }
  try {
    await rm(sentinel.temporaryRoot, { recursive: true, force: true });
  } catch (error) {
    failure ??= error;
  }
  if (failure !== undefined) throw failure;
}

export function sentinelAlive(sentinel: FocusSentinel): boolean {
  return childAlive(sentinel.child);
}

export async function macosVersion(): Promise<string> {
  const child = spawn("/usr/bin/sw_vers", ["-productVersion"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  const [code] = await once(child, "exit");
  if (code !== 0 || !/^\d+(?:\.\d+){1,3}$/.test(stdout.trim())) {
    throw new Error("macos_version_unavailable");
  }
  return stdout.trim();
}
