/**
 * Action-then-observe ordering adapted from:
 * https://github.com/trycua/cua/blob/c60ef6ad2db8774fb342938843e2f17f26c68240/libs/cua-driver/examples/agent-sdks/native-tools.ts
 * Upstream SPDX-License-Identifier: MIT
 */
import type { EngineAction, EngineDiscovery, EngineExecution, EnginePort, EngineWindowAction } from "../engine/port.js";
import type { ActEnvelope, ActInput, ComputerAction, ObservationEnvelope, ObserveInput } from "../protocol.js";
import { SnapshotStore } from "../snapshot-store.js";
import { TargetRegistry, type NativeAppTarget, type NativeWindowTarget } from "../target-registry.js";
import { ComputerUseError } from "../errors.js";
import {
  NOOP_METADATA_LOGGER,
  type MetadataLogEvent,
  type MetadataLogger,
} from "../logging/logger.js";
import { RuntimeTiming } from "../logging/timing.js";
import {
  assertCoordinates,
  failedExecution,
  toActEnvelope,
  toUnavailableActEnvelope,
  toWindowActEnvelope,
} from "./act.js";
import {
  observeWithOneTransientRetry,
  observeWindowWithOneTransientRetry,
  projectWindowElements,
  publicApp,
  publicWindow,
  toDesktopDiscoveryEnvelope,
  toObservationEnvelope,
  toWindowObservationEnvelope,
  withTimeout,
} from "./observe.js";
import { SerialExecutor } from "./serial-executor.js";
import { decideFinalObservation, decideInitialObservation } from "./observation-policy.js";
import {
  expectationSatisfied,
  verifyWindowState,
  type VerificationExpectation,
  type VerificationResult,
} from "./verifier.js";

export type RuntimeInstrumentation = Readonly<{
  logger?: MetadataLogger;
  now?: () => number;
}>;

export class ComputerUseRuntime {
  private readonly serial = new SerialExecutor();
  private readonly lifecycle = new AbortController();
  private closePromise?: Promise<void>;
  private engineUnhealthy = false;
  private readonly logger: MetadataLogger;
  private readonly now: () => number;

  constructor(
    private readonly engine: EnginePort,
    private readonly snapshots = new SnapshotStore(),
    private readonly targets = new TargetRegistry(),
    instrumentation: RuntimeInstrumentation = {},
  ) {
    this.logger = instrumentation.logger ?? NOOP_METADATA_LOGGER;
    this.now = instrumentation.now ?? (() => performance.now());
  }

  observe(input: ObserveInput = {}): Promise<ObservationEnvelope> {
    const timing = new RuntimeTiming(this.now);
    return this.serial.run(async () => {
      timing.markDequeued();
      try {
        const result = await this.observeUnlocked(input, timing);
        this.logSuccess("computer_observe", undefined, result, timing);
        return result;
      } catch (error) {
        this.logFailure("computer_observe", undefined, undefined, error, timing);
        throw error;
      }
    });
  }

