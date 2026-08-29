import { randomBytes } from "node:crypto";

import { ComputerUseError } from "../errors.js";
import type {
  EngineDesktopObservation,
  EngineElement,
  EngineObserveInput,
  EnginePort,
  EngineWindowObservation,
} from "../engine/port.js";
import {
  ObservationOutputSchema,
  type ImagePayload,
  type ObservationEnvelope,
} from "../protocol.js";
import type {
  ElementIdentity,
  SnapshotElement,
  SnapshotRecord,
} from "../snapshot-store.js";
import type { InternalAppTarget, InternalWindowTarget } from "../target-registry.js";
import { PROTOCOL_VERSION } from "../version.js";

export async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  timeoutCode: "action_timeout" | "capture_failed",
  lifecycleSignal?: AbortSignal,
): Promise<T> {
  if (lifecycleSignal?.aborted) {
    throw new ComputerUseError(
      "runtime_unavailable",
      "Runtime is closing",
      "stop",
      false,
    );
  }

  const controller = new AbortController();
  const signal = lifecycleSignal
    ? AbortSignal.any([controller.signal, lifecycleSignal])
    : controller.signal;
  let lifecycleAbort: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  let operation: Promise<T>;
  try {
    operation = Promise.resolve(run(signal));
  } catch (error) {
    operation = Promise.reject(error);
  }
  // Promise.race observes late settlement too, but this explicit handler makes
  // that guarantee visible and protects future refactors from unhandled SDK
  // rejections after the public deadline has already settled.
  void operation.catch(() => undefined);

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ComputerUseError(timeoutCode, timeoutCode, "observe_again", true));
      controller.abort();
    }, timeoutMs);
  });
  const lifecycle = lifecycleSignal === undefined
    ? new Promise<never>(() => undefined)
    : new Promise<never>((_, reject) => {
        lifecycleAbort = () => {
          reject(new ComputerUseError(
            "runtime_unavailable",
            "Runtime is closing",
            "stop",
            false,
          ));
        };
        lifecycleSignal.addEventListener("abort", lifecycleAbort, { once: true });
      });

  try {
    return await Promise.race([operation, timeout, lifecycle]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (lifecycleSignal !== undefined && lifecycleAbort !== undefined) {
      lifecycleSignal.removeEventListener("abort", lifecycleAbort);
    }
  }
}

export async function observeWithOneTransientRetry(
  engine: EnginePort,
  lifecycleSignal: AbortSignal,
): Promise<EngineDesktopObservation> {
  try {
    return await withTimeout(
      (signal) => engine.observe(signal),
      20_000,
      "capture_failed",
      lifecycleSignal,
    );
  } catch (error) {
    if (
      !(error instanceof ComputerUseError) ||
      error.code !== "capture_failed" ||
      !error.retryable
    ) {
      throw error;
    }
    return withTimeout(
      (signal) => engine.observe(signal),
      20_000,
      "capture_failed",
      lifecycleSignal,
    );
  }
}

export async function observeWindowWithOneTransientRetry(
  engine: EnginePort,
  input: Extract<EngineObserveInput, { target: { kind: "window" } }>,
  lifecycleSignal: AbortSignal,
): Promise<EngineWindowObservation> {
  const run = async (): Promise<EngineWindowObservation> => {
    const observed = await withTimeout(
      (signal) => engine.observe(input, signal),
      20_000,
      "capture_failed",
      lifecycleSignal,
    );
    if (!("visualStatus" in observed)) {
      throw new ComputerUseError("engine_contract_changed", "Window observation returned desktop state", "doctor", false);
    }
    return observed;
  };
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof ComputerUseError) || error.code !== "capture_failed" || !error.retryable) throw error;
    return run();
  }
}

export function toObservationEnvelope(
  engine: EnginePort,
  snapshot: SnapshotRecord,
  value: EngineDesktopObservation,
): ObservationEnvelope {
  return {
    structured: {
      protocol_version: PROTOCOL_VERSION,
      session_id: engine.sessionId,
      snapshot_id: snapshot.id,
      platform: value.platform,
      display_id: "primary",
      target: { kind: "desktop", display_id: "primary" },
      coordinate_space: "desktop_screenshot_pixels",
      screenshot: {
        mime_type: "image/png",
        width: value.image.width,
        height: value.image.height,
      },
      engine: { name: engine.name, version: engine.version },
    },
    image: { mimeType: "image/png", dataBase64: value.image.dataBase64 },
  };
}

export type PublicAppDiscovery = Readonly<{
  app_ref: string;
  display_name: string;
  running: boolean;
  capabilities: readonly ("launch" | "windows")[];
}>;

