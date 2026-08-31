#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PRODUCT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BROWSER = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SOURCE_FILES = [
  "tests/e2e/development/macos-cursor-ab.spec.ts",
  "tests/e2e/development/cursor-ab-diagnostic.ts",
  "tests/e2e/development/cursor-ab-recorder.ts",
  "tests/e2e/development/cursor-ab-evidence.schema.json",
  "tests/e2e/development/cursor-ab-diagnostic.schema.json",
  "tests/fixtures/desktop-harness/index.html",
  "tests/fixtures/desktop-harness/server.mjs",
  "engine.lock.json",
];
const TEST_KEYS = [
  "CUA_CURSOR_AB_TEST_PLATFORM",
  "CUA_CURSOR_AB_TEST_MACOS_VERSION",
  "CUA_CURSOR_AB_TEST_DOCTOR_JSON",
  "CUA_CURSOR_AB_TEST_BROWSER",
  "CUA_CURSOR_AB_TEST_CHILD_RESULT",
  "CUA_CURSOR_AB_TEST_CHILD_DIAGNOSTIC_RESULT",
  "CUA_CURSOR_AB_TEST_CHILD_EXIT_CODE",
  "CUA_CURSOR_AB_TEST_CHILD_STDOUT",
  "CUA_CURSOR_AB_TEST_CHILD_STDERR",
];

class CursorAbFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
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
  const confirmations = normalized.filter((argument) => argument === "--exclusive-desktop");
  if (confirmations.length === 0) {
    throw new CursorAbFailure("cursor_ab_preflight_failed:exclusive_desktop_confirmation_required");
  }
  if (confirmations.length !== 1) throw new CursorAbFailure("cursor_ab_preflight_failed:invalid_arguments");
  const remaining = normalized.filter((argument) => argument !== "--exclusive-desktop");
  if (remaining.length === 0) return { evidencePath: undefined };
  if (remaining.length !== 2 || remaining[0] !== "--evidence" || remaining[1] === "") {
    throw new CursorAbFailure("cursor_ab_preflight_failed:invalid_arguments");
  }
  return { evidencePath: remaining[1] };
}

function validDoctor(value, lockedVersion) {
  return value?.ok === true && value.platform === "macos" &&
    value.expected_engine_version === lockedVersion && value.reported_engine_version === lockedVersion &&
    value.engine_connected === true && value.required_tools_present === true &&
    value.desktop_unlocked === true && value.observation_succeeded === true &&
    Number.isInteger(value.screenshot?.width) && value.screenshot.width > 0 &&
    Number.isInteger(value.screenshot?.height) && value.screenshot.height > 0;
}

function validSemantics(value) {
  const enabled = value?.modes?.enabled;
  const disabled = value?.modes?.disabled;
  if (enabled === undefined || disabled === undefined) return false;
  for (const mode of [enabled, disabled]) {
    if (
      mode.sample_count !== 30 || mode.correct_count !== 30 ||
      mode.route_counts?.synthetic_events !== 30 ||
      Object.keys(mode.route_counts ?? {}).length !== 1 ||
      mode.p50_ms > mode.p95_ms || mode.p95_ms > mode.max_ms
    ) return false;
  }
  return value.delta_ms?.p50 === disabled.p50_ms - enabled.p50_ms &&
    value.delta_ms?.p95 === disabled.p95_ms - enabled.p95_ms &&
    value.delta_ms?.max === disabled.max_ms - enabled.max_ms;
}

async function validEvidence(value, engineVersion, productVersion) {
  if (
    value?.schema_version !== 1 || value.evidence_type !== "computer-use-macos-cursor-ab" ||
    value.status !== "passed" || value.metadata?.product_version !== productVersion ||
    value.metadata?.engine_version !== engineVersion || value.cleanup_passed !== true
  ) return false;
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const schema = JSON.parse(await readFile(
    join(PRODUCT_DIR, "tests/e2e/development/cursor-ab-evidence.schema.json"),
    "utf8",
  ));
  const validate = new Ajv2020({ allErrors: true, strict: false, validateFormats: false })
    .compile(schema);
  return validate(value) && validSemantics(value);
}

