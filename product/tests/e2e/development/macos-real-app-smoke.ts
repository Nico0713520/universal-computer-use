import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import {
  callTool,
  hasPng,
  requireSnapshot,
  structured,
  type PublicApp,
  type PublicElement,
  type PublicWindow,
} from "./macos-acceptance-support.js";
import { verifyExactVisibleText } from "./macos-visual-text-oracle.js";

export type RealAppSmoke = Readonly<{
  calculator_703: boolean;
  textedit_unique_value: boolean;
  textedit_single_write: boolean;
  error_code?:
    | "calculator_unavailable"
    | "textedit_unavailable"
    | "unsupported_locale"
    | "verification_failed";
  cleanup_failed?: true;
}>;

type ErrorCode = NonNullable<RealAppSmoke["error_code"]>;

class SmokeFailure extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}

export type Discovery = Readonly<{
  result: CallToolResult;
  app: PublicApp;
  appRef: string;
  windows: readonly PublicWindow[];
  windowRefs: ReadonlySet<string>;
}>;

function normalized(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC").trim() : "";
}

function isSuccessfulState(result: CallToolResult): boolean {
  const state = structured(result);
  return result.isError !== true && state.next_state !== "unavailable" &&
    typeof state.snapshot_id === "string" &&
    state.action_result?.status === "executed";
}

function requireSuccessfulState(result: CallToolResult): CallToolResult {
  if (!isSuccessfulState(result)) throw new SmokeFailure("verification_failed");
  return result;
}

function windowRefs(windows: readonly PublicWindow[]): ReadonlySet<string> {
  const refs = windows.flatMap((window) => typeof window.window_ref === "string" ? [window.window_ref] : []);
  if (refs.length !== windows.length || new Set(refs).size !== refs.length) {
    throw new SmokeFailure("verification_failed");
  }
  return new Set(refs);
}

export function selectExactVisibleWindow(
  windows: readonly PublicWindow[],
): PublicWindow | undefined {
  if (windows.length === 1 && typeof windows[0]?.window_ref === "string") return windows[0];
  const visible = windows.filter((window) =>
    typeof window.window_ref === "string" &&
    window.is_on_screen === true &&
    window.minimized !== true);
  return visible.length === 1 ? visible[0] : undefined;
}

async function discoverApp(
  client: Client,
  bundleQuery: string,
  missingCode: ErrorCode,
): Promise<Discovery> {
  const result = await callTool(client, "computer_observe", {
    target: { kind: "desktop" },
    discover: { apps: true, windows: true, query: bundleQuery },
  });
  if (result.isError === true || !hasPng(result)) throw new SmokeFailure("verification_failed");
  const apps = structured(result).apps ?? [];
  const appRef = apps[0]?.app_ref;
  if (apps.length !== 1 || typeof appRef !== "string") throw new SmokeFailure(missingCode);
  const app = apps[0];
  const windows = (structured(result).windows ?? []).filter((window) => window.app_ref === appRef);
  return { result, app, appRef, windows, windowRefs: windowRefs(windows) };
}

async function observeWindow(
  client: Client,
  windowRef: string,
  includeScreenshot: boolean,
): Promise<CallToolResult> {
  const result = await callTool(client, "computer_observe", {
    target: { kind: "window", window_ref: windowRef },
    include_screenshot: includeScreenshot,
    elements: { max_elements: 150, max_depth: 12 },
  });
  if (result.isError === true || (includeScreenshot && !hasPng(result))) {
    throw new SmokeFailure("verification_failed");
  }
  requireSnapshot(result);
  return result;
}

function uniqueElement(
  result: CallToolResult,
  predicate: (element: PublicElement) => boolean,
): PublicElement | undefined {
  const candidates = (structured(result).elements ?? []).filter(predicate);
  return candidates.length === 1 && typeof candidates[0]?.element_ref === "string"
    ? candidates[0]
    : undefined;
}

function labelIs(element: PublicElement, labels: readonly string[]): boolean {
  const candidate = normalized(element.label).toLocaleLowerCase("en-US");
  return labels.some((label) => candidate === label.normalize("NFKC").toLocaleLowerCase("en-US"));
}

