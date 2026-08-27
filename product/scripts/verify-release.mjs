#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { z } from "zod";

const productDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isSafeEvidenceReference(reference) {
  return typeof reference === "string"
    && /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(reference)
    && !reference.split("/").includes("..");
}

export async function inspectPackedArtifact(directory) {
  const { stdout } = await execFileAsync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["pack", "--dry-run", "--json"],
    { cwd: directory, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  const manifest = JSON.parse(stdout);
  if (!Array.isArray(manifest) || manifest.length !== 1 || !Array.isArray(manifest[0]?.files)) {
    throw new Error("package_manifest_invalid");
  }
  const files = manifest[0].files.map((entry) => entry?.path);
  if (!files.every((path) => typeof path === "string")) {
    throw new Error("package_manifest_invalid");
  }
  const required = [
    "dist/mcp/main.js",
    "dist/mcp/server.js",
    "dist/protocol.js",
    "skills/computer-use/SKILL.md",
    "integrations/generic/mcp.json",
    "integrations/codex/README.md",
    "integrations/kimi/README.md",
    "engine.lock.json",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
  ];
  for (const path of required) {
    if (!files.includes(path)) throw new Error(`package_missing:${path}`);
  }
  const forbiddenPath = /(?:^|\/)\.env(?:\.|$)|\.(?:rs|dylib|dll|exe|app|png|jpe?g|trace|zip|tar\.gz)$/i;
  if (files.some((path) => forbiddenPath.test(path))) {
    throw new Error("package_contains_forbidden_artifact");
  }

  const packageJson = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
  const dependencies = Object.keys(packageJson.dependencies ?? {}).sort();
  const expectedDependencies = ["@modelcontextprotocol/sdk", "@trycua/cua-driver", "zod"];
  if (JSON.stringify(dependencies) !== JSON.stringify(expectedDependencies)) {
    throw new Error("package_dependency_surface_changed");
  }
  const productLicense = await readFile(resolve(directory, "LICENSE"), "utf8");
  const notices = await readFile(resolve(directory, "THIRD_PARTY_NOTICES.md"), "utf8");
  if (!productLicense.includes("MIT License")) throw new Error("package_product_license_invalid");
  for (const dependency of expectedDependencies) {
    const version = packageJson.dependencies[dependency];
    if (!notices.includes(`\`${dependency}\` ${version}`)) {
      throw new Error(`package_notice_missing:${dependency}@${version}`);
    }
  }

  const protocol = await import(`${pathToFileURL(resolve(directory, "dist/protocol.js")).href}?release=${Date.now()}`);
  const names = protocol.PUBLIC_TOOL_SCHEMAS?.map((tool) => tool?.name);
  if (JSON.stringify(names) !== JSON.stringify(["computer_observe", "computer_act"])) {
    throw new Error("package_public_tool_contract_changed");
  }

  const lock = JSON.parse(await readFile(resolve(directory, "engine.lock.json"), "utf8"));
  for (const platform of ["macos", "windows"]) {
    const references = lock?.platforms?.[platform]?.e2e_evidence;
    if (!Array.isArray(references) || !references.every(isSafeEvidenceReference)) {
      throw new Error("package_contains_unsafe_evidence_reference");
    }
  }
  return { files, dependencies };
}

async function contractFingerprint(directory) {
  const protocolUrl = pathToFileURL(resolve(directory, "dist", "protocol.js"));
  const protocol = await import(`${protocolUrl.href}?release=${Date.now()}`);
  if (!Array.isArray(protocol.PUBLIC_TOOL_SCHEMAS)) {
    throw new Error("package_public_tool_contract_missing");
  }
  return sha256(JSON.stringify(protocol.PUBLIC_TOOL_SCHEMAS));
}

async function validatedEngineLock(options) {
  let raw;
  try {
    raw = JSON.parse(await readFile(options.lockPath, "utf8"));
  } catch {
    throw new Error("engine_lock_invalid");
  }
  const lockModuleUrl = pathToFileURL(resolve(options.productDirectory, "dist", "engine", "lock.js"));
  const lockModule = await import(`${lockModuleUrl.href}?release=${Date.now()}`);
  const parsed = lockModule.EngineLockSchema?.safeParse(raw);
  if (parsed?.success !== true) throw new Error("engine_lock_invalid");
  const lock = parsed.data;
  if (
    lock.tag !== `cua-driver-rs-v${lock.version}`
    || lock.required_fix_commits.length === 0
    || !/^[0-9a-f]{40}$/.test(lock.source_commit)
  ) {
    throw new Error("engine_lock_formal_release_invalid");
  }
  const packageJson = JSON.parse(
    await readFile(resolve(options.productDirectory, "package.json"), "utf8"),
  );
  if (packageJson.dependencies?.["@trycua/cua-driver"] !== lock.version) {
    throw new Error("engine_lock_sdk_version_mismatch");
  }
  return lock;
}

async function schemaParser(path, { stripConditions = false, hostStatus = false } = {}) {
  const schema = JSON.parse(await readFile(path, "utf8"));
  if (stripConditions) delete schema.allOf;
  if (hostStatus) {
    const { oneOf, ...strictBase } = schema;
    if (!Array.isArray(oneOf)) throw new Error("host_evidence_schema_invalid");
    return z.pipe(z.fromJSONSchema(strictBase), z.fromJSONSchema(schema));
  }
  return z.fromJSONSchema(schema);
}

function inside(root, path) {
  const child = relative(root, path);
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function sameArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function assertEngineEvidence(evidence, lock, platform, fingerprint) {
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
    throw new Error("platform_evidence_engine_mismatch");
  }
  const recordedFingerprint = platform === "macos"
    ? evidence.contract_fingerprint_sha256
    : engine.contract_fingerprint_sha256;
  if (recordedFingerprint !== fingerprint) throw new Error("contract_fingerprint_mismatch");
  if (platform === "windows" && !sameArray(engine.required_tools, lock.required_tools)) {
    throw new Error("platform_evidence_tool_contract_mismatch");
  }
}

async function readPlatformEvidence(options, lock, fingerprint) {
  const environment = options.environment ?? {};
  const rootText = environment.CUA_RELEASE_PLATFORM_EVIDENCE_ROOT;
  if (typeof rootText !== "string" || !isAbsolute(rootText)) {
    throw new Error("platform_evidence_root_required");
  }
  const root = resolve(rootText);
  const macParser = await schemaParser(
    resolve(options.productDirectory, "tests", "e2e", "macos", "evidence.schema.json"),
    { stripConditions: true },
  );
  const windowsParser = await schemaParser(
    resolve(options.productDirectory, "tests", "e2e", "windows", "evidence.schema.json"),
    { stripConditions: true },
  );
  const result = { macos: [], windows: [], byReference: new Map(), root };
  for (const platform of ["macos", "windows"]) {
    for (const reference of lock.platforms[platform].e2e_evidence) {
      if (!isSafeEvidenceReference(reference)) throw new Error("platform_evidence_reference_invalid");
      const path = resolve(root, reference);
      if (!inside(root, path)) throw new Error("platform_evidence_outside_root");
      const bytes = await readFile(path);
      const contentSha = sha256(bytes);
      if (!reference.endsWith(`-${contentSha}.json`)) {
        throw new Error("platform_evidence_content_address_mismatch");
      }
      const raw = JSON.parse(bytes.toString("utf8"));
      const parser = platform === "macos" ? macParser : windowsParser;
      const parsed = parser.safeParse(raw);
      if (!parsed.success) throw new Error("platform_evidence_schema_invalid");
      const evidence = parsed.data;
      assertEngineEvidence(evidence, lock, platform, fingerprint);
      if (platform === "macos") {
        if (
          evidence.mode !== "candidate"
          || evidence.system.display.backing_scale <= 1
          || evidence.results.repeat_completed < 20
          || evidence.results.repeat_completed !== evidence.results.repeat_requested
          || evidence.results.plugin_seam_failures !== 0
          || evidence.results.retina_lane !== "passed"
          || evidence.signature.team_identifier !== lock.platforms.macos.signer.team_id
          || evidence.signature.bundle_id !== lock.platforms.macos.signer.bundle_id
          || evidence.signature.designated_requirement_sha256
            !== lock.platforms.macos.signer.designated_requirement_sha256
        ) throw new Error("macos_beta_evidence_invalid");
      } else {
        if (
          evidence.stage !== "candidate"
          || evidence.promotable !== true
          || evidence.results.passed !== true
          || evidence.results.iterations_passed < 20
          || evidence.results.iterations_passed !== evidence.results.iterations_expected
          || evidence.results.plugin_seam_failures !== 0
          || evidence.signer.status !== "Valid"
          || evidence.signer.subject !== lock.platforms.windows.signer.subject
          || evidence.signer.thumbprint !== lock.platforms.windows.signer.thumbprint
        ) throw new Error("windows_beta_evidence_invalid");
      }
      result[platform].push(evidence);
      result.byReference.set(reference, { bytes, sha256: contentSha, platform });
    }
  }
  if (result.macos.length < 1) throw new Error("macos_retina_evidence_required");
  const dpis = result.windows.map((evidence) => evidence.host.dpi_percent).sort((a, b) => a - b);
  if (JSON.stringify(dpis) !== JSON.stringify([100, 125, 150])) {
    throw new Error("windows_dpi_evidence_required");
  }
  return result;
}

async function verifyHostEvidence(options, lock, platformEvidence) {
  const configured = options.environment?.CUA_HOST_EVIDENCE_FILES;
  if (typeof configured !== "string" || configured.length === 0) {
    throw new Error("host_evidence_required");
  }
  const paths = configured.split(delimiter).filter(Boolean);
  if (paths.length < 2 || paths.some((path) => !isAbsolute(path))) {
    throw new Error("host_evidence_required");
  }
  const parser = await schemaParser(
    resolve(options.productDirectory, "tests", "e2e", "host", "evidence.schema.json"),
    { hostStatus: true },
  );
  const verified = new Set();
  for (const path of paths) {
    const parsed = parser.safeParse(JSON.parse(await readFile(path, "utf8")));
    if (!parsed.success) throw new Error("host_evidence_schema_invalid");
    const evidence = parsed.data;
    if (evidence.status !== "verified") throw new Error("host_evidence_not_verified");
    if (evidence.system.engine_version !== lock.version) throw new Error("host_engine_version_mismatch");
    const reference = evidence.eligible_platform_evidence.reference;
    const linked = platformEvidence.byReference.get(reference);
    if (linked === undefined || linked.platform !== evidence.system.platform) {
      throw new Error("host_platform_evidence_not_in_lock");
    }
    if (evidence.eligible_platform_evidence.sha256 !== linked.sha256) {
      throw new Error("host_platform_evidence_hash_mismatch");
    }
    if (resolve(dirname(path), reference) !== resolve(platformEvidence.root, reference)) {
      throw new Error("host_platform_evidence_outside_bundle");
    }
    verified.add(evidence.host.name);
  }
  if (!verified.has("codex") || !verified.has("kimi")) {
    throw new Error("verified_codex_and_kimi_required");
  }
}

function exactKeys(value, expected) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function isNonnegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isIsoTimestamp(value) {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

async function verifyStableSoaks(options, lock) {
  const configured = options.environment?.CUA_SOAK_EVIDENCE_FILES;
  if (typeof configured !== "string" || configured.length === 0) {
    throw new Error("stable_soak_evidence_required");
  }
  const paths = configured.split(delimiter).filter(Boolean);
  if (paths.length !== 2 || paths.some((path) => !isAbsolute(path))) {
    throw new Error("stable_soak_evidence_required");
  }
  const expectedKeys = [
    "schema_version", "evidence_type", "platform", "generated_at", "engine_version",
    "duration_seconds", "actions_completed", "complete_cycles", "plugin_seam_failures",
    "stale_snapshot_acceptances", "coordinate_mismatches", "deadlocks",
    "unclassified_timeouts", "malformed_pngs", "sensitive_log_events", "rss_warm_mib",
    "rss_final_mib", "rss_delta_mib", "fixture_oracle",
  ];
  const seen = new Set();
  for (const path of paths) {
    const evidence = JSON.parse(await readFile(path, "utf8"));
    if (!exactKeys(evidence, expectedKeys)) throw new Error("stable_soak_evidence_invalid");
    const platform = evidence.platform;
    const counters = [
      evidence.plugin_seam_failures,
      evidence.stale_snapshot_acceptances,
      evidence.coordinate_mismatches,
      evidence.deadlocks,
      evidence.unclassified_timeouts,
      evidence.malformed_pngs,
      evidence.sensitive_log_events,
    ];
    if (
      evidence.schema_version !== 1
      || evidence.evidence_type !== "computer-use-soak"
      || (platform !== "macos" && platform !== "windows")
      || seen.has(platform)
      || evidence.engine_version !== lock.version
      || !isIsoTimestamp(evidence.generated_at)
      || !isNonnegativeInteger(evidence.duration_seconds)
      || !isNonnegativeInteger(evidence.actions_completed)
      || evidence.duration_seconds < 1800
      || evidence.actions_completed < 200
      || !isNonnegativeInteger(evidence.complete_cycles)
      || evidence.complete_cycles < 1
      || counters.some((value) => value !== 0)
      || evidence.fixture_oracle !== "loopback-http-state"
      || !Number.isFinite(evidence.rss_warm_mib)
      || !Number.isFinite(evidence.rss_final_mib)
      || !Number.isFinite(evidence.rss_delta_mib)
      || evidence.rss_warm_mib <= 0
      || evidence.rss_final_mib <= 0
      || evidence.rss_delta_mib > 150
      || Math.abs((evidence.rss_final_mib - evidence.rss_warm_mib) - evidence.rss_delta_mib) > 0.1
    ) throw new Error("stable_soak_evidence_invalid");
    seen.add(platform);
  }
  if (!seen.has("macos") || !seen.has("windows")) {
    throw new Error("stable_soak_evidence_required");
  }
}

export async function verifyRelease(options) {
  if (options.channel !== "beta" && options.channel !== "stable") {
    throw new Error("release_channel_invalid");
  }
  const lock = await validatedEngineLock(options);
  if (
    lock?.platforms?.macos?.release_eligible !== true
    || lock?.platforms?.windows?.release_eligible !== true
  ) {
    throw new Error("engine_not_release_eligible");
  }
  const fingerprint = await contractFingerprint(options.productDirectory);
  const platformEvidence = await readPlatformEvidence(options, lock, fingerprint);
  await verifyHostEvidence(options, lock, platformEvidence);
  if (options.channel === "stable") {
    const macIterations = platformEvidence.macos.reduce(
      (total, evidence) => total + evidence.results.repeat_completed,
      0,
    );
    const windowsIterations = platformEvidence.windows.reduce(
      (total, evidence) => total + evidence.results.iterations_passed,
      0,
    );
    if (macIterations < 100 || windowsIterations < 100) {
      throw new Error("stable_platform_iterations_insufficient");
    }
    await verifyStableSoaks(options, lock);
  }
  await inspectPackedArtifact(options.productDirectory);
  return { channel: options.channel, verified: true, engine_version: lock.version };
}

function isDirectEntryPoint() {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url;
}

if (isDirectEntryPoint()) {
  const cliArguments = process.argv.slice(2);
  if (cliArguments[0] === "--") cliArguments.shift();
  const [flag, channel, ...extra] = cliArguments;
  if (flag !== "--channel" || (channel !== "beta" && channel !== "stable") || extra.length !== 0) {
    process.stderr.write("Usage: verify-release.mjs --channel beta|stable\n");
    process.exitCode = 2;
  } else {
    void verifyRelease({
      channel,
      lockPath: resolve(productDirectory, "engine.lock.json"),
      productDirectory,
      environment: process.env,
    }).then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    }).catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
  }
}
