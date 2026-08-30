import { describe, expect, it, vi } from "vitest";

import { runIndependentCorrectnessChecks } from
  "../e2e/development/correctness-orchestration.js";

describe("runIndependentCorrectnessChecks", () => {
  it.each([
    "semanticSequence",
    "uniqueText",
    "overlayOnce",
    "focusPreserved",
  ] as const)("does not erase healthy proofs when %s throws", async (failedName) => {
    const makeCheck = (name: string) => vi.fn(async () => {
      if (name === failedName) throw new Error(`${name}_failed`);
      return true;
    });
    const semanticSequence = makeCheck("semanticSequence");
    const uniqueText = makeCheck("uniqueText");
    const overlayOnce = makeCheck("overlayOnce");
    const focusPreserved = makeCheck("focusPreserved");
    const checks = { semanticSequence, uniqueText, overlayOnce, focusPreserved };

    const result = await runIndependentCorrectnessChecks(checks);
    expect(result[failedName]).toBe(false);
    expect(Object.entries(result).filter(([name]) => name !== failedName)
      .every(([, value]) => value)).toBe(true);
    expect([semanticSequence, uniqueText, overlayOnce, focusPreserved]
      .every((check) => check.mock.calls.length === 1)).toBe(true);
  });

  it("records false without skipping later independent proofs", async () => {
    const later = vi.fn(async () => true);
    await expect(runIndependentCorrectnessChecks({
      semanticSequence: async () => false,
      uniqueText: later,
      overlayOnce: later,
      focusPreserved: later,
    })).resolves.toEqual({
      semanticSequence: false,
      uniqueText: true,
      overlayOnce: true,
      focusPreserved: true,
    });
    expect(later).toHaveBeenCalledTimes(3);
  });
});
