export type AcceptanceTimingName =
  | "mcp_start"
  | "desktop_observe"
  | "window_discover"
  | "window_observe"
  | "coordinate_action"
  | "element_action"
  | "mcp_reconnect";

export type AcceptanceScenarioName =
  | "two_tool_inventory"
  | "desktop_png"
  | "fresh_snapshot"
  | "stale_snapshot_rejected"
  | "exact_window_discovered"
  | "window_png_and_element"
  | "background_element_effect"
  | "window_coordinate_effect"
  | "old_refs_rejected_after_reconnect";

export type AcceptanceMetadata = Readonly<{
  product_version: string;
  protocol_version: string;
  engine_version: string;
  macos_version: string;
  architecture: "arm64" | "x86_64";
}>;

export type AcceptanceTiming = Readonly<{
  name: AcceptanceTimingName;
  duration_ms: number;
  target_ms: number;
  hard_limit_ms: number;
  status: "target_met" | "degraded" | "failed";
}>;

export type DevelopmentEvidence = Readonly<{
  schema_version: 1;
  evidence_type: "computer-use-macos-development-acceptance";
  status: "passed" | "degraded";
  metadata: AcceptanceMetadata;
  scenarios: Readonly<Record<AcceptanceScenarioName, true>>;
  timings: readonly Readonly<Omit<AcceptanceTiming, "status"> & {
    status: "target_met" | "degraded";
  }>[];
  cleanup_passed: true;
  timestamp: string;
}>;

const TIMING_NAMES: readonly AcceptanceTimingName[] = [
  "mcp_start",
  "desktop_observe",
  "window_discover",
  "window_observe",
  "coordinate_action",
  "element_action",
  "mcp_reconnect",
];

const SCENARIO_NAMES: readonly AcceptanceScenarioName[] = [
  "two_tool_inventory",
  "desktop_png",
  "fresh_snapshot",
  "stale_snapshot_rejected",
  "exact_window_discovered",
  "window_png_and_element",
  "background_element_effect",
  "window_coordinate_effect",
  "old_refs_rejected_after_reconnect",
];

const LIMITS: Readonly<Record<AcceptanceTimingName, readonly [number, number]>> = {
  mcp_start: [2_000, 10_000],
  desktop_observe: [1_000, 3_000],
  window_discover: [1_000, 3_000],
  window_observe: [1_000, 3_000],
  coordinate_action: [1_000, 3_000],
  element_action: [3_000, 8_000],
  mcp_reconnect: [2_000, 10_000],
};

export class AcceptanceRecorder {
  readonly #now: () => number;
  readonly #timings = new Map<AcceptanceTimingName, AcceptanceTiming>();
  readonly #scenarios = new Map<AcceptanceScenarioName, boolean>();

  constructor(now: () => number = () => performance.now()) {
    this.#now = now;
  }

  async measure<T>(name: AcceptanceTimingName, operation: () => Promise<T>): Promise<T> {
    const startedAt = this.#now();
    let completed = false;
    let value: T | undefined;
    let operationFailure: unknown;

    try {
      value = await operation();
      completed = true;
    } catch (error) {
      operationFailure = error;
    } finally {
      const durationMs = Math.ceil(Math.max(0, this.#now() - startedAt));
      const [targetMs, hardLimitMs] = LIMITS[name];
      const status = durationMs <= targetMs
        ? "target_met"
        : durationMs <= hardLimitMs
          ? "degraded"
          : "failed";
      this.#timings.set(name, {
        name,
        duration_ms: durationMs,
        target_ms: targetMs,
        hard_limit_ms: hardLimitMs,
        status,
      });
    }

    if (!completed) throw operationFailure;
    if (this.#timings.get(name)?.status === "failed") {
      throw new Error(`acceptance_timing_exceeded:${name}`);
    }
    return value as T;
  }

  recordScenario(name: AcceptanceScenarioName, passed: boolean): void {
    this.#scenarios.set(name, passed);
  }

  evidence(metadata: AcceptanceMetadata, cleanupPassed: boolean): DevelopmentEvidence {
    if (!cleanupPassed) throw new Error("acceptance_cleanup_failed");

    const completeScenarios = SCENARIO_NAMES.every((name) => this.#scenarios.get(name) === true);
    if (!completeScenarios) {
      throw new Error("acceptance_evidence_incomplete");
    }
    const timings = TIMING_NAMES.map((name) => {
      const timing = this.#timings.get(name);
      if (timing === undefined || timing.status === "failed") {
        throw new Error("acceptance_evidence_incomplete");
      }
      return timing as Readonly<Omit<AcceptanceTiming, "status"> & {
        status: "target_met" | "degraded";
      }>;
    });

    return {
      schema_version: 1,
      evidence_type: "computer-use-macos-development-acceptance",
      status: timings.some((timing) => timing.status === "degraded") ? "degraded" : "passed",
      metadata: { ...metadata },
      scenarios: Object.fromEntries(SCENARIO_NAMES.map((name) => [name, true])) as Record<
        AcceptanceScenarioName,
        true
      >,
      timings,
      cleanup_passed: true,
      timestamp: new Date().toISOString(),
    };
  }
}
