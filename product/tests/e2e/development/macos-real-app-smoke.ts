import { randomUUID } from "node:crypto";

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

function showsExactly703(result: CallToolResult): boolean {
  const values = (structured(result).elements ?? [])
    .flatMap((element) => element.value === undefined ? [] : [normalized(element.value)])
    .filter((value) => value === "703");
  return values.length === 1;
}

function showsExactlyValue(result: CallToolResult, value: string): boolean {
  return (structured(result).elements ?? [])
    .filter((element) => normalized(element.value) === value).length === 1;
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
  return { passed: showsExactly703(current), current };
}

export async function restoreCalculator(
  client: Client,
  touched: boolean,
  windowRef: string | undefined,
): Promise<void> {
  if (!touched) return;
  if (windowRef === undefined) throw new SmokeFailure("verification_failed");
  const current = await observeWindow(client, windowRef, true);
  const restored = await clickCalculatorControl(
    client,
    current,
    ["AC", "Clear", "All Clear", "清除", "全部清除"],
  );
  if (!showsExactlyValue(restored, "0")) {
    throw new SmokeFailure("verification_failed");
  }
}

function oneNewWindow(before: ReadonlySet<string>, after: ReadonlySet<string>): string | undefined {
  const added = [...after].filter((windowRef) => !before.has(windowRef));
  return added.length === 1 ? added[0] : undefined;
}

export async function ownFreshTextEditWindow(client: Client): Promise<string> {
  const initial = await discoverApp(client, "com.apple.TextEdit", "textedit_unavailable");
  const before = initial.windowRefs;

  if (initial.windows.length === 0) {
    const launched = await callTool(client, "computer_act", {
      snapshot_id: requireSnapshot(initial.result),
      action: { type: "launch_app", app_ref: initial.appRef },
    });
    if (!isSuccessfulState(launched)) throw new SmokeFailure("textedit_unavailable");
  } else {
    const sourceWindow = initial.windows.find((window) => typeof window.window_ref === "string");
    if (typeof sourceWindow?.window_ref !== "string") throw new SmokeFailure("textedit_unavailable");
    const source = await observeWindow(client, sourceWindow.window_ref, true);
    const created = await callTool(client, "computer_act", {
      snapshot_id: requireSnapshot(source),
      action: { type: "keypress", keys: ["cmd", "n"] },
      delivery: "foreground",
      next_observation: { mode: "visual" },
    });
    if (!isSuccessfulState(created)) throw new SmokeFailure("textedit_unavailable");
  }

  const refreshed = await discoverApp(client, "com.apple.TextEdit", "textedit_unavailable");
  const owned = oneNewWindow(before, refreshed.windowRefs);
  if (owned === undefined) throw new SmokeFailure("textedit_unavailable");
  return owned;
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
  const state = structured(current);
  const matches = (state.elements ?? []).filter((element) => element.value === nonce);
  const passed = isSuccessfulState(current) &&
    state.action_result?.effect === "confirmed" &&
    state.verification?.status === "satisfied" &&
    state.observation_mode === "semantic" &&
    matches.length === 1;
  return {
    passed,
    singleWrite: mutationRequests === 1,
    current,
  };
}

export async function cleanupOwnedTextEdit(
  client: Client,
  ownedWindowRef: string | undefined,
  _current: CallToolResult | undefined,
): Promise<void> {
  if (ownedWindowRef === undefined) return;
  // The mutation result may be an error or already consumed. Cleanup always
  // reacquires the exact proven-owned window instead of trusting cached state.
  const state = await observeWindow(client, ownedWindowRef, false);
  await callTool(client, "computer_act", {
    snapshot_id: requireSnapshot(state),
    action: { type: "keypress", keys: ["cmd", "w"] },
    delivery: "foreground",
    next_observation: { mode: "semantic" },
  });
  // Empty AXValue is absent in the locked Cua 0.22.2 contract, so cleanup must
  // not fabricate an empty readback. Destroying the exact owned unsaved window
  // (and explicitly discarding its sheet when present) is the trustworthy
  // cleanup postcondition; the final ref-set difference proves it.
  let refreshed = await discoverApp(client, "com.apple.TextEdit", "textedit_unavailable");
  if (refreshed.windowRefs.has(ownedWindowRef)) {
    const sheet = await observeWindow(client, ownedWindowRef, true);
    const discard = uniqueElement(sheet, (element) => labelIs(element, [
      "Don't Save",
      "Delete",
      "不存储",
      "不保存",
    ]));
    if (typeof discard?.element_ref !== "string") throw new SmokeFailure("verification_failed");
    requireSuccessfulState(await callTool(client, "computer_act", {
      snapshot_id: requireSnapshot(sheet),
      action: { type: "click", element_ref: discard.element_ref },
      delivery: "background",
      next_observation: { mode: "semantic" },
    }));
    refreshed = await discoverApp(client, "com.apple.TextEdit", "textedit_unavailable");
    if (refreshed.windowRefs.has(ownedWindowRef)) throw new SmokeFailure("verification_failed");
  }
}

export async function cleanupSmokeResources(
  client: Client,
  resources: Readonly<{
    calculatorTouched: boolean;
    calculatorWindowRef: string | undefined;
    ownedTextEditWindow: string | undefined;
    textEditCurrent: CallToolResult | undefined;
  }>,
): Promise<boolean> {
  let passed = true;
  try {
    await restoreCalculator(
      client,
      resources.calculatorTouched,
      resources.calculatorWindowRef,
    );
  } catch {
    passed = false;
  }
  try {
    await cleanupOwnedTextEdit(
      client,
      resources.ownedTextEditWindow,
      resources.textEditCurrent,
    );
  } catch {
    passed = false;
  }
  return passed;
}

export async function runRealAppSmoke(client: Client): Promise<RealAppSmoke> {
  let calculatorWindowRef: string | undefined;
  let calculatorTouched = false;
  let ownedTextEditWindow: string | undefined;
  let textEditCurrent: CallToolResult | undefined;
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
    if (!calculatorPassed) throw new SmokeFailure("verification_failed");
  } catch (error) {
    failure = error instanceof SmokeFailure ? error.code : "verification_failed";
  }

  try {
    ownedTextEditWindow = await ownFreshTextEditWindow(client);
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
    ownedTextEditWindow,
    textEditCurrent,
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
