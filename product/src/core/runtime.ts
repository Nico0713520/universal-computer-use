/**
 * Action-then-observe ordering adapted from:
 * https://github.com/trycua/cua/blob/c60ef6ad2db8774fb342938843e2f17f26c68240/libs/cua-driver/examples/agent-sdks/native-tools.ts
 * Upstream SPDX-License-Identifier: MIT
 */
import type { EngineAction, EngineDiscovery, EnginePort, EngineWindowAction } from "../engine/port.js";
import type { ActEnvelope, ActInput, ObservationEnvelope, ObserveInput } from "../protocol.js";
import { SnapshotStore } from "../snapshot-store.js";
import { TargetRegistry, type NativeAppTarget, type NativeWindowTarget } from "../target-registry.js";
import { ComputerUseError } from "../errors.js";
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

export class ComputerUseRuntime {
  private readonly serial = new SerialExecutor();
  private readonly lifecycle = new AbortController();
  private closePromise?: Promise<void>;

  constructor(
    private readonly engine: EnginePort,
    private readonly snapshots = new SnapshotStore(),
    private readonly targets = new TargetRegistry(),
  ) {}

  observe(input: ObserveInput = {}): Promise<ObservationEnvelope> {
    return this.serial.run(() => this.observeUnlocked(input));
  }

  private async observeUnlocked(input: ObserveInput): Promise<ObservationEnvelope> {
    this.snapshots.clear();
    const target = input.target ?? { kind: "desktop" as const };
    if (target.kind === "window") {
      const window = this.targets.resolveWindow(target.window_ref);
      const includeScreenshot = input.include_screenshot ?? true;
      const maxElements = input.elements?.max_elements ?? 150;
      const maxDepth = input.elements?.max_depth ?? 12;
      let observed;
      try {
        observed = await withTimeout(
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
      const projected = projectWindowElements(observed, maxElements);
      const visual = observed.visualStatus === "available" && observed.image !== undefined
        ? { status: "available" as const, width: observed.image.width, height: observed.image.height }
        : { status: observed.visualStatus as Exclude<typeof observed.visualStatus, "available"> };
      const snapshot = this.snapshots.create({
        sessionId: this.engine.sessionId,
        target: { kind: "window", windowRef: window.windowRef },
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
    }

    const observePromise = withTimeout(
      (signal) => this.engine.observe(signal),
      20_000,
      "capture_failed",
      this.lifecycle.signal,
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
    const snapshot = this.snapshots.create({
      sessionId: this.engine.sessionId,
      target: { kind: "desktop" },
      visual: { status: "available", width: observed.image.width, height: observed.image.height },
      coordinateSpace: "desktop_screenshot_pixels",
      elements: [],
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
    return this.serial.run(() => this.actUnlocked(input));
  }

  private async actUnlocked(input: ActInput): Promise<ActEnvelope> {
    const snapshot = this.snapshots.requireCurrent(input.snapshot_id);
    assertCoordinates(input.action, snapshot);
    const engineAction = this.resolveEngineAction(input, snapshot);
    this.snapshots.consume(input.snapshot_id);

    let actionResult;
    try {
      actionResult = await withTimeout(
        (signal) => this.engine.execute(engineAction, signal),
        20_000,
        "action_timeout",
        this.lifecycle.signal,
      );
    } catch (error) {
      if (
        error instanceof ComputerUseError &&
        ["action_timeout", "engine_contract_changed", "engine_unhealthy"].includes(error.code)
      ) {
        throw new ComputerUseError(
          error.code,
          error.message,
          error.recovery,
          error.retryable,
          true,
        );
      }
      actionResult = failedExecution(error);
    }

    if (snapshot.target.kind === "window") {
      const window = this.targets.resolveWindow(snapshot.target.windowRef);
      const options = snapshot.observeOptions;
      let observed;
      try {
        observed = await observeWindowWithOneTransientRetry(this.engine, {
          target: { kind: "window", window },
          includeScreenshot: options.includeScreenshot,
          ...(options.query === undefined ? {} : { query: options.query }),
          maxElements: options.maxElements,
          maxDepth: options.maxDepth,
        }, this.lifecycle.signal);
      } catch (error) {
        if (error instanceof ComputerUseError && error.code === "window_owner_changed") {
          this.targets.invalidateWindow(window.windowRef);
        }
        if (error instanceof ComputerUseError &&
            (error.code === "capture_failed" || error.code === "target_lost" || error.code === "window_owner_changed")) {
          return toUnavailableActEnvelope(this.engine, snapshot.id, actionResult, error.code);
        }
        throw error;
      }
      const projected = projectWindowElements(observed, options.maxElements);
      const visual = observed.visualStatus === "available" && observed.image !== undefined
        ? { status: "available" as const, width: observed.image.width, height: observed.image.height }
        : { status: observed.visualStatus as Exclude<typeof observed.visualStatus, "available"> };
      const next = this.snapshots.create({
        sessionId: this.engine.sessionId,
        target: { kind: "window", windowRef: window.windowRef },
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
        observeOptions: options,
      });
      return toWindowActEnvelope(this.engine, snapshot.id, next, actionResult, observed, projected);
    }

    let observed;
    try {
      observed = await observeWithOneTransientRetry(
        this.engine,
        this.lifecycle.signal,
      );
    } catch (error) {
      if (
        error instanceof ComputerUseError &&
        (error.code === "capture_failed" ||
          error.code === "target_lost" ||
          error.code === "window_owner_changed")
      ) {
        return toUnavailableActEnvelope(
          this.engine,
          snapshot.id,
          actionResult,
          error.code,
        );
      }
      throw error;
    }
    const next = this.snapshots.create(
      this.engine.sessionId,
      observed.image.width,
      observed.image.height,
    );
    return toActEnvelope(this.engine, snapshot.id, next, actionResult, observed);
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
