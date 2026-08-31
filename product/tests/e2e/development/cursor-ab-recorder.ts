import { nearestRank } from "./performance-recorder.js";

export type CursorAbMode = "enabled" | "disabled";

export type CursorAbSample = Readonly<{
  durationMs: number;
  correct: boolean;
  route: "synthetic_events";
}>;

export type CursorAbMetadata = Readonly<{
  product_version: string;
  engine_version: string;
  macos_version: string;
  architecture: "arm64" | "x86_64";
}>;

export type CursorAbInvariants = Readonly<{
  same_driver_process: boolean;
  same_session: boolean;
  same_target: boolean;
}>;

type CursorAbAggregate = Readonly<{
  sample_count: 30;
  correct_count: 30;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
  route_counts: Readonly<{ synthetic_events: 30 }>;
}>;

export type CursorAbEvidence = Readonly<{
  schema_version: 1;
  evidence_type: "computer-use-macos-cursor-ab";
  status: "passed";
  metadata: CursorAbMetadata;
  cursor_readback: Readonly<{ enabled: true; disabled: true }>;
  invariants: Readonly<{
    same_driver_process: true;
    same_session: true;
    same_target: true;
  }>;
  modes: Readonly<Record<CursorAbMode, CursorAbAggregate>>;
  delta_ms: Readonly<{ p50: number; p95: number; max: number }>;
  cleanup_passed: true;
  timestamp: string;
}>;

const MODES: readonly CursorAbMode[] = ["enabled", "disabled"];

function incomplete(): never {
  throw new Error("cursor_ab_evidence_incomplete");
}

function validateSample(sample: CursorAbSample): void {
  if (
    !Number.isFinite(sample.durationMs) ||
    sample.durationMs < 0 ||
    typeof sample.correct !== "boolean" ||
    sample.route !== "synthetic_events"
  ) incomplete();
}

function aggregate(samples: readonly CursorAbSample[]): CursorAbAggregate {
  if (samples.length !== 30 || samples.some((sample) => !sample.correct)) incomplete();
  const durations = samples.map((sample) => sample.durationMs);
  return {
    sample_count: 30,
    correct_count: 30,
    p50_ms: nearestRank(durations, 0.5),
    p95_ms: nearestRank(durations, 0.95),
    max_ms: Math.max(...durations),
    route_counts: { synthetic_events: 30 },
  };
}

export class CursorAbRecorder {
  readonly #readback = new Map<CursorAbMode, boolean>();
  readonly #warmups = new Map<CursorAbMode, number>();
  readonly #measured = new Map<CursorAbMode, CursorAbSample[]>();

  recordReadback(mode: CursorAbMode, enabled: boolean): void {
    if (this.#readback.has(mode) || (this.#warmups.get(mode) ?? 0) > 0 ||
        (this.#measured.get(mode)?.length ?? 0) > 0 || enabled !== (mode === "enabled")) {
      incomplete();
    }
    this.#readback.set(mode, enabled);
  }

  recordWarmup(mode: CursorAbMode, sample: CursorAbSample): void {
    validateSample(sample);
    if (!this.#readback.has(mode)) incomplete();
    const count = this.#warmups.get(mode) ?? 0;
    if (count >= 5 || (this.#measured.get(mode)?.length ?? 0) > 0) incomplete();
    this.#warmups.set(mode, count + 1);
  }

  recordMeasured(mode: CursorAbMode, sample: CursorAbSample): void {
    validateSample(sample);
    if (this.#readback.has(mode) === false || this.#warmups.get(mode) !== 5) incomplete();
    const samples = this.#measured.get(mode) ?? [];
    if (samples.length >= 30) incomplete();
    samples.push({ ...sample });
    this.#measured.set(mode, samples);
  }

  evidence(
    metadata: CursorAbMetadata,
    invariants: CursorAbInvariants,
    cleanupPassed: boolean,
    timestamp = new Date().toISOString(),
  ): CursorAbEvidence {
    if (
      !cleanupPassed ||
      !invariants.same_driver_process ||
      !invariants.same_session ||
      !invariants.same_target ||
      this.#readback.get("enabled") !== true ||
      this.#readback.get("disabled") !== false
    ) incomplete();
    const modes = Object.fromEntries(MODES.map((mode) => [
      mode,
      aggregate(this.#measured.get(mode) ?? []),
    ])) as Record<CursorAbMode, CursorAbAggregate>;
    return {
      schema_version: 1,
      evidence_type: "computer-use-macos-cursor-ab",
      status: "passed",
      metadata: {
        product_version: metadata.product_version,
        engine_version: metadata.engine_version,
        macos_version: metadata.macos_version,
        architecture: metadata.architecture,
      },
      cursor_readback: { enabled: true, disabled: true },
      invariants: {
        same_driver_process: true,
        same_session: true,
        same_target: true,
      },
      modes,
      delta_ms: {
        p50: modes.disabled.p50_ms - modes.enabled.p50_ms,
        p95: modes.disabled.p95_ms - modes.enabled.p95_ms,
        max: modes.disabled.max_ms - modes.enabled.max_ms,
      },
      cleanup_passed: true,
      timestamp,
    };
  }
}
