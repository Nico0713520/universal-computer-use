import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createRuntimeConnector,
  verifyMacRuntimeSignature,
} from "../../src/engine/runtime-startup.js";
import { loadEngineLock } from "../../src/engine/lock.js";
import { ComputerUseError } from "../../src/errors.js";

function runtimeUnavailable(): ComputerUseError {
  return new ComputerUseError(
    "runtime_unavailable",
    "fixture daemon is stopped",
    "doctor",
    true,
  );
}

function successfulRunner() {
  return {
    run: vi.fn(async (command: string, args: readonly string[]) => ({
      code: 0,
      stdout:
        command === "/usr/bin/codesign" && args.includes("-dv")
          ? "Identifier=com.trycua.driver"
          : "",
      stderr: "",
    })),
  };
}

describe("macOS Runtime startup", () => {
  it("connects once without startup when the installed Runtime is already ready", async () => {
    const engine = { id: "ready" };
    const connect = vi.fn(async () => engine);
    const access = vi.fn(async () => undefined);
    const runner = {
      async run() {
        return { code: 0, stdout: "", stderr: "" };
      },
    };
    const run = vi.spyOn(runner, "run");
    const wait = vi.fn(async () => undefined);
    const connector = createRuntimeConnector({
      platform: "darwin",
      connect,
      access,
      runner,
      wait,
      now: () => 0,
    });

    await expect(connector(await loadEngineLock())).resolves.toBe(engine);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(access).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(wait).not.toHaveBeenCalled();
  });

  it("starts a verified macOS Runtime only after runtime_unavailable", async () => {
    const engine = { id: "started" };
    const connect = vi.fn()
      .mockRejectedValueOnce(runtimeUnavailable())
      .mockResolvedValueOnce(engine);
    const access = vi.fn(async () => undefined);
    const runner = successfulRunner();
    const wait = vi.fn(async () => undefined);
    const connector = createRuntimeConnector({
      platform: "darwin",
      connect,
      access,
      runner,
      wait,
      now: () => 0,
    });

    await expect(connector(await loadEngineLock())).resolves.toBe(engine);
    expect(access).toHaveBeenCalledWith("/Applications/CuaDriver.app");
    expect(runner.run).toHaveBeenCalledWith(
      "/usr/bin/open",
      ["-g", "/Applications/CuaDriver.app", "--args", "serve"],
      { timeoutMs: 30_000 },
    );
    expect(connect).toHaveBeenCalledTimes(2);
    expect(wait).not.toHaveBeenCalled();
  });

  it("maps a missing installed app to runtime_missing", async () => {
    const connector = createRuntimeConnector({
      platform: "darwin",
      connect: vi.fn(async () => { throw runtimeUnavailable(); }),
      access: vi.fn(async () => { throw new Error("ENOENT"); }),
      runner: successfulRunner(),
      wait: vi.fn(async () => undefined),
      now: () => 0,
    });

    await expect(connector(await loadEngineLock())).rejects.toMatchObject({
      code: "runtime_missing",
      recovery: "setup",
      retryable: false,
      diagnosticReason: "runtime_missing",
    });
  });

  it("exits readiness polling on the first successful connection", async () => {
    const engine = { id: "ready-after-one-poll" };
    const connect = vi.fn()
      .mockRejectedValueOnce(runtimeUnavailable())
      .mockRejectedValueOnce(runtimeUnavailable())
      .mockResolvedValueOnce(engine);
    let currentTime = 0;
    const wait = vi.fn(async (ms: number) => { currentTime += ms; });
    const connector = createRuntimeConnector({
      platform: "darwin",
      connect,
      access: vi.fn(async () => undefined),
      runner: successfulRunner(),
      wait,
      now: () => currentTime,
    });

    await expect(connector(await loadEngineLock())).resolves.toBe(engine);
    expect(connect).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(50);
  });

  it("checks the complete locked Apple signing identity before startup", async () => {
    const lock = structuredClone(await loadEngineLock());
    const requirement = "designated => fixture";
    const signer = lock.platforms.macos.signer;
    if (signer.kind !== "apple") throw new Error("fixture requires Apple signer");
    signer.team_id = "TEAM123456";
    signer.bundle_id = "com.trycua.driver";
    signer.designated_requirement_sha256 = createHash("sha256")
      .update(requirement)
      .digest("hex");
    const runner = {
      run: vi.fn(async (command: string, args: readonly string[]) => {
        if (command === "/usr/bin/codesign" && args.includes("-dv")) {
          return {
            code: 0,
            stdout: "Identifier=com.trycua.driver\nTeamIdentifier=TEAM123456",
            stderr: "",
          };
        }
        if (command === "/usr/bin/codesign" && args.includes("-dr")) {
          return { code: 0, stdout: requirement, stderr: "" };
        }
        return { code: 0, stdout: "", stderr: "" };
      }),
    };

    await expect(
      verifyMacRuntimeSignature(lock, runner, "/Applications/CuaDriver.app"),
    ).resolves.toBeUndefined();
    expect(runner.run).toHaveBeenCalledWith(
      "/usr/bin/codesign",
      ["-dv", "--verbose=4", "/Applications/CuaDriver.app"],
      { timeoutMs: 30_000 },
    );
    expect(runner.run).toHaveBeenCalledWith(
      "/usr/bin/codesign",
      ["-dr", "-", "/Applications/CuaDriver.app"],
      { timeoutMs: 30_000 },
    );
  });

  it("never starts for a non-runtime connection error", async () => {
    const error = new ComputerUseError(
      "engine_version_mismatch",
      "fixture mismatch",
      "setup",
      false,
    );
    const runner = successfulRunner();
    const connector = createRuntimeConnector({
      platform: "darwin",
      connect: vi.fn(async () => { throw error; }),
      access: vi.fn(async () => undefined),
      runner,
      wait: vi.fn(async () => undefined),
      now: () => 0,
    });

    await expect(connector(await loadEngineLock())).rejects.toBe(error);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("never invokes macOS startup on Windows", async () => {
    const runner = successfulRunner();
    const connector = createRuntimeConnector({
      platform: "win32",
      connect: vi.fn(async () => { throw runtimeUnavailable(); }),
      access: vi.fn(async () => undefined),
      runner,
      wait: vi.fn(async () => undefined),
      now: () => 0,
    });

    await expect(connector(await loadEngineLock())).rejects.toMatchObject({
      code: "runtime_unavailable",
    });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("stops readiness polling at the ten-second deadline", async () => {
    let currentTime = 0;
    const wait = vi.fn(async (ms: number) => { currentTime += ms; });
    const connector = createRuntimeConnector({
      platform: "darwin",
      connect: vi.fn(async () => { throw runtimeUnavailable(); }),
      access: vi.fn(async () => undefined),
      runner: successfulRunner(),
      wait,
      now: () => currentTime,
    });

    await expect(connector(await loadEngineLock())).rejects.toMatchObject({
      code: "runtime_unavailable",
      recovery: "doctor",
      retryable: true,
      diagnosticReason: "runtime_startup_failed",
    });
    expect(wait.mock.calls.reduce((sum, [ms]) => sum + ms, 0)).toBe(10_000);
    expect(wait.mock.calls.every(([ms]) => ms <= 1_000)).toBe(true);
  });

  it("shares one startup attempt across concurrent callers", async () => {
    const engine = { id: "single-flight" };
    const connect = vi.fn()
      .mockRejectedValueOnce(runtimeUnavailable())
      .mockResolvedValueOnce(engine);
    const runner = successfulRunner();
    const connector = createRuntimeConnector({
      platform: "darwin",
      connect,
      access: vi.fn(async () => undefined),
      runner,
      wait: vi.fn(async () => undefined),
      now: () => 0,
    });
    const lock = await loadEngineLock();

    await expect(Promise.all([connector(lock), connector(lock)])).resolves.toEqual([
      engine,
      engine,
    ]);
    expect(
      runner.run.mock.calls.filter(([command]) => command === "/usr/bin/open"),
    ).toHaveLength(1);
  });

  it("maps an open failure to runtime_unavailable without polling", async () => {
    const runner = successfulRunner();
    runner.run.mockImplementation(async (command: string, args: readonly string[]) => ({
      code: command === "/usr/bin/open" ? 1 : 0,
      stdout:
        command === "/usr/bin/codesign" && args.includes("-dv")
          ? "Identifier=com.trycua.driver"
          : "",
      stderr: "fixture open failed",
    }));
    const wait = vi.fn(async () => undefined);
    const connector = createRuntimeConnector({
      platform: "darwin",
      connect: vi.fn(async () => { throw runtimeUnavailable(); }),
      access: vi.fn(async () => undefined),
      runner,
      wait,
      now: () => 0,
    });

    await expect(connector(await loadEngineLock())).rejects.toMatchObject({
      code: "runtime_unavailable",
      recovery: "doctor",
      diagnosticReason: "runtime_startup_failed",
    });
    expect(wait).not.toHaveBeenCalled();
  });

  it("marks a failed signature inspection with a typed signer reason", async () => {
    const runner = successfulRunner();
    runner.run.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "opaque" });

    await expect(
      verifyMacRuntimeSignature(
        await loadEngineLock(),
        runner,
        "/Applications/CuaDriver.app",
      ),
    ).rejects.toMatchObject({
      code: "engine_version_mismatch",
      diagnosticReason: "runtime_signature_mismatch",
    });
  });
});
