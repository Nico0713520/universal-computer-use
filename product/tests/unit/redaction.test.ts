import { describe, expect, it } from "vitest";

import {
  createMetadataLogger,
  type MetadataLogEvent,
} from "../../src/logging/logger.js";
import { redactMetadataEvent } from "../../src/logging/redaction.js";

const FIXED_TIMESTAMP = "2026-08-27T04:05:06.789Z";

const TYPE_SECRET = "typed-secret-8c36c8d8";
const KEY_SECRET = "key-secret-47a89074";
const SCREENSHOT_SECRET = "iVBORw0KGgo-screen-secret-8a68ca19";
const CLIPBOARD_SECRET = "clipboard-secret-eb0af72c";
const ENV_SECRET = "env-secret-fad00fa1";
const PROMPT_SECRET = "model-prompt-secret-e6f4de22";
const NESTED_SECRET = "nested-secret-acde8dad";

function poisonedEvent(): MetadataLogEvent {
  return {
    sessionId: "session-sensitive-value",
    snapshotId: "snapshot-sensitive-value",
    toolName: "computer_act",
    actionType: "type",
    durationMs: 37,
    effect: "confirmed",
    route: "accessibility",
    delivery: "foreground",
    errorCode: "action_failed",
    text: TYPE_SECRET,
    keys: [KEY_SECRET],
    screenshot: { dataBase64: SCREENSHOT_SECRET },
    clipboard: CLIPBOARD_SECRET,
    env: { TOKEN: ENV_SECRET },
    model: { prompt: PROMPT_SECRET },
    nested: {
      text: NESTED_SECRET,
      sessionId: NESTED_SECRET,
      deeper: {
        keys: [KEY_SECRET],
        screenshot: SCREENSHOT_SECRET,
        clipboard: CLIPBOARD_SECRET,
        env: ENV_SECRET,
        prompt: PROMPT_SECRET,
      },
    },
  } as unknown as MetadataLogEvent;
}

describe("metadata log redaction", () => {
  it("emits only the frozen metadata allowlist and recursively drops secrets", () => {
    const lines: string[] = [];
    const logger = createMetadataLogger({
      write: (line) => lines.push(line),
      now: () => new Date(FIXED_TIMESTAMP),
    });

    logger.log(poisonedEvent());

    expect(lines).toHaveLength(1);
    expect(lines[0]?.endsWith("\n")).toBe(true);
    const record = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(record).toEqual({
      timestamp: FIXED_TIMESTAMP,
      session_id_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      snapshot_id_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      tool_name: "computer_act",
      action_type: "type",
      duration_ms: 37,
      effect: "confirmed",
      route: "accessibility",
      delivery: "foreground",
      error_code: "action_failed",
    });

    for (const secret of [
      "session-sensitive-value",
      "snapshot-sensitive-value",
      TYPE_SECRET,
      KEY_SECRET,
      SCREENSHOT_SECRET,
      CLIPBOARD_SECRET,
      ENV_SECRET,
      PROMPT_SECRET,
      NESTED_SECRET,
    ]) {
      expect(lines[0]).not.toContain(secret);
    }
    expect(Object.keys(record)).toEqual([
      "timestamp",
      "session_id_hash",
      "snapshot_id_hash",
      "tool_name",
      "action_type",
      "duration_ms",
      "effect",
      "route",
      "delivery",
      "error_code",
    ]);
  });

  it("drops invalid values even when they use allowlisted field names", () => {
    const record = redactMetadataEvent(
      {
        toolName: PROMPT_SECRET,
        actionType: TYPE_SECRET,
        durationMs: Number.NaN,
        effect: NESTED_SECRET,
        route: ENV_SECRET,
        delivery: CLIPBOARD_SECRET,
        errorCode: SCREENSHOT_SECRET,
      } as unknown as MetadataLogEvent,
      new Date(FIXED_TIMESTAMP),
    );

    expect(record).toEqual({ timestamp: FIXED_TIMESTAMP });
    expect(JSON.stringify(record)).not.toContain("secret");
  });

  it("keeps pseudonyms stable in one process without exposing raw identifiers", () => {
    const first = redactMetadataEvent(
      { sessionId: "session-one", snapshotId: "snapshot-one" },
      new Date(FIXED_TIMESTAMP),
    );
    const second = redactMetadataEvent(
      { sessionId: "session-one", snapshotId: "snapshot-one" },
      new Date(FIXED_TIMESTAMP),
    );

    expect(second.session_id_hash).toBe(first.session_id_hash);
    expect(second.snapshot_id_hash).toBe(first.snapshot_id_hash);
    expect(JSON.stringify(first)).not.toContain("session-one");
    expect(JSON.stringify(first)).not.toContain("snapshot-one");
  });

  it("emits nothing at level off and defaults to metadata", () => {
    const offLines: string[] = [];
    const metadataLines: string[] = [];

    const off = createMetadataLogger({
      level: "off",
      write: (line) => offLines.push(line),
    });
    const metadata = createMetadataLogger({
      write: (line) => metadataLines.push(line),
      now: () => new Date(FIXED_TIMESTAMP),
    });

    off.log({ toolName: "computer_observe" });
    metadata.log({ toolName: "computer_observe" });

    expect(off.level).toBe("off");
    expect(offLines).toEqual([]);
    expect(metadata.level).toBe("metadata");
    expect(metadataLines).toEqual([
      `${JSON.stringify({ timestamp: FIXED_TIMESTAMP, tool_name: "computer_observe" })}\n`,
    ]);
  });
});
