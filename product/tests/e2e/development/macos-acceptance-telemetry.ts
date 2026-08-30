export type AcceptanceTelemetryStageName =
  | "queue_wait"
  | "engine_execute"
  | "post_action_observe"
  | "projection"
  | "tool_total";

export type AcceptanceTelemetryStages = Readonly<
  Partial<Record<AcceptanceTelemetryStageName, number>>
>;

type CollectedRecord = Readonly<{
  kind: "timing";
  tool: "computer_observe" | "computer_act";
  stages: AcceptanceTelemetryStages;
}>;

type CollectedEvent = CollectedRecord | Readonly<{ kind: "invalid" }>;

const TIMING_FIELDS = [
  ["queue_wait_ms", "queue_wait"],
  ["engine_execute_ms", "engine_execute"],
  ["post_action_observe_ms", "post_action_observe"],
  ["projection_ms", "projection"],
  ["tool_total_ms", "tool_total"],
] as const;

const TIMING_INPUT_FIELDS = new Set<string>(TIMING_FIELDS.map(([source]) => source));
const REQUIRED_STAGES: Readonly<Record<CollectedRecord["tool"], readonly AcceptanceTelemetryStageName[]>> = {
  computer_observe: ["queue_wait", "post_action_observe", "projection", "tool_total"],
  computer_act: ["queue_wait", "engine_execute", "post_action_observe", "projection", "tool_total"],
};
const MAX_JSONL_LINE_LENGTH = 64 * 1024;
const READY_LINE = "computer-use-mcp: ready on stdio";

export class AcceptanceTelemetryCollector {
  readonly #events: CollectedEvent[] = [];
  readonly #listeners = new Set<() => void>();
  #pending = "";
  #poisoned = false;
  #consumedCursor = 0;

  ingest(chunk: string): void {
    this.#pending += chunk;
    const lines = this.#pending.split(/\r?\n/u);
    this.#pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length > MAX_JSONL_LINE_LENGTH) this.#append({ kind: "invalid" });
      else this.#ingestLine(line);
    }
    if (this.#pending.length > MAX_JSONL_LINE_LENGTH) {
      this.#pending = "";
      this.#append({ kind: "invalid" });
    }
  }

  cursor(): number {
    if (this.#events.length !== this.#consumedCursor) this.#poisoned = true;
    return this.#events.length;
  }

  consumeOne(
    cursor: number,
    expectedTool: CollectedRecord["tool"],
  ): AcceptanceTelemetryStages | undefined {
    if (
      this.#poisoned ||
      !Number.isSafeInteger(cursor) ||
      cursor < 0 ||
      cursor !== this.#consumedCursor ||
      cursor > this.#events.length
    ) {
      return undefined;
    }
    const candidates = this.#events.slice(cursor);
    const candidate = candidates[0];
    if (
      candidates.length !== 1 ||
      candidate?.kind !== "timing" ||
      candidate.tool !== expectedTool ||
      REQUIRED_STAGES[expectedTool].some((stage) => candidate.stages[stage] === undefined)
    ) {
      if (candidates.length > 0) this.#poisoned = true;
      return undefined;
    }
    this.#consumedCursor = this.#events.length;
    return { ...candidate.stages };
  }

  async waitForOne(
    cursor: number,
    expectedTool: CollectedRecord["tool"],
    timeoutMs = 250,
  ): Promise<AcceptanceTelemetryStages | undefined> {
    if (
      this.#poisoned ||
      !Number.isSafeInteger(cursor) ||
      cursor < 0 ||
      !Number.isFinite(timeoutMs) ||
      timeoutMs < 0
    ) return undefined;

    if (this.#events.length <= cursor) {
      const observed = await new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (value: boolean): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          this.#listeners.delete(onEvent);
          resolve(value);
        };
        const onEvent = (): void => finish(true);
        const timeout = setTimeout(() => finish(false), timeoutMs);
        this.#listeners.add(onEvent);
        if (this.#events.length > cursor) onEvent();
      });
      if (!observed) {
        this.#poisoned = true;
        return undefined;
      }
    }

    await new Promise<void>((resolve) => setImmediate(resolve));
    return this.consumeOne(cursor, expectedTool);
  }

  clear(): void {
    this.#pending = "";
    this.#events.length = 0;
    this.#poisoned = false;
    this.#consumedCursor = 0;
    for (const listener of this.#listeners) listener();
    this.#listeners.clear();
  }

  #append(event: CollectedEvent): void {
    this.#events.push(event);
    for (const listener of [...this.#listeners]) listener();
  }

  #ingestLine(line: string): void {
    if (line === "" || line === READY_LINE) return;
    let value: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        this.#append({ kind: "invalid" });
        return;
      }
      value = parsed as Record<string, unknown>;
    } catch {
      this.#append({ kind: "invalid" });
      return;
    }
    if (value.tool_name !== "computer_observe" && value.tool_name !== "computer_act") {
      this.#append({ kind: "invalid" });
      return;
    }
    if (typeof value.timings !== "object" || value.timings === null || Array.isArray(value.timings)) {
      this.#append({ kind: "invalid" });
      return;
    }
    const input = value.timings as Record<string, unknown>;
    if (Object.keys(input).some((field) => !TIMING_INPUT_FIELDS.has(field))) {
      this.#append({ kind: "invalid" });
      return;
    }
    const stages: Partial<Record<AcceptanceTelemetryStageName, number>> = {};
    for (const [source, target] of TIMING_FIELDS) {
      const timing = input[source];
      if (timing === undefined) continue;
      if (typeof timing !== "number" || !Number.isFinite(timing) || timing < 0) {
        this.#append({ kind: "invalid" });
        return;
      }
      stages[target] = timing;
    }
    if (Object.keys(stages).length === 0) {
      this.#append({ kind: "invalid" });
      return;
    }
    this.#append({ kind: "timing", tool: value.tool_name, stages: Object.freeze(stages) });
  }
}
