import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import {
  PERFORMANCE_ACTION_ROUTES,
  type PerformanceActionRoute,
  type PerformanceOutcome,
  type PerformanceSample,
  type PerformanceScenarioName,
} from "./performance-recorder.js";
import { classifyToolCallFailure } from "./performance-classification.js";
import { preparePerformanceScenario } from "./performance-preparation.js";
import {
  buildSemanticSetValueRequest,
  validEmptyTextGrounding,
  validFixtureObserve,
} from "./macos-acceptance-result-checks.js";
import {
  FOCUS_SENTINEL_TEXT_LABEL,
  callTool,
  fixedVisualPoint,
  fixtureJson,
  hasPng,
  requireElement,
  requireSnapshot,
  resetFocusSentinelText,
  sentinelAlive,
  structured,
  waitForFocusSentinelText,
  waitForState,
  type Connection,
  type FixtureLayout,
  type FixtureProcess,
  type FocusSentinel,
  type HarnessState,
} from "./macos-acceptance-support.js";

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
): PerformanceSample {
  const route = "result" in measured
    ? structuredIfPresent(measured.result)?.action_result?.route
    : undefined;
  const measuredRoute = PERFORMANCE_ACTION_ROUTES.includes(route as PerformanceActionRoute)
    ? route as PerformanceActionRoute
    : undefined;
  return {
    durationMs: measured.durationMs,
    outcome: outcome ?? (stages === undefined ? "telemetry_missing" : "passed"),
    stages: stages ?? {},
    ...(measuredRoute === undefined ? {} : { route: measuredRoute }),
  };
}

function preparationFailureSample(startedAt: number): PerformanceSample {
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
  const route = state?.action_result?.route;
  const matchingValues = state?.elements?.filter((element) => element.value === nonce) ?? [];
  return state !== undefined &&
    typeof state.snapshot_id === "string" &&
    state.snapshot_id !== groundingSnapshot &&
    state.consumed_snapshot_id === groundingSnapshot &&
    state.action_result?.status === "executed" &&
    PERFORMANCE_ACTION_ROUTES.includes(route as PerformanceActionRoute) &&
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
  const route = state?.action_result?.route;
  return state !== undefined &&
    typeof state.snapshot_id === "string" &&
    state.snapshot_id !== groundingSnapshot &&
    state.consumed_snapshot_id === groundingSnapshot &&
    state.action_result?.status === "executed" &&
    PERFORMANCE_ACTION_ROUTES.includes(route as PerformanceActionRoute) &&
    state.action_result.delivery === "background" &&
    state.observation_mode === "visual" &&
    state.visual_status === "available" &&
    hasPng(result);
}

export async function performanceIteration(
  name: PerformanceScenarioName,
  index: number,
  connection: Connection,
  fixture: FixtureProcess | undefined,
  windowRef: string | undefined,
  layout: FixtureLayout | undefined,
  sentinel: FocusSentinel | undefined,
  sentinelWindowRef: string | undefined,
): Promise<PerformanceSample> {
  const preparationStartedAt = performance.now();
  let prepared: Awaited<ReturnType<typeof preparePerformanceScenario>>;
  try {
    prepared = await preparePerformanceScenario(name, {
      readFixtureState: () => fixture === undefined
        ? Promise.reject(new Error("performance_fixture_missing"))
        : fixtureJson<HarnessState>(fixture.url, "/state"),
      resetSentinelText: () => sentinel === undefined
        ? Promise.reject(new Error("performance_sentinel_missing"))
        : resetFocusSentinelText(sentinel),
    });
  } catch {
    return preparationFailureSample(preparationStartedAt);
  }

  if (name === "window_visual_observe" || name === "window_semantic_observe") {
    if (windowRef === undefined) return preparationFailureSample(preparationStartedAt);
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
    if (prepared.kind !== "semantic" || sentinel === undefined || sentinelWindowRef === undefined) {
      return preparationFailureSample(preparationStartedAt);
    }
    const groundingCursor = connection.telemetry.cursor();
    const groundedCall = await timedCall(() => callTool(
      connection.client,
      "computer_observe",
      {
        target: { kind: "window", window_ref: sentinelWindowRef },
        include_screenshot: false,
        elements: { max_elements: 150, max_depth: 12 },
      },
    ));
    const groundingStages = await connection.telemetry.waitForOne(
      groundingCursor,
      "computer_observe",
    );
    const groundingFailure = measuredToolFailure(groundedCall);
    if (groundingFailure !== undefined) return measuredSample(groundedCall, {}, groundingFailure);
    if (groundingStages === undefined) return measuredSample(groundedCall, {}, "telemetry_missing");
    if (!("result" in groundedCall)) return measuredSample(groundedCall, {}, "contract_mismatch");
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
    const cursor = connection.telemetry.cursor();
    const measured = await timedCall(() => callTool(
      connection.client,
      "computer_act",
      buildSemanticSetValueRequest(groundingSnapshot, text.elementRef, nonce),
    ));
    const stages = await collectMeasuredStages(connection, cursor, "computer_act", measured.durationMs);
    const toolFailure = measuredToolFailure(measured);
    if (toolFailure !== undefined) return measuredSample(measured, stages, toolFailure);
    if (!("result" in measured) || !validSemanticPerformanceContract(
      measured.result,
      groundingSnapshot,
      nonce,
    )) return measuredSample(measured, stages, "contract_mismatch");
    let oracle;
    try {
      oracle = await waitForFocusSentinelText(sentinel, nonce);
    } catch {
      if (!sentinelAlive(sentinel)) return measuredSample(measured, stages, "fixture_unavailable");
      oracle = sentinel.state.current;
    }
    if (
      oracle.reset_generation !== prepared.sentinelState.reset_generation ||
      oracle.text !== nonce ||
      oracle.text_write_count !== 1
    ) return measuredSample(measured, stages, "oracle_mismatch");
    return measuredSample(measured, stages);
  }

  if (
    prepared.kind !== "pixel" ||
    fixture === undefined ||
    windowRef === undefined ||
    layout === undefined ||
    !Number.isSafeInteger(prepared.fixtureState.pixel_clicks) ||
    prepared.fixtureState.pixel_clicks < 0
  ) return preparationFailureSample(preparationStartedAt);
  const groundingCursor = connection.telemetry.cursor();
  const groundedCall = await timedCall(() => callTool(connection.client, "computer_observe", {
    target: { kind: "window", window_ref: windowRef },
    include_screenshot: true,
    elements: { max_elements: 150, max_depth: 12 },
  }));
  const groundingStages = await connection.telemetry.waitForOne(groundingCursor, "computer_observe");
  const groundingFailure = measuredToolFailure(groundedCall);
  if (groundingFailure !== undefined) return measuredSample(groundedCall, {}, groundingFailure);
  if (groundingStages === undefined) return measuredSample(groundedCall, {}, "telemetry_missing");
  if (!("result" in groundedCall)) return measuredSample(groundedCall, {}, "contract_mismatch");
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
  const cursor = connection.telemetry.cursor();
  const measured = await timedCall(() => callTool(connection.client, "computer_act", {
    snapshot_id: groundingSnapshot,
    action: { type: "click", ...point },
    delivery: "background",
    next_observation: { mode: "visual" },
  }));
  const stages = await collectMeasuredStages(connection, cursor, "computer_act", measured.durationMs);
  const toolFailure = measuredToolFailure(measured);
  if (toolFailure !== undefined) return measuredSample(measured, stages, toolFailure);
  if (!("result" in measured) || !validPixelPerformanceContract(measured.result, groundingSnapshot)) {
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
