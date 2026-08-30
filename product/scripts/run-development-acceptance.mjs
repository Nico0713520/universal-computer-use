#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PRODUCT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BROWSER = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SOURCE_ACCEPTANCE_FILES = [
  "tests/e2e/development/macos-acceptance.spec.ts",
  "tests/e2e/development/macos-acceptance-support.ts",
  "tests/e2e/development/macos-acceptance-result-checks.ts",
  "tests/e2e/development/correctness-orchestration.ts",
  "tests/e2e/development/acceptance-recorder.ts",
  "tests/e2e/development/macos-real-app-smoke.ts",
  "tests/e2e/development/macos-visual-text-oracle.ts",
  "tests/e2e/development/macos-acceptance-telemetry.ts",
  "tests/e2e/development/performance-classification.ts",
  "tests/e2e/development/performance-preparation.ts",
  "tests/e2e/development/performance-recorder.ts",
  "tests/e2e/development/evidence.schema.json",
  "tests/e2e/development/fatal-diagnostic.ts",
  "tests/e2e/development/fatal-diagnostic.schema.json",
  "tests/helpers/fixed-delay-scan.ts",
  "tests/fixtures/focus-sentinel/main.swift",
  "tests/fixtures/focus-sentinel/Info.plist",
  "tests/fixtures/vision-ocr/main.swift",
  "tests/fixtures/desktop-harness/index.html",
  "tests/fixtures/desktop-harness/server.mjs",
  "skills/computer-use/SKILL.md",
];
const TEST_KEYS = [
  "CUA_ACCEPTANCE_TEST_PLATFORM",
  "CUA_ACCEPTANCE_TEST_MACOS_VERSION",
  "CUA_ACCEPTANCE_TEST_DOCTOR_JSON",
  "CUA_ACCEPTANCE_TEST_BROWSER",
  "CUA_ACCEPTANCE_TEST_CHILD_RESULT",
  "CUA_ACCEPTANCE_TEST_CHILD_EXIT_CODE",
  "CUA_ACCEPTANCE_TEST_CHILD_OMIT_EVIDENCE",
  "CUA_ACCEPTANCE_TEST_CHILD_DIAGNOSTIC",
  "CUA_ACCEPTANCE_TEST_CHILD_DIAGNOSTIC_RESULT",
];

class AcceptanceFailure extends Error {
  constructor(code, diagnostic = "") {
    super(code);
    this.code = code;
    this.diagnostic = diagnostic;
  }
}

