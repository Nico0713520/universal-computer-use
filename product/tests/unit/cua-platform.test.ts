import { describe, expect, it } from "vitest";

import { assertPreciseWindowSupport } from "../../src/engine/cua.js";

describe("locked Cua precise-window platform support", () => {
  it("allows macOS and rejects the Windows 0.22.2 stubs explicitly", () => {
    expect(() => assertPreciseWindowSupport("macos")).not.toThrow();
    expect(() => assertPreciseWindowSupport("windows")).toThrowError(
      expect.objectContaining({
        code: "unsupported_platform",
        recovery: "stop",
        retryable: false,
      }),
    );
  });
});
