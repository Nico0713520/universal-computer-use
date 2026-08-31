import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  assertDevelopmentEligible,
  assertReleaseEligible,
  EngineLockSchema,
  loadEngineLock,
} from "../../src/engine/lock.js";
import { PRODUCT_VERSION, PROTOCOL_VERSION } from "../../src/version.js";

describe("engine lock", () => {
  it("keeps package, product, and protocol versions aligned for v0.2", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { version?: unknown };

    expect(manifest.version).toBe("0.2.7");
    expect(PRODUCT_VERSION).toBe("0.2.7");
    expect(PROTOCOL_VERSION).toBe("1.2.0");
  });

  it("publishes independent implementation, evidence, host and release status", async () => {
    const readme = await readFile(new URL("../../../README.md", import.meta.url), "utf8");

    expect(readme).toContain("| Capability | Code | Contract | macOS real | Named host | Release |");
    expect(readme).toMatch(/^\| macOS exact window \| complete \| passed \| current local profiles passed \| pending \| blocked \|$/m);
    expect(readme).toMatch(/^\| macOS background semantic action \| complete \| passed \| 3 × 30\/30 local \| pending \| blocked \|$/m);
    expect(readme).toMatch(/^\| macOS covered-window pixel action \| complete \| passed \| 3 × 30\/30 local \| pending \| blocked \|$/m);
    expect(readme).toMatch(/^\| Windows DPI \| harness complete \| passed \| pending real hardware \| pending \| blocked \|$/m);
    expect(readme).toMatch(/^\| Windows exact window \| blocked upstream \| truthful refusal \| unavailable \| unavailable \| blocked \|$/m);
  });

  it("keeps the staged Cua release internally consistent", async () => {
    const lock = await loadEngineLock();

    expect(lock.engine).toBe("cua-driver");
    expect(lock.version).toBe("0.22.2");
    expect(lock.tag).toBe(`cua-driver-rs-v${lock.version}`);
    expect(lock.source_commit).toBe("d114f35fec05ecd37bf529e5587be86852205b64");
    expect(lock.required_fix_commits).toContain(
      "90295148d34dac8e5a1307bac917e08171af5839",
    );
    expect(lock.required_tools).toEqual([
      "click",
      "double_click",
      "right_click",
      "drag",
      "end_session",
      "get_desktop_state",
      "hotkey",
      "move_cursor",
      "press_key",
      "scroll",
      "start_session",
      "type_text",
      "list_apps",
      "list_windows",
      "get_window_state",
      "verify_state",
      "launch_app",
      "invoke_menu",
      "set_value",
      "health_report",
      "set_agent_cursor_enabled",
      "set_agent_cursor_motion",
      "set_agent_cursor_theme",
      "get_agent_cursor_state",
    ]);
    expect(lock.platforms.macos.installer_files.map(({ name }) => name)).toEqual([
      "install.sh",
      "_install-rust.sh",
      "_install-common.sh",
    ]);
    expect(lock.platforms.macos.uninstaller_file.name).toBe("uninstall.sh");
    expect(lock.platforms.windows.installer_files.map(({ name }) => name)).toEqual([
      "install.ps1",
      "_install-common.psm1",
    ]);
    expect(lock.platforms.windows.uninstaller_file.name).toBe("uninstall.ps1");
    expect(lock.platforms.macos.asset).toBe(
      `cua-driver-rs-${lock.version}-darwin-universal.tar.gz`,
    );
    expect(lock.platforms.windows.asset).toBe(
      `cua-driver-rs-${lock.version}-windows-x86_64.zip`,
    );
    expect(lock.platforms.macos.sha256).toBe(
      "a9ca5891386a3a50b595b53329127e18b0326ce1cefd4e8dcd16efff0e58f4cc",
    );
    expect(lock.platforms.windows.sha256).toBe(
      "03403da57c5e686c8bccb9b1d57a182e37cdf329c5f949eb54460aef554e6795",
    );
    expect(lock.platforms.macos.installer_files[1]).toEqual({
      name: "_install-rust.sh",
      source: "release",
      sha256: "f7483c2d081ed836ba1f9cbad943037907f098cf1be45f37a94d7a2d21303940",
    });
    expect(lock.platforms.macos.development_eligible).toBe(true);
    expect(lock.platforms.windows.development_eligible).toBe(true);
    expect(lock.platforms.macos.release_eligible).toBe(false);
    expect(lock.platforms.windows.release_eligible).toBe(false);
    expect(lock.platforms.macos.signer).toMatchObject({ kind: "apple" });
    expect(lock.platforms.windows.signer).toMatchObject({ kind: "authenticode" });
  });

  it("applies development and release eligibility gates from the validated lock", async () => {
    const lock = await loadEngineLock();

    for (const platform of ["macos", "windows"] as const) {
      if (lock.platforms[platform].development_eligible) {
        expect(() => assertDevelopmentEligible(lock, platform)).not.toThrow();
      } else {
        expect(() => assertDevelopmentEligible(lock, platform)).toThrowError(
          "engine_not_development_eligible",
        );
      }
      if (lock.platforms[platform].release_eligible) {
        expect(() => assertReleaseEligible(lock, platform)).not.toThrow();
      } else {
        expect(() => assertReleaseEligible(lock, platform)).toThrowError(
          "engine_not_release_eligible",
        );
      }
    }
  });

  it("rejects locks whose installer entrypoint is not in the verified file set", () => {
    expect(() =>
      EngineLockSchema.parse({
        schema_version: 2,
        engine: "cua-driver",
        version: "0.22.1",
        tag: "cua-driver-rs-v0.22.1",
        source_commit: "c60ef6ad2db8774fb342938843e2f17f26c68240",
        required_fix_commits: [],
        required_tools: ["click"],
        platforms: {
          macos: {
            development_eligible: true,
            release_eligible: false,
            asset: "driver.tar.gz",
            sha256: "a".repeat(64),
            installer_entrypoint: "install.sh",
            installer_files: [
              { name: "other.sh", source: "release", sha256: "b".repeat(64) },
            ],
            uninstaller_file: {
              name: "uninstall.sh",
              source: "release",
              sha256: "c".repeat(64),
            },
            signer: {
              kind: "apple",
              team_id: null,
              bundle_id: "com.trycua.driver",
              designated_requirement_sha256: null,
            },
            e2e_evidence: [],
          },
          windows: {
            development_eligible: true,
            release_eligible: false,
            asset: "driver.zip",
            sha256: "d".repeat(64),
            installer_entrypoint: "install.ps1",
            installer_files: [
              { name: "install.ps1", source: "release", sha256: "e".repeat(64) },
            ],
            uninstaller_file: {
              name: "uninstall.ps1",
              source: "release",
              sha256: "f".repeat(64),
            },
            signer: { kind: "authenticode", subject: null, thumbprint: null },
            e2e_evidence: [],
          },
        },
      }),
    ).toThrowError("installer entrypoint must be present in installer_files");
  });

  it("does not treat blank release evidence as a platform E2E path", async () => {
    const candidate = structuredClone(await loadEngineLock());
    candidate.platforms.macos.release_eligible = true;
    candidate.platforms.macos.e2e_evidence = ["   "];
    const signer = candidate.platforms.macos.signer;
    if (signer.kind !== "apple") throw new Error("test fixture has the wrong signer kind");
    signer.team_id = "TEAM123456";
    signer.designated_requirement_sha256 = "a".repeat(64);

    expect(() => EngineLockSchema.parse(candidate)).toThrowError();
  });
});
