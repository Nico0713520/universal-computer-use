import { describe, expect, it, vi } from "vitest";

import { runDoctor } from "../../src/cli/doctor.js";
import { loadEngineLock } from "../../src/engine/lock.js";
import { ComputerUseError } from "../../src/errors.js";
import { FakeEngine } from "../helpers/fake-engine.js";

const unknownMacPermissions = {
  accessibility: "unknown" as const,
  screen_recording: "unknown" as const,
  source: "unknown" as const,
};

describe("doctor", () => {
  it("reports every required field after exactly one side-effect-free observation", async () => {
    const lock = await loadEngineLock();
    const engine = new FakeEngine({ width: 2560, height: 1440, platform: "macos" });
    const execute = vi.spyOn(engine, "execute");

    const report = await runDoctor(
      { platform: "darwin", arch: "arm64" },
      {
        lock,
        connectEngine: vi.fn(async () => engine),
        probeInteractiveSession: vi.fn(async () => true),
        probeMacPermissions: vi.fn(async () => ({
          accessibility: "granted" as const,
          screen_recording: "granted" as const,
          source: "driver-daemon" as const,
        })),
      },
    );

    expect(report).toEqual({
      ok: true,
      product_version: "0.2.5",
      protocol_version: "1.2.0",
      platform: "macos",
      supported_platform: true,
      expected_engine_version: "0.22.2",
      reported_engine_version: "0.22.2",
      engine_connected: true,
      required_tools_present: true,
      desktop_unlocked: true,
      permissions: "granted",
      permission_details: {
        accessibility: "granted",
        screen_recording: "granted",
        source: "driver-daemon",
      },
      observation_succeeded: true,
      screenshot: { width: 2560, height: 1440 },
    });
    expect(engine.observations).toBe(1);
    expect(execute).not.toHaveBeenCalled();
    expect(engine.closes).toBe(1);
  });

  it("returns an exit-1 report when the Runtime cannot connect", async () => {
    const report = await runDoctor(
      { platform: "win32", arch: "x64" },
      {
        lock: await loadEngineLock(),
        connectEngine: vi.fn(async () => {
          throw new ComputerUseError(
            "runtime_unavailable",
            "daemon unavailable",
            "doctor",
            true,
          );
        }),
        probeInteractiveSession: vi.fn(async () => true),
        probeMacPermissions: vi.fn(async () => unknownMacPermissions),
      },
    );

    expect(report).toMatchObject({
      ok: false,
      platform: "windows",
      supported_platform: true,
      engine_connected: false,
      required_tools_present: false,
      desktop_unlocked: null,
      permissions: "unknown",
      observation_succeeded: false,
      screenshot: null,
      error: { code: "runtime_unavailable", retryable: true },
    });
    expect(report.reported_engine_version).toBeNull();
  });

  it("fails before observation when an injected Runtime version differs from the lock", async () => {
    const engine = new FakeEngine();
    Object.defineProperty(engine, "version", { value: "0.22.0" });

    const report = await runDoctor(
      { platform: "darwin", arch: "arm64" },
      {
        lock: await loadEngineLock(),
        connectEngine: vi.fn(async () => engine),
        probeInteractiveSession: vi.fn(async () => true),
        probeMacPermissions: vi.fn(async () => unknownMacPermissions),
      },
    );

    expect(report).toMatchObject({
      ok: false,
      reported_engine_version: "0.22.0",
      engine_connected: true,
      required_tools_present: false,
      observation_succeeded: false,
      error: { code: "engine_version_mismatch", recovery: "setup", retryable: false },
    });
    expect(engine.observations).toBe(0);
    expect(engine.closes).toBe(1);
  });

  it("truthfully classifies a locked desktop without sending an action", async () => {
    const engine = new FakeEngine({
      observationSequence: [
        new ComputerUseError(
          "interactive_session_required",
          "desktop locked",
          "stop",
          false,
        ),
      ],
    });
    const execute = vi.spyOn(engine, "execute");

    const report = await runDoctor(
      { platform: "darwin", arch: "x64" },
      {
        lock: await loadEngineLock(),
        connectEngine: vi.fn(async () => engine),
        probeInteractiveSession: vi.fn(async () => true),
        probeMacPermissions: vi.fn(async () => unknownMacPermissions),
      },
    );

    expect(report).toMatchObject({
      ok: false,
      engine_connected: true,
      required_tools_present: true,
      desktop_unlocked: false,
      observation_succeeded: false,
      error: { code: "interactive_session_required" },
    });
    expect(execute).not.toHaveBeenCalled();
    expect(engine.closes).toBe(1);
  });

  it("reports missing macOS permissions when the Runtime exposes that failure", async () => {
    const engine = new FakeEngine({
      observationSequence: [
        new ComputerUseError(
          "permission_required",
          "screen recording required",
          "grant_permission",
          false,
        ),
      ],
    });

    const report = await runDoctor(
      { platform: "darwin", arch: "arm64" },
      {
        lock: await loadEngineLock(),
        connectEngine: vi.fn(async () => engine),
        probeInteractiveSession: vi.fn(async () => true),
        probeMacPermissions: vi.fn(async () => ({
          accessibility: "unknown" as const,
          screen_recording: "unknown" as const,
          source: "unknown" as const,
        })),
      },
    );

    expect(report.permissions).toBe("required");
    expect(report.permission_details).toEqual({
      accessibility: "unknown",
      screen_recording: "unknown",
      source: "observation",
    });
    expect(report.ok).toBe(false);
  });

  it("stops before capture when the signed daemon reports one missing macOS grant", async () => {
    const engine = new FakeEngine({ platform: "macos" });

    const report = await runDoctor(
      { platform: "darwin", arch: "arm64" },
      {
        lock: await loadEngineLock(),
        connectEngine: vi.fn(async () => engine),
        probeInteractiveSession: vi.fn(async () => true),
        probeMacPermissions: vi.fn(async () => ({
          accessibility: "granted" as const,
          screen_recording: "required" as const,
          source: "driver-daemon" as const,
        })),
      },
    );

    expect(report).toMatchObject({
      ok: false,
      engine_connected: true,
      required_tools_present: true,
      desktop_unlocked: true,
      permissions: "required",
      permission_details: {
        accessibility: "granted",
        screen_recording: "required",
        source: "driver-daemon",
      },
      observation_succeeded: false,
      screenshot: null,
      error: {
        code: "permission_required",
        recovery: "grant_permission",
        retryable: false,
      },
    });
    expect(engine.observations).toBe(0);
    expect(engine.closes).toBe(1);
  });

  it("does not let a session cleanup failure replace the completed diagnosis", async () => {
    const engine = new FakeEngine({ platform: "macos" });
    vi.spyOn(engine, "close").mockRejectedValueOnce(new Error("cleanup failed"));

    const report = await runDoctor(
      { platform: "darwin", arch: "arm64" },
      {
        lock: await loadEngineLock(),
        connectEngine: vi.fn(async () => engine),
        probeInteractiveSession: vi.fn(async () => true),
        probeMacPermissions: vi.fn(async () => ({
          accessibility: "granted" as const,
          screen_recording: "granted" as const,
          source: "driver-daemon" as const,
        })),
      },
    );

    expect(report).toMatchObject({ ok: true, observation_succeeded: true });
    expect(engine.close).toHaveBeenCalledOnce();
  });

  it("continues to one observation when signed permission state cannot be confirmed", async () => {
    const engine = new FakeEngine({ platform: "macos" });

    const report = await runDoctor(
      { platform: "darwin", arch: "arm64" },
      {
        lock: await loadEngineLock(),
        connectEngine: vi.fn(async () => engine),
        probeInteractiveSession: vi.fn(async () => true),
        probeMacPermissions: vi.fn(async () => unknownMacPermissions),
      },
    );

    expect(report).toMatchObject({
      ok: true,
      permissions: "unknown",
      permission_details: unknownMacPermissions,
      observation_succeeded: true,
    });
    expect(engine.observations).toBe(1);
  });

  it("does not run macOS probes on a supported Windows host", async () => {
    const engine = new FakeEngine({ platform: "windows" });
    const probeInteractiveSession = vi.fn(async () => true);
    const probeMacPermissions = vi.fn(async () => unknownMacPermissions);

    const report = await runDoctor(
      { platform: "win32", arch: "x64" },
      {
        lock: await loadEngineLock(),
        connectEngine: vi.fn(async () => engine),
        probeInteractiveSession,
        probeMacPermissions,
      },
    );

    expect(report).toMatchObject({
      ok: true,
      platform: "windows",
      permissions: "unknown",
      permission_details: unknownMacPermissions,
    });
    expect(probeInteractiveSession).not.toHaveBeenCalled();
    expect(probeMacPermissions).not.toHaveBeenCalled();
  });

  it("rejects unsupported platforms without connecting", async () => {
    const connectEngine = vi.fn(async () => new FakeEngine());
    const report = await runDoctor(
      { platform: "linux", arch: "x64" },
      {
        lock: await loadEngineLock(),
        connectEngine,
        probeInteractiveSession: vi.fn(async () => true),
        probeMacPermissions: vi.fn(async () => unknownMacPermissions),
      },
    );

    expect(report).toMatchObject({
      ok: false,
      platform: null,
      supported_platform: false,
      error: { code: "unsupported_platform" },
    });
    expect(connectEngine).not.toHaveBeenCalled();
  });

  it("refuses loginwindow before capture", async () => {
    const engine = new FakeEngine({ platform: "macos" });

    const report = await runDoctor(
      { platform: "darwin", arch: "arm64" },
      {
        lock: await loadEngineLock(),
        connectEngine: async () => engine,
        probeInteractiveSession: async () => false,
        probeMacPermissions: vi.fn(async () => unknownMacPermissions),
      },
    );

    expect(report).toMatchObject({
      ok: false,
      engine_connected: true,
      required_tools_present: true,
      desktop_unlocked: false,
      observation_succeeded: false,
      screenshot: null,
      error: { code: "interactive_session_required" },
    });
    expect(engine.observations).toBe(0);
  });

  it("fails closed before capture when the interactive session is unavailable", async () => {
    const engine = new FakeEngine({ platform: "macos" });

    const report = await runDoctor(
      { platform: "darwin", arch: "arm64" },
      {
        lock: await loadEngineLock(),
        connectEngine: async () => engine,
        probeInteractiveSession: async () => null,
        probeMacPermissions: vi.fn(async () => unknownMacPermissions),
      },
    );

    expect(report).toMatchObject({
      ok: false,
      engine_connected: true,
      required_tools_present: true,
      desktop_unlocked: null,
      observation_succeeded: false,
      screenshot: null,
      error: { code: "runtime_unavailable" },
    });
    expect(engine.observations).toBe(0);
  });
});
