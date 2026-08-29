#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const PRODUCT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BROWSER = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SOURCE_ACCEPTANCE_FILES = [
  "tests/e2e/development/macos-acceptance.spec.ts",
  "tests/e2e/development/evidence.schema.json",
  "tests/fixtures/desktop-harness/server.mjs",
];
const TEST_KEYS = [
  "CUA_ACCEPTANCE_TEST_PLATFORM",
  "CUA_ACCEPTANCE_TEST_MACOS_VERSION",
  "CUA_ACCEPTANCE_TEST_DOCTOR_JSON",
  "CUA_ACCEPTANCE_TEST_BROWSER",
  "CUA_ACCEPTANCE_TEST_CHILD_RESULT",
];

class AcceptanceFailure extends Error {
  constructor(code, diagnostic = "") {
    super(code);
    this.code = code;
    this.diagnostic = diagnostic;
  }
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function runProcess(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: PRODUCT_DIR,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolvePromise({ code, signal, stdout, stderr }));
  });
}

function parseArguments(argv) {
  const normalized = argv[0] === "--" ? argv.slice(1) : argv;
  if (normalized.length === 0) return { evidencePath: undefined };
  if (normalized.length !== 2 || normalized[0] !== "--evidence" || normalized[1] === "") {
    throw new AcceptanceFailure("acceptance_preflight_failed:invalid_arguments");
  }
  return { evidencePath: normalized[1] };
}

function validDoctor(value, lockedVersion) {
  return value?.ok === true &&
    value.platform === "macos" &&
    value.expected_engine_version === lockedVersion &&
    value.reported_engine_version === lockedVersion &&
    value.engine_connected === true &&
    value.required_tools_present === true &&
    value.desktop_unlocked === true &&
    value.observation_succeeded === true &&
    Number.isInteger(value.screenshot?.width) && value.screenshot.width > 0 &&
    Number.isInteger(value.screenshot?.height) && value.screenshot.height > 0;
}

async function validEvidence(value) {
  if (!(value?.schema_version === 1 &&
    value.evidence_type === "computer-use-macos-development-acceptance" &&
    (value.status === "passed" || value.status === "degraded") &&
    typeof value.cleanup_passed === "boolean")) return false;
  const schema = JSON.parse(await readFile(
    join(PRODUCT_DIR, "tests/e2e/development/evidence.schema.json"),
    "utf8",
  ));
  const { oneOf, ...strictBase } = schema;
  if (!Array.isArray(oneOf)) return false;
  const parser = z.pipe(
    z.fromJSONSchema(strictBase),
    z.fromJSONSchema(schema),
  );
  return parser.safeParse(value).success;
}

async function selectEvidencePath(configured) {
  if (configured !== undefined) {
    if (!isAbsolute(configured)) {
      throw new AcceptanceFailure("acceptance_preflight_failed:evidence_path_must_be_absolute");
    }
    if (await exists(configured)) {
      throw new AcceptanceFailure("acceptance_preflight_failed:evidence_path_exists");
    }
    try {
      await access(dirname(configured));
    } catch {
      throw new AcceptanceFailure("acceptance_preflight_failed:evidence_parent_missing");
    }
    return { path: configured, temporaryRoot: undefined };
  }
  const temporaryRoot = await mkdtemp(join(tmpdir(), "ucu-acceptance-"));
  return { path: join(temporaryRoot, "macos-development.json"), temporaryRoot };
}

