import { describe, expect, it, vi } from "vitest";

import { runDoctor } from "../../src/cli/doctor.js";
import { loadEngineLock } from "../../src/engine/lock.js";
import { ComputerUseError } from "../../src/errors.js";
import { FakeEngine } from "../helpers/fake-engine.js";

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
      },
    );

    expect(report).toEqual({
      ok: true,
      product_version: "0.2.2",
      protocol_version: "1.2.0",
      platform: "macos",
      supported_platform: true,
      expected_engine_version: "0.22.2",
      reported_engine_version: "0.22.2",
      engine_connected: true,
      required_tools_present: true,
      desktop_unlocked: true,
      permissions: "unknown",
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
      },
    );

    expect(report.permissions).toBe("required");
    expect(report.ok).toBe(false);
  });

  it("rejects unsupported platforms without connecting", async () => {
    const connectEngine = vi.fn(async () => new FakeEngine());
    const report = await runDoctor(
      { platform: "linux", arch: "x64" },
      {
        lock: await loadEngineLock(),
        connectEngine,
        probeInteractiveSession: vi.fn(async () => true),
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
