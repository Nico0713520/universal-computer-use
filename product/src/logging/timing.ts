export type RuntimeTimingPhase =
  | "engineExecuteMs"
  | "postActionObserveMs"
  | "projectionMs";

export type RuntimeTimingSnapshot = Readonly<{
  queueWaitMs: number;
  engineExecuteMs?: number;
  postActionObserveMs?: number;
  projectionMs?: number;
  toolTotalMs: number;
}>;

export class RuntimeTiming {
  readonly #startedAt: number;
  readonly #now: () => number;
  readonly #durations = new Map<RuntimeTimingPhase, number>();
  #queueWaitMs = 0;
  #finished?: RuntimeTimingSnapshot;

  constructor(now: () => number = () => performance.now()) {
    this.#now = now;
    this.#startedAt = now();
  }

  markDequeued(): void {
    this.#queueWaitMs = this.#elapsed(this.#startedAt);
  }

  async measure<T>(
    phase: RuntimeTimingPhase,
    operation: () => Promise<T>,
  ): Promise<T> {
    const startedAt = this.#now();
    try {
      return await operation();
    } finally {
      this.#add(phase, this.#elapsed(startedAt));
    }
  }

  measureSync<T>(phase: RuntimeTimingPhase, operation: () => T): T {
    const startedAt = this.#now();
    try {
      return operation();
    } finally {
      this.#add(phase, this.#elapsed(startedAt));
    }
  }

  finish(): RuntimeTimingSnapshot {
    if (this.#finished !== undefined) return this.#finished;
    const phases = Object.fromEntries(
      [...this.#durations].map(([name, duration]) => [name, Math.ceil(duration)]),
    );
    this.#finished = Object.freeze({
      queueWaitMs: Math.ceil(this.#queueWaitMs),
      ...phases,
      toolTotalMs: Math.ceil(this.#elapsed(this.#startedAt)),
    }) as RuntimeTimingSnapshot;
    return this.#finished;
  }

  #elapsed(startedAt: number): number {
    return Math.max(0, this.#now() - startedAt);
  }

  #add(phase: RuntimeTimingPhase, elapsedMs: number): void {
    this.#durations.set(phase, (this.#durations.get(phase) ?? 0) + elapsedMs);
  }
}
