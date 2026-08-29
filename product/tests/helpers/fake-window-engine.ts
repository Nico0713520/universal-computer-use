import type {
  EngineAction,
  EngineDesktopObservation,
  EngineDiscoverInput,
  EngineDiscovery,
  EngineExecution,
  EngineObservation,
  EngineObserveInput,
  EnginePort,
  EngineWindowObservation,
} from "../../src/engine/port.js";
import type { InternalWindowTarget, NativeAppTarget, NativeWindowTarget } from "../../src/target-registry.js";

type WindowObserveInput = Readonly<{
  target: Readonly<{ kind: "window"; window: InternalWindowTarget }>;
  includeScreenshot: boolean;
  query?: string;
  maxElements: number;
  maxDepth: number;
}>;

function calculatorApp(): NativeAppTarget {
  return {
    nativeKey: "bundle:com.apple.calculator",
    displayName: "Calculator",
    running: true,
    active: false,
    capabilities: ["launch", "windows"],
    native: { platform: "macos", pid: 42, bundle_id: "com.apple.calculator" },
  };
}

function calculatorWindow(app: NativeAppTarget = calculatorApp(), index = 0): NativeWindowTarget {
  return {
    nativeKey: `window:${index + 7}`,
    ownerKey: "pid:42",
    app,
    title: `Calculator${index === 0 ? "" : ` ${index + 1}`}`,
    bounds: { x: 100 + index * 20, y: 100, width: 460, height: 816 },
    focused: false,
    isOnScreen: true,
    onCurrentSpace: true,
    capabilities: ["observe", "click", "set_value", "type_text", "keypress"],
    native: { platform: "macos", pid: 42, window_id: index + 7, z_index: 2 },
  };
}

function windowObservation(
  visualStatus: EngineWindowObservation["visualStatus"],
  value: string,
  role: string,
  label: string,
): EngineWindowObservation {
  const base = {
    platform: "macos" as const,
    target: {
      windowRef: "win_abcdefghijklmnop",
      appRef: "app_abcdefghijklmnop",
      appName: "Calculator",
      ...calculatorWindow(),
    },
    upstreamSnapshotId: "private-upstream-snapshot",
    elementsComplete: true,
    elements: [{
      index: 0,
      token: "private-element-token",
      role,
      label,
      value,
      frame: { x: 110, y: 610, width: 100, height: 80 },
      depth: 0,
      enabled: true,
    }],
  };
  return visualStatus === "available"
    ? {
        ...base,
        visualStatus: "available",
        image: { mimeType: "image/png", dataBase64: "d2luZG93", width: 920, height: 1632 },
      }
    : { ...base, visualStatus };
}

export class WindowFixtureEngine implements EnginePort {
  readonly name = "cua-driver" as const;
  readonly version = "0.22.2";
  readonly sessionId = "window-fixture-session";
  readonly executions: EngineAction[] = [];
  readonly observeInputs: WindowObserveInput[] = [];
  readonly observations: EngineWindowObservation[];
  readonly observationErrors: unknown[] = [];
  readonly desktopObservationErrors: unknown[] = [];
  readonly healthResults: boolean[] = [];
  execution: EngineExecution = {
    status: "executed",
    effect: "unverifiable",
    route: "unknown",
    delivery: "unknown",
  };

  constructor(
    visualStatus: EngineWindowObservation["visualStatus"] = "available",
    values: string[] = ["7"],
    elementRole = "AXButton",
    elementLabel = "7",
    private readonly launchWindowCount = 1,
  ) {
    this.observations = values.map((value) => windowObservation(visualStatus, value, elementRole, elementLabel));
  }

  async discover(_input: EngineDiscoverInput, _signal: AbortSignal): Promise<EngineDiscovery> {
    const app = calculatorApp();
    return { apps: [app], windows: [calculatorWindow(app)] };
  }

  async observe(signal: AbortSignal): Promise<EngineDesktopObservation>;
  async observe(input: EngineObserveInput, signal: AbortSignal): Promise<EngineObservation>;
  async observe(
    inputOrSignal: EngineObserveInput | AbortSignal,
    maybeSignal?: AbortSignal,
  ): Promise<EngineObservation> {
    const input = inputOrSignal instanceof AbortSignal ? undefined : inputOrSignal;
    const signal = inputOrSignal instanceof AbortSignal ? inputOrSignal : maybeSignal!;
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    if (input === undefined || input.target.kind === "desktop") {
      const error = this.desktopObservationErrors.shift();
      if (error !== undefined) throw error;
      return {
        platform: "macos",
        scaleFactor: 2,
        image: { mimeType: "image/png", dataBase64: "ZGVza3RvcA==", width: 1920, height: 1080 },
      };
    }
    this.observeInputs.push(input as WindowObserveInput);
    const error = this.observationErrors.shift();
    if (error !== undefined) throw error;
    const observed = this.observations.length > 1 ? this.observations.shift()! : this.observations[0]!;
    return { ...observed, target: input.target.window };
  }

  async execute(action: EngineAction, _signal: AbortSignal): Promise<EngineExecution> {
    this.executions.push(action);
    if (action.target.kind !== "app") return this.execution;
    const launchedApp = action.target.app;
    const windows = Array.from(
      { length: this.launchWindowCount },
      (_, index) => calculatorWindow(launchedApp, index),
    );
    return {
      status: "executed",
      effect: windows.length === 1 ? "confirmed" : "partial",
      route: "system_api",
      delivery: "background",
      evidence: ["process_running", ...(windows.length === 1 ? ["window_ready"] : [])],
      ...(windows.length === 0
        ? { errorCode: "window_not_ready" }
        : windows.length > 1
          ? { errorCode: "window_target_ambiguous" }
          : {}),
      launch: {
        requested: true,
        processRunning: true,
        windowReady: windows.length > 0,
        windows,
      },
    };
  }

  async health(_signal: AbortSignal): Promise<boolean> { return this.healthResults.shift() ?? true; }
  async close(): Promise<void> {}
}