  private async observeUnlocked(input: ObserveInput, timing: RuntimeTiming): Promise<ObservationEnvelope> {
    this.snapshots.clear();
    const target = input.target ?? { kind: "desktop" as const };
    if (target.kind === "window") {
      const window = this.targets.resolveWindow(target.window_ref);
      const includeScreenshot = input.include_screenshot ?? true;
      const maxElements = input.elements?.max_elements ?? 150;
      const maxDepth = input.elements?.max_depth ?? 12;
      let observed;
      try {
        observed = await timing.measure(
          "postActionObserveMs",
          () => withTimeout(
            (signal) => this.engine.observe({
              target: { kind: "window", window },
              includeScreenshot,
              ...(input.elements?.query === undefined ? {} : { query: input.elements.query }),
              maxElements,
              maxDepth,
            }, signal),
            20_000,
            "capture_failed",
            this.lifecycle.signal,
          ),
        );
      } catch (error) {
        if (error instanceof ComputerUseError && error.code === "window_owner_changed") {
          this.targets.invalidateWindow(window.windowRef);
        }
        throw error;
      }
      if (!("visualStatus" in observed)) {
        throw new ComputerUseError("engine_contract_changed", "Window observation returned desktop state", "doctor", false);
      }
      return timing.measureSync("projectionMs", () => {
        const projected = projectWindowElements(observed, maxElements);
        const visual = observed.visualStatus === "available" && observed.image !== undefined
          ? { status: "available" as const, width: observed.image.width, height: observed.image.height }
          : { status: observed.visualStatus as Exclude<typeof observed.visualStatus, "available"> };
        const snapshot = this.snapshots.create({
          sessionId: this.engine.sessionId,
          target: { kind: "window", windowRef: window.windowRef },
          observationMode: includeScreenshot ? "visual" : "semantic",
          visual,
          coordinateSpace: "window_screenshot_pixels",
          ...(observed.upstreamSnapshotId === undefined ? {} : { upstreamSnapshotId: observed.upstreamSnapshotId }),
          windowTarget: {
            windowRef: window.windowRef,
            appRef: window.appRef,
            nativeKey: window.nativeKey,
            ownerKey: window.ownerKey,
          },
          elements: projected.elements.map((element) => element.snapshot),
          observeOptions: {
            includeScreenshot,
            ...(input.elements?.query === undefined ? {} : { query: input.elements.query }),
            maxElements,
            maxDepth,
          },
        });
        return toWindowObservationEnvelope(this.engine, snapshot, observed, projected);
      });
    }

    const observePromise = timing.measure(
      "postActionObserveMs",
      () => withTimeout(
        (signal) => this.engine.observe(signal),
        20_000,
        "capture_failed",
        this.lifecycle.signal,
      ),
    );
    const discoveryPromise = input.discover === undefined
      ? undefined
      : withTimeout(
          (signal) => this.engine.discover({
            apps: input.discover?.apps === true,
            windows: input.discover?.windows === true,
          }, signal),
          20_000,
          "capture_failed",
          this.lifecycle.signal,
        );
    const [observed, discovery] = await Promise.all([
      observePromise,
      discoveryPromise ?? Promise.resolve(undefined),
    ]);
    return timing.measureSync("projectionMs", () => {
      const snapshot = this.snapshots.create({
        sessionId: this.engine.sessionId,
        target: { kind: "desktop" },
        visual: { status: "available", width: observed.image.width, height: observed.image.height },
        coordinateSpace: "desktop_screenshot_pixels",
        observeOptions: { includeScreenshot: true, maxElements: 0, maxDepth: 0 },
      });
      if (discovery === undefined || input.discover === undefined) {
        return toObservationEnvelope(this.engine, snapshot, observed);
      }
      return toDesktopDiscoveryEnvelope(
        this.engine,
        snapshot,
        observed,
        this.projectDiscovery(discovery, input.discover),
      );
    });
  }

