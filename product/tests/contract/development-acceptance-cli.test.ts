import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = resolve("scripts/run-development-acceptance.mjs");
const temporaryRoots: string[] = [];

type RunResult = Readonly<{ code: number | null; stdout: string; stderr: string }>;

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function successfulDoctor(): Record<string, unknown> {
  return {
    ok: true,
    platform: "macos",
    expected_engine_version: "0.22.2",
    reported_engine_version: "0.22.2",
    engine_connected: true,
    required_tools_present: true,
    desktop_unlocked: true,
    observation_succeeded: true,
    screenshot: { width: 1920, height: 1080 },
  };
}

function performanceStages(action: boolean): Record<string, unknown> {
  const summary = (p50: number, p95: number, max: number) => ({
    sample_count: 30,
    p50_ms: p50,
    p95_ms: p95,
    max_ms: max,
  });
  return {
    queue_wait: summary(1, 2, 3),
    ...(action ? { engine_execute: summary(20, 25, 30) } : {}),
    post_action_observe: summary(50, 60, 70),
    projection: summary(2, 3, 4),
    tool_total: summary(55, 65, 75),
    transport_overhead: summary(5, 6, 7),
  };
}

function performanceProfile(
  p50: number,
  p95: number,
  max: number,
  sloP50: number,
  sloP95: number,
  action: boolean,
): Record<string, unknown> {
  return {
    sample_count: 30,
    correct_count: 30,
    failed_count: 0,
    success_rate: 1,
    p50_ms: p50,
    p95_ms: p95,
    max_ms: max,
    slo: { p50_ms: sloP50, p95_ms: sloP95 },
    latency_status: "passed",
    correctness_status: "passed",
    failure_counts: {},
    stages: performanceStages(action),
    status: "passed",
  };
}

function simulatedEvidence(cleanupPassed = true): Record<string, unknown> {
  return {
    schema_version: 3,
    evidence_type: "computer-use-macos-development-acceptance",
    status: "passed",
    metadata: {
      product_version: "0.2.3",
      protocol_version: "1.2.0",
      engine_version: "0.22.2",
      macos_version: "15.6.1",
      architecture: "arm64",
    },
    scenarios: {
      two_tool_inventory: true,
      desktop_png: true,
      fresh_snapshot: true,
      stale_snapshot_rejected: true,
      exact_window_discovered: true,
      window_png_and_element: true,
      background_element_effect: true,
      window_coordinate_effect: true,
      old_refs_rejected_after_reconnect: true,
    },
    timings: [
      { name: "mcp_start", duration_ms: 100, target_ms: 2_000, hard_limit_ms: 10_000, status: "target_met" },
      { name: "desktop_observe", duration_ms: 100, target_ms: 1_000, hard_limit_ms: 3_000, status: "target_met" },
      { name: "window_discover", duration_ms: 100, target_ms: 1_000, hard_limit_ms: 3_000, status: "target_met" },
      { name: "window_observe", duration_ms: 100, target_ms: 1_000, hard_limit_ms: 3_000, status: "target_met" },
      { name: "coordinate_action", duration_ms: 100, target_ms: 1_000, hard_limit_ms: 3_000, status: "target_met" },
      { name: "element_action", duration_ms: 100, target_ms: 3_000, hard_limit_ms: 8_000, status: "target_met" },
      { name: "mcp_reconnect", duration_ms: 100, target_ms: 2_000, hard_limit_ms: 10_000, status: "target_met" },
    ],
    performance: {
      window_visual_observe: performanceProfile(100, 200, 300, 700, 1_500, false),
      window_semantic_observe: performanceProfile(100, 200, 300, 400, 1_000, false),
      semantic_action_next_state: performanceProfile(100, 200, 300, 1_500, 2_000, true),
      pixel_action_next_state: performanceProfile(100, 200, 300, 1_500, 3_000, true),
    },
    adaptive_correctness: {
      no_fixed_action_delay: true,
      semantic_sequence: true,
      pixel_once: true,
      unique_input_once: true,
      visual_recovery_once: true,
      focus_preserved: true,
    },
    real_app_smoke: {
      calculator_703: true,
      textedit_unique_value: true,
      textedit_single_write: true,
    },
    cleanup_passed: cleanupPassed,
    timestamp: "2026-08-29T12:34:56.000Z",
  };
}

