import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = resolve("scripts/run-cursor-ab.mjs");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function evidence(): Record<string, unknown> {
  return {
    schema_version: 1,
    evidence_type: "computer-use-macos-cursor-ab",
    status: "passed",
    metadata: {
      product_version: "0.2.4",
      engine_version: "0.22.2",
      macos_version: "15.6.1",
      architecture: "arm64",
    },
    cursor_readback: { enabled: true, disabled: true },
    invariants: { same_driver_process: true, same_session: true, same_target: true },
    modes: {
      enabled: {
        sample_count: 30,
        correct_count: 30,
        p50_ms: 100,
        p95_ms: 120,
        max_ms: 130,
        route_counts: { synthetic_events: 30 },
      },
      disabled: {
        sample_count: 30,
        correct_count: 30,
        p50_ms: 20,
        p95_ms: 30,
        max_ms: 40,
        route_counts: { synthetic_events: 30 },
      },
    },
    delta_ms: { p50: -80, p95: -90, max: -90 },
    cleanup_passed: true,
    timestamp: "2026-08-31T00:00:00.000Z",
  };
}

function doctor(): Record<string, unknown> {
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

async function fixturePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ucu-cursor-ab-cli-test-"));
  temporaryRoots.push(root);
  return join(root, "cursor-ab.json");
}

async function run(
  path: string,
  args: readonly string[] = ["--exclusive-desktop"],
  overrides: NodeJS.ProcessEnv = {},
): Promise<Readonly<{ code: number | null; stdout: string; stderr: string }>> {
  const child = spawn(process.execPath, [SCRIPT, ...args, "--evidence", path], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "test",
      CUA_CURSOR_AB_TEST_MODE: "1",
      CUA_CURSOR_AB_TEST_PLATFORM: "darwin",
      CUA_CURSOR_AB_TEST_MACOS_VERSION: "15.6.1",
      CUA_CURSOR_AB_TEST_DOCTOR_JSON: JSON.stringify(doctor()),
      CUA_CURSOR_AB_TEST_BROWSER: process.execPath,
      CUA_CURSOR_AB_TEST_CHILD_RESULT: JSON.stringify(evidence()),
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

describe("macOS Cursor A/B launcher", () => {
  it("requires exclusive desktop before doctor or GUI setup", async () => {
    const path = await fixturePath();
    const result = await run(path, [], { CUA_CURSOR_AB_TEST_DOCTOR_JSON: "must-not-be-read" });
    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: "cursor_ab_preflight_failed:exclusive_desktop_confirmation_required\n",
    });
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes one strict same-process/session/target artifact", async () => {
    const path = await fixturePath();
    const result = await run(path);
    expect(result).toEqual({
      code: 0,
      stdout: `${JSON.stringify({ status: "passed", evidence_path: path })}\n`,
      stderr: "",
    });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(evidence());
  });

  it.each([
    ["route", (value: Record<string, unknown>) => {
      (((value.modes as Record<string, unknown>).disabled as Record<string, unknown>)
        .route_counts as Record<string, unknown>).synthetic_events = 29;
    }],
    ["driver identity", (value: Record<string, unknown>) => {
      (value.invariants as Record<string, unknown>).same_driver_process = false;
    }],
    ["delta arithmetic", (value: Record<string, unknown>) => {
      (value.delta_ms as Record<string, unknown>).p50 = 999;
    }],
  ])("rejects invalid %s evidence", async (_label, mutate) => {
    const malformed = evidence();
    mutate(malformed);
    const result = await run(await fixturePath(), undefined, {
      CUA_CURSOR_AB_TEST_CHILD_RESULT: JSON.stringify(malformed),
    });
    expect(result).toMatchObject({
      code: 1,
      stdout: "",
      stderr: "cursor_ab_failed:evidence_missing_or_invalid\n",
    });
  });

  it("rejects test injection outside an explicit test process", async () => {
    const result = await run(await fixturePath(), undefined, { NODE_ENV: "production" });
    expect(result).toMatchObject({
      code: 1,
      stderr: "cursor_ab_preflight_failed:test_injection_forbidden\n",
    });
  });
});