export type PublicWindowDiscovery = Readonly<{
  window_ref: string;
  app_ref: string;
  app_name: string;
  title: string;
  bounds: Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
    coordinate_space: "desktop_logical";
  }>;
  is_on_screen?: boolean;
  on_current_space?: boolean;
  minimized?: boolean;
  capabilities: Readonly<{
    elements: "available" | "unavailable" | "unknown";
    window_screenshot: "available" | "unavailable" | "unknown";
    background_actions: "available" | "unavailable" | "unknown";
  }>;
}>;

export type ProjectedElement = Readonly<{
  public: Readonly<{
    element_ref: string;
    role: string;
    label: string;
    value?: string;
    bounds?: Readonly<{ x: number; y: number; width: number; height: number }>;
    enabled?: boolean;
    selected?: boolean;
    focused?: boolean;
    actions: readonly ("click" | "double_click" | "right_click" | "scroll" | "set_value" | "type_text" | "keypress")[];
  }>;
  snapshot: SnapshotElement;
}>;

function normalized(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function publicRole(role: string): string {
  return role.replace(/^AX/u, "").replace(/^UIA[_-]?/iu, "").trim().toLocaleLowerCase("en-US");
}

function provenActions(role: string): ProjectedElement["public"]["actions"] {
  const value = publicRole(role).replace(/[\s_-]/gu, "");
  if (["button", "checkbox", "radiobutton", "menuitem", "link", "tab"].includes(value)) {
    return Object.freeze(["click", "double_click", "right_click"]);
  }
  if (["textfield", "textarea", "edit", "combobox", "searchfield"].includes(value)) {
    return Object.freeze(["click", "double_click", "right_click", "set_value", "type_text", "keypress"]);
  }
  if (["scrollarea", "scrollbar"].includes(value)) return Object.freeze(["click", "double_click", "right_click", "scroll"]);
  // Cua's get_window_state only emits element-indexed rows that its click
  // route can address; non-actionable display-only AX rows are omitted.
  return Object.freeze(["click", "double_click", "right_click"]);
}

export function elementIdentityFor(element: EngineElement, byIndex: ReadonlyMap<number, EngineElement>): ElementIdentity {
  const parents: Array<Readonly<{ role: string; label: string }>> = [];
  const visited = new Set<number>([element.index]);
  let parentIndex = element.parentIndex;
  while (parentIndex !== undefined && parents.length < 12 && !visited.has(parentIndex)) {
    visited.add(parentIndex);
    const parent = byIndex.get(parentIndex);
    if (parent === undefined) break;
    parents.push(Object.freeze({
      role: normalized(publicRole(parent.role)),
      label: normalized(parent.label ?? ""),
    }));
    parentIndex = parent.parentIndex;
  }
  return Object.freeze({
    role: normalized(publicRole(element.role)),
    label: normalized(element.label ?? ""),
    parentChain: Object.freeze(parents),
  });
}

function projectedBounds(
  element: EngineElement,
  observation: EngineWindowObservation,
): Readonly<{ x: number; y: number; width: number; height: number }> | undefined {
  if (observation.visualStatus !== "available" || observation.image === undefined || element.frame === undefined) {
    return undefined;
  }
  const window = observation.target.bounds;
  const scaleX = observation.image.width / window.width;
  const scaleY = observation.image.height / window.height;
  const left = Math.max(0, Math.min(observation.image.width, (element.frame.x - window.x) * scaleX));
  const top = Math.max(0, Math.min(observation.image.height, (element.frame.y - window.y) * scaleY));
  const right = Math.max(left, Math.min(observation.image.width, (element.frame.x + element.frame.width - window.x) * scaleX));
  const bottom = Math.max(top, Math.min(observation.image.height, (element.frame.y + element.frame.height - window.y) * scaleY));
  if (![left, top, right, bottom].every(Number.isFinite)) return undefined;
  return Object.freeze({
    x: Math.round(left * 1_000) / 1_000,
    y: Math.round(top * 1_000) / 1_000,
    width: Math.round((right - left) * 1_000) / 1_000,
    height: Math.round((bottom - top) * 1_000) / 1_000,
  });
}

export function projectWindowElements(
  observation: EngineWindowObservation,
  maxElements: number,
  token: () => string = () => randomBytes(18).toString("base64url"),
): Readonly<{ elements: readonly ProjectedElement[]; truncated: boolean }> {
  const byIndex = new Map(observation.elements.map((element) => [element.index, element]));
  const projected = observation.elements.slice(0, maxElements).map((element): ProjectedElement => {
    const elementRef = `el_${token()}`;
    const actions = provenActions(element.role);
    const bounds = projectedBounds(element, observation);
    return Object.freeze({
      public: Object.freeze({
        element_ref: elementRef,
        role: publicRole(element.role),
        label: element.label ?? "",
        ...(element.value === undefined ? {} : { value: element.value }),
        ...(bounds === undefined ? {} : { bounds }),
        ...(element.enabled === undefined ? {} : { enabled: element.enabled }),
        ...(element.selected === undefined ? {} : { selected: element.selected }),
        ...(element.focused === undefined ? {} : { focused: element.focused }),
        actions,
      }),
      snapshot: Object.freeze({
        elementRef,
        token: element.token,
        identity: elementIdentityFor(element, byIndex),
        capabilities: actions,
        observed: Object.freeze({
          ...(element.value === undefined ? {} : { value: element.value }),
          ...(element.enabled === undefined ? {} : { enabled: element.enabled }),
          ...(element.selected === undefined ? {} : { selected: element.selected }),
        }),
      }),
    });
  });
  return Object.freeze({
    elements: Object.freeze(projected),
    truncated: !observation.elementsComplete || observation.elements.length > maxElements,
  });
}

export function publicApp(target: InternalAppTarget): PublicAppDiscovery {
  return Object.freeze({
    app_ref: target.appRef,
    display_name: target.displayName,
    running: target.running,
    capabilities: Object.freeze(target.capabilities.filter(
      (capability): capability is "launch" | "windows" => capability === "launch" || capability === "windows",
    )),
  });
}

export function publicWindow(target: InternalWindowTarget): PublicWindowDiscovery {
  const platform = target.native.platform;
  return Object.freeze({
    window_ref: target.windowRef,
    app_ref: target.appRef,
    app_name: target.appName,
    title: target.title,
    bounds: Object.freeze({ ...target.bounds, coordinate_space: "desktop_logical" as const }),
    ...(target.isOnScreen === undefined ? {} : { is_on_screen: target.isOnScreen }),
    ...(target.onCurrentSpace === undefined ? {} : { on_current_space: target.onCurrentSpace }),
    ...(target.minimized === undefined ? {} : { minimized: target.minimized }),
    capabilities: Object.freeze({
      elements: target.capabilities.includes("observe") ? "available" : "unavailable",
      window_screenshot: platform === "macos" ? "available" : platform === "windows" ? "unavailable" : "unknown",
      background_actions: platform === "macos" ? "available" : platform === "windows" ? "unavailable" : "unknown",
    }),
  });
}

export function toDesktopDiscoveryEnvelope(
  engine: EnginePort,
  snapshot: SnapshotRecord,
  value: EngineDesktopObservation,
  discovery: Readonly<{
    apps?: readonly PublicAppDiscovery[];
    appsTruncated?: boolean;
    windows?: readonly PublicWindowDiscovery[];
    windowsTruncated?: boolean;
  }>,
): ObservationEnvelope {
  const base = toObservationEnvelope(engine, snapshot, value);
  const structured = ObservationOutputSchema.parse({
    ...base.structured,
    ...(discovery.apps === undefined ? {} : { apps: discovery.apps, apps_truncated: discovery.appsTruncated ?? false }),
    ...(discovery.windows === undefined ? {} : { windows: discovery.windows, windows_truncated: discovery.windowsTruncated ?? false }),
  });
  return Object.freeze({ structured, image: base.image });
}

export function toWindowObservationEnvelope(
  engine: EnginePort,
  snapshot: SnapshotRecord,
  value: EngineWindowObservation,
  projected: Readonly<{ elements: readonly ProjectedElement[]; truncated: boolean }>,
): ObservationEnvelope {
  const target = value.target;
  const screenshot = value.visualStatus === "available" && value.image !== undefined
    ? { mime_type: "image/png" as const, width: value.image.width, height: value.image.height }
    : undefined;
  const structured = ObservationOutputSchema.parse({
    protocol_version: PROTOCOL_VERSION,
    session_id: engine.sessionId,
    snapshot_id: snapshot.id,
    platform: value.platform,
    target: {
      kind: "window",
      window_ref: target.windowRef,
      app_ref: target.appRef,
      app_name: target.appName,
      title: target.title,
    },
    coordinate_space: "window_screenshot_pixels",
    observation_mode: snapshot.observationMode,
    visual_status: value.visualStatus,
    ...(screenshot === undefined ? {} : { screenshot }),
    elements: projected.elements.map((element) => element.public),
    elements_truncated: projected.truncated,
    engine: { name: engine.name, version: engine.version },
  });
  const image: ImagePayload | undefined = value.visualStatus === "available" && value.image !== undefined
    ? { mimeType: "image/png", dataBase64: value.image.dataBase64 }
    : undefined;
  return Object.freeze({ structured, ...(image === undefined ? {} : { image }) });
}
