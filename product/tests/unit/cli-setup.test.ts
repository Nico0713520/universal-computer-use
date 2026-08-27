import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { EngineLock } from "../../src/engine/lock.js";
import { loadEngineLock } from "../../src/engine/lock.js";
import type { Downloader, ProcessRunner } from "../../src/cli/process-runner.js";
import { runSetup } from "../../src/cli/setup.js";

const bytesByName: Record<string, string> = {
  "install.sh": "mac entry",
  "_install-rust.sh": "mac rust helper",
  "_install-common.sh": "mac common helper",
  "install.ps1": "windows entry",
  "_install-common.psm1": "windows common helper",
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function fixtureLock(): Promise<EngineLock> {
  const lock = structuredClone(await loadEngineLock());
  for (const platform of ["macos", "windows"] as const) {
    for (const file of lock.platforms[platform].installer_files) {
      file.sha256 = sha256(bytesByName[file.name]);
    }
  }
  return lock;
}

function fakeBoundary() {
  const downloads: Array<{ url: string; destination: string }> = [];
  const runs: Array<{
    command: string;
    args: string[];
    env?: NodeJS.ProcessEnv;
  }> = [];
  const downloader: Downloader = {
    async download(url, destination) {
      downloads.push({ url: url.href, destination });
      await writeFile(destination, bytesByName[url.pathname.split("/").at(-1) ?? ""] ?? "bad");
    },
  };
  const runner: ProcessRunner = {
    async run(command, args, options) {
      runs.push({ command, args, env: options.env });
      const isSignatureInspection =
        command === "powershell.exe" && args.includes("-Command");
      const isMacIdentityInspection =
        command === "/usr/bin/codesign" && args.includes("-dv");
      const isMacRequirementInspection =
        command === "/usr/bin/codesign" && args.includes("-dr");
      return {
        code: 0,
        stdout: isSignatureInspection
          ? JSON.stringify({ Status: "Valid", Subject: "fixture", Thumbprint: "A".repeat(40) })
          : isMacIdentityInspection
            ? "Identifier=com.trycua.driver\nTeamIdentifier=TEAM123456"
          : isMacRequirementInspection
            ? "designated => fixture"
          : "",
        stderr: "",
      };
    },
  };
  return { downloader, downloads, runner, runs };
}

const healthyDoctor = {
  ok: true,
  product_version: "0.1.0",
  protocol_version: "1.0.0",
  platform: "macos" as const,
  supported_platform: true,
  expected_engine_version: "0.22.1",
  reported_engine_version: "0.22.1",
  engine_connected: true,
  required_tools_present: true,
  desktop_unlocked: true,
  permissions: "unknown" as const,
  observation_succeeded: true,
  screenshot: { width: 100, height: 80 },
};

describe("setup", () => {
  it("downloads and checks the exact macOS script group before local execution", async () => {
    const boundary = fakeBoundary();
    const lock = await fixtureLock();

    const result = await runSetup(
      { development: true, platform: "darwin", arch: "arm64" },
      {
        lock,
        ...boundary,
        runDoctor: vi.fn(async () => healthyDoctor),
      },
    );

    expect(boundary.downloads.map(({ url }) => url)).toEqual([
      "https://github.com/trycua/cua/releases/download/cua-driver-rs-v0.22.1/install.sh",
      "https://raw.githubusercontent.com/trycua/cua/c60ef6ad2db8774fb342938843e2f17f26c68240/libs/cua-driver/scripts/_install-rust.sh",
      "https://raw.githubusercontent.com/trycua/cua/c60ef6ad2db8774fb342938843e2f17f26c68240/libs/cua-driver/scripts/_install-common.sh",
    ]);
    const installRun = boundary.runs[0];
    expect(installRun.command).toBe("/bin/bash");
    expect(installRun.args).toHaveLength(2);
    expect(installRun.args[0]).toBe(boundary.downloads[0].destination);
    expect(dirname(installRun.args[0])).toBe(dirname(boundary.downloads[1].destination));
    expect(installRun.args[1]).toBe("--autostart");
    expect(installRun.env?.CUA_DRIVER_RS_VERSION).toBe("0.22.1");
    expect(result).toMatchObject({ ok: true, development_only: true });
    expect(result.warning).toMatchObject({ development_only: true });

    await expect(access(dirname(boundary.downloads[0].destination))).rejects.toThrow();
  });

  it("uses the exact Windows PowerShell argv without shell interpolation", async () => {
    const boundary = fakeBoundary();
    const lock = await fixtureLock();

    await runSetup(
      { development: true, platform: "win32", arch: "x64" },
      {
        lock,
        ...boundary,
        runDoctor: vi.fn(async () => ({ ...healthyDoctor, platform: "windows" as const })),
        windowsExecutablePath: "C:\\Program Files\\Cua\\cua-driver.exe",
      },
    );

    expect(boundary.downloads.map(({ url }) => url)).toEqual([
      "https://github.com/trycua/cua/releases/download/cua-driver-rs-v0.22.1/install.ps1",
      "https://raw.githubusercontent.com/trycua/cua/c60ef6ad2db8774fb342938843e2f17f26c68240/libs/cua-driver/scripts/_install-common.psm1",
    ]);
    expect(boundary.runs[0]).toMatchObject({
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        boundary.downloads[0].destination,
        "-Release",
        "0.22.1",
        "-AutoStart",
      ],
    });
  });

  it("fails closed before downloading when ordinary setup is not release eligible", async () => {
    const boundary = fakeBoundary();

    await expect(
      runSetup(
        { development: false, platform: "darwin", arch: "arm64" },
        {
          lock: await fixtureLock(),
          ...boundary,
          runDoctor: vi.fn(async () => healthyDoctor),
        },
      ),
    ).rejects.toThrow("engine_not_release_eligible");
    expect(boundary.downloads).toEqual([]);
    expect(boundary.runs).toEqual([]);
  });

  it("removes the exact temp directory and never executes on any checksum mismatch", async () => {
    const boundary = fakeBoundary();
    const lock = await fixtureLock();
    lock.platforms.macos.installer_files[1].sha256 = "0".repeat(64);

    await expect(
      runSetup(
        { development: true, platform: "darwin", arch: "x64" },
        {
          lock,
          ...boundary,
          runDoctor: vi.fn(async () => healthyDoctor),
        },
      ),
    ).rejects.toThrow("checksum mismatch");
    expect(boundary.runs).toEqual([]);
    const tempDirectory = dirname(boundary.downloads[0].destination);
    await expect(access(tempDirectory)).rejects.toThrow();
  });

  it.each([
    ["linux", "x64"],
    ["win32", "arm64"],
    ["darwin", "ia32"],
  ])("rejects unsupported %s/%s before side effects", async (platform, arch) => {
    const boundary = fakeBoundary();

    await expect(
      runSetup(
        { development: true, platform: platform as NodeJS.Platform, arch },
        {
          lock: await fixtureLock(),
          ...boundary,
          runDoctor: vi.fn(async () => healthyDoctor),
        },
      ),
    ).rejects.toMatchObject({ code: "unsupported_platform" });
    expect(boundary.downloads).toEqual([]);
    expect(boundary.runs).toEqual([]);
  });

  it("rejects an ineligible development lock before downloading", async () => {
    const boundary = fakeBoundary();
    const lock = await fixtureLock();
    lock.platforms.macos.development_eligible = false;

    await expect(
      runSetup(
        { development: true, platform: "darwin", arch: "arm64" },
        {
          lock,
          ...boundary,
          runDoctor: vi.fn(async () => healthyDoctor),
        },
      ),
    ).rejects.toThrow("engine_not_development_eligible");
    expect(boundary.downloads).toEqual([]);
  });

  it("rejects installer filenames that could escape the exact temp directory", async () => {
    const boundary = fakeBoundary();
    const lock = await fixtureLock();
    lock.platforms.macos.installer_files[1].name = "../_install-rust.sh";

    await expect(
      runSetup(
        { development: true, platform: "darwin", arch: "arm64" },
        {
          lock,
          ...boundary,
          runDoctor: vi.fn(async () => healthyDoctor),
        },
      ),
    ).rejects.toThrow("unsafe installer filename");
    expect(boundary.downloads).toEqual([]);
  });

  it("does not use latest URLs or write a host configuration", async () => {
    const boundary = fakeBoundary();
    const hostConfigWriter = vi.fn();

    await runSetup(
      { development: true, platform: "darwin", arch: "arm64" },
      {
        lock: await fixtureLock(),
        ...boundary,
        runDoctor: vi.fn(async () => healthyDoctor),
      },
    );

    expect(boundary.downloads.every(({ url }) => !url.includes("latest"))).toBe(true);
    expect(hostConfigWriter).not.toHaveBeenCalled();
    await expect(readFile(boundary.downloads[0].destination)).rejects.toThrow();
  });

  it("requires the exact promoted macOS signer identity in release mode", async () => {
    const boundary = fakeBoundary();
    const lock = await fixtureLock();
    const signer = lock.platforms.macos.signer;
    if (signer.kind !== "apple") throw new Error("fixture has wrong signer kind");
    lock.platforms.macos.release_eligible = true;
    lock.platforms.macos.e2e_evidence = ["evidence/macos.json"];
    signer.team_id = "WRONGTEAM1";
    signer.designated_requirement_sha256 = sha256("designated => fixture");

    await expect(
      runSetup(
        { development: false, platform: "darwin", arch: "arm64" },
        {
          lock,
          ...boundary,
          runDoctor: vi.fn(async () => healthyDoctor),
        },
      ),
    ).rejects.toThrow("TeamIdentifier mismatch");
  });
});
