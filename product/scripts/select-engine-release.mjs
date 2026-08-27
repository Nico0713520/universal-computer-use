#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const RELEASE_ROOT = "https://github.com/trycua/cua/releases/download";
const SOURCE_ROOT = "https://raw.githubusercontent.com/trycua/cua";
const REPOSITORY_API = "https://api.github.com/repos/trycua/cua";
const STABLE_SEMVER = /^\d+\.\d+\.\d+$/;
const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function releaseUrl(tag, name) {
  return new URL(`${RELEASE_ROOT}/${tag}/${name}`);
}

function sourceUrl(commit, name) {
  return new URL(`${SOURCE_ROOT}/${commit}/libs/cua-driver/scripts/${name}`);
}

function parseChecksums(text) {
  const result = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim());
    if (match !== null) result.set(match[2], match[1]);
  }
  return result;
}

async function hashDownload(dependencies, url) {
  return digest(await dependencies.download(url));
}

function replacePinnedSourceMap(sourceMap, tag, commit) {
  const releasePattern = /开发基线 release：`[^`]+`/;
  const commitPattern = /开发基线 commit：`[0-9a-f]{40}`/;
  if (!releasePattern.test(sourceMap) || !commitPattern.test(sourceMap)) {
    throw new Error("upstream source map is missing the pinned Cua baseline fields");
  }
  return sourceMap
    .replace(releasePattern, `开发基线 release：\`${tag}\``)
    .replace(commitPattern, `开发基线 commit：\`${commit}\``);
}

/**
 * Stage a formal Cua release for candidate E2E without granting release
 * eligibility. All network and git seams are injected so contract tests never
 * touch the real lock, package manifest, or GitHub.
 */
export async function stageEngineRelease(options, dependencies) {
  if (!STABLE_SEMVER.test(options.version)) {
    throw new Error("stage requires one explicit stable SemVer x.y.z");
  }
  if (!(await dependencies.isWorktreeClean())) {
    throw new Error("refusing to stage with a dirty worktree");
  }

  const oldLockText = await readFile(options.lockPath, "utf8");
  const oldPackageText = await readFile(options.packagePath, "utf8");
  const oldSourceMap = await readFile(options.sourceMapPath, "utf8");
  const lock = JSON.parse(oldLockText);
  const packageJson = JSON.parse(oldPackageText);
  const tag = `cua-driver-rs-v${options.version}`;
  const sourceCommit = await dependencies.resolveTagCommit(tag);
  if (!COMMIT.test(sourceCommit)) throw new Error("release tag did not resolve to a commit");

  for (const requiredFix of lock.required_fix_commits ?? []) {
    if (!COMMIT.test(requiredFix)) throw new Error("engine lock contains an invalid required fix commit");
    if (!(await dependencies.isAncestor(requiredFix, sourceCommit))) {
      throw new Error(`required fix commit ${requiredFix} is not an ancestor of ${tag}`);
    }
  }

  const checksumsBytes = await dependencies.download(releaseUrl(tag, "checksums.txt"));
  const checksums = parseChecksums(Buffer.from(checksumsBytes).toString("utf8"));
  const macAsset = `cua-driver-rs-${options.version}-darwin-universal.tar.gz`;
  const windowsAsset = `cua-driver-rs-${options.version}-windows-x86_64.zip`;
  const macAssetSha = checksums.get(macAsset);
  const windowsAssetSha = checksums.get(windowsAsset);
  if (macAssetSha === undefined) throw new Error(`checksum missing for ${macAsset}`);
  if (windowsAssetSha === undefined) throw new Error(`checksum missing for ${windowsAsset}`);
  if (!SHA256.test(macAssetSha) || !SHA256.test(windowsAssetSha)) {
    throw new Error("release asset checksum is malformed");
  }

  const macFiles = [
    { name: "install.sh", source: "release" },
    { name: "_install-rust.sh", source: "source_commit" },
    { name: "_install-common.sh", source: "source_commit" },
  ];
  const windowsFiles = [
    { name: "install.ps1", source: "release" },
    { name: "_install-common.psm1", source: "source_commit" },
  ];
  const withHashes = async (files) =>
    Promise.all(
      files.map(async (file) => ({
        ...file,
        sha256: await hashDownload(
          dependencies,
          file.source === "release"
            ? releaseUrl(tag, file.name)
            : sourceUrl(sourceCommit, file.name),
        ),
      })),
    );

  const [macInstallerFiles, windowsInstallerFiles, macUninstallerSha, windowsUninstallerSha] =
    await Promise.all([
      withHashes(macFiles),
      withHashes(windowsFiles),
      hashDownload(dependencies, releaseUrl(tag, "uninstall.sh")),
      hashDownload(dependencies, releaseUrl(tag, "uninstall.ps1")),
    ]);

  if (
    packageJson.dependencies === undefined ||
    typeof packageJson.dependencies["@trycua/cua-driver"] !== "string"
  ) {
    throw new Error("package.json is missing @trycua/cua-driver");
  }
  packageJson.dependencies["@trycua/cua-driver"] = options.version;
  const stagedLock = {
    ...lock,
    version: options.version,
    tag,
    source_commit: sourceCommit,
    platforms: {
      macos: {
        ...lock.platforms.macos,
        development_eligible: true,
        release_eligible: false,
        asset: macAsset,
        sha256: macAssetSha,
        installer_entrypoint: "install.sh",
        installer_files: macInstallerFiles,
        uninstaller_file: {
          name: "uninstall.sh",
          source: "release",
          sha256: macUninstallerSha,
        },
        signer: {
          kind: "apple",
          team_id: null,
          bundle_id: null,
          designated_requirement_sha256: null,
        },
        e2e_evidence: [],
      },
      windows: {
        ...lock.platforms.windows,
        development_eligible: true,
        release_eligible: false,
        asset: windowsAsset,
        sha256: windowsAssetSha,
        installer_entrypoint: "install.ps1",
        installer_files: windowsInstallerFiles,
        uninstaller_file: {
          name: "uninstall.ps1",
          source: "release",
          sha256: windowsUninstallerSha,
        },
        signer: { kind: "authenticode", subject: null, thumbprint: null },
        e2e_evidence: [],
      },
    },
  };
  const stagedLockText = `${JSON.stringify(stagedLock, null, 2)}\n`;
  const stagedPackageText = `${JSON.stringify(packageJson, null, 2)}\n`;
  const stagedSourceMap = replacePinnedSourceMap(oldSourceMap, tag, sourceCommit);

  try {
    await writeFile(options.lockPath, stagedLockText);
    await writeFile(options.packagePath, stagedPackageText);
    await writeFile(options.sourceMapPath, stagedSourceMap);
    await dependencies.verifyContracts();
  } catch (error) {
    await Promise.all([
      writeFile(options.lockPath, oldLockText),
      writeFile(options.packagePath, oldPackageText),
      writeFile(options.sourceMapPath, oldSourceMap),
    ]);
    throw error;
  }

  return {
    version: options.version,
    tag,
    source_commit: sourceCommit,
    release_eligible: false,
  };
}

