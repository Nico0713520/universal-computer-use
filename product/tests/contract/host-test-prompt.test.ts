import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const SCRIPT = resolve("scripts/render-host-test-prompt.mjs");
const REPOSITORY = "https://github.com/Nico0713520/universal-computer-use";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const temporaryDirectories: string[] = [];

function pnpmInvocation(args: string[]) {
  if (process.platform !== "win32") {
    return { file: "pnpm", args: ["--silent", "host:test-prompt", ...args] };
  }
  return {
    file: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", "pnpm.cmd", "--silent", "host:test-prompt", ...args],
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
});

async function render(host: string, cwd?: string) {
  return execFileAsync(
    process.execPath,
    [SCRIPT, "--host", host, "--repo", REPOSITORY, "--commit", COMMIT],
    { cwd, encoding: "utf8", timeout: 5_000 },
  );
}

async function renderInvalid(args: string[]) {
  try {
    await execFileAsync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      timeout: 5_000,
    });
    throw new Error("invalid renderer invocation unexpectedly succeeded");
  } catch (error) {
    return error as Error & { code?: number; stdout?: string; stderr?: string };
  }
}

async function renderThroughPnpm(args: string[]) {
  const invocation = pnpmInvocation(args);
  return execFileAsync(invocation.file, invocation.args, {
    encoding: "utf8",
    timeout: 5_000,
  });
}

async function renderInvalidThroughPnpm(args: string[]) {
  try {
    await renderThroughPnpm(args);
    throw new Error("invalid pnpm renderer invocation unexpectedly succeeded");
  } catch (error) {
    return error as Error & { code?: number; stdout?: string; stderr?: string };
  }
}

