import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

import { classifyToolCallFailure } from "../e2e/development/performance-classification.js";

function schemaFailure(): unknown {
  try {
    CallToolResultSchema.parse({ content: "not-an-array" });
  } catch (error) {
    return error;
  }
  throw new Error("schema_failure_fixture_invalid");
}

describe("performance tool-call classification", () => {
  it("separates malformed public envelopes from transport failures", () => {
    expect(classifyToolCallFailure({ kind: "thrown", error: schemaFailure() }))
      .toBe("contract_mismatch");
    expect(classifyToolCallFailure({ kind: "thrown", error: new Error("socket closed") }))
      .toBe("tool_error");
  });

  it("prioritizes target loss over a generic tool error", () => {
    expect(classifyToolCallFailure({
      kind: "result",
      resultIsError: true,
      errorCodes: ["target_lost"],
    })).toBe("target_lost");
    expect(classifyToolCallFailure({
      kind: "result",
      resultIsError: true,
      errorCodes: ["window_not_found"],
    })).toBe("target_lost");
  });

  it("returns no failure for a valid non-error envelope", () => {
    expect(classifyToolCallFailure({
      kind: "result",
      resultIsError: false,
      errorCodes: [],
    })).toBeUndefined();
  });
});