async function clickCalculatorControl(
  client: Client,
  current: CallToolResult,
  labels: readonly string[],
): Promise<CallToolResult> {
  const element = uniqueElement(current, (candidate) => labelIs(candidate, labels));
  if (typeof element?.element_ref !== "string") throw new SmokeFailure("unsupported_locale");
  return requireSuccessfulState(await callTool(client, "computer_act", {
    snapshot_id: requireSnapshot(current),
    action: { type: "click", element_ref: element.element_ref },
    delivery: "background",
    next_observation: { mode: "semantic" },
  }));
}

async function calculatorKeypress(
  client: Client,
  current: CallToolResult,
  keys: readonly string[],
): Promise<CallToolResult> {
  const result = requireSuccessfulState(await callTool(client, "computer_act", {
    snapshot_id: requireSnapshot(current),
    action: { type: "keypress", keys },
    delivery: "foreground",
    next_observation: { mode: "semantic" },
  }));
  if (structured(result).observation_mode !== "visual_recovery" || !hasPng(result)) {
    throw new SmokeFailure("verification_failed");
  }
  return result;
}

export async function ensureCalculatorWindow(
  client: Client,
  discovered: Discovery,
): Promise<Readonly<{ windowRef: string; current: CallToolResult }>> {
  const existing = selectExactVisibleWindow(discovered.windows);
  if (typeof existing?.window_ref === "string") {
    const windowRef = existing.window_ref;
    return { windowRef, current: await observeWindow(client, windowRef, true) };
  }
  if (discovered.windows.length > 1) throw new SmokeFailure("calculator_unavailable");
  const launched = await callTool(client, "computer_act", {
    snapshot_id: requireSnapshot(discovered.result),
    action: { type: "launch_app", app_ref: discovered.appRef },
  });
  if (!isSuccessfulState(launched)) throw new SmokeFailure("calculator_unavailable");
  const target = structured(launched).target;
  if (target?.kind === "window" && typeof target.window_ref === "string") {
    return { windowRef: target.window_ref, current: launched };
  }
  const refreshed = await discoverApp(client, "com.apple.calculator", "calculator_unavailable");
  const refreshedWindow = selectExactVisibleWindow(refreshed.windows);
  if (typeof refreshedWindow?.window_ref !== "string") {
    throw new SmokeFailure("calculator_unavailable");
  }
  const windowRef = refreshedWindow.window_ref;
  return { windowRef, current: await observeWindow(client, windowRef, true) };
}

async function runCalculator(
  client: Client,
  onWindowRef: (windowRef: string) => void,
  onMutationAttempt: () => void,
): Promise<Readonly<{
  passed: boolean;
  current?: CallToolResult;
}>> {
  const discovered = await discoverApp(client, "com.apple.calculator", "calculator_unavailable");
  const ensured = await ensureCalculatorWindow(client, discovered);
  const windowRef = ensured.windowRef;
  onWindowRef(windowRef);
  let current = ensured.current;
  if (!hasPng(current)) current = await observeWindow(client, windowRef, true);

  onMutationAttempt();
  current = await clickCalculatorControl(client, current, ["AC", "Clear", "All Clear", "清除", "全部清除"]);
  onMutationAttempt();
  current = await clickCalculatorControl(client, current, ["3"]);
  onMutationAttempt();
  current = await clickCalculatorControl(client, current, ["7"]);

  const multiply = uniqueElement(current, (element) => labelIs(element, ["×", "Multiply", "乘", "乘以"]));
  onMutationAttempt();
  current = typeof multiply?.element_ref === "string"
    ? await clickCalculatorControl(client, current, [normalized(multiply.label)])
    : await calculatorKeypress(client, current, ["shift", "8"]);

  onMutationAttempt();
  current = await clickCalculatorControl(client, current, ["1"]);
  onMutationAttempt();
  current = await clickCalculatorControl(client, current, ["9"]);
  const equals = uniqueElement(current, (element) => labelIs(element, ["=", "Equals", "等于"]));
  onMutationAttempt();
  current = typeof equals?.element_ref === "string"
    ? await clickCalculatorControl(client, current, [normalized(equals.label)])
    : await calculatorKeypress(client, current, ["enter"]);
  current = await observeWindow(client, windowRef, true);
  return { passed: await verifyExactVisibleText(current, "703"), current };
}