  private projectDiscovery(
    discovery: EngineDiscovery,
    request: NonNullable<ObserveInput["discover"]>,
  ): Readonly<{
    apps?: ReturnType<typeof publicApp>[];
    appsTruncated?: boolean;
    windows?: ReturnType<typeof publicWindow>[];
    windowsTruncated?: boolean;
  }> {
    const query = request.query?.normalize("NFKC").toLocaleLowerCase("en-US");
    const appFilter = request.window_app_ref === undefined
      ? undefined
      : this.targets.resolveApp(request.window_app_ref);
    const apps = discovery.apps.filter((app) => this.matchesApp(app, query));
    const windows = discovery.windows.filter((window) =>
      (appFilter === undefined || window.app.nativeKey === appFilter.nativeKey) && this.matchesWindow(window, query));
    const appCandidates = [...apps].sort((left, right) =>
      Number(right.running) - Number(left.running) ||
      left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" }) ||
      left.nativeKey.localeCompare(right.nativeKey));
    const windowCandidates = [...windows].sort((left, right) =>
      Number(right.onCurrentSpace === true) - Number(left.onCurrentSpace === true) ||
      Number(right.isOnScreen === true) - Number(left.isOnScreen === true) ||
      (right.zIndex ?? Number.NEGATIVE_INFINITY) - (left.zIndex ?? Number.NEGATIVE_INFINITY) ||
      left.app.displayName.localeCompare(right.app.displayName, undefined, { sensitivity: "base" }) ||
      left.title.localeCompare(right.title, undefined, { sensitivity: "base" }) ||
      left.nativeKey.localeCompare(right.nativeKey));
    const result: {
      apps?: ReturnType<typeof publicApp>[];
      appsTruncated?: boolean;
      windows?: ReturnType<typeof publicWindow>[];
      windowsTruncated?: boolean;
    } = {};
    if (request.apps === true) {
      const capped = appCandidates.slice(0, 50);
      result.apps = this.targets.registerApps(capped).map(publicApp);
      result.appsTruncated = appCandidates.length > capped.length;
    }
    if (request.windows === true) {
      const capped = windowCandidates.slice(0, 30);
      result.windows = this.targets.registerWindows(capped).map(publicWindow);
      result.windowsTruncated = windowCandidates.length > capped.length;
    }
    return result;
  }

  private matchesApp(app: NativeAppTarget, query: string | undefined): boolean {
    if (query === undefined) return true;
    return [app.displayName, ...Object.values(app.native).filter((value): value is string => typeof value === "string")]
      .some((value) => value.normalize("NFKC").toLocaleLowerCase("en-US").includes(query));
  }

  private matchesWindow(window: NativeWindowTarget, query: string | undefined): boolean {
    return query === undefined || this.matchesApp(window.app, query) ||
      window.title.normalize("NFKC").toLocaleLowerCase("en-US").includes(query);
  }

  act(input: ActInput): Promise<ActEnvelope> {
    const timing = new RuntimeTiming(this.now);
    return this.serial.run(async () => {
      timing.markDequeued();
      try {
        const result = await this.actUnlocked(input, timing);
        this.logSuccess("computer_act", input.action.type, result, timing);
        return result;
      } catch (error) {
        this.logFailure("computer_act", input.action.type, input.snapshot_id, error, timing);
        throw error;
      }
    });
  }

