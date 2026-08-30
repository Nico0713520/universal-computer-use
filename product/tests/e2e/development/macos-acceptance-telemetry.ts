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
const MAX_JSONL_LINE_LENGTH = 64 * 1024;
const READY_LINE = "computer-use-mcp: ready on stdio";

export class AcceptanceTelemetryCollector {
  readonly #events: CollectedEvent[] = [];
  #pending = "";

  ingest(chunk: string): void {
    this.#pending += chunk;
    const lines = this.#pending.split(/\r?\n/u);
    this.#pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length > MAX_JSONL_LINE_LENGTH) this.#events.push({ kind: "invalid" });
      else this.#ingestLine(line);
    }
    if (this.#pending.length > MAX_JSONL_LINE_LENGTH) {
      this.#pending = "";
      this.#events.push({ kind: "invalid" });
    }
  }

  cursor(): number {
    return this.#events.length;
  }

  consumeOne(
    cursor: number,
    expectedTool: CollectedRecord["tool"],
  ): AcceptanceTelemetryStages | undefined {
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > this.#events.length) {
      return undefined;
    }
    const candidates = this.#events.slice(cursor);
    const candidate = candidates[0];
    if (
      candidates.length !== 1 ||
      candidate?.kind !== "timing" ||
      candidate.tool !== expectedTool
    ) return undefined;
    return { ...candidate.stages };
  }

  clear(): void {
    this.#pending = "";
    this.#events.length = 0;
  }

  #ingestLine(line: string): void {
    if (line === "" || line === READY_LINE) return;
    let value: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        this.#events.push({ kind: "invalid" });
        return;
      }
      value = parsed as Record<string, unknown>;
    } catch {
      this.#events.push({ kind: "invalid" });
      return;
    }
    if (value.tool_name !== "computer_observe" && value.tool_name !== "computer_act") {
      this.#events.push({ kind: "invalid" });
      return;
    }
    if (typeof value.timings !== "object" || value.timings === null || Array.isArray(value.timings)) {
      this.#events.push({ kind: "invalid" });
      return;
    }
    const input = value.timings as Record<string, unknown>;
    if (Object.keys(input).some((field) => !TIMING_INPUT_FIELDS.has(field))) {
      this.#events.push({ kind: "invalid" });
      return;
    }
    const stages: Partial<Record<AcceptanceTelemetryStageName, number>> = {};
    for (const [source, target] of TIMING_FIELDS) {
      const timing = input[source];
      if (timing === undefined) continue;
      if (typeof timing !== "number" || !Number.isFinite(timing) || timing < 0) {
        this.#events.push({ kind: "invalid" });
        return;
      }
      stages[target] = timing;
    }
    if (Object.keys(stages).length === 0) {
      this.#events.push({ kind: "invalid" });
      return;
    }
    this.#events.push({ kind: "timing", tool: value.tool_name, stages: Object.freeze(stages) });
  }
}
