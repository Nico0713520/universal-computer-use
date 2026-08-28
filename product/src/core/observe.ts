import { ComputerUseError } from "../errors.js";
import type { EngineDesktopObservation, EnginePort } from "../engine/port.js";
import type { ObservationEnvelope } from "../protocol.js";
import type { SnapshotRecord } from "../snapshot-store.js";
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