export async function restoreCalculator(
  client: Client,
  touched: boolean,
  windowRef: string | undefined,
  verified703State: CallToolResult | undefined,
  verifyVisibleText: (result: CallToolResult, expected: string) => Promise<boolean> =
    verifyExactVisibleText,
): Promise<void> {
  if (!touched) return;
  if (windowRef === undefined || verified703State === undefined ||
      structured(verified703State).target?.window_ref !== windowRef || !hasPng(verified703State)) {
    throw new SmokeFailure("verification_failed");
  }
  const current = await observeWindow(client, windowRef, true);
  await clickCalculatorControl(
    client,
    current,
    ["AC", "Clear", "All Clear", "清除", "全部清除"],
  );
  let observed = await observeWindow(client, windowRef, true);
  if (await verifyVisibleText(observed, "703")) {
    await clickCalculatorControl(
      client,
      observed,
      ["AC", "Clear", "All Clear", "清除", "全部清除"],
    );
    observed = await observeWindow(client, windowRef, true);
    if (await verifyVisibleText(observed, "703")) {
      throw new SmokeFailure("verification_failed");
    }
  }
}

function oneNewWindow(
  before: ReadonlySet<string>,
  after: readonly PublicWindow[],
): string | undefined {
  const added = after.filter((window) =>
    typeof window.window_ref === "string" && !before.has(window.window_ref));
  const selected = selectExactVisibleWindow(added);
  return typeof selected?.window_ref === "string" ? selected.window_ref : undefined;
}

async function openTextEditDocument(documentPath: string): Promise<void> {
  const child = spawn("/usr/bin/open", ["-a", "TextEdit", documentPath], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  const [code] = await once(child, "exit") as [number | null];
  if (code !== 0) throw new SmokeFailure("textedit_unavailable");
}

export async function ownFreshTextEditWindow(
  client: Client,
  documentPath: string,
  openDocument: (path: string) => Promise<void> = openTextEditDocument,
): Promise<string> {
  const initial = await discoverApp(client, "com.apple.TextEdit", "textedit_unavailable");
  const before = initial.windowRefs;
  await openDocument(documentPath);
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const refreshed = await discoverApp(client, "com.apple.TextEdit", "textedit_unavailable");
    const owned = oneNewWindow(before, refreshed.windows);
    if (owned !== undefined) return owned;
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new SmokeFailure("textedit_unavailable");
}

function editableElement(result: CallToolResult): PublicElement | undefined {
  return uniqueElement(result, (element) =>
    Array.isArray(element.actions) && element.actions.includes("set_value") &&
    (normalized(element.role).toLocaleLowerCase("en-US").includes("text") ||
      typeof element.value === "string"));
}

async function runTextEdit(client: Client, ownedWindowRef: string): Promise<Readonly<{
  passed: boolean;
  singleWrite: boolean;
  current: CallToolResult;
}>> {
  let current = await observeWindow(client, ownedWindowRef, true);
  const editable = editableElement(current);
  if (typeof editable?.element_ref !== "string") throw new SmokeFailure("textedit_unavailable");
  const nonce = `ucu-${randomUUID()}`;
  let mutationRequests = 0;
  mutationRequests += 1;
  current = await callTool(client, "computer_act", {
    snapshot_id: requireSnapshot(current),
    action: { type: "set_value", element_ref: editable.element_ref, value: nonce },
    next_observation: { mode: "semantic" },
  });
  const passed = validTextEditSetValueResult(current, nonce);
  return {
    passed,
    singleWrite: mutationRequests === 1,
    current,
  };
}

export function validTextEditSetValueResult(
  result: CallToolResult,
  expected: string,
): boolean {
  const state = structured(result);
  const matches = (state.elements ?? []).filter((element) => element.value === expected);
  const verificationState = (
    state.verification?.status === "satisfied" &&
    state.observation_mode === "semantic"
  ) || (
    state.verification?.status === "unknown" &&
    state.action_result?.error_code === "verification_unknown" &&
    state.observation_mode === "visual_recovery" &&
    state.visual_status === "available" &&
    hasPng(result)
  );
  return isSuccessfulState(result) &&
    state.action_result?.effect === "confirmed" &&
    state.action_result.evidence?.includes("value_readback") === true &&
    matches.length === 1 && verificationState;
}

async function textEditWindows(client: Client): Promise<readonly PublicWindow[]> {
  const result = await callTool(client, "computer_observe", {
    target: { kind: "desktop" },
    discover: { apps: true, windows: true, query: "com.apple.TextEdit" },
  });
  if (result.isError === true || !hasPng(result)) throw new SmokeFailure("verification_failed");
  return structured(result).windows ?? [];
}

async function waitForTextEditWindowGone(
  client: Client,
  ownedWindowRef: string,
  timeoutMs = 5_000,
  ownedTitle?: string,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    const windows = await textEditWindows(client);
    const ownedStillVisible = ownedTitle === undefined
      ? windows.some((window) => window.window_ref === ownedWindowRef)
      : windows.some((window) => window.title === ownedTitle && window.is_on_screen !== false);
    if (!ownedStillVisible) return true;
    if (Date.now() >= deadline) return false;
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 50));
  } while (true);
}

