import type {
  FocusSentinelState,
  HarnessState,
} from "./macos-acceptance-support.js";
import type { PerformanceScenarioName } from "./performance-recorder.js";

export type PerformancePreparationDependencies = Readonly<{
  readFixtureState: () => Promise<HarnessState>;
  resetSentinelText: () => Promise<FocusSentinelState>;
  preparePixelTarget: () => Promise<void>;
}>;

export type PreparedPerformanceState =
  | Readonly<{ kind: "observe" }>
  | Readonly<{ kind: "semantic"; sentinelState: FocusSentinelState }>
  | Readonly<{ kind: "pixel"; fixtureState: HarnessState }>;

export function establishPerformanceTelemetryBoundary(
  telemetry: Readonly<{ clear: () => void }>,
): void {
  telemetry.clear();
}

export async function preparePerformanceScenario(
  name: PerformanceScenarioName,
  dependencies: PerformancePreparationDependencies,
): Promise<PreparedPerformanceState> {
  if (name === "window_visual_observe" || name === "window_semantic_observe") {
    return { kind: "observe" };
  }
  if (name === "semantic_action_next_state") {
    return { kind: "semantic", sentinelState: await dependencies.resetSentinelText() };
  }
  await dependencies.preparePixelTarget();
  return { kind: "pixel", fixtureState: await dependencies.readFixtureState() };
}
