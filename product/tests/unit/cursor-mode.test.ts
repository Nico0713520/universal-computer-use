import { describe, expect, it } from "vitest";

import {
  parseCursorMode,
  resolveCursorMode,
} from "../../src/engine/cursor-mode.js";

describe("Cursor mode", () => {
  it.each(["auto", "visible", "hidden"] as const)(
    "accepts %s as an explicit mode",
    (mode) => {
      expect(parseCursorMode(mode)).toBe(mode);
    },
  );

  it("defaults to auto when neither argv nor environment selects a mode", () => {
    expect(resolveCursorMode([], {})).toBe("auto");
  });

  it("uses UCU_CURSOR_MODE when the command line omits a mode", () => {
    expect(resolveCursorMode([], { UCU_CURSOR_MODE: "hidden" })).toBe("hidden");
  });

  it("lets the command line override the environment", () => {
    expect(resolveCursorMode(
      ["--cursor", "visible"],
      { UCU_CURSOR_MODE: "not-a-mode" },
    )).toBe("visible");
  });

  it.each([
    ["invalid value", ["--cursor", "fast"]],
    ["missing value", ["--cursor"]],
    ["duplicate option", ["--cursor", "auto", "--cursor", "hidden"]],
    ["unknown option", ["--other", "auto"]],
  ] as const)("rejects %s", (_label, argv) => {
    expect(() => resolveCursorMode(argv, {})).toThrow("cursor mode");
  });

  it("rejects an invalid environment value", () => {
    expect(() => resolveCursorMode([], { UCU_CURSOR_MODE: "fast" }))
      .toThrow("cursor mode");
  });
});