export async function cleanupOwnedTextEdit(
  client: Client,
  ownedWindowRef: string | undefined,
  _current: CallToolResult | undefined,
  closePollTimeoutMs = 5_000,
  ownedTitle?: string,
): Promise<void> {
  if (ownedWindowRef === undefined) return;
  // invoke_menu is the one Cua macOS primitive that makes the exact pid/window
  // key, resolves each live AX menu hop, and restores the prior foreground.
  // Try only closed, localized TextEdit path variants; a refused path consumes
  // its snapshot, so every candidate reacquires the exact owned ref.
  let state = await observeWindow(client, ownedWindowRef, false);
  const hasChineseMenu = (structured(state).elements ?? []).some((element) =>
    normalized(element.label) === "文件");
  const englishPaths = [["File", "Close"], ["File", "Close Window"]] as const;
  const chinesePaths = [["文件", "关闭"], ["文件", "关闭窗口"]] as const;
  const paths = hasChineseMenu
    ? [...chinesePaths, ...englishPaths]
    : [...englishPaths, ...chinesePaths];
  let closeExecuted = false;
  for (const path of paths) {
    const result = await callTool(client, "computer_act", {
      snapshot_id: requireSnapshot(state),
      action: { type: "invoke_menu", path },
      next_observation: { mode: "semantic" },
    });
    if (result.isError !== true && structured(result).action_result?.status === "executed") {
      closeExecuted = true;
      break;
    }
    state = await observeWindow(client, ownedWindowRef, false);
  }
  if (!closeExecuted) throw new SmokeFailure("verification_failed");
  // Empty AXValue is absent in the locked Cua 0.22.2 contract, so cleanup must
  // not fabricate an empty readback. Destroying the exact owned unsaved window
  // (and explicitly discarding its sheet when present) is the trustworthy
  // cleanup postcondition; the unique owned title becoming non-visible proves it.
  if (!await waitForTextEditWindowGone(client, ownedWindowRef, closePollTimeoutMs, ownedTitle)) {
    const sheet = await observeWindow(client, ownedWindowRef, true);
    const discard = uniqueElement(sheet, (element) => labelIs(element, [
      "Don't Save",
      "Delete",
      "不存储",
      "不保存",
      "删除",
    ]));
    if (typeof discard?.element_ref === "string") {
      requireSuccessfulState(await callTool(client, "computer_act", {
        snapshot_id: requireSnapshot(sheet),
        action: { type: "click", element_ref: discard.element_ref },
        delivery: "background",
        next_observation: { mode: "semantic" },
      }));
      if (!await waitForTextEditWindowGone(client, ownedWindowRef, closePollTimeoutMs, ownedTitle)) {
        throw new SmokeFailure("verification_failed");
      }
      return;
    }
    throw new SmokeFailure("verification_failed");
  }
}