async function compileSourceOnlySchema(schema) {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  return new Ajv2020({ allErrors: true, strict: false, validateFormats: false })
    .compile(schema);
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

async function validEvidence(value, lockedVersion, productVersion) {
  if (!(value?.schema_version === 3 &&
    value.evidence_type === "computer-use-macos-development-acceptance" &&
    (value.status === "passed" || value.status === "degraded" || value.status === "failed") &&
    value.metadata?.product_version === productVersion &&
    value.metadata?.protocol_version === "1.2.0" &&
    value.metadata?.engine_version === lockedVersion &&
    typeof value.cleanup_passed === "boolean")) return false;
  const schema = JSON.parse(await readFile(
    join(PRODUCT_DIR, "tests/e2e/development/evidence.schema.json"),
    "utf8",
  ));
  const validate = await compileSourceOnlySchema(schema);
  return validate(value) && validEvidenceSemantics(value);
}

function validEvidenceSemantics(value) {
  const slo = {
    window_visual_observe: [700, 1500, false],
    window_semantic_observe: [400, 1000, false],
    semantic_action_next_state: [1500, 2000, true],
    pixel_action_next_state: [1500, 3000, true],
  };
  for (const [name, [p50Slo, p95Slo, action]] of Object.entries(slo)) {
    const profile = value.performance?.[name];
    const correct = profile?.correct_count;
    const failed = profile?.failed_count;
    const latencyStatus = profile?.p50_ms <= p50Slo && profile?.p95_ms <= p95Slo
      ? "passed"
      : "failed";
    const correctnessStatus = correct === 30 ? "passed" : "failed";
    const status = latencyStatus === "passed" && correctnessStatus === "passed"
      ? "passed"
      : "failed";
    if (!Number.isInteger(correct) || !Number.isInteger(failed) || correct + failed !== 30 ||
      profile.success_rate !== correct / 30 || profile.latency_status !== latencyStatus ||
      profile.correctness_status !== correctnessStatus || profile.status !== status ||
      Object.values(profile.failure_counts ?? {}).reduce((sum, count) => sum + count, 0) !== failed ||
      profile.p50_ms > profile.p95_ms || profile.p95_ms > profile.max_ms) return false;
    const requiredStages = [
      "queue_wait", ...(action ? ["engine_execute"] : []), "post_action_observe",
      "projection", "tool_total", "transport_overhead",
    ];
    for (const stage of Object.values(profile.stages ?? {})) {
      if (stage.p50_ms > stage.p95_ms || stage.p95_ms > stage.max_ms) return false;
    }
    if (status === "passed" && requiredStages.some(
      (stageName) => profile.stages?.[stageName]?.sample_count !== 30,
    )) return false;
  }
  const allScenariosPassed = Object.values(value.scenarios).every((passed) => passed === true);
  const performancePassed = Object.values(value.performance).every((profile) => profile.status === "passed");
  const adaptivePassed = Object.values(value.adaptive_correctness).every((passed) => passed === true);
  const smoke = value.real_app_smoke;
  const smokePassed = smoke.calculator_703 === true && smoke.textedit_unique_value === true &&
    smoke.textedit_single_write === true && smoke.error_code === undefined &&
    smoke.cleanup_failed === undefined;
  const expectedStatus = !allScenariosPassed || value.timings.some((timing) => timing.status === "failed") ||
    !performancePassed || !adaptivePassed || !smokePassed
    ? "failed"
    : value.timings.some((timing) => timing.status === "degraded") ? "degraded" : "passed";
  return value.status === expectedStatus;
}

async function validDiagnostic(value) {
  if (value?.schema_version !== 1 ||
    value.evidence_type !== "computer-use-macos-development-fatal-diagnostic" ||
    value.status !== "failed") return false;
  const schema = JSON.parse(await readFile(
    join(PRODUCT_DIR, "tests/e2e/development/fatal-diagnostic.schema.json"),
    "utf8",
  ));
  return (await compileSourceOnlySchema(schema))(value);
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
    const diagnosticPath = `${configured}.diagnostic.json`;
    if (await exists(diagnosticPath)) {
      throw new AcceptanceFailure("acceptance_preflight_failed:diagnostic_path_exists");
    }
    return { path: configured, diagnosticPath, temporaryRoot: undefined };
  }
  const temporaryRoot = await mkdtemp(join(tmpdir(), "ucu-acceptance-"));
  const path = join(temporaryRoot, "macos-development.json");
  return { path, diagnosticPath: `${path}.diagnostic.json`, temporaryRoot };
}

