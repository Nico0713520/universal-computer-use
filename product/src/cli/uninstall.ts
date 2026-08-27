import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, win32 } from "node:path";
import process from "node:process";

import type { EngineLock } from "../engine/lock.js";
import type { Downloader, ProcessRunner } from "./process-runner.js";
import { resolveEnginePlatform } from "./setup.js";

export type UninstallOptions = Readonly<{
  engine: boolean;
  platform?: NodeJS.Platform;
  arch?: string;
}>;

export type UninstallDependencies = Readonly<{
  lock: EngineLock;
  downloader: Downloader;
  runner: ProcessRunner;
  productOwnedPaths: readonly string[];
  isEngineInstalled: () => Promise<boolean>;
}>;

export type UninstallReport = Readonly<{
  ok: true;
  product_removed: true;
  engine_removed: boolean;
  engine_remains: boolean;
}>;

function supportedAbsolute(path: string): boolean {
  return isAbsolute(path) || win32.isAbsolute(path);
}

async function removeOwnedPaths(paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    if (!supportedAbsolute(path)) throw new Error("product-owned uninstall path must be absolute");
    await rm(path, { recursive: true, force: true });
  }
}

export async function runUninstall(
  options: UninstallOptions,
  dependencies: UninstallDependencies,
): Promise<UninstallReport> {
  await removeOwnedPaths(dependencies.productOwnedPaths);
  if (!options.engine) {
    return {
      ok: true,
      product_removed: true,
      engine_removed: false,
      engine_remains: await dependencies.isEngineInstalled(),
    };
  }

  const platform = resolveEnginePlatform(
    options.platform ?? process.platform,
    options.arch ?? process.arch,
  );
  const uninstaller = dependencies.lock.platforms[platform].uninstaller_file;
  if (uninstaller.source !== "release") {
    throw new Error("engine uninstaller must be pinned to the locked release");
  }
  if (
    uninstaller.name === "." ||
    uninstaller.name === ".." ||
    uninstaller.name !== basename(uninstaller.name) ||
    uninstaller.name !== win32.basename(uninstaller.name)
  ) {
    throw new Error(`unsafe uninstaller filename: ${uninstaller.name}`);
  }
  const tempDirectory = await mkdtemp(join(tmpdir(), "computer-use-uninstall-"));
  try {
    const path = join(tempDirectory, uninstaller.name);
    const url = new URL(
      `https://github.com/trycua/cua/releases/download/${dependencies.lock.tag}/${uninstaller.name}`,
    );
    await dependencies.downloader.download(url, path);
    const actual = createHash("sha256").update(await readFile(path)).digest("hex");
    if (actual !== uninstaller.sha256) throw new Error(`checksum mismatch: ${path}`);

    const command = platform === "macos" ? "/bin/bash" : "powershell.exe";
    const args =
      platform === "macos"
        ? [path]
        : ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path];
    const result = await dependencies.runner.run(command, args, {
      timeoutMs: 120_000,
    });
    if (result.code !== 0) {
      throw new Error(
        `Cua uninstaller failed: ${result.stderr.trim() || result.stdout.trim()}`,
      );
    }
    return {
      ok: true,
      product_removed: true,
      engine_removed: true,
      engine_remains: false,
    };
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}