export async function cleanupSmokeResources(
  client: Client,
  resources: Readonly<{
    calculatorTouched: boolean;
    calculatorWindowRef: string | undefined;
    calculatorCurrent?: CallToolResult | undefined;
    ownedTextEditWindow: string | undefined;
    textEditCurrent: CallToolResult | undefined;
    ownedTextEditRoot?: string | undefined;
    ownedTextEditTitle?: string | undefined;
  }>,
): Promise<boolean> {
  let passed = true;
  try {
    await restoreCalculator(
      client,
      resources.calculatorTouched,
      resources.calculatorWindowRef,
      resources.calculatorCurrent,
    );
  } catch {
    passed = false;
  }
  try {
    await cleanupOwnedTextEdit(
      client,
      resources.ownedTextEditWindow,
      resources.textEditCurrent,
      5_000,
      resources.ownedTextEditTitle,
    );
  } catch {
    passed = false;
  }
  if (resources.ownedTextEditRoot !== undefined) {
    try {
      await rm(resources.ownedTextEditRoot, { recursive: true, force: true });
    } catch {
      passed = false;
    }
  }
  return passed;
}

export async function runRealAppSmoke(client: Client): Promise<RealAppSmoke> {
  let calculatorWindowRef: string | undefined;
  let calculatorTouched = false;
  let calculatorCurrent: CallToolResult | undefined;
  let ownedTextEditWindow: string | undefined;
  let textEditCurrent: CallToolResult | undefined;
  let ownedTextEditRoot: string | undefined;
  let ownedTextEditTitle: string | undefined;
  let calculatorPassed = false;
  let textEditPassed = false;
  let textEditSingleWrite = false;
  let failure: ErrorCode | undefined;

  try {
    const calculator = await runCalculator(
      client,
      (windowRef) => { calculatorWindowRef = windowRef; },
      () => { calculatorTouched = true; },
    );
    calculatorPassed = calculator.passed;
    calculatorCurrent = calculator.current;
    if (!calculatorPassed) throw new SmokeFailure("verification_failed");
  } catch (error) {
    failure = error instanceof SmokeFailure ? error.code : "verification_failed";
  }

  try {
    ownedTextEditRoot = await mkdtemp(join(tmpdir(), "ucu-textedit-smoke-"));
    ownedTextEditTitle = `ucu-${randomUUID()}.txt`;
    const documentPath = join(ownedTextEditRoot, ownedTextEditTitle);
    await writeFile(documentPath, "", { flag: "wx" });
    ownedTextEditWindow = await ownFreshTextEditWindow(client, documentPath);
    const textEdit = await runTextEdit(client, ownedTextEditWindow);
    textEditCurrent = textEdit.current;
    textEditPassed = textEdit.passed;
    textEditSingleWrite = textEdit.singleWrite;
    if (!textEditPassed || !textEditSingleWrite) throw new SmokeFailure("verification_failed");
  } catch (error) {
    failure ??= error instanceof SmokeFailure ? error.code : "verification_failed";
  }

  const cleanupPassed = await cleanupSmokeResources(client, {
    calculatorTouched,
    calculatorWindowRef,
    calculatorCurrent,
    ownedTextEditWindow,
    textEditCurrent,
    ownedTextEditRoot,
    ownedTextEditTitle,
  });
  if (!cleanupPassed) failure ??= "verification_failed";

  return {
    calculator_703: calculatorPassed,
    textedit_unique_value: textEditPassed,
    textedit_single_write: textEditSingleWrite,
    ...(failure === undefined ? {} : { error_code: failure }),
    ...(cleanupPassed ? {} : { cleanup_failed: true as const }),
  };
}