async function fetchBytes(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json" },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`download failed (${response.status}): ${url.href}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function githubJson(path) {
  const bytes = await fetchBytes(new URL(`${REPOSITORY_API}${path}`));
  return JSON.parse(Buffer.from(bytes).toString("utf8"));
}

async function resolveTagCommit(tag) {
  const reference = await githubJson(`/git/ref/tags/${tag}`);
  let object = reference.object;
  while (object?.type === "tag") {
    const annotated = await githubJson(`/git/tags/${object.sha}`);
    object = annotated.object;
  }
  if (object?.type !== "commit" || !COMMIT.test(object.sha)) {
    throw new Error(`tag ${tag} does not resolve to a commit`);
  }
  return object.sha;
}

const productDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryDirectory = resolve(productDirectory, "..");

export const defaultStageDependencies = {
  async isWorktreeClean() {
    const result = await execFileAsync("git", ["status", "--porcelain"], {
      cwd: repositoryDirectory,
      encoding: "utf8",
    });
    return result.stdout.trim().length === 0;
  },
  resolveTagCommit,
  async isAncestor(ancestor, descendant) {
    const comparison = await githubJson(`/compare/${ancestor}...${descendant}`);
    return comparison.status === "ahead" || comparison.status === "identical";
  },
  download: fetchBytes,
  async verifyContracts() {
    const executable = process.platform === "win32" ? "npx.cmd" : "npx";
    await execFileAsync(
      executable,
      [
        "--yes",
        "pnpm@9.0.4",
        "exec",
        "vitest",
        "run",
        "tests/contract/engine-lock.test.ts",
        "tests/contract/upstream-sources.test.ts",
      ],
      { cwd: productDirectory },
    );
  },
};

function isDirectEntryPoint() {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url;
}

if (isDirectEntryPoint()) {
  const [command, version, ...extra] = process.argv.slice(2);
  if (command !== "stage" || version === undefined || extra.length !== 0) {
    process.stderr.write("Usage: select-engine-release.mjs stage VERSION\n");
    process.exitCode = 2;
  } else {
    void stageEngineRelease(
      {
        version,
        lockPath: resolve(productDirectory, "engine.lock.json"),
        packagePath: resolve(productDirectory, "package.json"),
        sourceMapPath: resolve(repositoryDirectory, "docs", "upstream-sources.md"),
      },
      defaultStageDependencies,
    )
      .then((result) => {
        process.stdout.write(`${JSON.stringify(result)}\n`);
      })
      .catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      });
  }
}