async function main() {
  const sourceCheckout = await Promise.all(
    SOURCE_ACCEPTANCE_FILES.map((path) => exists(join(PRODUCT_DIR, path))),
  );
  if (sourceCheckout.some((present) => !present)) {
    throw new AcceptanceFailure("acceptance_preflight_failed:source_checkout_required");
  }

  const testModeRequested = process.env.CUA_ACCEPTANCE_TEST_MODE === "1" ||
    TEST_KEYS.some((key) => process.env[key] !== undefined);
  if (testModeRequested && process.env.NODE_ENV !== "test") {
    throw new AcceptanceFailure("acceptance_preflight_failed:test_injection_forbidden");
  }
  const testMode = process.env.CUA_ACCEPTANCE_TEST_MODE === "1";
  const platform = testMode ? process.env.CUA_ACCEPTANCE_TEST_PLATFORM : process.platform;
  if (platform !== "darwin") {
    throw new AcceptanceFailure("acceptance_preflight_failed:darwin_required");
  }

  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 19)) {
    throw new AcceptanceFailure("acceptance_preflight_failed:node_version");
  }

  let hostVersion;
  if (testMode) {
    hostVersion = process.env.CUA_ACCEPTANCE_TEST_MACOS_VERSION ?? "";
  } else {
    const checkedVersion = await runProcess("/usr/bin/sw_vers", ["-productVersion"]);
    if (checkedVersion.code !== 0) {
      throw new AcceptanceFailure("acceptance_preflight_failed:macos_version");
    }
    hostVersion = checkedVersion.stdout.trim();
  }
  const versionMatch = /^(\d+)(?:\.\d+){1,3}$/.exec(hostVersion);
  if (versionMatch === null || Number(versionMatch[1]) < 14) {
    throw new AcceptanceFailure("acceptance_preflight_failed:macos_version");
  }

  const { evidencePath: configuredPath } = parseArguments(process.argv.slice(2));
  const selected = await selectEvidencePath(configuredPath);
  let completed = false;
  try {
    const lock = JSON.parse(await readFile(join(PRODUCT_DIR, "engine.lock.json"), "utf8"));
    if (typeof lock.version !== "string") {
      throw new AcceptanceFailure("acceptance_preflight_failed:engine_lock_invalid");
    }

    let doctor;
    if (testMode) {
      try {
        doctor = JSON.parse(process.env.CUA_ACCEPTANCE_TEST_DOCTOR_JSON ?? "");
      } catch {
        throw new AcceptanceFailure("acceptance_preflight_failed:doctor_failed");
      }
    } else {
      const build = await runProcess("npx", ["--yes", "pnpm@9.0.4", "build"]);
      if (build.code !== 0) {
        throw new AcceptanceFailure("acceptance_preflight_failed:build_failed", build.stderr || build.stdout);
      }
      const checked = await runProcess(process.execPath, ["dist/cli/main.js", "doctor", "--json"]);
      if (checked.code !== 0) {
        throw new AcceptanceFailure("acceptance_preflight_failed:doctor_failed", checked.stderr);
      }
      try {
        doctor = JSON.parse(checked.stdout);
      } catch {
        throw new AcceptanceFailure("acceptance_preflight_failed:doctor_failed");
      }
    }
    if (!validDoctor(doctor, lock.version)) {
      throw new AcceptanceFailure("acceptance_preflight_failed:doctor_failed");
    }

    const browser = testMode
      ? process.env.CUA_ACCEPTANCE_TEST_BROWSER
      : process.env.CUA_E2E_BROWSER ?? DEFAULT_BROWSER;
    if (browser === undefined || !isAbsolute(browser)) {
      throw new AcceptanceFailure("acceptance_preflight_failed:browser_missing");
    }
    try {
      await access(browser);
    } catch {
      throw new AcceptanceFailure("acceptance_preflight_failed:browser_missing");
    }

    if (testMode) {
      let simulated;
      try {
        simulated = JSON.parse(process.env.CUA_ACCEPTANCE_TEST_CHILD_RESULT ?? "");
      } catch {
        throw new AcceptanceFailure("acceptance_failed:acceptance_lane_failed");
      }
      await writeFile(selected.path, `${JSON.stringify(simulated, null, 2)}\n`, { flag: "wx" });
    } else {
      const child = await runProcess(
        "npx",
        [
          "--yes", "pnpm@9.0.4", "exec", "vitest", "run",
          "tests/e2e/development/macos-acceptance.spec.ts",
          "--sequence.concurrent=false", "--reporter=basic",
        ],
        {
          env: {
            ...process.env,
            CUA_DEVELOPMENT_ACCEPTANCE: "1",
            CUA_DEVELOPMENT_EVIDENCE_PATH: selected.path,
            CUA_E2E_BROWSER: browser,
          },
        },
      );
      if (child.code !== 0) {
        throw new AcceptanceFailure(
          "acceptance_failed:acceptance_lane_failed",
          [child.stdout, child.stderr].filter(Boolean).join("\n"),
        );
      }
    }

    let evidence;
    try {
      evidence = JSON.parse(await readFile(selected.path, "utf8"));
    } catch {
      throw new AcceptanceFailure("acceptance_failed:evidence_missing_or_invalid");
    }
    if (evidence.cleanup_passed !== true) {
      throw new AcceptanceFailure("acceptance_failed:cleanup_failed");
    }
    if (!(await validEvidence(evidence))) {
      throw new AcceptanceFailure("acceptance_failed:evidence_missing_or_invalid");
    }

    completed = true;
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      evidence_path: selected.path,
      cleanup_passed: evidence.cleanup_passed,
    })}\n`);
  } finally {
    if (!completed && selected.temporaryRoot !== undefined) {
      await rm(selected.temporaryRoot, { recursive: true, force: true });
    }
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof AcceptanceFailure) {
    if (error.diagnostic !== "") process.stderr.write(`${error.diagnostic.trim()}\n`);
    process.stderr.write(`${error.code}\n`);
  } else {
    process.stderr.write("acceptance_failed:unexpected_error\n");
  }
  process.exitCode = 1;
}
