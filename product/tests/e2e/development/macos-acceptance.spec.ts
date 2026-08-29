import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { loadEngineLock } from "../../../src/engine/lock.js";
import { PRODUCT_VERSION, PROTOCOL_VERSION } from "../../../src/version.js";
import { scanNoFixedActionDelay } from "../../helpers/fixed-delay-scan.js";
import {
  ACCEPTANCE_SCENARIO_NAMES,
  AcceptanceRecorder,
  type AdaptiveCorrectnessEvidence,
  type RealAppSmokeEvidence,
} from "./acceptance-recorder.js";
import {
  PerformanceRecorder,
  PERFORMANCE_SCENARIO_NAMES,
  type PerformanceScenarioName,
} from "./performance-recorder.js";
import { runRealAppSmoke } from "./macos-real-app-smoke.js";
import {
  buildForegroundPositiveControlRequest,
  buildSemanticSetValueRequest,
  buildVerifiedSemanticClickRequest,
  validBackgroundSemanticResult,
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
  waitForFrontmost,
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

type IterationResult = Readonly<{ durationMs: number; correctnessPassed: boolean }>;

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

async function timedCall(operation: () => Promise<CallToolResult>): Promise<Readonly<{
  durationMs: number;
  result?: CallToolResult;
}>> {
  const startedAt = performance.now();
  try {
    const result = await operation();
    return { durationMs: Math.ceil(Math.max(0, performance.now() - startedAt)), result };
  } catch {
    return { durationMs: Math.ceil(Math.max(0, performance.now() - startedAt)) };
  }
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
  client: Connection["client"],
  fixture: FixtureProcess,
  windowRef: string,
  layout: FixtureLayout,
  sentinel: FocusSentinel,
  sentinelWindowRef: string,
): Promise<IterationResult> {
  const initialState = await resetFixture(fixture.url);

  if (name === "window_visual_observe" || name === "window_semantic_observe") {
    const includeScreenshot = name === "window_visual_observe";
    const measured = await timedCall(() => callTool(client, "computer_observe", {
      target: { kind: "window", window_ref: windowRef },
      include_screenshot: includeScreenshot,
      elements: { max_elements: 150, max_depth: 12 },
    }));
    const correctnessPassed = measured.result !== undefined &&
      validFixtureObserve(measured.result, includeScreenshot);
    return { durationMs: measured.durationMs, correctnessPassed };
  }

  if (name === "semantic_action_next_state") {
    const nativeInitialState = await resetFocusSentinelText(sentinel);
    const grounded = await observeFixture(
      client,
      sentinelWindowRef,
      true,
      FOCUS_SENTINEL_TEXT_LABEL,
    );
    const text = requireElement(grounded, FOCUS_SENTINEL_TEXT_LABEL);
    const groundingSnapshot = requireSnapshot(grounded);
    const nonce = `ucu-perf-${index}-${Date.now()}`;
    const measured = await timedCall(() => callTool(
      client,
      "computer_act",
      buildSemanticSetValueRequest(groundingSnapshot, text.elementRef, nonce),
    ));
    const oracle = measured.result?.isError === true
      ? sentinel.state.current
      : await waitForFocusSentinelText(sentinel, nonce).catch(() => sentinel.state.current);
    const correctnessPassed = validEmptyTextGrounding(nativeInitialState, text) &&
      measured.result !== undefined && validSemanticSetValueResult(measured.result, {
        groundingSnapshot,
        nonce,
        oracleText: oracle.text,
        oracleWriteCount: oracle.text_write_count,
      });
    return { durationMs: measured.durationMs, correctnessPassed };
  }

  const grounded = await observeFixture(client, windowRef, true);
  const groundingSnapshot = requireSnapshot(grounded);
  const point = fixedVisualPoint(layout, grounded, "double-target");
  const measured = await timedCall(() => callTool(client, "computer_act", {
    snapshot_id: groundingSnapshot,
    action: { type: "click", ...point },
    delivery: "foreground",
    next_observation: { mode: "visual" },
  }));
  const oracle = await waitForState(
    fixture.url,
    (state) => state.pixel_clicks === initialState.pixel_clicks + 1 || measured.result?.isError === true,
  ).catch(() => fixtureJson<HarnessState>(fixture.url, "/state"));
  const correctnessPassed = measured.result !== undefined && validPixelActionResult(measured.result, {
    groundingSnapshot,
    beforeClicks: initialState.pixel_clicks,
    afterClicks: oracle.pixel_clicks,
  });
  return { durationMs: measured.durationMs, correctnessPassed };
}

async function runPerformanceProfiles(
  client: Connection["client"],
  fixture: FixtureProcess,
  windowRef: string,
  layout: FixtureLayout,
  sentinel: FocusSentinel,
  sentinelWindowRef: string,
): Promise<ReturnType<PerformanceRecorder["performance"]>> {
  const recorder = new PerformanceRecorder();
  for (const name of PERFORMANCE_SCENARIO_NAMES) {
    for (let index = 0; index < 35; index += 1) {
      const sample = await performanceIteration(
        name,
        index,
        client,
        fixture,
        windowRef,
        layout,
        sentinel,
        sentinelWindowRef,
      );
      if (index < 5) recorder.recordWarmup(name, sample);
      else recorder.recordMeasured(name, sample);
      await fixtureJson<HarnessState>(fixture.url, "/state");
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
  await resetFixture(fixture.url);
  let current = await observeFixture(client, windowRef, true);
  const alphaGrounding = requireSnapshot(current);
  current = await callTool(
    client,
    "computer_act",
    buildVerifiedSemanticClickRequest(
      alphaGrounding,
      requireElement(current, "Semantic Alpha").elementRef,
      "background",
    ),
  );
  const alphaState = structured(current);
  const alphaSemantic = current.isError !== true &&
    alphaState.consumed_snapshot_id === alphaGrounding &&
    typeof alphaState.snapshot_id === "string" && alphaState.snapshot_id !== alphaGrounding &&
    alphaState.action_result?.status === "executed" &&
    alphaState.action_result.effect === "confirmed" &&
    alphaState.action_result.delivery === "background" &&
    alphaState.verification?.status === "satisfied" &&
    alphaState.observation_mode === "semantic" && !hasPng(current);
  const betaGrounding = requireSnapshot(current);
  current = await callTool(
    client,
    "computer_act",
    buildVerifiedSemanticClickRequest(
      betaGrounding,
      requireElement(current, "Semantic Beta").elementRef,
      "background",
    ),
  );
  const sequenceState = await waitForState(
    fixture.url,
    (state) => state.semantic_sequence.join(",") === "alpha,beta",
  );
  const betaState = structured(current);
  const semanticSequence = alphaSemantic && current.isError !== true &&
    betaState.consumed_snapshot_id === betaGrounding &&
    typeof betaState.snapshot_id === "string" && betaState.snapshot_id !== betaGrounding &&
    betaState.action_result?.status === "executed" &&
    betaState.action_result.effect === "confirmed" &&
    betaState.action_result.delivery === "background" &&
    betaState.verification?.status === "satisfied" &&
    betaState.observation_mode === "semantic" && !hasPng(current) &&
    sequenceState.semantic_sequence.join(",") === "alpha,beta";

  const nativeInitialState = await resetFocusSentinelText(sentinel);
  current = await observeFixture(
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
    buildSemanticSetValueRequest(
      textGrounding,
      nativeText.elementRef,
      nonce,
    ),
  );
  const textState = await waitForFocusSentinelText(sentinel, nonce);
  const uniqueText = validEmptyTextGrounding(nativeInitialState, nativeText) &&
    validSemanticSetValueResult(current, {
    groundingSnapshot: textGrounding,
    nonce,
    oracleText: textState.text,
    oracleWriteCount: textState.text_write_count,
    });

  await resetFixture(fixture.url);
  current = await observeFixture(client, windowRef, true);
  current = await callTool(
    client,
    "computer_act",
    buildVerifiedSemanticClickRequest(
      requireSnapshot(current),
      requireElement(current, "Toggle pixel overlay").elementRef,
      "background",
    ),
  );
  const toggleState = structured(current);
  const toggleSemantic = current.isError !== true &&
    toggleState.action_result?.status === "executed" &&
    toggleState.action_result.effect === "confirmed" &&
    toggleState.action_result.delivery === "background" &&
    toggleState.verification?.status === "satisfied" &&
    toggleState.observation_mode === "semantic" && !hasPng(current);
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
  const overlayOnce = toggleSemantic && current.isError !== true &&
    overlayResult.consumed_snapshot_id === overlayGrounding &&
    typeof overlayResult.snapshot_id === "string" && overlayResult.snapshot_id !== overlayGrounding &&
    overlayResult.action_result?.status === "executed" &&
    overlayResult.action_result.delivery === "foreground" &&
    overlayResult.observation_mode === "visual_recovery" &&
    hasPng(current) && overlayState.overlay_clicks === 1;

  await resetFixture(fixture.url);
  await activateFocusSentinel(sentinel);
  const globalGrounding = await callTool(client, "computer_observe", {
    target: { kind: "desktop" },
  });
  const globalSwitch = await callTool(
    client,
    "computer_act",
    buildForegroundPositiveControlRequest(requireSnapshot(globalGrounding)),
  );
  if (globalSwitch.isError === true || structured(globalSwitch).action_result?.status !== "executed") {
    throw new Error("focus_oracle_positive_control_failed");
  }
  await waitForFrontmost({ bundleIdentifier: CHROME_BUNDLE_ID, processIdentifier: browserPid });
  await activateFocusSentinel(sentinel);
  current = await observeFixture(client, windowRef, true);
  const backgroundGrounding = requireSnapshot(current);
  current = await callTool(
    client,
    "computer_act",
    buildVerifiedSemanticClickRequest(
      backgroundGrounding,
      requireElement(current, "Semantic Beta").elementRef,
      "background",
    ),
  );
  const identity = await frontmostIdentity();
  const focusPreserved = sentinelAlive(sentinel) &&
    identity.bundleIdentifier === FOCUS_SENTINEL_BUNDLE_ID &&
    identity.processIdentifier === sentinel.pid &&
    validBackgroundSemanticResult(current, backgroundGrounding);
  return { semanticSequence, uniqueText, overlayOnce, focusPreserved };
}

async function evidenceParser(): Promise<z.ZodType> {
  const schema = JSON.parse(await readFile(EVIDENCE_SCHEMA, "utf8")) as Record<string, unknown>;
  const { oneOf, ...strictBase } = schema;
  if (!Array.isArray(oneOf)) throw new Error("development evidence status contract is missing");
  return z.pipe(z.fromJSONSchema(strictBase as never), z.fromJSONSchema(schema as never));
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

    const recorder = new AcceptanceRecorder();
    for (const name of ACCEPTANCE_SCENARIO_NAMES) recorder.recordScenario(name, false);
    const lock = await loadEngineLock();
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
    let gateFailure: unknown;

    try {
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

      connection = await recorder.measure("mcp_start", () =>
        connectClient("ucu-development-acceptance-1"));
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
        // Correctness failures belong in schema-v2 evidence. The subsequent
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

      performanceEvidence = await runPerformanceProfiles(
        connection.client,
        fixture,
        windowRef,
        layout,
        sentinel,
        sentinelWindowRef,
      );
      realAppSmoke = await runRealAppSmoke(connection.client);

      const oldSnapshot = optionalSnapshot(elementActed);
      const oldElementRef = optionalElementRef(elementActed, "Single click");
      await closeConnection(connection);
      connection = undefined;
      try {
        connection = await recorder.measure("mcp_reconnect", () =>
          connectClient("ucu-development-acceptance-2"));
      } catch {
        // The failed reconnect timing and false scenario are valid failed evidence.
      }
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
          // A reconnect correctness failure remains false in schema-v2 evidence.
        }
      }
    } catch (error) {
      gateFailure = error;
    } finally {
      const cleanup = async (operation: () => Promise<void>): Promise<void> => {
        try {
          await operation();
        } catch (error) {
          cleanupFailure ??= error;
        }
      };
      await cleanup(() => closeConnection(connection));
      await cleanup(() => cleanupFocusSentinel(sentinel));
      await cleanup(() => cleanupBrowser(browser));
      await cleanup(() => stopOwnedProcess(fixture?.child));
    }

    if (cleanupFailure !== undefined) throw cleanupFailure;
    if (gateFailure !== undefined || performanceEvidence === undefined) {
      throw gateFailure ?? new Error("acceptance_profiles_missing");
    }
    if (process.arch !== "arm64" && process.arch !== "x64") {
      throw new Error("acceptance_architecture_unsupported");
    }
    const evidence = recorder.evidence({
      product_version: PRODUCT_VERSION,
      protocol_version: PROTOCOL_VERSION,
      engine_version: lock.version,
      macos_version: await macosVersion(),
      architecture: process.arch === "x64" ? "x86_64" : "arm64",
    }, true, performanceEvidence, realAppSmoke, adaptiveCorrectness);
    (await evidenceParser()).parse(evidence);
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
    if (evidence.status === "failed") throw new Error("acceptance_gate_failed");
  }, 600_000);
});
