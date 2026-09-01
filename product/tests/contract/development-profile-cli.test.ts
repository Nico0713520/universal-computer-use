import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = resolve("scripts/run-development-profile.mjs");
const temporaryRoots: string[] = [];
const PROFILE = "pixel_action_next_state";

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

function evidence(profile = PROFILE): Record<string, unknown> {
  const action = profile === "semantic_action_next_state" || profile === "pixel_action_next_state";
  return {
    schema_version: 1,
    evidence_type: "computer-use-macos-development-profile",
    status: "passed",
    metadata: {
      product_version: "0.2.8",
      protocol_version: "1.2.0",
      engine_version: "0.22.2",
      macos_version: "15.6.1",
      architecture: "arm64",
    },
    profile_name: profile,
    performance: {
      sample_count: 30,
      correct_count: 30,
      failed_count: 0,
      success_rate: 1,
      p50_ms: 100,
      p95_ms: 200,
      max_ms: 300,
      slo: profile === "window_visual_observe"
        ? { p50_ms: 700, p95_ms: 1500 }
        : profile === "window_semantic_observe"
          ? { p50_ms: 400, p95_ms: 1000 }
          : profile === "semantic_action_next_state"
            ? { p50_ms: 1500, p95_ms: 2000 }
            : { p50_ms: 1500, p95_ms: 3000 },
      latency_status: "passed",
      correctness_status: "passed",
      failure_counts: {},
      route_counts: action ? { synthetic_events: 30 } : {},
      stages: {
        queue_wait: { sample_count: 30, p50_ms: 1, p95_ms: 2, max_ms: 3 },
        ...(action ? { engine_execute: { sample_count: 30, p50_ms: 10, p95_ms: 20, max_ms: 30 } } : {}),
        post_action_observe: { sample_count: 30, p50_ms: 10, p95_ms: 20, max_ms: 30 },
        projection: { sample_count: 30, p50_ms: 1, p95_ms: 2, max_ms: 3 },
        tool_total: { sample_count: 30, p50_ms: 50, p95_ms: 60, max_ms: 70 },
        transport_overhead: { sample_count: 30, p50_ms: 1, p95_ms: 2, max_ms: 3 },
      },
      status: "passed",
    },
    cleanup_passed: true,
    timestamp: "2026-08-31T00:00:00.000Z",
  };
}

async function fixturePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ucu-profile-cli-test-"));
  temporaryRoots.push(root);
  return join(root, "profile.json");
}

async function run(
  path: string,
  args: readonly string[] = ["--profile", PROFILE, "--exclusive-desktop"],
  overrides: NodeJS.ProcessEnv = {},
): Promise<Readonly<{ code: number | null; stdout: string; stderr: string }>> {
  const child = spawn(process.execPath, [SCRIPT, ...args, "--evidence", path], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "test",
      CUA_PROFILE_TEST_MODE: "1",
      CUA_PROFILE_TEST_PLATFORM: "darwin",
      CUA_PROFILE_TEST_MACOS_VERSION: "15.6.1",
      CUA_PROFILE_TEST_DOCTOR_JSON: JSON.stringify(successfulDoctor()),
      CUA_PROFILE_TEST_BROWSER: process.execPath,
      CUA_PROFILE_TEST_CHILD_RESULT: JSON.stringify(evidence(
        args[args.indexOf("--profile") + 1] ?? PROFILE,
      )),
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

describe("macOS focused profile launcher", () => {
  it("refuses before doctor when exclusive desktop acknowledgement is missing", async () => {
    const path = await fixturePath();
    const result = await run(path, ["--profile", PROFILE], {
      CUA_PROFILE_TEST_DOCTOR_JSON: "must-not-be-read",
    });

    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: "profile_preflight_failed:exclusive_desktop_confirmation_required\n",
    });
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ["unknown profile", ["--profile", "private_profile", "--exclusive-desktop"]],
    ["duplicate profile", ["--profile", PROFILE, "--profile", PROFILE, "--exclusive-desktop"]],
    ["duplicate acknowledgement", ["--profile", PROFILE, "--exclusive-desktop", "--exclusive-desktop"]],
  ])("rejects %s", async (_label, args) => {
    const result = await run(await fixturePath(), args);
    expect(result).toMatchObject({ code: 1, stdout: "", stderr: "profile_preflight_failed:invalid_arguments\n" });
  });

  it("writes one validated focused artifact", async () => {
    const path = await fixturePath();
    const result = await run(path);

    expect(result).toEqual({
      code: 0,
      stdout: `${JSON.stringify({ status: "passed", profile: PROFILE, evidence_path: path })}\n`,
      stderr: "",
    });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(evidence());
  });

  it("accepts every declared profile name", async () => {
    for (const profile of [
      "window_visual_observe",
      "window_semantic_observe",
      "semantic_action_next_state",
      "pixel_action_next_state",
    ]) {
      const path = await fixturePath();
      const result = await run(path, ["--profile", profile, "--exclusive-desktop"]);
      expect(result.code, profile).toBe(0);
    }
  });

  it("rejects an action artifact whose routes do not account for 30 calls", async () => {
    const path = await fixturePath();
    const malformed = evidence();
    ((malformed.performance as Record<string, unknown>).route_counts as Record<string, unknown>)
      .synthetic_events = 29;
    const result = await run(path, undefined, {
      CUA_PROFILE_TEST_CHILD_RESULT: JSON.stringify(malformed),
    });

    expect(result).toMatchObject({
      code: 1,
      stdout: "",
      stderr: "profile_failed:evidence_missing_or_invalid\n",
    });
  });

  it("refuses to overwrite an existing path", async () => {
    const path = await fixturePath();
    await writeFile(path, "owned\n");
    const result = await run(path);

    expect(result).toMatchObject({ code: 1, stderr: "profile_preflight_failed:evidence_path_exists\n" });
    expect(await readFile(path, "utf8")).toBe("owned\n");
  });

  it("rejects test injection outside an explicit test process", async () => {
    const result = await run(await fixturePath(), undefined, { NODE_ENV: "production" });
    expect(result).toMatchObject({ code: 1, stderr: "profile_preflight_failed:test_injection_forbidden\n" });
  });
});
