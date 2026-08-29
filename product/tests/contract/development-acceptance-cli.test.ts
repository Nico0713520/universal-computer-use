import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

function simulatedEvidence(cleanupPassed = true): Record<string, unknown> {
  return {
    schema_version: 2,
    evidence_type: "computer-use-macos-development-acceptance",
    status: "passed",
    metadata: {
      product_version: "0.2.2",
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
      window_visual_observe: {
        sample_count: 30, p50_ms: 100, p95_ms: 200, max_ms: 300,
        slo: { p50_ms: 700, p95_ms: 1_500 }, status: "passed",
      },
      window_semantic_observe: {
        sample_count: 30, p50_ms: 100, p95_ms: 200, max_ms: 300,
        slo: { p50_ms: 400, p95_ms: 1_000 }, status: "passed",
      },
      semantic_action_next_state: {
        sample_count: 30, p50_ms: 100, p95_ms: 200, max_ms: 300,
        slo: { p50_ms: 1_000, p95_ms: 2_000 }, status: "passed",
      },
      pixel_action_next_state: {
        sample_count: 30, p50_ms: 100, p95_ms: 200, max_ms: 300,
        slo: { p50_ms: 1_500, p95_ms: 3_000 }, status: "passed",
      },
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

function failedEvidence(
  mutate: (evidence: Record<string, unknown>) => void,
): Record<string, unknown> {
  const evidence = simulatedEvidence();
  evidence.status = "failed";
  mutate(evidence);
  return evidence;
}

async function run(
  evidencePath: string,
  overrides: NodeJS.ProcessEnv = {},
  extraArgs: readonly string[] = [],
  packageManagerSeparator = false,
): Promise<RunResult> {
  const child = spawn(process.execPath, [
    SCRIPT,
    ...(packageManagerSeparator ? ["--"] : []),
    "--evidence",
    evidencePath,
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

  it("preserves the child diagnostic when the real lane exits before evidence exists", async () => {
    const path = await fixturePath("evidence.json");
    const result = await run(path, {
      CUA_ACCEPTANCE_TEST_CHILD_OMIT_EVIDENCE: "1",
      CUA_ACCEPTANCE_TEST_CHILD_DIAGNOSTIC: "interactive_session_required",
      CUA_ACCEPTANCE_TEST_CHILD_EXIT_CODE: "1",
    });

    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: "interactive_session_required\nacceptance_failed:evidence_missing_or_invalid\n",
    });
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ["failed performance profile", failedEvidence((evidence) => {
      const profile = (evidence.performance as Record<string, Record<string, unknown>>)
        .window_visual_observe;
      profile.status = "failed";
      profile.p50_ms = 701;
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
