#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { z } from "zod";

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

function sameArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function assertCandidateEngine(evidence, lock, platform, contractFingerprint) {
  const engine = evidence.engine;
  const platformLock = lock.platforms[platform];
  if (
    engine?.name !== "cua-driver"
    || engine.version !== lock.version
    || engine.tag !== lock.tag
    || engine.source_commit !== lock.source_commit
    || engine.asset !== platformLock.asset
    || engine.asset_sha256 !== platformLock.sha256
    || !sameArray(engine.required_fix_commits, lock.required_fix_commits)
  ) {
    throw new Error(`${platform}_candidate_engine_mismatch`);
  }
  const fingerprint = platform === "macos"
    ? evidence.contract_fingerprint_sha256
    : engine.contract_fingerprint_sha256;
  if (fingerprint !== contractFingerprint) {
    throw new Error("contract_fingerprint_mismatch");
  }
  if (platform === "windows" && !sameArray(engine.required_tools, lock.required_tools)) {
    throw new Error("windows_candidate_tool_contract_mismatch");
  }
}

async function parseEvidence(path, schemaPath) {
  const bytes = await readFile(path);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`evidence_json_invalid:${basename(path)}`);
  }
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  // Zod validates the strict base schema. Candidate-only conditions are
  // enforced explicitly below because z.fromJSONSchema intentionally does
  // not implement JSON Schema if/then/else.
  delete schema.allOf;
  const parsed = z.fromJSONSchema(schema).safeParse(value);
  if (!parsed.success) throw new Error(`evidence_schema_invalid:${basename(path)}`);
  return { path, bytes, value: parsed.data, sha256: digest(bytes) };
}

function evidenceReference(platform, repeat, sha256) {
  return `platform/${platform}-r${repeat}-${sha256}.json`;
}

