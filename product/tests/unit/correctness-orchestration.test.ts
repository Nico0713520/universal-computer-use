import { describe, expect, it, vi } from "vitest";

import { runIndependentCorrectnessChecks } from
  "../e2e/development/correctness-orchestration.js";

describe("runIndependentCorrectnessChecks", () => {
  it("does not erase healthy proofs when one independent proof throws", async () => {
    const checks = {
      semanticSequence: vi.fn(async () => true),
      uniqueText: vi.fn(async () => { throw new Error("native_text_failed"); }),
      overlayOnce: vi.fn(async () => true),
      focusPreserved: vi.fn(async () => true),
    };

    await expect(runIndependentCorrectnessChecks(checks)).resolves.toEqual({
      semanticSequence: true,
      uniqueText: false,
      overlayOnce: true,
      focusPreserved: true,
    });
    expect(Object.values(checks).every((check) => check.mock.calls.length === 1)).toBe(true);
  });
});
