import { describe, expect, it } from "vitest";

import {
  assertDevelopmentEligible,
  assertReleaseEligible,
  EngineLockSchema,
  loadEngineLock,
} from "../../src/engine/lock.js";

describe("engine lock", () => {
  it("pins the reviewed Cua development baseline", async () => {
    const lock = await loadEngineLock();

    expect(lock.engine).toBe("cua-driver");
    expect(lock.version).toBe("0.22.1");
    expect(lock.source_commit).toBe("c60ef6ad2db8774fb342938843e2f17f26c68240");
    expect(lock.required_tools).toEqual([
      "click",
      "drag",
      "end_session",
      "get_desktop_state",
      "hotkey",
      "move_cursor",
      "press_key",
      "scroll",
      "start_session",
      "type_text",
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
    expect(lock.platforms.macos.development_eligible).toBe(true);
    expect(lock.platforms.windows.development_eligible).toBe(true);
    expect(lock.platforms.macos.signer).toMatchObject({
      kind: "apple",
      bundle_id: "com.trycua.driver",
    });
    expect(lock.platforms.windows.signer).toMatchObject({ kind: "authenticode" });
  });

  it("blocks both public platforms until signer and E2E evidence are promoted", async () => {
    const lock = await loadEngineLock();

    expect(() => assertDevelopmentEligible(lock, "macos")).not.toThrow();
    expect(() => assertDevelopmentEligible(lock, "windows")).not.toThrow();
    expect(() => assertReleaseEligible(lock, "macos")).toThrowError(
      "engine_not_release_eligible",
    );
    expect(() => assertReleaseEligible(lock, "windows")).toThrowError(
      "engine_not_release_eligible",
    );
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
