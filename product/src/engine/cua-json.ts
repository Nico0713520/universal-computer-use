import type { ToolResult } from "@trycua/cua-driver";
import { z } from "zod";

import { ComputerUseError } from "../errors.js";
import type { InternalAppTarget, InternalWindowTarget, NativeAppTarget, NativeWindowTarget } from "../target-registry.js";
import type {
  EngineDesktopObservation,
  EngineElement,
  EngineExecution,
  EngineWindowObservation,
} from "./port.js";

const PlatformSchema = z.enum(["macos", "windows"]);
const finite = z.number().finite();
const positive = finite.positive();
const nonnegativeInteger = z.number().int().nonnegative();
const positiveInteger = z.number().int().positive();
const BoundsSchema = z.object({
  x: finite,
  y: finite,
  width: positive,
  height: positive,
}).passthrough();
const WindowListBoundsSchema = z.object({
  x: finite,
  y: finite,
  width: finite.nonnegative(),
  height: finite.nonnegative(),
}).passthrough();

const DesktopStateSchema = z.object({
  platform: PlatformSchema,
  screenshot_width: positiveInteger,
  screenshot_height: positiveInteger,
  screen_width: positiveInteger,
  screen_height: positiveInteger,
  scale_factor: positive,
  screenshot_mime_type: z.literal("image/png"),
}).passthrough();

const AppSchema = z.object({
  pid: nonnegativeInteger.optional(),
  name: z.string().min(1),
  bundle_id: z.string().nullable().optional(),
  active: z.boolean().optional(),
  running: z.boolean(),
  launch_path: z.string().nullable().optional(),
  path: z.string().nullable().optional(),
  aumid: z.string().nullable().optional(),
}).passthrough();
const AppListSchema = z.object({ apps: z.array(AppSchema).max(5_000) }).passthrough();

const WindowSchema = z.object({
  window_id: positiveInteger,
  pid: positiveInteger,
  app_name: z.string(),
  title: z.string(),
  bounds: WindowListBoundsSchema,
  z_index: z.number().int().nullable().optional(),
  is_on_screen: z.boolean().optional(),
  on_current_space: z.boolean().nullable().optional(),
  minimized: z.boolean().optional(),
}).passthrough();
const WindowListSchema = z.object({ windows: z.array(WindowSchema).max(10_000) }).passthrough();