function simulatedDiagnostic(): Record<string, unknown> {
  return {
    schema_version: 1,
    evidence_type: "computer-use-macos-development-fatal-diagnostic",
    status: "failed",
    phase: "performance",
    scenario: "semantic_action_next_state",
    sample_kind: "measured",
    sample_index: 4,
    error_code: "fixture_reset_ack_timeout",
    elapsed_ms: 103_000,
    owned_processes: { fixture: false, browser: false, sentinel: false, mcp: false },
    last_tool: { name: "computer_act", error_code: null },
    cleanup_passed: true,
    timestamp: "2026-08-30T00:00:00.000Z",
  };
}

function failedEvidence(
  mutate: (evidence: Record<string, unknown>) => void,
): Record<string, unknown> {
  const evidence = simulatedEvidence();
  evidence.status = "failed";
  mutate(evidence);
  return evidence;
}

async function run(
  evidencePath: string | undefined,
  overrides: NodeJS.ProcessEnv = {},
  extraArgs: readonly string[] = [],
  packageManagerSeparator = false,
): Promise<RunResult> {
  const child = spawn(process.execPath, [
    SCRIPT,
    ...(packageManagerSeparator ? ["--"] : []),
    ...(evidencePath === undefined ? [] : ["--evidence", evidencePath]),
    ...extraArgs,
  ], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "test",
      CUA_ACCEPTANCE_TEST_MODE: "1",
      CUA_ACCEPTANCE_TEST_PLATFORM: "darwin",
      CUA_ACCEPTANCE_TEST_MACOS_VERSION: "15.6.1",
      CUA_ACCEPTANCE_TEST_DOCTOR_JSON: JSON.stringify(successfulDoctor()),
      CUA_ACCEPTANCE_TEST_BROWSER: process.execPath,
      CUA_ACCEPTANCE_TEST_CHILD_RESULT: JSON.stringify(simulatedEvidence()),
      ...overrides,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const [code] = await once(child, "exit");
  return { code: typeof code === "number" ? code : null, stdout, stderr };
}

async function fixturePath(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ucu-acceptance-cli-test-"));
  temporaryRoots.push(root);
  return join(root, name);
}

describe("macOS development acceptance launcher", () => {
  it("uses checkout-local build and test tooling without a registry lookup", async () => {
    const source = await readFile(SCRIPT, "utf8");

    expect(source).not.toContain('runProcess("npx"');
    expect(source).toContain('runProcess("npm", ["run", "build"]');
    expect(source).toContain('node_modules/vitest/vitest.mjs');
  });

  it("refuses an installed-package layout before loading source-only Ajv", async () => {
    const root = await mkdtemp(join(tmpdir(), "ucu-acceptance-installed-test-"));
    temporaryRoots.push(root);
    const copiedScript = join(root, "scripts", "run-development-acceptance.mjs");
    await mkdir(dirname(copiedScript), { recursive: true });
    await copyFile(SCRIPT, copiedScript);
    const child = spawn(process.execPath, [copiedScript], {
      cwd: root,
      env: { PATH: process.env.PATH, NODE_ENV: "production" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    const [code] = await once(child, "exit");

    expect({ code, stdout, stderr }).toEqual({
      code: 1,
      stdout: "",
      stderr: "acceptance_preflight_failed:source_checkout_required\n",
    });
  });

  it("fails before creating evidence on a non-macOS host", async () => {
    const path = await fixturePath("evidence.json");
    const result = await run(path, { CUA_ACCEPTANCE_TEST_PLATFORM: "win32" });

    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: "acceptance_preflight_failed:darwin_required\n",
    });
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stops on a failed doctor before the child lane can write evidence", async () => {
    const path = await fixturePath("evidence.json");
    const result = await run(path, {
      CUA_ACCEPTANCE_TEST_DOCTOR_JSON: JSON.stringify({ ...successfulDoctor(), ok: false }),
      CUA_ACCEPTANCE_TEST_CHILD_RESULT: "not-json-and-must-not-be-read",
    });

    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: "acceptance_preflight_failed:doctor_failed\n",
    });
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects macOS versions older than the supported development floor", async () => {
    const path = await fixturePath("evidence.json");
    const result = await run(path, { CUA_ACCEPTANCE_TEST_MACOS_VERSION: "13.7.8" });

    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: "acceptance_preflight_failed:macos_version\n",
    });
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes a new external record and emits one machine-readable summary", async () => {
    const path = await fixturePath("evidence.json");
    const result = await run(path);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      status: "passed",
      evidence_path: path,
      cleanup_passed: true,
    });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(simulatedEvidence());
    expect(await readFile(path, "utf8")).not.toContain(path);
  });

  it("accepts the package-manager argument separator used by the documented command", async () => {
    const path = await fixturePath("evidence.json");
    const result = await run(path, {}, [], true);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "passed", evidence_path: path });
  });

  it("refuses to overwrite an existing evidence path", async () => {
    const path = await fixturePath("evidence.json");
    await writeFile(path, "owned-by-user\n");
    const result = await run(path);

    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: "acceptance_preflight_failed:evidence_path_exists\n",
    });
    expect(await readFile(path, "utf8")).toBe("owned-by-user\n");
  });

  it("refuses to start when the sibling diagnostic path already exists", async () => {
    const path = await fixturePath("evidence.json");
    const diagnosticPath = `${path}.diagnostic.json`;
    await writeFile(diagnosticPath, "owned-by-user\n");
    const result = await run(path);

    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: "acceptance_preflight_failed:diagnostic_path_exists\n",
    });
    expect(await readFile(diagnosticPath, "utf8")).toBe("owned-by-user\n");
  });

  it("turns a child cleanup failure into a nonzero stable result", async () => {
    const path = await fixturePath("evidence.json");
    const result = await run(path, {
      CUA_ACCEPTANCE_TEST_CHILD_RESULT: JSON.stringify(simulatedEvidence(false)),
    });

    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: "acceptance_failed:cleanup_failed\n",
    });
  });

  it("rejects a child record that violates the redacted evidence schema", async () => {
    const path = await fixturePath("evidence.json");
    const malformed = { ...simulatedEvidence(), screenshot: "private-png" };
    const result = await run(path, {
      CUA_ACCEPTANCE_TEST_CHILD_RESULT: JSON.stringify(malformed),
    });

    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: "acceptance_failed:evidence_missing_or_invalid\n",
    });
  });

  it.each([
    ["protocol", "protocol_version", "9.9.9"],
    ["engine", "engine_version", "9.9.9"],
  ])("rejects evidence with the wrong frozen %s version", async (_label, field, version) => {
    const path = await fixturePath("evidence.json");
    const malformed = simulatedEvidence();
    (malformed.metadata as Record<string, unknown>)[field] = version;
    const result = await run(path, {
      CUA_ACCEPTANCE_TEST_CHILD_RESULT: JSON.stringify(malformed),
    });

    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: "acceptance_failed:evidence_missing_or_invalid\n",
    });
  });

  it("accepts the measured semantic-action p50 between the old and current baseline", async () => {
    const path = await fixturePath("evidence.json");
    const evidence = simulatedEvidence();
    const profile = (evidence.performance as Record<string, Record<string, unknown>>)
      .semantic_action_next_state;
    profile.p50_ms = 1_200;
    profile.p95_ms = 1_300;
    profile.max_ms = 1_400;

    const result = await run(path, {
      CUA_ACCEPTANCE_TEST_CHILD_RESULT: JSON.stringify(evidence),
    });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "passed", evidence_path: path });
  });

  it("accepts one truthful pixel oracle miss while preserving the raw count", async () => {
    const path = await fixturePath("evidence.json");
    const evidence = simulatedEvidence();
    const profile = (evidence.performance as Record<string, Record<string, unknown>>)
      .pixel_action_next_state;
    profile.correct_count = 29;
    profile.failed_count = 1;
    profile.success_rate = 29 / 30;
    profile.failure_counts = { oracle_mismatch: 1 };

    const result = await run(path, {
      CUA_ACCEPTANCE_TEST_CHILD_RESULT: JSON.stringify(evidence),
    });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "passed", evidence_path: path });
    expect((JSON.parse(await readFile(path, "utf8")).performance as Record<string, unknown>)
      .pixel_action_next_state).toMatchObject({
        correct_count: 29,
        failed_count: 1,
        failure_counts: { oracle_mismatch: 1 },
      });
  });

  it("does not leak raw child stderr when no validated artifact exists", async () => {
    const path = await fixturePath("evidence.json");
    const result = await run(path, {
      CUA_ACCEPTANCE_TEST_CHILD_OMIT_EVIDENCE: "1",
      CUA_ACCEPTANCE_TEST_CHILD_DIAGNOSTIC: "/private/user/secret stack and typed text",
      CUA_ACCEPTANCE_TEST_CHILD_EXIT_CODE: "1",
    });

    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: "acceptance_failed:evidence_missing_or_invalid\n",
    });
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("accepts only a strict fatal diagnostic, prints its path, and never treats it as evidence", async () => {
    const path = await fixturePath("evidence.json");
    const diagnosticPath = `${path}.diagnostic.json`;
    const result = await run(path, {
      CUA_ACCEPTANCE_TEST_CHILD_OMIT_EVIDENCE: "1",
      CUA_ACCEPTANCE_TEST_CHILD_DIAGNOSTIC_RESULT: JSON.stringify(simulatedDiagnostic()),
      CUA_ACCEPTANCE_TEST_CHILD_EXIT_CODE: "1",
    });

    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: `${JSON.stringify({
        status: "failed",
        diagnostic_path: diagnosticPath,
        cleanup_passed: true,
      })}\nacceptance_failed:fatal_diagnostic\n`,
    });
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(diagnosticPath, "utf8"))).toEqual(simulatedDiagnostic());
  });

  it("preserves an auto-created private directory when it contains a valid diagnostic", async () => {
    const result = await run(undefined, {
      CUA_ACCEPTANCE_TEST_CHILD_OMIT_EVIDENCE: "1",
      CUA_ACCEPTANCE_TEST_CHILD_DIAGNOSTIC_RESULT: JSON.stringify(simulatedDiagnostic()),
      CUA_ACCEPTANCE_TEST_CHILD_EXIT_CODE: "1",
    });
    const [summary] = result.stderr.trim().split("\n");
    const diagnosticPath = (JSON.parse(summary!) as { diagnostic_path: string }).diagnostic_path;
    temporaryRoots.push(dirname(diagnosticPath));

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(await readFile(diagnosticPath, "utf8"))).toEqual(simulatedDiagnostic());
  });

  it("fails closed when evidence and a diagnostic coexist", async () => {
    const path = await fixturePath("evidence.json");
    const result = await run(path, {
      CUA_ACCEPTANCE_TEST_CHILD_DIAGNOSTIC_RESULT: JSON.stringify(simulatedDiagnostic()),
    });

    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: `${JSON.stringify({
        status: "failed",
        evidence_path: path,
        diagnostic_path: `${path}.diagnostic.json`,
      })}\nacceptance_failed:artifact_conflict\n`,
    });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(simulatedEvidence());
    expect(JSON.parse(await readFile(`${path}.diagnostic.json`, "utf8"))).toEqual(simulatedDiagnostic());
  });

  it("prints both preserved paths when conflicting artifacts coexist in an auto-created directory", async () => {
    const result = await run(undefined, {
      CUA_ACCEPTANCE_TEST_CHILD_DIAGNOSTIC_RESULT: JSON.stringify(simulatedDiagnostic()),
    });
    const [summaryLine, failureLine] = result.stderr.trim().split("\n");
    const summary = JSON.parse(summaryLine!) as {
      status: string;
      evidence_path: string;
      diagnostic_path: string;
    };
    temporaryRoots.push(dirname(summary.evidence_path));

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(failureLine).toBe("acceptance_failed:artifact_conflict");
    expect(summary).toEqual({
      status: "failed",
      evidence_path: summary.evidence_path,
      diagnostic_path: `${summary.evidence_path}.diagnostic.json`,
    });
    expect(JSON.parse(await readFile(summary.evidence_path, "utf8"))).toEqual(simulatedEvidence());
    expect(JSON.parse(await readFile(summary.diagnostic_path, "utf8"))).toEqual(simulatedDiagnostic());
  });

  it.each([
    ["failed performance profile", failedEvidence((evidence) => {
      const profile = (evidence.performance as Record<string, Record<string, unknown>>)
        .window_visual_observe;
      profile.latency_status = "failed";
      profile.status = "failed";
      profile.p50_ms = 701;
      profile.p95_ms = 800;
      profile.max_ms = 900;
    })],
    ["false Calculator smoke", failedEvidence((evidence) => {
      const smoke = evidence.real_app_smoke as Record<string, unknown>;
      smoke.calculator_703 = false;
      smoke.error_code = "calculator_unavailable";
    })],
    ["false TextEdit smoke", failedEvidence((evidence) => {
      const smoke = evidence.real_app_smoke as Record<string, unknown>;
      smoke.textedit_unique_value = false;
      smoke.textedit_single_write = false;
      smoke.error_code = "textedit_unavailable";
    })],
    ["unsupported locale", failedEvidence((evidence) => {
      const smoke = evidence.real_app_smoke as Record<string, unknown>;
      smoke.textedit_unique_value = false;
      smoke.textedit_single_write = false;
      smoke.error_code = "unsupported_locale";
    })],
    ["old hard timing failure", failedEvidence((evidence) => {
      const timing = (evidence.timings as Array<Record<string, unknown>>)[5]!;
      timing.duration_ms = 8_001;
      timing.status = "failed";
    })],
    ["false adaptive correctness", failedEvidence((evidence) => {
      const adaptive = evidence.adaptive_correctness as Record<string, unknown>;
      adaptive.visual_recovery_once = false;
    })],
    ["real-app cleanup failure", failedEvidence((evidence) => {
      (evidence.real_app_smoke as Record<string, unknown>).cleanup_failed = true;
    })],
  ])("retains schema-valid failed evidence for %s and exits nonzero", async (_label, evidence) => {
    const path = await fixturePath("evidence.json");
    const result = await run(path, {
      CUA_ACCEPTANCE_TEST_CHILD_RESULT: JSON.stringify(evidence),
      CUA_ACCEPTANCE_TEST_CHILD_EXIT_CODE: "1",
    });

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`${JSON.stringify({
      status: "failed",
      evidence_path: path,
      cleanup_passed: true,
    })}\nacceptance_failed:gate_failed\n`);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(evidence);
  });

  it("rejects test injection outside an explicit test process", async () => {
    const path = await fixturePath("evidence.json");
    const result = await run(path, { NODE_ENV: "production" });

    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: "acceptance_preflight_failed:test_injection_forbidden\n",
    });
  });
});
