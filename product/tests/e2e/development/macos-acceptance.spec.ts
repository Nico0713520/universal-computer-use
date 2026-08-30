import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { loadEngineLock } from "../../../src/engine/lock.js";
import { PRODUCT_VERSION, PROTOCOL_VERSION } from "../../../src/version.js";
import { scanNoFixedActionDelay } from "../../helpers/fixed-delay-scan.js";
import {
  ACCEPTANCE_SCENARIO_NAMES,
  AcceptanceRecorder,
  validateDevelopmentEvidenceSemantics,
  type AdaptiveCorrectnessEvidence,
  type RealAppSmokeEvidence,
} from "./acceptance-recorder.js";
import {
  FatalDiagnosticTracker,
  runFatalGuardedLifecycle,
} from "./fatal-diagnostic.js";
import {
  PerformanceRecorder,
  PERFORMANCE_SCENARIO_NAMES,
  type PerformanceOutcome,
  type PerformanceSample,
  type PerformanceScenarioName,
} from "./performance-recorder.js";
import { classifyToolCallFailure } from "./performance-classification.js";
import {
  establishPerformanceTelemetryBoundary,
  preparePerformanceScenario,
} from "./performance-preparation.js";
import { runRealAppSmoke } from "./macos-real-app-smoke.js";
import { runIndependentCorrectnessChecks } from "./correctness-orchestration.js";
import {
  buildSemanticSetValueRequest,
  buildBackgroundSemanticClickRequest,
  validBackgroundSemanticExecution,
  validEmptyTextGrounding,
  validFixtureObserve,
  validPixelActionResult,
  validSemanticSetValueResult,
} from "./macos-acceptance-result-checks.js";
import {
  CHROME_BUNDLE_ID,
  FOCUS_SENTINEL_BUNDLE_ID,
  FOCUS_SENTINEL_TEXT_LABEL,
  FOCUS_SENTINEL_WINDOW_TITLE,
  WINDOW_TITLE,
  activateOwnedApplication,
  activateFocusSentinel,
  callTool,
  cleanupBrowser,
  cleanupFocusSentinel,
  closeConnection,
  connectClient,
  fixedVisualPoint,
  fixtureJson,
  frontmostIdentity,
  hasPng,
  launchBrowser,
  macosVersion,
  requireElement,
  requireInteractiveSession,
  requireSnapshot,
  requireWindow,
  resetFixture,
  resetFocusSentinelText,
  sentinelAlive,
  startFixture,
  startFocusSentinel,
  stopOwnedProcess,
  structured,
  waitForFixture,
  waitForFocusSentinelText,
  waitForState,
  type BrowserProcess,
  type Connection,
  type FixtureLayout,
  type FixtureProcess,
  type FocusSentinel,
  type HarnessState,
} from "./macos-acceptance-support.js";

const REAL_ACCEPTANCE = process.env.CUA_DEVELOPMENT_ACCEPTANCE === "1";
const EVIDENCE_SCHEMA = new URL("./evidence.schema.json", import.meta.url);
const ACCEPTANCE_DEADLINE_MS = 540_000;

type IterationResult = PerformanceSample;

