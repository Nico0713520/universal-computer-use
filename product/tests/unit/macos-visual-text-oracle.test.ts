import { describe, expect, it } from "vitest";

import { recognizedTextContainsExactValue } from
  "../e2e/development/macos-visual-text-oracle.js";

describe("macOS visual text oracle", () => {
  it("accepts an exact Calculator value with display separators", () => {
    expect(recognizedTextContainsExactValue(["Calculator", "7 0 3", "AC"], "703")).toBe(true);
    expect(recognizedTextContainsExactValue(["Calculator", "703.0"], "703")).toBe(false);
    expect(recognizedTextContainsExactValue(["1703"], "703")).toBe(false);
  });
});
