import { describe, expect, it, vi } from "vitest";

import { probeMacPermissions } from "../../src/cli/macos-permissions.js";
import { loadEngineLock } from "../../src/engine/lock.js";
import type { ProcessRunner } from "../../src/cli/process-runner.js";

function withTrustedSignature(permissionRun: ProcessRunner["run"]): ProcessRunner {
  return {
    async run(command, args, options) {
      if (command === "/usr/bin/codesign" && args.includes("-dv")) {
        return { code: 0, stdout: "", stderr: "Identifier=com.trycua.driver" };
      }
      if (command === "/usr/bin/codesign" || command === "/usr/sbin/spctl") {
        return { code: 0, stdout: "", stderr: "" };
      }
      return permissionRun(command, args, options);
    },
  };
}

describe("macOS permission diagnostics", () => {
  it("verifies the locked local app before accepting daemon-attributed permission JSON", async () => {
    const events: string[] = [];
    const runner: ProcessRunner = {
      async run(command, args) {
        events.push(`${command} ${args.join(" ")}`);
        if (command === "/usr/bin/codesign" && args.includes("-dv")) {
          return { code: 0, stdout: "", stderr: "Identifier=com.trycua.driver" };
        }
        if (command.endsWith("/cua-driver")) {
          return {
            code: 0,
            stdout: JSON.stringify({
              accessibility: true,
              screen_recording: true,
              source: {
                attribution: "driver-daemon",
                bundle_id: "com.trycua.driver",
              },
            }),
            stderr: "",
          };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    };

    await expect(probeMacPermissions(await loadEngineLock(), runner)).resolves.toEqual({
      accessibility: "granted",
      screen_recording: "granted",
      source: "driver-daemon",
    });
    expect(events).toEqual([
      "/usr/bin/codesign --verify --deep --strict /Applications/CuaDriver.app",
      "/usr/sbin/spctl --assess --type execute /Applications/CuaDriver.app",
      "/usr/bin/codesign -dv --verbose=4 /Applications/CuaDriver.app",
      "/Applications/CuaDriver.app/Contents/MacOS/cua-driver permissions status --json",
    ]);
  });

  it("preserves a typed signature failure and never asks the untrusted executable for permissions", async () => {
    const run = vi.fn<ProcessRunner["run"]>(async () => ({
      code: 1,
      stdout: "",
      stderr: "rejected",
    }));

    await expect(
      probeMacPermissions(await loadEngineLock(), { run }),
    ).rejects.toMatchObject({
      code: "engine_version_mismatch",
      diagnosticReason: "runtime_signature_mismatch",
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalledWith(
      "/Applications/CuaDriver.app/Contents/MacOS/cua-driver",
      ["permissions", "status", "--json"],
      expect.anything(),
    );
  });

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
      probeMacPermissions(await loadEngineLock(), withTrustedSignature(run)),
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
    const runner = withTrustedSignature(
      async () => {
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
    );

    const result = await probeMacPermissions(await loadEngineLock(), runner);
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
    const runner = withTrustedSignature(async () => response);

    await expect(probeMacPermissions(await loadEngineLock(), runner)).resolves.toEqual({
      accessibility: "unknown",
      screen_recording: "unknown",
      source: "unknown",
    });
  });

  it("keeps permission state unknown when the command cannot run", async () => {
    const runner = withTrustedSignature(
      async () => {
        throw new Error("spawn failed with a private executable path");
      },
    );

    await expect(probeMacPermissions(await loadEngineLock(), runner)).resolves.toEqual({
      accessibility: "unknown",
      screen_recording: "unknown",
      source: "unknown",
    });
  });
});