function withFatalToolTracking(
  connection: Connection,
  tracker: FatalDiagnosticTracker,
): Connection {
  const client = new Proxy(connection.client, {
    get(target, property) {
      if (property !== "callTool") {
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (...args: unknown[]) => {
        const request = args[0] as { name?: unknown } | undefined;
        const name = request?.name === "computer_observe" || request?.name === "computer_act"
          ? request.name
          : undefined;
        if (name !== undefined) tracker.recordTool(name, null);
        const result = await Reflect.apply(target.callTool, target, args) as CallToolResult;
        if (name !== undefined) tracker.recordToolResult(name, result);
        return result;
      };
    },
  });
  return { ...connection, client };
}

async function discoverFixture(client: Connection["client"]): Promise<Readonly<{
  result: CallToolResult;
  windowRef: string;
}>> {
  const result = await callTool(client, "computer_observe", {
    target: { kind: "desktop" },
    discover: { windows: true, query: WINDOW_TITLE },
  });
  if (result.isError === true || !hasPng(result)) throw new Error("fixture_discovery_failed");
  return { result, windowRef: requireWindow(result) };
}

async function discoverSentinel(client: Connection["client"]): Promise<string> {
  const result = await callTool(client, "computer_observe", {
    target: { kind: "desktop" },
    discover: { windows: true, query: FOCUS_SENTINEL_WINDOW_TITLE },
  });
  if (result.isError === true || !hasPng(result)) throw new Error("focus_sentinel_discovery_failed");
  return requireWindow(result, FOCUS_SENTINEL_WINDOW_TITLE);
}

async function observeFixture(
  client: Connection["client"],
  windowRef: string,
  includeScreenshot: boolean,
  query?: string,
): Promise<CallToolResult> {
  const result = await callTool(client, "computer_observe", {
    target: { kind: "window", window_ref: windowRef },
    include_screenshot: includeScreenshot,
    elements: {
      ...(query === undefined ? {} : { query }),
      max_elements: 150,
      max_depth: 12,
    },
  });
  if (result.isError === true) throw new Error("fixture_window_observation_failed");
  requireSnapshot(result);
  return result;
}

type TimedToolCall =
  | Readonly<{ durationMs: number; result: CallToolResult }>
  | Readonly<{ durationMs: number; error: unknown }>;

async function timedCall(operation: () => Promise<CallToolResult>): Promise<TimedToolCall> {
  const startedAt = performance.now();
  try {
    const result = await operation();
    return { durationMs: Math.ceil(Math.max(0, performance.now() - startedAt)), result };
  } catch (error) {
    return { durationMs: Math.ceil(Math.max(0, performance.now() - startedAt)), error };
  }
}

function structuredIfPresent(result: CallToolResult): ReturnType<typeof structured> | undefined {
  const value = structured(result);
  return typeof value === "object" && value !== null ? value : undefined;
}

function measuredToolFailure(call: TimedToolCall): PerformanceOutcome | undefined {
  if ("error" in call) {
    return classifyToolCallFailure({ kind: "thrown", error: call.error });
  }
  const state = structuredIfPresent(call.result);
  return classifyToolCallFailure({
    kind: "result",
    resultIsError: call.result.isError === true,
    errorCodes: [state?.code, state?.action_result?.error_code],
  });
}

async function collectMeasuredStages(
  connection: Connection,
  cursor: number,
  expectedTool: "computer_observe" | "computer_act",
  durationMs: number,
): Promise<PerformanceSample["stages"] | undefined> {
  const stages = await connection.telemetry.waitForOne(cursor, expectedTool);
  const toolTotal = stages?.tool_total;
  return stages === undefined ? undefined : {
    ...stages,
    transport_overhead: Math.max(0, durationMs - (toolTotal ?? durationMs)),
  };
}

function measuredSample(
  measured: TimedToolCall,
  stages: PerformanceSample["stages"] | undefined,
  outcome?: PerformanceOutcome,
): IterationResult {
  return {
    durationMs: measured.durationMs,
    outcome: outcome ?? (stages === undefined ? "telemetry_missing" : "passed"),
    stages: stages ?? {},
  };
}

function preparationFailureSample(startedAt: number): IterationResult {
  return {
    durationMs: Math.ceil(Math.max(0, performance.now() - startedAt)),
    outcome: "fixture_unavailable",
    stages: {},
  };
}

function validObservePerformanceContract(
  result: CallToolResult,
  windowRef: string,
  visual: boolean,
): boolean {
  const state = structuredIfPresent(result);
  const screenshot = state?.screenshot;
  return state !== undefined &&
    state.target?.kind === "window" &&
    state.target.window_ref === windowRef &&
    (!visual || (
      typeof screenshot?.width === "number" && Number.isFinite(screenshot.width) &&
      screenshot.width > 0 &&
      typeof screenshot.height === "number" && Number.isFinite(screenshot.height) &&
      screenshot.height > 0
    )) &&
    validFixtureObserve(result, visual);
}

function validSemanticPerformanceContract(
  result: CallToolResult,
  groundingSnapshot: string,
  nonce: string,
): boolean {
  const state = structuredIfPresent(result);
  const matchingValues = state?.elements?.filter((element) => element.value === nonce) ?? [];
  return state !== undefined &&
    typeof state.snapshot_id === "string" &&
    state.snapshot_id !== groundingSnapshot &&
    state.consumed_snapshot_id === groundingSnapshot &&
    state.action_result?.status === "executed" &&
    state.action_result.effect === "confirmed" &&
    state.action_result.delivery === "background" &&
    state.verification?.status === "satisfied" &&
    state.observation_mode === "semantic" &&
    state.visual_status === "not_requested" &&
    !hasPng(result) &&
    matchingValues.length === 1;
}

function validPixelPerformanceContract(
  result: CallToolResult,
  groundingSnapshot: string,
): boolean {
  const state = structuredIfPresent(result);
  return state !== undefined &&
    typeof state.snapshot_id === "string" &&
    state.snapshot_id !== groundingSnapshot &&
    state.consumed_snapshot_id === groundingSnapshot &&
    state.action_result?.status === "executed" &&
    state.action_result.delivery === "foreground" &&
    state.observation_mode === "visual" &&
    state.visual_status === "available" &&
    hasPng(result);
}

function optionalSnapshot(result: CallToolResult | undefined): string | undefined {
  const snapshotId = result === undefined ? undefined : structured(result).snapshot_id;
  return typeof snapshotId === "string" ? snapshotId : undefined;
}

function optionalElementRef(result: CallToolResult | undefined, label: string): string | undefined {
  const candidates = result === undefined
    ? []
    : (structured(result).elements ?? []).filter((element) => element.label === label);
  const elementRef = candidates[0]?.element_ref;
  return candidates.length === 1 && typeof elementRef === "string" ? elementRef : undefined;
}

async function attemptTool(operation: () => Promise<CallToolResult>): Promise<CallToolResult | undefined> {
  try {
    return await operation();
  } catch {
    return undefined;
  }
}

async function performanceIteration(
  name: PerformanceScenarioName,
  index: number,
  connection: Connection,
  fixture: FixtureProcess,
  windowRef: string,
  layout: FixtureLayout,
  sentinel: FocusSentinel,
  sentinelWindowRef: string,
): Promise<IterationResult> {
  const preparationStartedAt = performance.now();
  let prepared: Awaited<ReturnType<typeof preparePerformanceScenario>>;
  try {
    prepared = await preparePerformanceScenario(name, {
      readFixtureState: () => fixtureJson<HarnessState>(fixture.url, "/state"),
      resetSentinelText: () => resetFocusSentinelText(sentinel),
    });
  } catch {
    return preparationFailureSample(preparationStartedAt);
  }

  if (name === "window_visual_observe" || name === "window_semantic_observe") {
    const includeScreenshot = name === "window_visual_observe";
    const cursor = connection.telemetry.cursor();
    const measured = await timedCall(() => callTool(connection.client, "computer_observe", {
      target: { kind: "window", window_ref: windowRef },
      include_screenshot: includeScreenshot,
      elements: { max_elements: 150, max_depth: 12 },
    }));
    const stages = await collectMeasuredStages(
      connection,
      cursor,
      "computer_observe",
      measured.durationMs,
    );
    const toolFailure = measuredToolFailure(measured);
    if (toolFailure !== undefined) return measuredSample(measured, stages, toolFailure);
    if (!("result" in measured) || !validObservePerformanceContract(
      measured.result,
      windowRef,
      includeScreenshot,
    )) {
      return measuredSample(measured, stages, "contract_mismatch");
    }
    return measuredSample(measured, stages);
  }

  if (name === "semantic_action_next_state") {
    if (prepared.kind !== "semantic") return preparationFailureSample(preparationStartedAt);
    const groundingCursor = connection.telemetry.cursor();
    const groundedCall = await timedCall(() => callTool(
      connection.client,
      "computer_observe",
      {
        target: { kind: "window", window_ref: sentinelWindowRef },
        include_screenshot: false,
        elements: { query: FOCUS_SENTINEL_TEXT_LABEL, max_elements: 150, max_depth: 12 },
      },
    ));
    const groundingStages = await connection.telemetry.waitForOne(
      groundingCursor,
      "computer_observe",
    );
    const groundingFailure = measuredToolFailure(groundedCall);
    if (groundingFailure !== undefined) {
      return measuredSample(groundedCall, {}, groundingFailure);
    }
    if (groundingStages === undefined) {
      return measuredSample(groundedCall, {}, "telemetry_missing");
    }
    if (!("result" in groundedCall)) {
      return measuredSample(groundedCall, {}, "contract_mismatch");
    }
    let text: ReturnType<typeof requireElement>;
    let groundingSnapshot: string;
    try {
      const grounded = groundedCall.result;
      const state = structuredIfPresent(grounded);
      if (
        state?.target?.kind !== "window" ||
        state.target.window_ref !== sentinelWindowRef ||
        state.observation_mode !== "semantic" ||
        state.visual_status !== "not_requested" ||
        hasPng(grounded)
      ) throw new Error("semantic_grounding_contract_mismatch");
      text = requireElement(grounded, FOCUS_SENTINEL_TEXT_LABEL);
      groundingSnapshot = requireSnapshot(grounded);
    } catch {
      return measuredSample(groundedCall, {}, "contract_mismatch");
    }
    if (!validEmptyTextGrounding(prepared.sentinelState, text)) {
      return preparationFailureSample(preparationStartedAt);
    }
    const nonce = `ucu-perf-${index}-${Date.now()}`;
    const request = buildSemanticSetValueRequest(groundingSnapshot, text.elementRef, nonce);
    const cursor = connection.telemetry.cursor();
    const measured = await timedCall(() => callTool(
      connection.client,
      "computer_act",
      request,
    ));
    const stages = await collectMeasuredStages(
      connection,
      cursor,
      "computer_act",
      measured.durationMs,
    );
    const toolFailure = measuredToolFailure(measured);
    if (toolFailure !== undefined) return measuredSample(measured, stages, toolFailure);
    if (!("result" in measured) || !validSemanticPerformanceContract(
      measured.result,
      groundingSnapshot,
      nonce,
    )) {
      return measuredSample(measured, stages, "contract_mismatch");
    }
    let oracle;
    try {
      oracle = await waitForFocusSentinelText(sentinel, nonce);
    } catch {
      if (!sentinelAlive(sentinel)) {
        return measuredSample(measured, stages, "fixture_unavailable");
      }
      oracle = sentinel.state.current;
    }
    if (
      oracle.reset_generation !== prepared.sentinelState.reset_generation
      || oracle.text !== nonce
      || oracle.text_write_count !== 1
    ) {
      return measuredSample(measured, stages, "oracle_mismatch");
    }
    return measuredSample(measured, stages);
  }

  if (
    prepared.kind !== "pixel"
    || !Number.isSafeInteger(prepared.fixtureState.pixel_clicks)
    || prepared.fixtureState.pixel_clicks < 0
  ) {
    return preparationFailureSample(preparationStartedAt);
  }
  const groundingCursor = connection.telemetry.cursor();
  const groundedCall = await timedCall(() => callTool(
    connection.client,
    "computer_observe",
    {
      target: { kind: "window", window_ref: windowRef },
      include_screenshot: true,
      elements: { max_elements: 150, max_depth: 12 },
    },
  ));
  const groundingStages = await connection.telemetry.waitForOne(
    groundingCursor,
    "computer_observe",
  );
  const groundingFailure = measuredToolFailure(groundedCall);
  if (groundingFailure !== undefined) {
    return measuredSample(groundedCall, {}, groundingFailure);
  }
  if (groundingStages === undefined) {
    return measuredSample(groundedCall, {}, "telemetry_missing");
  }
  if (!("result" in groundedCall)) {
    return measuredSample(groundedCall, {}, "contract_mismatch");
  }
  let groundingSnapshot: string;
  let point: ReturnType<typeof fixedVisualPoint>;
  try {
    const grounded = groundedCall.result;
    if (!validObservePerformanceContract(grounded, windowRef, true)) {
      throw new Error("pixel_grounding_contract_mismatch");
    }
    groundingSnapshot = requireSnapshot(grounded);
    point = fixedVisualPoint(layout, grounded, "double-target");
  } catch {
    return measuredSample(groundedCall, {}, "contract_mismatch");
  }
  const request = {
    snapshot_id: groundingSnapshot,
    action: { type: "click", ...point },
    delivery: "foreground",
    next_observation: { mode: "visual" },
  } as const;
  const cursor = connection.telemetry.cursor();
  const measured = await timedCall(() => callTool(connection.client, "computer_act", request));
  const stages = await collectMeasuredStages(
    connection,
    cursor,
    "computer_act",
    measured.durationMs,
  );
  const toolFailure = measuredToolFailure(measured);
  if (toolFailure !== undefined) return measuredSample(measured, stages, toolFailure);
  if (!("result" in measured) || !validPixelPerformanceContract(
    measured.result,
    groundingSnapshot,
  )) {
    return measuredSample(measured, stages, "contract_mismatch");
  }
  let oracle: HarnessState;
  try {
    oracle = await waitForState(
      fixture.url,
      (state) => state.pixel_clicks === prepared.fixtureState.pixel_clicks + 1,
    );
  } catch {
    try {
      oracle = await fixtureJson<HarnessState>(fixture.url, "/state");
    } catch {
      return measuredSample(measured, stages, "fixture_unavailable");
    }
  }
  if (oracle.pixel_clicks !== prepared.fixtureState.pixel_clicks + 1) {
    return measuredSample(measured, stages, "oracle_mismatch");
  }
  return measuredSample(measured, stages);
}

async function runPerformanceProfiles(
  connection: Connection,
  fixture: FixtureProcess,
  windowRef: string,
  layout: FixtureLayout,
  sentinel: FocusSentinel,
  sentinelWindowRef: string,
  fatalDiagnostic: FatalDiagnosticTracker,
  signal: AbortSignal,
): Promise<ReturnType<PerformanceRecorder["performance"]>> {
  const recorder = new PerformanceRecorder();
  for (const name of PERFORMANCE_SCENARIO_NAMES) {
    for (let index = 0; index < 35; index += 1) {
      signal.throwIfAborted();
      fatalDiagnostic.setPerformanceSample(
        name,
        index < 5 ? "warmup" : "measured",
        index < 5 ? index : index - 5,
      );
      const sample = await performanceIteration(
        name,
        index,
        connection,
        fixture,
        windowRef,
        layout,
        sentinel,
        sentinelWindowRef,
      );
      signal.throwIfAborted();
      if (index < 5) recorder.recordWarmup(name, sample);
      else recorder.recordMeasured(name, sample);
    }
  }
  return recorder.performance();
}

async function runFixtureCorrectness(
  client: Connection["client"],
  fixture: FixtureProcess,
  windowRef: string,
  layout: FixtureLayout,
  sentinel: FocusSentinel,
  sentinelWindowRef: string,
  browserPid: number,
): Promise<Readonly<{
  semanticSequence: boolean;
  uniqueText: boolean;
  overlayOnce: boolean;
  focusPreserved: boolean;
}>> {
  return runIndependentCorrectnessChecks({
    semanticSequence: async () => {
      await resetFixture(fixture.url);
      let current = await observeFixture(client, windowRef, true);
      const alphaGrounding = requireSnapshot(current);
      current = await callTool(
        client,
        "computer_act",
        buildBackgroundSemanticClickRequest(
          alphaGrounding,
          requireElement(current, "Semantic Alpha").elementRef,
          "background",
        ),
      );
      const alphaSemantic = validBackgroundSemanticExecution(current, alphaGrounding);
      await waitForState(fixture.url, (state) => state.semantic_sequence.join(",") === "alpha");
      current = await observeFixture(client, windowRef, true);
      const betaGrounding = requireSnapshot(current);
      current = await callTool(
        client,
        "computer_act",
        buildBackgroundSemanticClickRequest(
          betaGrounding,
          requireElement(current, "Semantic Beta").elementRef,
          "background",
        ),
      );
      const sequenceState = await waitForState(
        fixture.url,
        (state) => state.semantic_sequence.join(",") === "alpha,beta",
      );
      return alphaSemantic && validBackgroundSemanticExecution(current, betaGrounding) &&
        sequenceState.semantic_sequence.join(",") === "alpha,beta";
    },
    uniqueText: async () => {
      const nativeInitialState = await resetFocusSentinelText(sentinel);
      let current = await observeFixture(
        client,
        sentinelWindowRef,
        true,
        FOCUS_SENTINEL_TEXT_LABEL,
      );
      const textGrounding = requireSnapshot(current);
      const nonce = `ucu-correctness-${Date.now()}`;
      const nativeText = requireElement(current, FOCUS_SENTINEL_TEXT_LABEL);
      current = await callTool(
        client,
        "computer_act",
        buildSemanticSetValueRequest(textGrounding, nativeText.elementRef, nonce),
      );
      const textState = await waitForFocusSentinelText(sentinel, nonce);
      return validEmptyTextGrounding(nativeInitialState, nativeText) &&
        validSemanticSetValueResult(current, {
          groundingSnapshot: textGrounding,
          nonce,
          oracleText: textState.text,
          oracleWriteCount: textState.text_write_count,
        });
    },
    overlayOnce: async () => {
      await resetFixture(fixture.url);
      let current = await observeFixture(client, windowRef, true);
      const toggleGrounding = requireSnapshot(current);
      current = await callTool(
        client,
        "computer_act",
        buildBackgroundSemanticClickRequest(
          toggleGrounding,
          requireElement(current, "Toggle pixel overlay").elementRef,
          "background",
        ),
      );
      const toggleSemantic = validBackgroundSemanticExecution(current, toggleGrounding);
      await waitForState(fixture.url, (state) => state.overlay_enabled);
      current = await observeFixture(client, windowRef, true);
      const overlayGrounding = requireSnapshot(current);
      const overlayPoint = fixedVisualPoint(layout, current, "overlay-target");
      current = await callTool(client, "computer_act", {
        snapshot_id: overlayGrounding,
        action: { type: "click", ...overlayPoint },
        delivery: "foreground",
        next_observation: { mode: "semantic" },
      });
      const overlayState = await waitForState(fixture.url, (state) => state.overlay_clicks === 1);
      const overlayResult = structured(current);
      return toggleSemantic && current.isError !== true &&
        overlayResult.consumed_snapshot_id === overlayGrounding &&
        typeof overlayResult.snapshot_id === "string" &&
        overlayResult.snapshot_id !== overlayGrounding &&
        overlayResult.action_result?.status === "executed" &&
        overlayResult.action_result.delivery === "foreground" &&
        overlayResult.observation_mode === "visual_recovery" &&
        hasPng(current) && overlayState.overlay_clicks === 1;
    },
    focusPreserved: async () => {
      await resetFixture(fixture.url);
      await activateFocusSentinel(sentinel);
      await activateOwnedApplication({
        bundleIdentifier: CHROME_BUNDLE_ID,
        processIdentifier: browserPid,
      });
      await activateFocusSentinel(sentinel);
      let current = await observeFixture(client, windowRef, true);
      const backgroundGrounding = requireSnapshot(current);
      current = await callTool(
        client,
        "computer_act",
        buildBackgroundSemanticClickRequest(
          backgroundGrounding,
          requireElement(current, "Semantic Beta").elementRef,
          "background",
        ),
      );
      const sequenceState = await waitForState(
        fixture.url,
        (state) => state.semantic_sequence.join(",") === "beta",
      );
      const identity = await frontmostIdentity();
      return sentinelAlive(sentinel) &&
        identity.bundleIdentifier === FOCUS_SENTINEL_BUNDLE_ID &&
        identity.processIdentifier === sentinel.pid &&
        validBackgroundSemanticExecution(current, backgroundGrounding) &&
        sequenceState.semantic_sequence.join(",") === "beta";
    },
  });
}

async function validateEvidence(value: unknown): Promise<void> {
  const schema = JSON.parse(await readFile(EVIDENCE_SCHEMA, "utf8")) as Record<string, unknown>;
  const validate = new Ajv2020({ allErrors: true, strict: false, validateFormats: false })
    .compile(schema);
  if (!validate(value)) throw new Error("acceptance_evidence_invalid");
  validateDevelopmentEvidenceSemantics(value);
}

describe("macOS development acceptance opt-in", () => {
  it("stays disabled unless the launcher marks the real lane", () => {
    if (!REAL_ACCEPTANCE) expect(process.env.CUA_DEVELOPMENT_EVIDENCE_PATH).toBeUndefined();
  });
});

describe.skipIf(!REAL_ACCEPTANCE)("macOS development acceptance through public MCP", () => {
  it("runs correctness, performance and real-app smoke with owned resources", async () => {
    if (process.platform !== "darwin") throw new Error("acceptance_requires_darwin");
    const evidencePath = process.env.CUA_DEVELOPMENT_EVIDENCE_PATH;
    if (evidencePath === undefined || !evidencePath.startsWith("/")) {
      throw new Error("acceptance_evidence_path_missing");
    }
    const diagnosticPath = process.env.CUA_DEVELOPMENT_DIAGNOSTIC_PATH;
    if (diagnosticPath === undefined || !diagnosticPath.startsWith("/")) {
      throw new Error("acceptance_diagnostic_path_missing");
    }

    const recorder = new AcceptanceRecorder();
    const fatalDiagnostic = new FatalDiagnosticTracker();
    for (const name of ACCEPTANCE_SCENARIO_NAMES) recorder.recordScenario(name, false);
    let fixture: FixtureProcess | undefined;
    let browser: BrowserProcess | undefined;
    let sentinel: FocusSentinel | undefined;
    let connection: Connection | undefined;
    let cleanupFailure: unknown;
    let performanceEvidence: ReturnType<PerformanceRecorder["performance"]> | undefined;
    let realAppSmoke: RealAppSmokeEvidence = {
      calculator_703: false,
      textedit_unique_value: false,
      textedit_single_write: false,
      error_code: "verification_failed",
    };
    let adaptiveCorrectness: AdaptiveCorrectnessEvidence = {
      no_fixed_action_delay: false,
      semantic_sequence: false,
      pixel_once: false,
      unique_input_once: false,
      visual_recovery_once: false,
      focus_preserved: false,
    };
    const lifecycle = await runFatalGuardedLifecycle({
      diagnosticPath,
      tracker: fatalDiagnostic,
      timeoutMs: ACCEPTANCE_DEADLINE_MS,
      operation: async (signal) => {
      const lock = await loadEngineLock();
      signal.throwIfAborted();
      requireInteractiveSession(await frontmostIdentity());
      fixture = await startFixture();
      browser = await launchBrowser(fixture.url);
      await waitForFixture(fixture.url);
      await resetFixture(fixture.url);
      await activateOwnedApplication({
        bundleIdentifier: CHROME_BUNDLE_ID,
        processIdentifier: browser.pid,
      });
      sentinel = await startFocusSentinel();
      signal.throwIfAborted();

      connection = withFatalToolTracking(
        await recorder.measure("mcp_start", () => connectClient("ucu-development-acceptance-1")),
        fatalDiagnostic,
      );
      fatalDiagnostic.setPhase("correctness");
      const sentinelWindowRef = await discoverSentinel(connection.client);
      const tools = await connection.client.listTools();
      recorder.recordScenario(
        "two_tool_inventory",
        tools.tools.map((tool) => tool.name).join(",") === "computer_observe,computer_act",
      );

      const desktop = await recorder.measure("desktop_observe", () =>
        callTool(connection!.client, "computer_observe", {}));
      recorder.recordScenario("desktop_png", desktop.isError !== true && hasPng(desktop));
      const desktopSnapshot = optionalSnapshot(desktop);
      const waited = desktopSnapshot === undefined
        ? undefined
        : await attemptTool(() => callTool(connection!.client, "computer_act", {
            snapshot_id: desktopSnapshot,
            action: { type: "wait", ms: 0 },
          }));
      const waitedSnapshot = optionalSnapshot(waited);
      recorder.recordScenario(
        "fresh_snapshot",
        desktopSnapshot !== undefined && waited !== undefined && waited.isError !== true &&
          waitedSnapshot !== undefined && waitedSnapshot !== desktopSnapshot && hasPng(waited),
      );
      const stale = desktopSnapshot === undefined
        ? undefined
        : await attemptTool(() => callTool(connection!.client, "computer_act", {
            snapshot_id: desktopSnapshot,
            action: { type: "wait", ms: 0 },
          }));
      recorder.recordScenario(
        "stale_snapshot_rejected",
        stale?.isError === true && structured(stale).code === "stale_snapshot",
      );

      let discovered: CallToolResult | undefined;
      try {
        discovered = await recorder.measure("window_discover", () =>
          callTool(connection!.client, "computer_observe", {
            target: { kind: "desktop" },
            discover: { windows: true, query: WINDOW_TITLE },
          }));
      } catch {
        // Preserve the failed timing; the fresh discovery below is recovery,
        // not a replacement timing sample.
      }
      let windowRef: string | undefined;
      try {
        if (discovered !== undefined && discovered.isError !== true) {
          windowRef = requireWindow(discovered);
        }
      } catch {
        // The measured discovery is a false correctness result.
      }
      recorder.recordScenario(
        "exact_window_discovered",
        windowRef !== undefined && discovered !== undefined && hasPng(discovered),
      );
      if (windowRef === undefined) {
        // Only a failed fresh recovery is target loss that prevents profiles.
        windowRef = (await discoverFixture(connection.client)).windowRef;
      }

      let measuredWindowState: CallToolResult | undefined;
      try {
        measuredWindowState = await recorder.measure("window_observe", () =>
          callTool(connection!.client, "computer_observe", {
            target: { kind: "window", window_ref: windowRef },
            include_screenshot: true,
            elements: { max_elements: 150, max_depth: 12 },
          }));
      } catch {
        // Preserve the failed timing and recover with a new observation below.
      }
      const measuredWindowPassed = measuredWindowState !== undefined &&
        measuredWindowState.isError !== true && hasPng(measuredWindowState) &&
        optionalSnapshot(measuredWindowState) !== undefined;
      // A fresh observation avoids reusing any partial/failed state. Failure
      // here is target loss because the exact 30-sample profiles cannot start.
      const windowState = measuredWindowPassed
        ? measuredWindowState
        : await observeFixture(connection.client, windowRef, true);
      const singleClickRef = optionalElementRef(windowState, "Single click");
      const windowSnapshot = optionalSnapshot(windowState);
      const legacyWindowProof = measuredWindowPassed && singleClickRef !== undefined;
      const beforeElement = await fixtureJson<HarnessState>(fixture.url, "/state");
      let elementActed: CallToolResult | undefined;
      if (singleClickRef === undefined || windowSnapshot === undefined) {
        recorder.recordFailedTiming("element_action");
      } else {
        try {
          elementActed = await recorder.measure("element_action", () =>
            callTool(connection!.client, "computer_act", {
              snapshot_id: windowSnapshot,
              action: { type: "click", element_ref: singleClickRef },
              delivery: "background",
              next_observation: { mode: "semantic" },
            }));
        } catch {
          // The timed sample is retained as failed. A fresh observation below
          // distinguishes a recoverable correctness failure from target loss.
        }
      }
      const afterElement = elementActed === undefined
        ? await fixtureJson<HarnessState>(fixture.url, "/state")
        : await waitForState(
            fixture.url,
            (state) => state.clicks === beforeElement.clicks + 1,
          ).catch(() => fixtureJson<HarnessState>(fixture!.url, "/state"));

      // Never reuse a possibly consumed action snapshot for recovery.
      const visualForCoordinate = await observeFixture(connection.client, windowRef, true);
      const layout = await waitForFixture(fixture.url);
      const point = fixedVisualPoint(layout, visualForCoordinate, "double-target");
      const beforeCoordinate = await fixtureJson<HarnessState>(fixture.url, "/state");
      let coordinateActed: CallToolResult | undefined;
      try {
        coordinateActed = await recorder.measure("coordinate_action", () =>
          callTool(connection!.client, "computer_act", {
            snapshot_id: requireSnapshot(visualForCoordinate),
            action: { type: "click", ...point },
            delivery: "foreground",
            next_observation: { mode: "visual" },
          }));
      } catch {
        // Preserve the failed timing and continue if the fixture stays healthy.
      }
      const afterCoordinate = coordinateActed === undefined
        ? await fixtureJson<HarnessState>(fixture.url, "/state")
        : await waitForState(
            fixture.url,
            (state) => state.pixel_clicks === beforeCoordinate.pixel_clicks + 1,
          ).catch(() => fixtureJson<HarnessState>(fixture!.url, "/state"));

      let correctness = {
        semanticSequence: false,
        uniqueText: false,
        overlayOnce: false,
        focusPreserved: false,
      };
      try {
        correctness = await runFixtureCorrectness(
          connection.client,
          fixture,
          windowRef,
          layout,
          sentinel,
          sentinelWindowRef,
          browser.pid,
        );
      } catch {
        // Correctness failures belong in complete schema-v3 evidence. The subsequent
        // 140-call performance run remains the target-health check; if the
        // fixture or window is truly dead it fails there as a fatal no-evidence
        // condition instead of being mislabeled as a boolean regression.
      }
      recorder.recordScenario(
        "window_png_and_element",
        legacyWindowProof,
      );
      recorder.recordScenario(
        "background_element_effect",
        elementActed?.isError !== true && elementActed !== undefined &&
          afterElement.clicks === beforeElement.clicks + 1 &&
          structured(elementActed).action_result?.delivery === "background" &&
          optionalSnapshot(elementActed) !== undefined &&
          optionalSnapshot(elementActed) !== windowSnapshot,
      );
      recorder.recordScenario(
        "window_coordinate_effect",
        coordinateActed?.isError !== true && coordinateActed !== undefined && hasPng(coordinateActed) &&
          afterCoordinate.pixel_clicks === beforeCoordinate.pixel_clicks + 1,
      );
      let noFixedActionDelay = false;
      try {
        noFixedActionDelay = (await scanNoFixedActionDelay(process.cwd())).length === 0;
      } catch {
        // A static-scan failure is explicit failed evidence, never an implicit pass.
      }
      adaptiveCorrectness = {
        no_fixed_action_delay: noFixedActionDelay,
        semantic_sequence: correctness.semanticSequence,
        pixel_once: coordinateActed !== undefined && validPixelActionResult(coordinateActed, {
          groundingSnapshot: requireSnapshot(visualForCoordinate),
          beforeClicks: beforeCoordinate.pixel_clicks,
          afterClicks: afterCoordinate.pixel_clicks,
        }),
        unique_input_once: correctness.uniqueText,
        visual_recovery_once: correctness.overlayOnce,
        focus_preserved: correctness.focusPreserved,
      };

      // Correctness calls deliberately do not consume performance telemetry.
      // Start profiles at a clean correlation boundary; any record arriving
      // after this boundary still poisons the first measured sample.
      establishPerformanceTelemetryBoundary(connection.telemetry);
      performanceEvidence = await runPerformanceProfiles(
        connection,
        fixture,
        windowRef,
        layout,
        sentinel,
        sentinelWindowRef,
        fatalDiagnostic,
        signal,
      );
      signal.throwIfAborted();
      fatalDiagnostic.setPhase("real_app_smoke");
      realAppSmoke = await runRealAppSmoke(connection.client);
      signal.throwIfAborted();

      const oldSnapshot = optionalSnapshot(elementActed);
      const oldElementRef = optionalElementRef(elementActed, "Single click");
      await closeConnection(connection);
      connection = undefined;
      fatalDiagnostic.setPhase("reconnect");
      try {
        connection = withFatalToolTracking(
          await recorder.measure("mcp_reconnect", () => connectClient("ucu-development-acceptance-2")),
          fatalDiagnostic,
        );
      } catch {
        // The failed reconnect timing and false scenario are valid failed evidence.
      }
      signal.throwIfAborted();
      if (connection !== undefined && oldSnapshot !== undefined && oldElementRef !== undefined) {
        try {
          const staleAfterReconnect = await callTool(connection.client, "computer_act", {
            snapshot_id: oldSnapshot,
            action: { type: "wait", ms: 0 },
          });
          const oldWindow = await callTool(connection.client, "computer_observe", {
            target: { kind: "window", window_ref: windowRef },
            include_screenshot: true,
          });
          const rediscovered = await discoverFixture(connection.client);
          const newWindowState = await observeFixture(connection.client, rediscovered.windowRef, true);
          const oldElement = await callTool(connection.client, "computer_act", {
            snapshot_id: requireSnapshot(newWindowState),
            action: { type: "click", element_ref: oldElementRef },
            delivery: "background",
          });
          recorder.recordScenario(
            "old_refs_rejected_after_reconnect",
            staleAfterReconnect.isError === true && structured(staleAfterReconnect).code === "stale_snapshot" &&
              oldWindow.isError === true && structured(oldWindow).code === "window_not_found" &&
              rediscovered.windowRef !== windowRef && oldElement.isError === true &&
              structured(oldElement).code === "stale_element_ref",
          );
        } catch {
          // A reconnect correctness failure remains false in schema-v3 evidence.
        }
      }
      if (performanceEvidence === undefined) throw new Error("acceptance_profiles_missing");
      if (process.arch !== "arm64" && process.arch !== "x64") {
        throw new Error("acceptance_architecture_unsupported");
      }
      return { lock, performanceEvidence };
      },
      cleanup: async () => {
      const cleanup = async (operation: () => Promise<void>): Promise<void> => {
        try {
          await operation();
        } catch (error) {
          cleanupFailure ??= error;
        }
      };
      await cleanup(async () => {
        await closeConnection(connection);
        connection = undefined;
      });
      await cleanup(async () => {
        await cleanupFocusSentinel(sentinel);
        sentinel = undefined;
      });
      await cleanup(async () => {
        await cleanupBrowser(browser);
        browser = undefined;
      });
      await cleanup(async () => {
        await stopOwnedProcess(fixture?.child);
        fixture = undefined;
      });
      return {
        ownedProcesses: {
          fixture: fixture !== undefined,
          browser: browser !== undefined,
          sentinel: sentinel !== undefined,
          mcp: connection !== undefined,
        },
        ...(cleanupFailure === undefined ? {} : { failure: cleanupFailure }),
      };
      },
    });

    fatalDiagnostic.setPhase("evidence");
    let evidence;
    try {
      evidence = recorder.evidence({
        product_version: PRODUCT_VERSION,
        protocol_version: PROTOCOL_VERSION,
        engine_version: lifecycle.lock.version,
        macos_version: await macosVersion(),
        architecture: process.arch === "x64" ? "x86_64" : "arm64",
      }, true, lifecycle.performanceEvidence, realAppSmoke, adaptiveCorrectness);
      await validateEvidence(evidence);
      await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
    } catch (error) {
      await fatalDiagnostic.write(diagnosticPath, error, {
        fixture: false,
        browser: false,
        sentinel: false,
        mcp: false,
      }, true);
      throw error;
    }
    if (evidence.status === "failed") throw new Error("acceptance_gate_failed");
  }, 600_000);
});
