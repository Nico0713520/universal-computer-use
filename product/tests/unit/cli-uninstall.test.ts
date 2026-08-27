import { createHash } from "node:crypto";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { Downloader, ProcessRunner } from "../../src/cli/process-runner.js";
import { runUninstall } from "../../src/cli/uninstall.js";
import { loadEngineLock } from "../../src/engine/lock.js";

const uninstallerBytes = "locked upstream uninstaller";
const uninstallerSha = createHash("sha256").update(uninstallerBytes).digest("hex");

function boundary() {
  const downloads: Array<{ url: string; destination: string }> = [];
  const runs: Array<{ command: string; args: string[] }> = [];
  const downloader: Downloader = {
    async download(url, destination) {
      downloads.push({ url: url.href, destination });
      await writeFile(destination, uninstallerBytes);
    },
  };
  const runner: ProcessRunner = {
    async run(command, args) {
      runs.push({ command, args });
      return { code: 0, stdout: "", stderr: "" };
    },
  };
  return { downloader, downloads, runner, runs };
}

describe("uninstall", () => {
  it("removes only declared product-owned links and leaves the shared Cua Runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "computer-use-uninstall-test-"));
    const owned = join(root, "computer-use-skill-link");
    const unrelated = join(root, "user-config.json");
    await writeFile(owned, "owned");
    await writeFile(unrelated, "user");
    const edge = boundary();

    const result = await runUninstall(
      { engine: false, platform: "darwin", arch: "arm64" },
      {
        lock: await loadEngineLock(),
        ...edge,
        productOwnedPaths: [owned],
        isEngineInstalled: vi.fn(async () => true),
      },
    );

    await expect(access(owned)).rejects.toThrow();
    await expect(access(unrelated)).resolves.toBeUndefined();
    expect(edge.downloads).toEqual([]);
    expect(edge.runs).toEqual([]);
    expect(result).toEqual({ ok: true, product_removed: true, engine_removed: false, engine_remains: true });
  });

  it("executes only the exact hash-checked macOS release uninstaller after --engine", async () => {
    const lock = structuredClone(await loadEngineLock());
    lock.platforms.macos.uninstaller_file.sha256 = uninstallerSha;
    const edge = boundary();

    const result = await runUninstall(
      { engine: true, platform: "darwin", arch: "x64" },
      { lock, ...edge, productOwnedPaths: [], isEngineInstalled: vi.fn(async () => true) },
    );

    expect(edge.downloads).toHaveLength(1);
    expect(edge.downloads[0].url).toBe(
      "https://github.com/trycua/cua/releases/download/cua-driver-rs-v0.22.1/uninstall.sh",
    );
    expect(edge.runs).toEqual([
      { command: "/bin/bash", args: [edge.downloads[0].destination] },
    ]);
    expect(edge.runs[0].args[0]).toBe(edge.downloads[0].destination);
    expect(result.engine_removed).toBe(true);
    await expect(access(dirname(edge.downloads[0].destination))).rejects.toThrow();
  });

  it("uses a separate PowerShell file argument on Windows", async () => {
    const lock = structuredClone(await loadEngineLock());
    lock.platforms.windows.uninstaller_file.sha256 = uninstallerSha;
    const edge = boundary();

    await runUninstall(
      { engine: true, platform: "win32", arch: "x64" },
      { lock, ...edge, productOwnedPaths: [], isEngineInstalled: vi.fn(async () => true) },
    );

    expect(edge.runs).toEqual([
      {
        command: "powershell.exe",
        args: [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          edge.downloads[0].destination,
        ],
      },
    ]);
  });

  it("refuses execution and cleans up when the uninstaller checksum differs", async () => {
    const edge = boundary();

    await expect(
      runUninstall(
        { engine: true, platform: "darwin", arch: "arm64" },
        {
          lock: await loadEngineLock(),
          ...edge,
          productOwnedPaths: [],
          isEngineInstalled: vi.fn(async () => true),
        },
      ),
    ).rejects.toThrow("checksum mismatch");
    expect(edge.runs).toEqual([]);
    await expect(access(dirname(edge.downloads[0].destination))).rejects.toThrow();
  });

  it("rejects an uninstaller filename that could escape its temp directory", async () => {
    const lock = structuredClone(await loadEngineLock());
    lock.platforms.macos.uninstaller_file.name = "../uninstall.sh";
    const edge = boundary();

    await expect(
      runUninstall(
        { engine: true, platform: "darwin", arch: "arm64" },
        { lock, ...edge, productOwnedPaths: [], isEngineInstalled: vi.fn(async () => true) },
      ),
    ).rejects.toThrow("unsafe uninstaller filename");
    expect(edge.downloads).toEqual([]);
    expect(edge.runs).toEqual([]);
  });
});