  private async actUnlocked(input: ActInput, timing: RuntimeTiming): Promise<ActEnvelope> {
    const snapshot = this.snapshots.requireCurrent(input.snapshot_id);
    if (input.next_observation !== undefined && snapshot.target.kind !== "window") {
      throw new ComputerUseError(
        "next_observation_target_conflict",
        "next_observation requires a window snapshot",
        "observe_again",
        true,
      );
    }
    if (this.engineUnhealthy) {
      const healthy = await withTimeout(
        (signal) => this.engine.health(signal),
        5_000,
        "capture_failed",
        this.lifecycle.signal,
      );
      if (!healthy) {
        throw new ComputerUseError("engine_unhealthy", "Cua health checks have not recovered", "doctor", true);
      }
      this.engineUnhealthy = false;
    }
    assertCoordinates(input.action, snapshot);
    const verificationExpectation = this.resolveVerificationExpectation(input, snapshot);
    const engineAction = this.resolveEngineAction(input, snapshot);
    this.snapshots.consume(input.snapshot_id);

    let actionResult: EngineExecution;
    try {
      actionResult = await timing.measure(
        "engineExecuteMs",
        () => withTimeout(
          (signal) => this.engine.execute(engineAction, signal),
          20_000,
          "action_timeout",
          this.lifecycle.signal,
        ),
      );
    } catch (error) {
      const critical = this.consumedCriticalError(error);
      if (critical !== undefined) throw critical;
      actionResult = failedExecution(error);
    }

    if (engineAction.target.kind === "app") {
      return this.finishLaunch(snapshot.id, actionResult, timing);
    }

    if (snapshot.target.kind === "window") {
      if (engineAction.target.kind !== "window") {
        this.engineUnhealthy = true;
        throw new ComputerUseError(
          "engine_contract_changed",
          "Window snapshot resolved to a non-window action",
          "doctor",
          false,
          true,
        );
      }
      const window = this.targets.resolveWindow(snapshot.target.windowRef);
      const initial = decideInitialObservation({
        consumedOptions: snapshot.observeOptions,
        requestedMode: input.next_observation?.mode,
        action: engineAction.action as EngineWindowAction,
        execution: actionResult,
        hasResolvedExpectation: verificationExpectation !== undefined,
      });
      const observeWith = (options: typeof snapshot.observeOptions) =>
        timing.measure(
          "postActionObserveMs",
          () => observeWindowWithOneTransientRetry(this.engine, {
            target: { kind: "window", window },
            includeScreenshot: options.includeScreenshot,
            ...(options.query === undefined ? {} : { query: options.query }),
            maxElements: options.maxElements,
            maxDepth: options.maxDepth,
          }, this.lifecycle.signal),
        );
      let observed;
      let verification: VerificationResult = { status: "not_requested" };
      let transitioned = false;
      try {
        if (verificationExpectation === undefined) {
          observed = await observeWith(initial.options);
        } else {
          const verified = await verifyWindowState({
            observe: () => observeWith(initial.options),
            expectation: verificationExpectation.expectation,
            timeoutMs: verificationExpectation.timeoutMs,
            signal: this.lifecycle.signal,
          });
          observed = verified.observation;
          verification = verified.verification;
          transitioned = verified.transitioned;
        }
      } catch (error) {
        if (error instanceof ComputerUseError && error.code === "window_owner_changed") {
          this.targets.invalidateWindow(window.windowRef);
        }
        const critical = this.consumedCriticalError(error);
        if (critical !== undefined) throw critical;
        if (error instanceof ComputerUseError &&
            (error.code === "capture_failed" || error.code === "target_lost" || error.code === "window_owner_changed")) {
          const errorCode = error.code;
          return timing.measureSync(
            "projectionMs",
            () => toUnavailableActEnvelope(
              this.engine,
              snapshot.id,
              actionResult,
              errorCode,
              verificationExpectation === undefined
                ? { status: "not_requested" }
                : { status: "unknown", reason: "observation_unavailable" },
            ),
          );
        }
        throw error;
      }
      actionResult = this.applyVerification(
        actionResult,
        verification,
        transitioned,
        verificationExpectation?.setValue === true,
      );
      const final = decideFinalObservation({ initial, verification, finalExecution: actionResult });
      if (final.requiresVisualRecovery) {
        try {
          observed = await observeWith(final.options);
        } catch (error) {
          if (error instanceof ComputerUseError && error.code === "window_owner_changed") {
            this.targets.invalidateWindow(window.windowRef);
          }
          const critical = this.consumedCriticalError(error);
          if (critical !== undefined) throw critical;
          if (error instanceof ComputerUseError &&
              (error.code === "capture_failed" || error.code === "target_lost" || error.code === "window_owner_changed")) {
            const errorCode = error.code;
            return timing.measureSync(
              "projectionMs",
              () => toUnavailableActEnvelope(
                this.engine,
                snapshot.id,
                actionResult,
                errorCode,
                verificationExpectation === undefined
                  ? { status: "not_requested" }
                  : { status: "unknown", reason: "observation_unavailable" },
              ),
            );
          }
          throw error;
        }
      }
      return timing.measureSync("projectionMs", () => {
        const projected = projectWindowElements(observed, final.options.maxElements);
        const visual = observed.visualStatus === "available" && observed.image !== undefined
          ? { status: "available" as const, width: observed.image.width, height: observed.image.height }
          : { status: observed.visualStatus as Exclude<typeof observed.visualStatus, "available"> };
        const next = this.snapshots.create({
          sessionId: this.engine.sessionId,
          target: { kind: "window", windowRef: window.windowRef },
          observationMode: final.observationMode,
          visual,
          coordinateSpace: "window_screenshot_pixels",
          ...(observed.upstreamSnapshotId === undefined ? {} : { upstreamSnapshotId: observed.upstreamSnapshotId }),
          windowTarget: {
            windowRef: window.windowRef,
            appRef: window.appRef,
            nativeKey: window.nativeKey,
            ownerKey: window.ownerKey,
          },
          elements: projected.elements.map((element) => element.snapshot),
          observeOptions: final.options,
        });
        return toWindowActEnvelope(this.engine, snapshot.id, next, actionResult, observed, projected, verification);
      });
    }

    let observed;
    try {
      observed = await timing.measure(
        "postActionObserveMs",
        () => observeWithOneTransientRetry(
          this.engine,
          this.lifecycle.signal,
        ),
      );
    } catch (error) {
      const critical = this.consumedCriticalError(error);
      if (critical !== undefined) throw critical;
      if (
        error instanceof ComputerUseError &&
        (error.code === "capture_failed" ||
          error.code === "target_lost" ||
          error.code === "window_owner_changed")
      ) {
        const errorCode = error.code;
        return timing.measureSync(
          "projectionMs",
          () => toUnavailableActEnvelope(
            this.engine,
            snapshot.id,
            actionResult,
            errorCode,
          ),
        );
      }
      throw error;
    }
    return timing.measureSync("projectionMs", () => {
      const next = this.snapshots.create(
        this.engine.sessionId,
        observed.image.width,
        observed.image.height,
      );
      return toActEnvelope(this.engine, snapshot.id, next, actionResult, observed);
    });
  }

