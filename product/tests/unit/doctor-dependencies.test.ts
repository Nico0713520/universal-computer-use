import { describe, expect, it, vi } from "vitest";

import { createDoctorDependencyAdapter } from "../../src/cli/doctor-dependencies.js";
import { runDoctor } from "../../src/cli/doctor.js";
import { loadEngineLock } from "../../src/engine/lock.js";
import { FakeEngine } from "../helpers/fake-engine.js";

describe("doctor production dependency adapter", () => {
  it("orders the production macOS trust probes before the first Runtime connection", async () => {
    const lock = await loadEngineLock();
    const runs: Array<{ command: string; args: readonly string[] }> = [];
    const events: string[] = [];
    const engine = new FakeEngine({ platform: "macos" });
    const connectEngine = vi.fn(async () => {
      events.push("connect");
      return engine;
    });
    const adapter = createDoctorDependencyAdapter({
      connectEngine,
      async accessRuntimePath(path) {
        events.push(`access ${path}`);
      },
      runner: {
        async run(command, args) {
          runs.push({ command, args });
          events.push(`${command} ${args.join(" ")}`);
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

    const report = await runDoctor(
      { platform: "darwin", arch: "arm64" },
      adapter(lock),
    );

    expect(report.ok).toBe(true);
    expect(connectEngine).toHaveBeenCalledOnce();
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
    expect(events).toEqual([
      expect.stringMatching(/^\/usr\/bin\/osascript -l JavaScript -e /u),
      "access /Applications/CuaDriver.app",
      "/usr/bin/codesign --verify --deep --strict /Applications/CuaDriver.app",
      "/usr/sbin/spctl --assess --type execute /Applications/CuaDriver.app",
      "/usr/bin/codesign -dv --verbose=4 /Applications/CuaDriver.app",
      "/Applications/CuaDriver.app/Contents/MacOS/cua-driver permissions status --json",
      "connect",
    ]);
  });
});