async function validDiagnostic(value) {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const schema = JSON.parse(await readFile(
    join(PRODUCT_DIR, "tests/e2e/development/cursor-ab-diagnostic.schema.json"),
    "utf8",
  ));
  const validate = new Ajv2020({ allErrors: true, strict: false, validateFormats: false })
    .compile(schema);
  return validate(value);
}

async function selectEvidencePath(configured) {
  if (configured !== undefined) {
    if (!isAbsolute(configured)) {
      throw new CursorAbFailure("cursor_ab_preflight_failed:evidence_path_must_be_absolute");
    }
    if (await exists(configured)) throw new CursorAbFailure("cursor_ab_preflight_failed:evidence_path_exists");
    if (await exists(`${configured}.diagnostic.json`)) {
      throw new CursorAbFailure("cursor_ab_preflight_failed:diagnostic_path_exists");
    }
    try {
      await access(dirname(configured));
    } catch {
      throw new CursorAbFailure("cursor_ab_preflight_failed:evidence_parent_missing");
    }
    return { path: configured, temporaryRoot: undefined };
  }
  const temporaryRoot = await mkdtemp(join(tmpdir(), "ucu-cursor-ab-"));
  return { path: join(temporaryRoot, "cursor-ab.json"), temporaryRoot };
}

async function main() {
  const sourceCheckout = await Promise.all(SOURCE_FILES.map((path) => exists(join(PRODUCT_DIR, path))));
  if (sourceCheckout.some((present) => !present)) {
    throw new CursorAbFailure("cursor_ab_preflight_failed:source_checkout_required");
  }
  const { evidencePath } = parseArguments(process.argv.slice(2));
  const testModeRequested = process.env.CUA_CURSOR_AB_TEST_MODE === "1" ||
    TEST_KEYS.some((key) => process.env[key] !== undefined);
  if (testModeRequested && process.env.NODE_ENV !== "test") {
    throw new CursorAbFailure("cursor_ab_preflight_failed:test_injection_forbidden");
  }
  const testMode = process.env.CUA_CURSOR_AB_TEST_MODE === "1";
  const platform = testMode ? process.env.CUA_CURSOR_AB_TEST_PLATFORM : process.platform;
  if (platform !== "darwin") throw new CursorAbFailure("cursor_ab_preflight_failed:darwin_required");
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 19)) {
    throw new CursorAbFailure("cursor_ab_preflight_failed:node_version");
  }
  const hostVersion = testMode
    ? process.env.CUA_CURSOR_AB_TEST_MACOS_VERSION ?? ""
    : (await runProcess("/usr/bin/sw_vers", ["-productVersion"])).stdout.trim();
  if (!/^\d+(?:\.\d+){1,3}$/.test(hostVersion) || Number(hostVersion.split(".")[0]) < 14) {
    throw new CursorAbFailure("cursor_ab_preflight_failed:macos_version");
  }

  const selected = await selectEvidencePath(evidencePath);
  let preserve = false;
  try {
    const lock = JSON.parse(await readFile(join(PRODUCT_DIR, "engine.lock.json"), "utf8"));
    const productVersion = JSON.parse(await readFile(join(PRODUCT_DIR, "package.json"), "utf8")).version;
    if (typeof lock.version !== "string") throw new CursorAbFailure("cursor_ab_preflight_failed:engine_lock_invalid");
    let doctor;
    if (testMode) {
      try {
        doctor = JSON.parse(process.env.CUA_CURSOR_AB_TEST_DOCTOR_JSON ?? "");
      } catch {
        throw new CursorAbFailure("cursor_ab_preflight_failed:doctor_failed");
      }
    } else {
      const build = await runProcess("npm", ["run", "build"]);
      if (build.code !== 0) throw new CursorAbFailure("cursor_ab_preflight_failed:build_failed");
      const checked = await runProcess(process.execPath, ["dist/cli/main.js", "doctor", "--json"]);
      try {
        doctor = checked.code === 0 ? JSON.parse(checked.stdout) : undefined;
      } catch {
        doctor = undefined;
      }
    }
    if (!validDoctor(doctor, lock.version)) throw new CursorAbFailure("cursor_ab_preflight_failed:doctor_failed");
    const browser = testMode
      ? process.env.CUA_CURSOR_AB_TEST_BROWSER
      : process.env.CUA_E2E_BROWSER ?? DEFAULT_BROWSER;
    if (browser === undefined || !isAbsolute(browser)) {
      throw new CursorAbFailure("cursor_ab_preflight_failed:browser_missing");
    }
    try {
      await access(browser);
    } catch {
      throw new CursorAbFailure("cursor_ab_preflight_failed:browser_missing");
    }

    let childFailed = false;
    if (testMode) {
      childFailed = (process.env.CUA_CURSOR_AB_TEST_CHILD_EXIT_CODE ?? "0") !== "0";
      const simulatedEvidence = process.env.CUA_CURSOR_AB_TEST_CHILD_RESULT;
      if (simulatedEvidence !== undefined && simulatedEvidence !== "") {
        try {
          await writeFile(selected.path, `${JSON.stringify(JSON.parse(simulatedEvidence), null, 2)}\n`, {
            flag: "wx",
          });
        } catch (error) {
          if (error?.code === "EEXIST") throw error;
        }
      }
      const simulatedDiagnostic = process.env.CUA_CURSOR_AB_TEST_CHILD_DIAGNOSTIC_RESULT;
      if (simulatedDiagnostic !== undefined && simulatedDiagnostic !== "") {
        try {
          await writeFile(`${selected.path}.diagnostic.json`, `${JSON.stringify(JSON.parse(simulatedDiagnostic), null, 2)}\n`, {
            flag: "wx",
          });
        } catch (error) {
          if (error?.code === "EEXIST") throw error;
        }
      }
    } else {
      const child = await runProcess(process.execPath, [
        join(PRODUCT_DIR, "node_modules/vitest/vitest.mjs"),
        "run",
        "tests/e2e/development/macos-cursor-ab.spec.ts",
        "--sequence.concurrent=false",
        "--reporter=basic",
      ], {
        env: {
          ...process.env,
          CUA_CURSOR_AB_ACCEPTANCE: "1",
          CUA_CURSOR_AB_EVIDENCE_PATH: selected.path,
          CUA_E2E_BROWSER: browser,
        },
      });
      childFailed = child.code !== 0;
    }

    let evidence;
    try {
      evidence = JSON.parse(await readFile(selected.path, "utf8"));
    } catch {
      evidence = undefined;
    }
    if (evidence === undefined || !(await validEvidence(evidence, lock.version, productVersion))) {
      let diagnosticRaw;
      try {
        diagnosticRaw = await readFile(`${selected.path}.diagnostic.json`, "utf8");
      } catch {
        diagnosticRaw = undefined;
      }
      let diagnostic;
      if (diagnosticRaw !== undefined) {
        try {
          diagnostic = JSON.parse(diagnosticRaw);
        } catch {
          diagnostic = undefined;
        }
      }
      if (childFailed && diagnostic !== undefined && await validDiagnostic(diagnostic)) {
        preserve = true;
        throw new CursorAbFailure(`cursor_ab_failed:${diagnostic.error_code}`);
      }
      if (diagnosticRaw !== undefined) {
        await rm(`${selected.path}.diagnostic.json`, { force: true });
      }
      throw new CursorAbFailure("cursor_ab_failed:evidence_missing_or_invalid");
    }
    if (childFailed) {
      await rm(selected.path, { force: true });
      throw new CursorAbFailure("cursor_ab_failed:lane_failed");
    }
    preserve = true;
    process.stdout.write(`${JSON.stringify({ status: "passed", evidence_path: selected.path })}\n`);
  } finally {
    if (!preserve && selected.temporaryRoot !== undefined) {
      await rm(selected.temporaryRoot, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  const code = error instanceof CursorAbFailure ? error.code : "cursor_ab_failed:internal_error";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