describe("commit-bound external host test prompt", () => {
  it("renders the HanaAgent direct-loop handoff deterministically without touching the checkout", async () => {
    const emptyDirectory = await mkdtemp(join(tmpdir(), "ucu-host-prompt-"));
    temporaryDirectories.push(emptyDirectory);

    const first = await render("hanaagent", emptyDirectory);
    const second = await render("hanaagent", emptyDirectory);

    expect(first.stderr).toBe("");
    expect(first.stdout).toBe(second.stdout);
    expect(first.stdout).toContain(REPOSITORY);
    expect(first.stdout).toContain(COMMIT);
    expect(first.stdout).toContain("git checkout --detach");
    expect(first.stdout).toContain("git rev-parse HEAD");
    expect(first.stdout).toContain("test \"$(git rev-parse HEAD)\"");
    expect(first.stdout).toContain("pnpm@9.0.4 install --frozen-lockfile");
    expect(first.stdout).toContain("pnpm@9.0.4 build");
    expect(first.stdout).toContain("setup --development");
    expect(first.stdout).toContain("doctor --json");
    expect(first.stdout).toContain("config --client hanaagent");
    expect(first.stdout).toContain("Restart HanaAgent");
    expect(first.stdout).toContain("new conversation");
    expect(first.stdout).toContain("direct stdio");
    expect(first.stdout).toContain("computer_observe");
    expect(first.stdout).toContain("computer_act");
    expect(first.stdout).toContain("first PNG");
    expect(first.stdout).toContain("second PNG");
    expect(first.stdout).toContain("same host-reported model");
    expect(first.stdout).toContain("same direct loop");
    expect(first.stdout).toContain("calculator");
    expect(first.stdout).toContain("37 × 19");
    expect(first.stdout).toContain("703");
    expect(first.stdout).toContain("unique_input");
    expect(first.stdout).toContain("write_count: 1");
    expect(first.stdout).toContain("covered_window");
    expect(first.stdout).toContain("semantic background");
    expect(first.stdout).toContain("pixel-window");
    expect(first.stdout).toContain("serial");
    expect(first.stdout).toContain("Screen Recording");
    expect(first.stdout).toContain("Accessibility");
    expect(first.stdout).toContain("schema_version: 2");
    expect(first.stdout).toContain("Return only the privacy-safe v2 JSON report");
    expect(await readdir(emptyDirectory)).toEqual([]);
  });

  it("renders the same exact-build acceptance contract for all three named hosts", async () => {
    for (const [host, displayName] of [
      ["codex", "Codex"],
      ["hanaagent", "HanaAgent"],
      ["workbuddy", "WorkBuddy"],
    ] as const) {
      const { stdout, stderr } = await render(host);
      expect(stderr, host).toBe("");
      expect(stdout, host).toContain(`config --client ${host}`);
      expect(stdout, host).toContain(`Restart ${displayName}`);
      expect(stdout, host).toContain("worktree is clean");
      expect(stdout, host).toContain("git clone --no-checkout");
      expect(stdout, host).toContain(`test "$(git rev-parse HEAD)" = "${COMMIT}"`);
      expect(stdout, host).toContain("complete public tool inventory contains exactly these two tools");
      expect(new Set(
        [...stdout.matchAll(/`(computer_[a-z_]+)`/g)].map((match) => match[1]),
      )).toEqual(new Set([
        "computer_observe",
        "computer_act",
      ]));
      for (const invalidPath of [
        "shell bridge",
        "shell-driven JSON-RPC",
        "host built-in Computer Use",
        "AppleScript",
        "DOM automation",
        "mental arithmetic",
      ]) {
        expect(stdout, `${host}: ${invalidPath}`).toContain(invalidPath);
      }
      for (const forbiddenReportMaterial of [
        "screenshots",
        "prompts",
        "nonces",
        "tool arguments",
        "clipboard contents",
        "raw image payloads",
      ]) {
        expect(stdout, `${host}: ${forbiddenReportMaterial}`).toContain(forbiddenReportMaterial);
      }
    }
  });

  it("keeps the public pnpm entrypoint free of lifecycle banners, machine paths, and wrapped errors", async () => {
    const args = [
      "--host", "workbuddy",
      "--repo", REPOSITORY,
      "--commit", COMMIT,
    ];
    const valid = await renderThroughPnpm(args);
    expect(valid.stderr).toBe("");
    expect(valid.stdout).toContain("exact-commit WorkBuddy acceptance");
    expect(valid.stdout).not.toContain("> @universal-computer-use/plugin");
    expect(valid.stdout).not.toContain("> node scripts/render-host-test-prompt.mjs");
    expect(valid.stdout).not.toContain(resolve("."));

    const invalid = await renderInvalidThroughPnpm([
      "--host", "workbuddy",
      "--repo", "https://user:secret@github.com/Nico0713520/universal-computer-use",
      "--commit", COMMIT,
    ]);
    expect(invalid.code).not.toBe(0);
    expect(invalid.stdout).toBe("");
    expect(invalid.stderr).toBe("host_prompt_failed:invalid_arguments\n");
    expect(invalid.stderr).not.toContain("secret");
    expect(invalid.stderr).not.toContain(resolve("."));
  });

  it("fails closed with one stable non-leaking diagnostic for every invalid argument shape", async () => {
    const invalidInvocations = [
      ["--host", "other", "--repo", REPOSITORY, "--commit", COMMIT],
      ["--host", "hanaagent", "--repo", "http://github.com/Nico0713520/universal-computer-use", "--commit", COMMIT],
      ["--host", "hanaagent", "--repo", "https://user:secret@github.com/Nico0713520/universal-computer-use", "--commit", COMMIT],
      ["--host", "hanaagent", "--repo", "https://github.com/other/project", "--commit", COMMIT],
      ["--host", "hanaagent", "--repo", REPOSITORY, "--commit", COMMIT.toUpperCase()],
      ["--host", "hanaagent", "--repo", REPOSITORY, "--commit", COMMIT.slice(1)],
      ["--host", "hanaagent", "--repo", REPOSITORY, "--commit", "0".repeat(40)],
      ["--host", "hanaagent", "--host", "codex", "--repo", REPOSITORY, "--commit", COMMIT],
      ["--host", "hanaagent", "--repo", REPOSITORY],
      ["--host=hanaagent", "--repo", REPOSITORY, "--commit", COMMIT],
      ["SECRET-POSITIONAL", "--host", "hanaagent", "--repo", REPOSITORY, "--commit", COMMIT],
      [],
    ];

    for (const args of invalidInvocations) {
      const error = await renderInvalid(args);
      expect(error.code, args.join(" ")).not.toBe(0);
      expect(error.stdout, args.join(" ")).toBe("");
      expect(error.stderr, args.join(" ")).toBe("host_prompt_failed:invalid_arguments\n");
      expect(error.stderr).not.toContain("SECRET");
      expect(error.stderr).not.toContain("user:secret");
    }
  });
});