async function atomicWrite(path, text) {
  const temporary = resolve(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, text, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * Promote only complete, externally produced candidate evidence. Evidence
 * remains outside the repository; the lock receives relative content-addressed
 * references and normalized signer identities only.
 */
export async function promoteEngineRelease(options, dependencies) {
  if (!STABLE_SEMVER.test(options.version)) {
    throw new Error("promote requires one explicit stable SemVer x.y.z");
  }
  if (!(await dependencies.isWorktreeClean())) {
    throw new Error("refusing to promote with a dirty worktree");
  }
  if (
    !isAbsolute(options.lockPath)
    || !isAbsolute(options.macEvidencePath)
    || !isAbsolute(options.windowsEvidencePath)
  ) {
    throw new Error("promotion paths must be absolute");
  }

  const oldLockText = await readFile(options.lockPath, "utf8");
  const lock = JSON.parse(oldLockText);
  if (
    lock.version !== options.version
    || lock.tag !== `cua-driver-rs-v${options.version}`
    || !COMMIT.test(lock.source_commit)
    || !Array.isArray(lock.required_fix_commits)
    || lock.required_fix_commits.length === 0
    || !lock.required_fix_commits.every((commit) => COMMIT.test(commit))
  ) {
    throw new Error("promotion requires one staged formal release with required fixes");
  }
  if (
    lock.platforms?.macos?.release_eligible !== false
    || lock.platforms?.windows?.release_eligible !== false
    || lock.platforms.macos.development_eligible !== true
    || lock.platforms.windows.development_eligible !== true
  ) {
    throw new Error("promotion requires one non-release-eligible staged lock");
  }
  const contractFingerprint = await dependencies.currentContractFingerprint();
  if (!SHA256.test(contractFingerprint)) throw new Error("public contract fingerprint is malformed");

  // Read every external input before changing the lock. Windows PATH is a
  // directory containing exactly one JSON file for each accepted DPI lane.
  const windowsNames = (await readdir(options.windowsEvidencePath))
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .sort();
  if (windowsNames.length !== 3) {
    throw new Error("windows_evidence_requires_exact_dpi_lanes");
  }
  const macRaw = JSON.parse(await readFile(options.macEvidencePath, "utf8"));
  if (
    macRaw?.mode !== "candidate"
    || macRaw?.results?.repeat_completed < 20
    || macRaw.results.repeat_requested !== macRaw.results.repeat_completed
    || macRaw.results.plugin_seam_failures !== 0
  ) {
    throw new Error("macos_candidate_runs_insufficient");
  }
  const windowsRaw = await Promise.all(windowsNames.map(async (name) => ({
    path: resolve(options.windowsEvidencePath, name),
    value: JSON.parse(await readFile(resolve(options.windowsEvidencePath, name), "utf8")),
  })));
  const rawDpis = windowsRaw.map(({ value }) => value?.host?.dpi_percent).sort((a, b) => a - b);
  if (JSON.stringify(rawDpis) !== JSON.stringify([100, 125, 150])) {
    throw new Error("windows_evidence_requires_exact_dpi_lanes");
  }
  for (const { value } of windowsRaw) {
    if (
      value?.stage !== "candidate"
      || value.promotable !== true
      || value.results?.iterations_passed < 20
      || value.results.iterations_expected !== value.results.iterations_passed
      || value.results.plugin_seam_failures !== 0
    ) {
      throw new Error("windows_candidate_runs_insufficient");
    }
  }

  const mac = await parseEvidence(options.macEvidencePath, options.macSchemaPath);
  const windows = await Promise.all(windowsRaw.map(({ path }) =>
    parseEvidence(path, options.windowsSchemaPath)));
  assertCandidateEngine(mac.value, lock, "macos", contractFingerprint);
  for (const evidence of windows) {
    assertCandidateEngine(evidence.value, lock, "windows", contractFingerprint);
  }

  const macSigner = mac.value.signature;
  if (
    macSigner.codesign !== "valid"
    || macSigner.gatekeeper !== "accepted"
    || typeof macSigner.team_identifier !== "string"
    || typeof macSigner.bundle_id !== "string"
    || !SHA256.test(macSigner.designated_requirement_sha256)
  ) {
    throw new Error("macos_signer_missing");
  }
  const firstWindowsSigner = windows[0].value.signer;
  if (
    firstWindowsSigner?.status !== "Valid"
    || typeof firstWindowsSigner.subject !== "string"
    || firstWindowsSigner.subject.length === 0
    || !/^[0-9A-F]{40}$/.test(firstWindowsSigner.thumbprint)
  ) {
    throw new Error("windows_signer_missing");
  }
  for (const evidence of windows.slice(1)) {
    if (
      evidence.value.signer.subject !== firstWindowsSigner.subject
      || evidence.value.signer.thumbprint !== firstWindowsSigner.thumbprint
    ) {
      throw new Error("windows_signer_mismatch");
    }
  }

  const macReference = evidenceReference("macos", mac.value.results.repeat_completed, mac.sha256);
  const windowsReferences = windows
    .sort((left, right) => left.value.host.dpi_percent - right.value.host.dpi_percent)
    .map((evidence) => ({
      ...evidence,
      reference: evidenceReference(
        `windows-${evidence.value.host.dpi_percent}`,
        evidence.value.results.iterations_passed,
        evidence.sha256,
      ),
    }));
  const promotedLock = {
    ...lock,
    platforms: {
      macos: {
        ...lock.platforms.macos,
        release_eligible: true,
        signer: {
          kind: "apple",
          team_id: macSigner.team_identifier,
          bundle_id: macSigner.bundle_id,
          designated_requirement_sha256: macSigner.designated_requirement_sha256,
        },
        e2e_evidence: [macReference],
      },
      windows: {
        ...lock.platforms.windows,
        release_eligible: true,
        signer: {
          kind: "authenticode",
          subject: firstWindowsSigner.subject,
          thumbprint: firstWindowsSigner.thumbprint,
        },
        e2e_evidence: windowsReferences.map(({ reference }) => reference),
      },
    },
  };
  const promotedText = `${JSON.stringify(promotedLock, null, 2)}\n`;
  await atomicWrite(options.lockPath, promotedText);
  try {
    await dependencies.verifyContracts();
  } catch (error) {
    await atomicWrite(options.lockPath, oldLockText);
    throw error;
  }

  return {
    version: lock.version,
    tag: lock.tag,
    release_eligible: true,
    evidence_renames: [
      { source: options.macEvidencePath, target: macReference, sha256: mac.sha256 },
      ...windowsReferences.map(({ path, reference, sha256 }) => ({ source: path, target: reference, sha256 })),
    ],
  };
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
  const oldDependencyLockText = await readFile(options.dependencyLockPath, "utf8");
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
    { name: "_install-rust.sh", source: "release" },
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
    await dependencies.updateDependencyLock({
      version: options.version,
      packagePath: options.packagePath,
      dependencyLockPath: options.dependencyLockPath,
    });
    await dependencies.verifyContracts();
  } catch (error) {
    await Promise.all([
      writeFile(options.lockPath, oldLockText),
      writeFile(options.packagePath, oldPackageText),
      writeFile(options.dependencyLockPath, oldDependencyLockText),
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
  async updateDependencyLock({ packagePath, dependencyLockPath }) {
    const packageDirectory = dirname(packagePath);
    if (resolve(packageDirectory, "pnpm-lock.yaml") !== resolve(dependencyLockPath)) {
      throw new Error("dependency lock path must be the package pnpm-lock.yaml");
    }
    const executable = process.platform === "win32" ? "npx.cmd" : "npx";
    await execFileAsync(
      executable,
      [
        "--yes",
        "pnpm@9.0.4",
        "install",
        "--lockfile-only",
        "--ignore-scripts",
      ],
      { cwd: packageDirectory },
    );
  },
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

export const defaultPromotionDependencies = {
  isWorktreeClean: defaultStageDependencies.isWorktreeClean,
  async currentContractFingerprint() {
    const protocolUrl = pathToFileURL(resolve(productDirectory, "dist", "protocol.js"));
    const protocol = await import(`${protocolUrl.href}?promotion=${Date.now()}`);
    if (!Array.isArray(protocol.PUBLIC_TOOL_SCHEMAS)) {
      throw new Error("build is missing PUBLIC_TOOL_SCHEMAS");
    }
    return digest(JSON.stringify(protocol.PUBLIC_TOOL_SCHEMAS));
  },
  verifyContracts: defaultStageDependencies.verifyContracts,
};

function isDirectEntryPoint() {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url;
}

if (isDirectEntryPoint()) {
  const [command, version, ...extra] = process.argv.slice(2);
  const stage = command === "stage" && version !== undefined && extra.length === 0;
  const promote = command === "promote"
    && version !== undefined
    && extra.length === 4
    && extra[0] === "--mac-evidence"
    && extra[2] === "--windows-evidence";
  if (!stage && !promote) {
    process.stderr.write(
      "Usage:\n"
      + "  select-engine-release.mjs stage VERSION\n"
      + "  select-engine-release.mjs promote VERSION --mac-evidence PATH --windows-evidence PATH\n",
    );
    process.exitCode = 2;
  } else if (promote) {
    void promoteEngineRelease(
      {
        version,
        lockPath: resolve(productDirectory, "engine.lock.json"),
        macEvidencePath: resolve(extra[1]),
        windowsEvidencePath: resolve(extra[3]),
        macSchemaPath: resolve(productDirectory, "tests", "e2e", "macos", "evidence.schema.json"),
        windowsSchemaPath: resolve(productDirectory, "tests", "e2e", "windows", "evidence.schema.json"),
      },
      defaultPromotionDependencies,
    ).then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    }).catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
  } else {
    void stageEngineRelease(
      {
        version,
        lockPath: resolve(productDirectory, "engine.lock.json"),
        packagePath: resolve(productDirectory, "package.json"),
        dependencyLockPath: resolve(productDirectory, "pnpm-lock.yaml"),
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