  private async finishLaunch(
    consumedId: string,
    result: EngineExecution,
    timing: RuntimeTiming,
  ): Promise<ActEnvelope> {
    const candidates = result.launch === undefined
      ? []
      : this.targets.registerWindows(result.launch.windows).slice(0, 30);
    if (result.status === "executed" && result.launch?.windowReady === true && candidates.length === 1) {
      const window = candidates[0]!;
      try {
        const observed = await timing.measure(
          "postActionObserveMs",
          () => observeWindowWithOneTransientRetry(this.engine, {
            target: { kind: "window", window },
            includeScreenshot: true,
            maxElements: 150,
            maxDepth: 12,
          }, this.lifecycle.signal),
        );
        return timing.measureSync("projectionMs", () => {
          const projected = projectWindowElements(observed, 150);
          const visual = observed.visualStatus === "available" && observed.image !== undefined
            ? { status: "available" as const, width: observed.image.width, height: observed.image.height }
            : { status: observed.visualStatus as Exclude<typeof observed.visualStatus, "available"> };
          const next = this.snapshots.create({
            sessionId: this.engine.sessionId,
            target: { kind: "window", windowRef: window.windowRef },
            observationMode: "visual",
            visual,
            coordinateSpace: "window_screenshot_pixels",
            ...(observed.upstreamSnapshotId === undefined ? {} : { upstreamSnapshotId: observed.upstreamSnapshotId }),
            windowTarget: {
              windowRef: window.windowRef,
              appRef: window.appRef,
              nativeKey: window.nativeKey,
              ownerKey: window.ownerKey,
            },
            elements: projected.elements.map((element) => element.snapshot),
            observeOptions: { includeScreenshot: true, maxElements: 150, maxDepth: 12 },
          });
          return toWindowActEnvelope(this.engine, consumedId, next, result, observed, projected);
        });
      } catch (error) {
        const critical = this.consumedCriticalError(error);
        if (critical !== undefined) throw critical;
        if (!(error instanceof ComputerUseError) ||
            !["capture_failed", "target_lost", "window_owner_changed"].includes(error.code)) throw error;
        result = {
          ...result,
          effect: "partial",
          evidence: (result.evidence ?? []).filter((evidence) => evidence !== "window_ready"),
          errorCode: "window_not_ready",
          escalation: { reason: "window_not_ready" },
        };
      }
    }

    let observed;
    try {
      observed = await timing.measure(
        "postActionObserveMs",
        () => observeWithOneTransientRetry(this.engine, this.lifecycle.signal),
      );
    } catch (error) {
      const critical = this.consumedCriticalError(error);
      if (critical !== undefined) throw critical;
      throw error;
    }
    return timing.measureSync("projectionMs", () => {
      const next = this.snapshots.create({
        sessionId: this.engine.sessionId,
        target: { kind: "desktop" },
        visual: { status: "available", width: observed.image.width, height: observed.image.height },
        coordinateSpace: "desktop_screenshot_pixels",
        observeOptions: { includeScreenshot: true, maxElements: 0, maxDepth: 0 },
      });
      return toActEnvelope(
        this.engine,
        consumedId,
        next,
        result,
        observed,
        candidates.length > 1
          ? { windows: candidates.map(publicWindow), windowsTruncated: result.launch!.windows.length > candidates.length }
          : {},
      );
    });
  }

