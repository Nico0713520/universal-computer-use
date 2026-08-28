import type { ComputerAction } from "../protocol.js";
import type {
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
}>;

export interface EnginePort {
  readonly name: "cua-driver";
  readonly version: string;
  readonly sessionId: string;
  discover(input: EngineDiscoverInput, signal: AbortSignal): Promise<EngineDiscovery>;
  observe(signal: AbortSignal): Promise<EngineDesktopObservation>;
  observe(input: EngineObserveInput, signal: AbortSignal): Promise<EngineObservation>;
  execute(action: ComputerAction, signal: AbortSignal): Promise<EngineExecution>;
  health(signal: AbortSignal): Promise<boolean>;
  close(): Promise<void>;
}
