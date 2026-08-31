import { describe, expect, it, vi } from "vitest";

import { probeMacPermissions } from "../../src/cli/macos-permissions.js";
import type { ProcessRunner } from "../../src/cli/process-runner.js";

describe("macOS permission diagnostics", () => {
  it("reads both grants from the signed CuaDriver daemon identity", async () => {
    const run = vi.fn<ProcessRunner["run"]>(async () => ({
      code: 0,
      stdout: JSON.stringify({
        accessibility: true,
        screen_recording: true,
        source: {
          attribution: "driver-daemon",
          bundle_id: "com.trycua.driver",
          pid: 1234,
          executable: "/private/sensitive/cua-driver",
          note: "must not escape",
        },
      }),
      stderr: "",
    }));

    await expect(
      probeMacPermissions({ run }),
    ).resolves.toEqual({
      accessibility: "granted",
      screen_recording: "granted",
      source: "driver-daemon",
    });
    expect(run).toHaveBeenCalledWith(
      "/Applications/CuaDriver.app/Contents/MacOS/cua-driver",
      ["permissions", "status", "--json"],
      { timeoutMs: 10_000 },
    );
  });

  it("reports each denied grant without exposing daemon metadata", async () => {
    const runner: ProcessRunner = {
      async run() {
        return {
          code: 0,
          stdout: JSON.stringify({
            accessibility: false,
            screen_recording: true,
            source: {
              attribution: "driver-daemon",
              bundle_id: "com.trycua.driver",
              pid: 1234,
              path: "/private/sensitive/cua-driver",
            },
          }),
          stderr: "",
        };
      },
    };

    const result = await probeMacPermissions(runner);
    expect(result).toEqual({
      accessibility: "required",
      screen_recording: "granted",
      source: "driver-daemon",
    });
    expect(JSON.stringify(result)).not.toMatch(/1234|private|path|pid/u);
  });

  it.each([
    ["malformed JSON", { code: 0, stdout: "not-json", stderr: "" }],
    ["non-zero command", { code: 1, stdout: "", stderr: "denied" }],
    [
      "untrusted attribution",
      {
        code: 0,
        stdout: JSON.stringify({
          accessibility: true,
          screen_recording: true,
          source: { attribution: "calling-process", bundle_id: "com.trycua.driver" },
        }),
        stderr: "",
      },
    ],
    [
      "unexpected bundle",
      {
        code: 0,
        stdout: JSON.stringify({
          accessibility: true,
          screen_recording: true,
          source: { attribution: "driver-daemon", bundle_id: "com.example.fake" },
        }),
        stderr: "",
      },
    ],
  ])("keeps permission state unknown for %s", async (_label, response) => {
    const runner: ProcessRunner = { async run() { return response; } };

    await expect(probeMacPermissions(runner)).resolves.toEqual({
      accessibility: "unknown",
      screen_recording: "unknown",
      source: "unknown",
    });
  });

  it("keeps permission state unknown when the command cannot run", async () => {
    const runner: ProcessRunner = {
      async run() {
        throw new Error("spawn failed with a private executable path");
      },
    };

    await expect(probeMacPermissions(runner)).resolves.toEqual({
      accessibility: "unknown",
      screen_recording: "unknown",
      source: "unknown",
    });
  });
});