  private resolveEngineAction(input: ActInput, snapshot: ReturnType<SnapshotStore["requireCurrent"]>): EngineAction {
    const action = input.action;
    if (snapshot.target.kind === "desktop") {
      if (input.delivery !== undefined || input.expect !== undefined) {
        throw new ComputerUseError("unsupported_action", "Desktop actions do not accept delivery or expect", "stop", false);
      }
      if ("element_ref" in action ||
          ((action.type === "type" || action.type === "type_text" || action.type === "keypress") && "x" in action)) {
        throw new ComputerUseError("element_target_conflict", "Desktop action address does not match its snapshot", "observe_again", false);
      }
      if (action.type === "invoke_menu") {
        throw new ComputerUseError("unsupported_action", `${action.type} requires a window snapshot`, "observe_again", false);
      }
      if (action.type === "launch_app") {
        return {
          target: { kind: "app", app: this.targets.resolveApp(action.app_ref) },
          action: { type: "launch_app" },
        };
      }
      return { target: { kind: "desktop" }, action };
    }

    if (action.type === "move" || action.type === "launch_app") {
      throw new ComputerUseError("unsupported_action", `${action.type} is not available on a window snapshot`, "observe_again", false);
    }
    if (["set_value", "invoke_menu", "wait"].includes(action.type) && input.delivery !== undefined) {
      throw new ComputerUseError("unsupported_action", `delivery is not valid for ${action.type}`, "stop", false);
    }
    const window = this.targets.resolveWindow(snapshot.target.windowRef);
    if (snapshot.windowTarget === undefined ||
        snapshot.windowTarget.nativeKey !== window.nativeKey ||
        snapshot.windowTarget.ownerKey !== window.ownerKey) {
      throw new ComputerUseError("window_owner_changed", "Window identity changed after observation", "discover_again", true);
    }
    const pid = window.native.pid;
    const windowId = window.native.window_id;
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(windowId)) {
      throw new ComputerUseError("engine_contract_changed", "Window target lacks safe native identifiers", "doctor", false);
    }

    const elementAddress = (elementRef: string, capability: string): Readonly<{ kind: "element"; token: string }> => {
      const element = this.snapshots.resolveElement(snapshot.id, elementRef);
      if (!element.capabilities.includes(capability)) {
        throw new ComputerUseError("element_unavailable", `Element does not support ${capability}`, "observe_again", true);
      }
      return { kind: "element", token: element.token };
    };
    const address = (
      candidate: { element_ref: string } | { x: number; y: number },
      capability: string,
    ): Readonly<{ kind: "element"; token: string }> | Readonly<{ kind: "coordinate"; x: number; y: number }> =>
      "element_ref" in candidate
        ? elementAddress(candidate.element_ref, capability)
        : { kind: "coordinate", x: candidate.x, y: candidate.y };

