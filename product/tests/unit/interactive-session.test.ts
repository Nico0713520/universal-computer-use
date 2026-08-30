import { describe, expect, it, vi } from "vitest";

import { probeMacInteractiveSession } from "../../src/cli/interactive-session.js";
import type {
  ProcessResult,
  ProcessRunner,
} from "../../src/cli/process-runner.js";

function runnerReturning(result: ProcessResult): ProcessRunner {
  return { run: vi.fn(async () => result) };
}

describe("macOS interactive session probe", () => {
  it("reports the login window as non-interactive", async () => {
    const runner = runnerReturning({
      code: 0,
      stdout: '{"bundleIdentifier":"com.apple.loginwindow"}\n',
      stderr: "",
    });

    await expect(probeMacInteractiveSession(runner)).resolves.toBe(false);
  });

  it("reports another frontmost application as interactive", async () => {
    const runner = runnerReturning({
      code: 0,
      stdout: '{"bundleIdentifier":"com.google.Chrome"}\n',
      stderr: "",
    });

    await expect(probeMacInteractiveSession(runner)).resolves.toBe(true);
  });

  it.each([
    { code: 1, stdout: "", stderr: "denied" },
    { code: 0, stdout: "not-json", stderr: "" },
    { code: 0, stdout: '{"bundleIdentifier":""}', stderr: "" },
  ])("fails closed when the session cannot be verified", async (result) => {
    await expect(
      probeMacInteractiveSession(runnerReturning(result)),
    ).resolves.toBeNull();
  });

  it("fails closed when osascript cannot be started", async () => {
    const runner: ProcessRunner = {
      run: vi.fn(async () => {
        throw new Error("spawn failed");
      }),
    };

    await expect(probeMacInteractiveSession(runner)).resolves.toBeNull();
  });

  it("invokes osascript with structured arguments and a bounded timeout", async () => {
    const runner = runnerReturning({
      code: 0,
      stdout: '{"bundleIdentifier":"com.google.Chrome"}\n',
      stderr: "",
    });

    await probeMacInteractiveSession(runner);

    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(runner.run).toHaveBeenCalledWith(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", expect.any(String)],
      { timeoutMs: 2_000 },
    );
  });
});
