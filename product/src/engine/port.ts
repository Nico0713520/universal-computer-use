import type { ComputerAction } from "../protocol.js";

export type EngineImage = Readonly<{
  mimeType: "image/png";
  dataBase64: string;
  width: number;
  height: number;
}>;

export type EngineObservation = Readonly<{
  image: EngineImage;
  platform: "macos" | "windows";
  scaleFactor: number;
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
}>;

export interface EnginePort {
  readonly name: "cua-driver";
  readonly version: string;
  readonly sessionId: string;
  observe(signal: AbortSignal): Promise<EngineObservation>;
  execute(action: ComputerAction, signal: AbortSignal): Promise<EngineExecution>;
  close(): Promise<void>;
}
