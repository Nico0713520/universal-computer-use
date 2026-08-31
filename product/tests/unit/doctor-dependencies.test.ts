import { describe, expect, it, vi } from "vitest";

import { createDoctorDependencyAdapter } from "../../src/cli/doctor-dependencies.js";
import { loadEngineLock } from "../../src/engine/lock.js";
import { FakeEngine } from "../helpers/fake-engine.js";

describe("doctor production dependency adapter", () => {
  it("wires the independent connector and signed Cua permission probe for every caller", async () => {
    const lock = await loadEngineLock();
    const runs: Array<{ command: string; args: readonly string[] }> = [];
    const engine = new FakeEngine({ platform: "macos" });
    const connectEngine = vi.fn(async () => engine);
    const adapter = createDoctorDependencyAdapter({
      connectEngine,
      runner: {
        async run(command, args) {
          runs.push({ command, args });
          if (command === "/usr/bin/osascript") {
            return {
              code: 0,
              stdout: JSON.stringify({ bundleIdentifier: "com.apple.Finder" }),
              stderr: "",
            };
          }
          if (command === "/usr/bin/codesign" && args.includes("-dv")) {
            return {
              code: 0,
              stdout: "",
              stderr: "Identifier=com.trycua.driver",
            };
          }
          if (command === "/usr/bin/codesign" || command === "/usr/sbin/spctl") {
            return { code: 0, stdout: "", stderr: "" };
          }
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
        },
      },
    });

    const setupDoctor = adapter(lock);
    const directDoctor = adapter(lock);
    await setupDoctor.connectEngine(lock);
    await directDoctor.connectEngine(lock);
    expect(await setupDoctor.probeInteractiveSession()).toBe(true);
    expect(await directDoctor.probeMacPermissions()).toEqual({
      accessibility: "granted",
      screen_recording: "granted",
      source: "driver-daemon",
    });

    expect(connectEngine).toHaveBeenCalledTimes(2);
    expect(runs).toEqual([
      expect.objectContaining({ command: "/usr/bin/osascript" }),
      {
        command: "/usr/bin/codesign",
        args: ["--verify", "--deep", "--strict", "/Applications/CuaDriver.app"],
      },
      {
        command: "/usr/sbin/spctl",
        args: ["--assess", "--type", "execute", "/Applications/CuaDriver.app"],
      },
      {
        command: "/usr/bin/codesign",
        args: ["-dv", "--verbose=4", "/Applications/CuaDriver.app"],
      },
      {
        command: "/Applications/CuaDriver.app/Contents/MacOS/cua-driver",
        args: ["permissions", "status", "--json"],
      },
    ]);
  });
});