const ElementSchema = z.object({
  element_index: nonnegativeInteger,
  element_token: z.string().min(1),
  role: z.string().min(1),
  label: z.string().optional(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  frame: z.object({ x: finite, y: finite, w: finite.nonnegative(), h: finite.nonnegative() }).passthrough().optional(),
  parent_index: nonnegativeInteger.optional(),
  depth: nonnegativeInteger,
  enabled: z.boolean().optional(),
  selected: z.boolean().optional(),
  focused: z.boolean().optional(),
  in_web_content: z.boolean().optional(),
}).passthrough();
const WindowStateSchema = z.object({
  window_id: positiveInteger,
  pid: positiveInteger,
  snapshot_id: z.string().min(1).optional(),
  element_count: nonnegativeInteger,
  returned_element_count: nonnegativeInteger.optional(),
  elements_complete: z.boolean().optional(),
  elements: z.array(ElementSchema).max(2_000),
  degraded_reason: z.string().optional(),
  screenshot_width: positiveInteger.optional(),
  screenshot_height: positiveInteger.optional(),
  screenshot_mime_type: z.literal("image/png").optional(),
  screenshot_frame_valid: z.boolean().optional(),
  screenshot_error: z.object({ code: z.string() }).passthrough().optional(),
  window_bounds: BoundsSchema.optional(),
}).passthrough();

const HealthSchema = z.object({
  schema_version: z.literal("1"),
  platform: z.enum(["darwin", "win32"]),
  driver_version: z.string(),
  overall: z.enum(["ok", "degraded", "failed"]),
  checks: z.array(z.object({
    name: z.string(),
    status: z.enum(["pass", "fail", "skip"]),
    message: z.string(),
  }).passthrough()).max(100),
}).passthrough();

const LaunchSchema = z.object({
  pid: positiveInteger.optional(),
  bundle_id: z.string().nullable().optional(),
  name: z.string().optional(),
  windows: z.array(WindowSchema).max(100),
  launch_state: z.object({
    requested: z.boolean(),
    process_running: z.boolean(),
    window_ready: z.boolean(),
  }).passthrough(),
}).passthrough();

const DESKTOP_PERMISSION_ERRORS = new Set([
  "permission_required",
  "accessibility_permission_required",
  "screen_recording_permission_required",
]);
const NON_INTERACTIVE_DESKTOP_ERRORS = new Set(["desktop_locked", "session_0"]);

function contractError(message: string): ComputerUseError {
  return new ComputerUseError("engine_contract_changed", message, "doctor", false);
}

function structured(result: ToolResult, context: string): unknown {
  try {
    return JSON.parse(result.structuredJson ?? "");
  } catch {
    throw contractError(`Cua returned malformed ${context} JSON`);
  }
}

function parseWith<T>(schema: z.ZodType<T>, value: unknown, context: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw contractError(`Cua returned invalid ${context} data`);
  return parsed.data;
}

function onePng(result: ToolResult, context: string): Readonly<{ mimeType: "image/png"; dataBase64: string }> {
  const image = result.images.length === 1 ? result.images[0] : undefined;
  if (image === undefined || image.mimeType !== "image/png" || image.dataBase64.length === 0) {
    throw contractError(`Cua returned an invalid ${context} image set`);
  }
  return { mimeType: "image/png", dataBase64: image.dataBase64 };
}

export function parseDesktopObservation(result: ToolResult): EngineDesktopObservation {
  if (result.isError) {
    if (
      result.errorCode !== undefined &&
      DESKTOP_PERMISSION_ERRORS.has(result.errorCode)
    ) {
      throw new ComputerUseError(
        "permission_required",
        "CuaDriver requires desktop capture permissions",
        "grant_permission",
        false,
      );
    }
    if (
      result.errorCode !== undefined &&
      NON_INTERACTIVE_DESKTOP_ERRORS.has(result.errorCode)
    ) {
      throw new ComputerUseError(
        "interactive_session_required",
        "The desktop is locked or non-interactive",
        "stop",
        false,
      );
    }
    throw new ComputerUseError("capture_failed", "Cua failed to capture the desktop", "observe_again", true);
  }
  let value: unknown;
  try {
    value = JSON.parse(result.structuredJson ?? "");
  } catch {
    throw new ComputerUseError("capture_failed", "Cua returned malformed desktop metadata", "observe_again", true);
  }
  const parsed = DesktopStateSchema.safeParse(value);
  if (!parsed.success) {
    throw new ComputerUseError("capture_failed", "Cua returned invalid desktop metadata", "observe_again", true);
  }
  const image = result.images.length === 1 ? result.images[0] : undefined;
  if (image === undefined || image.mimeType !== "image/png" || image.dataBase64.length === 0) {
    throw new ComputerUseError("capture_failed", "Cua did not return exactly one screenshot image", "observe_again", true);
  }
  return {
    image: {
      mimeType: "image/png",
      dataBase64: image.dataBase64,
      width: parsed.data.screenshot_width,
      height: parsed.data.screenshot_height,
    },
    platform: parsed.data.platform,
    scaleFactor: parsed.data.scale_factor,
  };
}

export function parseAppList(
  result: ToolResult,
  platform: "macos" | "windows",
): readonly NativeAppTarget[] {
  if (result.isError) throw contractError("Cua list_apps failed");
  const parsed = parseWith(AppListSchema, structured(result, "app list"), "app list");
  return Object.freeze(parsed.apps.map((app): NativeAppTarget => {
    const bundleId = app.bundle_id || undefined;
    const launchPath = app.launch_path || undefined;
    const path = app.path || undefined;
    const aumid = app.aumid || undefined;
    const pid = app.pid ?? 0;
    const nativeKey = platform === "macos"
      ? bundleId ? `bundle:${bundleId}` : launchPath ? `path:${launchPath}` : pid > 0 ? `pid:${pid}` : `name:${app.name}`
      : launchPath ? `launch:${launchPath}` : path ? `path:${path}` : aumid ? `aumid:${aumid}` : `name:${app.name}`;
    return Object.freeze({
      nativeKey,
      displayName: app.name,
      running: app.running,
      ...(app.active === undefined ? {} : { active: app.active }),
      capabilities: Object.freeze(["launch", "windows"] as const),
      native: Object.freeze({
        platform,
        pid,
        ...(bundleId === undefined ? {} : { bundle_id: bundleId }),
        ...(launchPath === undefined ? {} : { launch_path: launchPath }),
        ...(path === undefined ? {} : { path }),
        ...(aumid === undefined ? {} : { aumid }),
        name: app.name,
      }),
    });
  }));
}

export function parseWindowList(
  result: ToolResult,
  apps: readonly NativeAppTarget[],
  platform: "macos" | "windows",
): readonly NativeWindowTarget[] {
  if (result.isError) throw contractError("Cua list_windows failed");
  const parsed = parseWith(WindowListSchema, structured(result, "window list"), "window list");
  const appsByPid = new Map<number, NativeAppTarget>();
  for (const app of apps) {
    const pid = app.native.pid;
    if (typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0) appsByPid.set(pid, app);
  }
  const highestZ = Math.max(
    Number.NEGATIVE_INFINITY,
    ...parsed.windows.flatMap((window) => window.z_index === null || window.z_index === undefined ? [] : [window.z_index]),
  );
  return Object.freeze(parsed.windows
    .filter((window) => window.bounds.width > 0 && window.bounds.height > 0)
    .map((window): NativeWindowTarget => {
    const ownerApp: NativeAppTarget = appsByPid.get(window.pid) ?? Object.freeze({
      nativeKey: `pid:${window.pid}`,
      displayName: window.app_name,
      running: true,
      capabilities: Object.freeze(["windows"] as const),
      native: Object.freeze({ platform, pid: window.pid, name: window.app_name }),
    });
    return Object.freeze({
      nativeKey: `window:${window.window_id}`,
      ownerKey: `pid:${window.pid}`,
      app: ownerApp,
      title: window.title,
      appName: window.app_name,
      bounds: Object.freeze({ ...window.bounds }),
      focused: ownerApp.active === true && window.z_index === highestZ,
      ...(window.z_index === null || window.z_index === undefined ? {} : { zIndex: window.z_index }),
      ...(window.minimized === undefined ? {} : { minimized: window.minimized }),
      ...(window.is_on_screen === undefined ? {} : { isOnScreen: window.is_on_screen }),
      ...(window.on_current_space === null || window.on_current_space === undefined
        ? {}
        : { onCurrentSpace: window.on_current_space }),
      capabilities: Object.freeze([
        "observe", "click", "double_click", "right_click", "scroll", "set_value", "type_text", "keypress", "invoke_menu",
      ] as const),
      native: Object.freeze({ platform, pid: window.pid, window_id: window.window_id }),
    });
    }));
}

function exactWindowIds(target: InternalWindowTarget): { pid: number; windowId: number } {
  const pid = target.native.pid;
  const windowId = target.native.window_id;
  if (!Number.isSafeInteger(pid) || (pid as number) <= 0 || !Number.isSafeInteger(windowId) || (windowId as number) <= 0) {
    throw contractError("Internal window target is missing safe native identifiers");
  }
  return { pid: pid as number, windowId: windowId as number };
}

function stateRefusal(result: ToolResult): never {
  const value = (() => {
    try { return JSON.parse(result.structuredJson ?? "") as Record<string, unknown>; } catch { return {}; }
  })();
  const code = value.code;
  if (code === "window_id_not_found" || code === "px_window_not_found") {
    throw new ComputerUseError("target_lost", "target_lost", "discover_again", true);
  }
  if (code === "window_owner_pid_mismatch") {
    throw new ComputerUseError("window_owner_changed", "window_owner_changed", "discover_again", true);
  }
  throw new ComputerUseError("capture_failed", "Cua get_window_state failed", "observe_again", true);
}

export function parseWindowState(
  result: ToolResult,
  target: InternalWindowTarget,
  includeScreenshot: boolean,
): EngineWindowObservation {
  if (result.isError) return stateRefusal(result);
  const parsed = parseWith(WindowStateSchema, structured(result, "window state"), "window state");
  const expected = exactWindowIds(target);
  if (parsed.pid !== expected.pid || parsed.window_id !== expected.windowId) {
    throw contractError("Cua window state changed owner or target identity");
  }
  const indices = new Set<number>();
  const tokens = new Set<string>();
  const elements: EngineElement[] = parsed.elements.map((element) => {
    if (indices.has(element.element_index) || tokens.has(element.element_token)) {
      throw contractError("Cua window state contains duplicate element identities");
    }
    indices.add(element.element_index);
    tokens.add(element.element_token);
    return Object.freeze({
      index: element.element_index,
      token: element.element_token,
      role: element.role,
      ...(element.label === undefined ? {} : { label: element.label }),
      ...(element.value === undefined ? {} : { value: String(element.value) }),
      ...(element.frame === undefined
        ? {}
        : { frame: Object.freeze({ x: element.frame.x, y: element.frame.y, width: element.frame.w, height: element.frame.h }) }),
      ...(element.parent_index === undefined ? {} : { parentIndex: element.parent_index }),
      depth: element.depth,
      ...(element.enabled === undefined ? {} : { enabled: element.enabled }),
      ...(element.selected === undefined ? {} : { selected: element.selected }),
      ...(element.focused === undefined ? {} : { focused: element.focused }),
      ...(element.in_web_content === undefined ? {} : { inWebContent: element.in_web_content }),
    });
  });
  for (const element of elements) {
    if (element.parentIndex !== undefined && (!indices.has(element.parentIndex) || element.parentIndex === element.index)) {
      throw contractError("Cua window state contains an invalid parent index");
    }
  }

  const base = {
    platform: (target.native.platform === "windows" ? "windows" : "macos") as "macos" | "windows",
    target,
    ...(parsed.snapshot_id === undefined ? {} : { upstreamSnapshotId: parsed.snapshot_id }),
    elements: Object.freeze(elements),
    elementsComplete: parsed.elements_complete === true,
    ...(parsed.degraded_reason === undefined ? {} : { degradedReason: parsed.degraded_reason }),
  };
  if (!includeScreenshot) {
    if (result.images.length !== 0) throw contractError("Cua returned an unexpected window screenshot");
    return Object.freeze({ ...base, visualStatus: "not_requested" });
  }
  if (parsed.screenshot_frame_valid === false) {
    if (result.images.length !== 0) throw contractError("Cua returned an unproven window screenshot");
    const code = parsed.screenshot_error?.code;
    if (code === "px_window_not_found") {
      throw new ComputerUseError("target_lost", "target_lost", "discover_again", true);
    }
    return Object.freeze({
      ...base,
      visualStatus: code === "px_capture_unavailable" ? "capture_unavailable" : "pixel_frame_unproven",
    });
  }
  if (
    parsed.screenshot_frame_valid !== true ||
    parsed.screenshot_width === undefined ||
    parsed.screenshot_height === undefined ||
    parsed.window_bounds === undefined
  ) {
    throw contractError("Cua omitted proven window screenshot metadata");
  }
  const scaleX = parsed.screenshot_width / parsed.window_bounds.width;
  const scaleY = parsed.screenshot_height / parsed.window_bounds.height;
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || Math.abs(scaleX - scaleY) > 0.03) {
    throw contractError("Cua returned incoherent window screenshot dimensions");
  }
  const image = onePng(result, "window screenshot");
  return Object.freeze({
    ...base,
    visualStatus: "available",
    image: Object.freeze({
      ...image,
      width: parsed.screenshot_width,
      height: parsed.screenshot_height,
    }),
  });
}

