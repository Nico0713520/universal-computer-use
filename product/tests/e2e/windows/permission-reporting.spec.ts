import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { type ToolResult } from "@trycua/cua-driver";

import { mapCuaResult } from "../../../src/engine/result-mapper.js";

function denied(errorCode: string, rawJson: string): ToolResult {
  return {
    text: "controlled Windows refusal fixture",
    images: [],
    structuredJson: undefined,
    isError: true,
    degraded: false,
    errorCode,
    rawJson,
  };
}

describe("truthful Windows permission reporting", () => {
  it.each([
    ["background_uipi_blocked", "refused", "action_refused"],
    ["permission_denied", "refused", "action_refused"],
    ["controlled_unknown_denial", "failed", "action_failed"],
  ] as const)(
    "maps controlled Cua diagnostic %s without reporting an executed action",
    (diagnostic, status, stableCode) => {
      const source = denied(diagnostic, JSON.stringify({ diagnostic }));
      const mapped = mapCuaResult(source);

      expect(mapped).toMatchObject({ status, errorCode: stableCode });
      expect(mapped.status).not.toBe("executed");
      expect(JSON.stringify(mapped)).not.toContain("target_privilege_mismatch");
      expect(JSON.stringify(mapped)).not.toContain(diagnostic);
    },
  );

  it("documents privilege mismatch detection and UAC secure desktop as unsupported", async () => {
    const documentation = await readFile(new URL("./README.md", import.meta.url), "utf8");
    expect(documentation).toContain("does not detect `target_privilege_mismatch`");
    expect(documentation).toContain("support the UAC secure desktop");
  });
});