async function main() {
  const sourceCheckout = await Promise.all(
    SOURCE_ACCEPTANCE_FILES.map((path) => exists(join(PRODUCT_DIR, path))),
  );
  if (sourceCheckout.some((present) => !present)) {
    throw new AcceptanceFailure("acceptance_preflight_failed:source_checkout_required");
  }
  const productVersion = JSON.parse(
    await readFile(join(PRODUCT_DIR, "package.json"), "utf8"),
  ).version;

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
      const build = await runProcess("npm", ["run", "build"]);
      if (build.code !== 0) {
        throw new AcceptanceFailure("acceptance_preflight_failed:build_failed");
      }
      const checked = await runProcess(process.execPath, ["dist/cli/main.js", "doctor", "--json"]);
      if (checked.code !== 0) {
        throw new AcceptanceFailure("acceptance_preflight_failed:doctor_failed");
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

    let childFailed = false;
    if (testMode) {
      let simulated;
      try {
        simulated = JSON.parse(process.env.CUA_ACCEPTANCE_TEST_CHILD_RESULT ?? "");
      } catch {
        throw new AcceptanceFailure("acceptance_failed:acceptance_lane_failed");
      }
      if (process.env.CUA_ACCEPTANCE_TEST_CHILD_OMIT_EVIDENCE !== "1") {
        await writeFile(selected.path, `${JSON.stringify(simulated, null, 2)}\n`, { flag: "wx" });
      }
      if (process.env.CUA_ACCEPTANCE_TEST_CHILD_DIAGNOSTIC_RESULT !== undefined) {
        let diagnostic;
        try {
          diagnostic = JSON.parse(process.env.CUA_ACCEPTANCE_TEST_CHILD_DIAGNOSTIC_RESULT);
        } catch {
          diagnostic = { invalid: true };
        }
        await writeFile(selected.diagnosticPath, `${JSON.stringify(diagnostic, null, 2)}\n`, { flag: "wx" });
      }
      const simulatedExitCode = process.env.CUA_ACCEPTANCE_TEST_CHILD_EXIT_CODE ?? "0";
      if (simulatedExitCode !== "0" && simulatedExitCode !== "1") {
        throw new AcceptanceFailure("acceptance_failed:acceptance_lane_failed");
      }
      childFailed = simulatedExitCode === "1";
    } else {
      const child = await runProcess(
        process.execPath,
        [
          join(PRODUCT_DIR, "node_modules/vitest/vitest.mjs"), "run",
          "tests/e2e/development/macos-acceptance.spec.ts",
          "--sequence.concurrent=false", "--reporter=basic",
        ],
        {
          env: {
            ...process.env,
            CUA_DEVELOPMENT_ACCEPTANCE: "1",
            CUA_DEVELOPMENT_EVIDENCE_PATH: selected.path,
            CUA_DEVELOPMENT_DIAGNOSTIC_PATH: selected.diagnosticPath,
            CUA_E2E_BROWSER: browser,
          },
        },
      );
      childFailed = child.code !== 0;
    }

    const evidencePresent = await exists(selected.path);
    const diagnosticPresent = await exists(selected.diagnosticPath);
    if (evidencePresent && diagnosticPresent) {
      completed = true;
      throw new AcceptanceFailure(
        "acceptance_failed:artifact_conflict",
        JSON.stringify({
          status: "failed",
          evidence_path: selected.path,
          diagnostic_path: selected.diagnosticPath,
        }),
      );
    }

    let evidence;
    try {
      evidence = JSON.parse(await readFile(selected.path, "utf8"));
    } catch {
      if (diagnosticPresent) {
        let diagnostic;
        try {
          diagnostic = JSON.parse(await readFile(selected.diagnosticPath, "utf8"));
        } catch {
          throw new AcceptanceFailure("acceptance_failed:evidence_missing_or_invalid");
        }
        if (await validDiagnostic(diagnostic)) {
          completed = true;
          throw new AcceptanceFailure(
            "acceptance_failed:fatal_diagnostic",
            JSON.stringify({
              status: "failed",
              diagnostic_path: selected.diagnosticPath,
              cleanup_passed: diagnostic.cleanup_passed,
            }),
          );
        }
      }
      throw new AcceptanceFailure("acceptance_failed:evidence_missing_or_invalid");
    }
    if (evidence.cleanup_passed !== true) {
      throw new AcceptanceFailure("acceptance_failed:cleanup_failed");
    }
    if (!(await validEvidence(evidence, lock.version, productVersion))) {
      throw new AcceptanceFailure("acceptance_failed:evidence_missing_or_invalid");
    }

    if (evidence.status === "failed") {
      completed = true;
      throw new AcceptanceFailure(
        "acceptance_failed:gate_failed",
        JSON.stringify({
          status: evidence.status,
          evidence_path: selected.path,
          cleanup_passed: evidence.cleanup_passed,
        }),
      );
    }
    if (childFailed) {
      throw new AcceptanceFailure("acceptance_failed:acceptance_lane_failed");
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
