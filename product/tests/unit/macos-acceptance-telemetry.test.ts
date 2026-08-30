import { describe, expect, it } from "vitest";

import { AcceptanceTelemetryCollector } from "../e2e/development/macos-acceptance-telemetry.js";

function record(
  tool: "computer_observe" | "computer_act",
  timings: Record<string, unknown>,
): string {
  return `${JSON.stringify({
    timestamp: "2026-08-30T00:00:00.000Z",
    tool_name: tool,
    timings,
  })}\n`;
}

describe("macOS acceptance telemetry collector", () => {
  it("reassembles split JSONL and projects only allowlisted timing fields", () => {
    const collector = new AcceptanceTelemetryCollector();
    const cursor = collector.cursor();
    collector.ingest("computer-use-mcp: ready on stdio\n{\"tool_name\":\"computer_ob");
    collector.ingest("serve\",\"timings\":{\"queue_wait_ms\":1,\"post_action_observe_ms\":8,\"projection_ms\":2,\"tool_total_ms\":11}}\n");

    expect(collector.consumeOne(cursor, "computer_observe")).toEqual({
      queue_wait: 1,
      post_action_observe: 8,
      projection: 2,
      tool_total: 11,
    });
  });

  it.each([
    ["malformed JSON", "not-json\n", "computer_observe"],
    ["wrong tool", record("computer_act", { tool_total_ms: 10 }), "computer_observe"],
    ["negative timing", record("computer_observe", { tool_total_ms: -1 }), "computer_observe"],
    ["unknown timing", record("computer_observe", { tool_total_ms: 10, secret_ms: 1 }), "computer_observe"],
  ] as const)("returns undefined for %s", (_name, input, expectedTool) => {
    const collector = new AcceptanceTelemetryCollector();
    const cursor = collector.cursor();
    collector.ingest(input);
    expect(collector.consumeOne(cursor, expectedTool)).toBeUndefined();
  });

  it("returns undefined when no record or more than one record follows the cursor", () => {
    const collector = new AcceptanceTelemetryCollector();
    expect(collector.consumeOne(collector.cursor(), "computer_observe")).toBeUndefined();

    const cursor = collector.cursor();
    collector.ingest(record("computer_observe", { tool_total_ms: 10 }));
    collector.ingest(record("computer_observe", { tool_total_ms: 11 }));
    expect(collector.consumeOne(cursor, "computer_observe")).toBeUndefined();
  });

  it("taints a sample when an invalid record precedes a valid timing record", () => {
    const collector = new AcceptanceTelemetryCollector();
    const cursor = collector.cursor();
    collector.ingest("not-json\n");
    collector.ingest(record("computer_observe", { tool_total_ms: 1 }));

    expect(collector.consumeOne(cursor, "computer_observe")).toBeUndefined();
  });

  it("bounds an unterminated line and clears retained collector state", () => {
    const collector = new AcceptanceTelemetryCollector();
    const cursor = collector.cursor();
    collector.ingest("x".repeat(70 * 1024));
    collector.ingest(record("computer_observe", { tool_total_ms: 1 }));
    expect(collector.consumeOne(cursor, "computer_observe")).toBeUndefined();

    collector.clear();
    expect(collector.cursor()).toBe(0);
    expect(collector.consumeOne(0, "computer_observe")).toBeUndefined();
  });

  it("does not expose raw log data through the projected record", () => {
    const collector = new AcceptanceTelemetryCollector();
    const cursor = collector.cursor();
    collector.ingest(`${JSON.stringify({
      timestamp: "2026-08-30T00:00:00.000Z",
      tool_name: "computer_act",
      snapshot_id: "private",
      prompt: "private",
      timings: { engine_execute_ms: 4, tool_total_ms: 9 },
    })}\n`);

    const projected = collector.consumeOne(cursor, "computer_act");
    expect(projected).toEqual({ engine_execute: 4, tool_total: 9 });
    expect(JSON.stringify(projected)).not.toMatch(/private|snapshot|prompt|timestamp/);
  });

  it("waits for a late cross-stream record without a fixed sleep", async () => {
    const collector = new AcceptanceTelemetryCollector();
    const cursor = collector.cursor();
    const waiting = collector.waitForOne(cursor, "computer_observe", 100);
    setImmediate(() => collector.ingest(record("computer_observe", { tool_total_ms: 4 })));

    await expect(waiting).resolves.toEqual({ tool_total: 4 });
  });

  it("poisons correlation after a missing record until the collector is cleared", async () => {
    const collector = new AcceptanceTelemetryCollector();
    await expect(collector.waitForOne(collector.cursor(), "computer_observe", 1))
      .resolves.toBeUndefined();

    const poisonedCursor = collector.cursor();
    collector.ingest(record("computer_observe", { tool_total_ms: 4 }));
    await expect(collector.waitForOne(poisonedCursor, "computer_observe", 10))
      .resolves.toBeUndefined();

    collector.clear();
    const recoveredCursor = collector.cursor();
    collector.ingest(record("computer_observe", { tool_total_ms: 5 }));
    await expect(collector.waitForOne(recoveredCursor, "computer_observe", 10))
      .resolves.toEqual({ tool_total: 5 });
  });
});
