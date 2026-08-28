import type { ComputerAction } from "../protocol.js";
import type {
  InternalAppTarget,
  InternalWindowTarget,
  NativeAppTarget,
  NativeWindowTarget,
  TargetBounds,
} from "../target-registry.js";

export type EngineImage = Readonly<{
  mimeType: "image/png";
  dataBase64: string;
  width: number;
  height: number;
}>;

export type EngineDesktopObservation = Readonly<{
  image: EngineImage;
  platform: "macos" | "windows";
  scaleFactor: number;
}>;

export type EngineElement = Readonly<{
  index: number;
  token: string;
  role: string;
  label?: string;
  value?: string;
  frame?: TargetBounds;
  parentIndex?: number;
  depth: number;
  enabled?: boolean;
  selected?: boolean;
  focused?: boolean;
  inWebContent?: boolean;
}>;

export type EngineWindowObservation = Readonly<{
  platform: "macos" | "windows";
  target: InternalWindowTarget;
  visualStatus: "available" | "not_requested" | "capture_unavailable" | "pixel_frame_unproven";
  image?: EngineImage;
  upstreamSnapshotId?: string;
  elements: readonly EngineElement[];
  elementsComplete: boolean;
  degradedReason?: string;
}>;

export type EngineObservation = EngineDesktopObservation | EngineWindowObservation;

export type EngineDiscoverInput = Readonly<{
  apps: boolean;
  windows: boolean;
}>;
export type EngineDiscovery = Readonly<{
  apps: readonly NativeAppTarget[];
  windows: readonly NativeWindowTarget[];
}>;

export type EngineElementAddress = Readonly<{ kind: "element"; token: string }>;
export type EngineCoordinateAddress = Readonly<{ kind: "coordinate"; x: number; y: number }>;
export type EngineWindowAddress = EngineElementAddress | EngineCoordinateAddress;
export type EngineWindowAction =
  | Readonly<{ type: "click" | "double_click" | "right_click"; address: EngineWindowAddress }>
  | Readonly<{ type: "drag"; fromX: number; fromY: number; toX: number; toY: number; durationMs?: number }>
  | Readonly<{
      type: "scroll";
      address: EngineWindowAddress;
      direction: "up" | "down" | "left" | "right";
      amount: number;
      by?: "line" | "page";
    }>
  | Readonly<{ type: "set_value"; address: EngineElementAddress; value: string }>
  | Readonly<{ type: "type_text"; address?: EngineWindowAddress; text: string }>
  | Readonly<{ type: "keypress"; address?: EngineWindowAddress; keys: readonly string[] }>
  | Readonly<{ type: "invoke_menu"; path: readonly string[] }>
  | Readonly<{ type: "wait"; ms: number }>;

export type EngineAction =
  | Readonly<{ target: Readonly<{ kind: "desktop" }>; action: ComputerAction }>
  | Readonly<{
      target: Readonly<{ kind: "window"; pid: number; windowId: number }>;
      action: EngineWindowAction;
      delivery?: "background" | "foreground";
    }>
  | Readonly<{
      target: Readonly<{ kind: "app"; app: InternalAppTarget }>;
      action: Readonly<{ type: "launch_app" }>;
    }>;

export type EngineObserveInput =
  | Readonly<{ target: Readonly<{ kind: "desktop" }> }>
  | Readonly<{
      target: Readonly<{ kind: "window"; window: InternalWindowTarget }>;
      includeScreenshot: boolean;
      query?: string;
      maxElements: number;
      maxDepth: number;
    }>;

export type EngineExecution = Readonly<{
  status: "executed" | "refused" | "failed";
  effect: "confirmed" | "partial" | "unverifiable" | "suspected_noop" | "refused";
  route:
    | "accessibility"
    | "synthetic_events"
    | "global_input"
    | "system_api"
    | "dom"
    | "trusted_input"
    | "unknown";
  delivery: "background" | "foreground" | "not_applicable" | "unknown";
  errorCode?: string;
  evidence?: readonly string[];
  deliveredCount?: number;
  escalation?: Readonly<{
    reason: "background_unavailable" | "foreground_required" | "effect_unconfirmed" | "window_not_ready" | "window_target_ambiguous";
    suggestedDelivery?: "foreground";
  }>;
  launch?: Readonly<{
    requested: boolean;
    processRunning: boolean;
    windowReady: boolean;
    windows: readonly NativeWindowTarget[];
  }>;
}>;

export interface EnginePort {
  readonly name: "cua-driver";
  readonly version: string;
  readonly sessionId: string;
  discover(input: EngineDiscoverInput, signal: AbortSignal): Promise<EngineDiscovery>;
  observe(signal: AbortSignal): Promise<EngineDesktopObservation>;
  observe(input: EngineObserveInput, signal: AbortSignal): Promise<EngineObservation>;
  execute(action: EngineAction, signal: AbortSignal): Promise<EngineExecution>;
  health(signal: AbortSignal): Promise<boolean>;
  close(): Promise<void>;
}