export function parseHealth(result: ToolResult, expectedVersion: string): boolean {
  if (result.isError) return false;
  const parsed = HealthSchema.safeParse(structured(result, "health report"));
  if (!parsed.success || parsed.data.driver_version !== expectedVersion) return false;
  const required = new Map(parsed.data.checks.map((check) => [check.name, check.status]));
  return parsed.data.overall !== "failed" &&
    ["binary_version", "platform_supported", "session_active"].every((name) => required.get(name) === "pass");
}

export function parseLaunchResult(
  result: ToolResult,
  target: InternalAppTarget,
): EngineExecution {
  if (result.isError) throw new ComputerUseError("action_failed", "Cua launch_app failed", "observe_again", false);
  const parsed = parseWith(LaunchSchema, structured(result, "launch result"), "launch result");
  const platform = target.native.platform;
  if (platform !== "macos" && platform !== "windows") throw contractError("Launch target has an unknown platform");
  if (parsed.launch_state.process_running && parsed.pid === undefined) {
    throw contractError("Cua launch result omitted the running process id");
  }
  if (parsed.launch_state.window_ready !== (parsed.windows.length > 0) ||
      (!parsed.launch_state.process_running && parsed.windows.length > 0)) {
    throw contractError("Cua launch result contains contradictory readiness proof");
  }
  const expectedBundleId = target.native.bundle_id;
  if (typeof expectedBundleId === "string" && parsed.bundle_id !== null && parsed.bundle_id !== undefined &&
      parsed.bundle_id !== expectedBundleId) {
    throw contractError("Cua launch result changed application identity");
  }
  const launchedApp: NativeAppTarget = Object.freeze({
    nativeKey: target.nativeKey,
    displayName: parsed.name ?? target.displayName,
    running: parsed.launch_state.process_running,
    capabilities: Object.freeze([...target.capabilities]),
    native: Object.freeze({
      ...target.native,
      ...(parsed.pid === undefined ? {} : { pid: parsed.pid }),
      ...(parsed.bundle_id === null || parsed.bundle_id === undefined ? {} : { bundle_id: parsed.bundle_id }),
    }),
  });
  const windows = parseWindowList({
    text: result.text,
    images: [],
    structuredJson: JSON.stringify({ windows: parsed.windows }),
    isError: false,
    degraded: result.degraded,
    rawJson: result.rawJson,
  }, [launchedApp], platform);
  const processRunning = parsed.launch_state.process_running;
  const windowReady = parsed.launch_state.window_ready && windows.length > 0;
  const ambiguous = windows.length > 1;
  return {
    status: "executed",
    effect: windowReady && !ambiguous ? "confirmed" : processRunning ? "partial" : "unverifiable",
    route: "system_api",
    delivery: "background",
    evidence: [
      ...(processRunning ? ["process_running"] : []),
      ...(windowReady && !ambiguous ? ["window_ready"] : []),
    ],
    ...(!processRunning
      ? {}
      : ambiguous
        ? { errorCode: "window_target_ambiguous", escalation: { reason: "window_target_ambiguous" as const } }
        : !windowReady
          ? { errorCode: "window_not_ready", escalation: { reason: "window_not_ready" as const } }
          : {}),
    launch: {
      requested: parsed.launch_state.requested,
      processRunning,
      windowReady,
      windows,
    },
  };
}