    let mapped: EngineWindowAction;
    switch (action.type) {
      case "click":
      case "double_click":
      case "right_click":
        mapped = { type: action.type, address: address(action, action.type) };
        break;
      case "drag":
        mapped = {
          type: "drag",
          fromX: action.from_x,
          fromY: action.from_y,
          toX: action.to_x,
          toY: action.to_y,
          ...(action.duration_ms === undefined ? {} : { durationMs: action.duration_ms }),
        };
        break;
      case "scroll":
        mapped = {
          type: "scroll",
          address: address(action, "scroll"),
          direction: action.direction,
          amount: action.amount,
          ...(action.by === undefined ? {} : { by: action.by }),
        };
        break;
      case "set_value":
        mapped = { type: "set_value", address: elementAddress(action.element_ref, "set_value"), value: action.value };
        break;
      case "type":
      case "type_text":
        mapped = {
          type: "type_text",
          ...("element_ref" in action
            ? { address: elementAddress(action.element_ref, "type_text") }
            : "x" in action
              ? { address: { kind: "coordinate" as const, x: action.x, y: action.y } }
              : {}),
          text: action.text,
        };
        break;
      case "keypress":
        mapped = {
          type: "keypress",
          ...("element_ref" in action
            ? { address: elementAddress(action.element_ref, "keypress") }
            : "x" in action
              ? { address: { kind: "coordinate" as const, x: action.x, y: action.y } }
              : {}),
          keys: action.keys,
        };
        break;
      case "invoke_menu":
        mapped = { type: "invoke_menu", path: action.path };
        break;
      case "wait":
        mapped = { type: "wait", ms: action.ms };
        break;
    }
    return {
      target: { kind: "window", pid: pid as number, windowId: windowId as number },
      action: mapped,
      ...(["set_value", "invoke_menu", "wait"].includes(mapped.type)
        ? {}
        : { delivery: input.delivery ?? "background" }),
    };
  }

  private resolveVerificationExpectation(
    input: ActInput,
    snapshot: ReturnType<SnapshotStore["requireCurrent"]>,
  ): Readonly<{ expectation: VerificationExpectation; timeoutMs: number; setValue: boolean }> | undefined {
    const setValueAction = input.action.type === "set_value" ? input.action : undefined;
    if (input.expect === undefined && setValueAction === undefined) return undefined;
    if (snapshot.target.kind !== "window") {
      throw new ComputerUseError("element_target_conflict", "Verification requires a window snapshot", "observe_again", false);
    }
    if (setValueAction !== undefined && input.expect !== undefined &&
        input.expect.element.element_ref !== setValueAction.element_ref) {
      throw new ComputerUseError("element_target_conflict", "set_value expectation targets another element", "observe_again", false);
    }
    const elementRef = setValueAction?.element_ref ?? input.expect!.element.element_ref;
    const element = this.snapshots.resolveElement(snapshot.id, elementRef);
    const assertion = {
      ...(setValueAction !== undefined
        ? { valueEquals: setValueAction.value }
        : input.expect?.element.value_equals === undefined
          ? {}
          : { valueEquals: input.expect.element.value_equals }),
      ...(input.expect?.element.enabled === undefined ? {} : { enabled: input.expect.element.enabled }),
      ...(input.expect?.element.selected === undefined ? {} : { selected: input.expect.element.selected }),
    };
    const observed = element.observed ?? {};
    const trustworthy = (assertion.valueEquals === undefined || observed.value !== undefined) &&
      (assertion.enabled === undefined || observed.enabled !== undefined) &&
      (assertion.selected === undefined || observed.selected !== undefined);
    return {
      expectation: {
        identity: element.identity,
        ...assertion,
        preSatisfied: trustworthy ? expectationSatisfied(assertion, observed) : "unknown",
      },
      timeoutMs: input.expect?.timeout_ms ?? 5_000,
      setValue: setValueAction !== undefined,
    };
  }

  private applyVerification(
    result: EngineExecution,
    verification: VerificationResult,
    transitioned: boolean,
    setValue: boolean,
  ): EngineExecution {
    if (verification.status === "not_requested" || result.status !== "executed") return result;
    const evidence = new Set(result.evidence ?? []);
    let effect = result.effect;
    let errorCode = result.errorCode;
    if (verification.status === "satisfied" && transitioned) {
      evidence.add("predicate_satisfied");
      if (setValue) evidence.add("value_readback");
      effect = "confirmed";
      errorCode = undefined;
    } else if (verification.status === "unsatisfied") {
      errorCode = "verification_unsatisfied";
    } else if (verification.status === "unknown") {
      errorCode = "verification_unknown";
    }
    return {
      ...result,
      effect,
      evidence: [...evidence],
      ...(errorCode === undefined ? { errorCode: undefined } : { errorCode }),
    };
  }

  private consumedCriticalError(error: unknown): ComputerUseError | undefined {
    if (!(error instanceof ComputerUseError) ||
        !["action_timeout", "engine_contract_changed", "engine_unhealthy"].includes(error.code)) {
      return undefined;
    }
    if (error.code === "engine_contract_changed" || error.code === "engine_unhealthy") {
      this.engineUnhealthy = true;
    }
    return new ComputerUseError(
      error.code,
      error.message,
      error.recovery,
      error.retryable,
      true,
      error.diagnosticReason,
    );
  }

  private logSuccess(
    toolName: "computer_observe" | "computer_act",
    actionType: ComputerAction["type"] | undefined,
    envelope: ObservationEnvelope | ActEnvelope,
    timing: RuntimeTiming,
  ): void {
    const structured = envelope.structured;
    const snapshotId = "snapshot_id" in structured
      ? structured.snapshot_id
      : "consumed_snapshot_id" in structured
        ? structured.consumed_snapshot_id
        : undefined;
    const actionResult = "action_result" in structured ? structured.action_result : undefined;
    this.writeLog({
      sessionId: structured.session_id,
      ...(snapshotId === undefined ? {} : { snapshotId }),
      toolName,
      ...(actionType === undefined ? {} : { actionType }),
      timings: timing.finish(),
      ...("observation_mode" in structured
        ? { observationMode: structured.observation_mode }
        : {}),
      ...(actionResult === undefined
        ? {}
        : {
            effect: actionResult.effect,
            route: actionResult.route,
            delivery: actionResult.delivery,
            ...(actionResult.error_code === undefined
              ? {}
              : { errorCode: actionResult.error_code }),
          }),
    });
  }

  private logFailure(
    toolName: "computer_observe" | "computer_act",
    actionType: ComputerAction["type"] | undefined,
    snapshotId: string | undefined,
    error: unknown,
    timing: RuntimeTiming,
  ): void {
    this.writeLog({
      sessionId: this.engine.sessionId,
      ...(snapshotId === undefined ? {} : { snapshotId }),
      toolName,
      ...(actionType === undefined ? {} : { actionType }),
      timings: timing.finish(),
      errorCode: error instanceof ComputerUseError ? error.code : "runtime_unavailable",
    });
  }

  private writeLog(event: MetadataLogEvent): void {
    try {
      this.logger.log(event);
    } catch {
      // Telemetry is best-effort and must never change tool-call semantics.
    }
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;

    this.lifecycle.abort();
    this.closePromise = this.serial.run(async () => {
      this.snapshots.clear();
      this.targets.clear();
      await this.engine.close();
    });
    return this.closePromise;
  }
}
