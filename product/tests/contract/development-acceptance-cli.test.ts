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
    schema_version: 1,
    evidence_type: "computer-use-macos-development-acceptance",
    status: "passed",
    cleanup_passed: cleanupPassed,
  };
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
