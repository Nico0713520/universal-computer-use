import { createHash } from "node:crypto";
import process from "node:process";

import type { ProcessResult, ProcessRunner } from "../cli/process-runner.js";
import { ComputerUseError } from "../errors.js";
import type { EngineLock } from "./lock.js";

const DEFAULT_MAC_APP_PATH = "/Applications/CuaDriver.app";
const READINESS_DEADLINE_MS = 10_000;
const READINESS_DELAYS_MS = [50, 100, 200, 400, 800, 1_000] as const;

function isRuntimeUnavailable(error: unknown): error is ComputerUseError {
  return error instanceof ComputerUseError && error.code === "runtime_unavailable";
}

async function requireProcessSuccess(
  result: ProcessResult,
  label: string,
): Promise<ProcessResult> {
  if (result.code !== 0) {
    throw new ComputerUseError(
      "engine_version_mismatch",
      `${label} failed`,
      "setup",
      false,
    );
  }
  return result;
}

function signerMismatch(message: string): ComputerUseError {
  return new ComputerUseError(
    "engine_version_mismatch",
    message,
    "setup",
    false,
  );
}

export async function verifyMacRuntimeSignature(
  lock: EngineLock,
  runner: ProcessRunner,
  appPath: string,
): Promise<void> {
  await requireProcessSuccess(
    await runner.run("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath], {
      timeoutMs: 30_000,
    }),
    "codesign verification",
  );
  await requireProcessSuccess(
    await runner.run("/usr/sbin/spctl", ["--assess", "--type", "execute", appPath], {
      timeoutMs: 30_000,
    }),
    "Gatekeeper assessment",
  );

  const signer = lock.platforms.macos.signer;
  if (signer.kind !== "apple") throw signerMismatch("Invalid macOS signer lock");
  if (
    signer.team_id === null &&
    signer.bundle_id === null &&
    signer.designated_requirement_sha256 === null
  ) {
    return;
  }

  const identity = await requireProcessSuccess(
    await runner.run("/usr/bin/codesign", ["-dv", "--verbose=4", appPath], {
      timeoutMs: 30_000,
    }),
    "codesign identity inspection",
  );
  const identityLines = `${identity.stdout}\n${identity.stderr}`.split(/\r?\n/u);
  if (signer.team_id !== null && !identityLines.includes(`TeamIdentifier=${signer.team_id}`)) {
    throw signerMismatch("macOS signer TeamIdentifier mismatch");
  }
  if (signer.bundle_id !== null && !identityLines.includes(`Identifier=${signer.bundle_id}`)) {
    throw signerMismatch("macOS signer bundle identifier mismatch");
  }
  if (signer.designated_requirement_sha256 !== null) {
    const requirement = await requireProcessSuccess(
      await runner.run("/usr/bin/codesign", ["-dr", "-", appPath], {
        timeoutMs: 30_000,
      }),
      "designated requirement inspection",
    );
    const actual = createHash("sha256")
      .update(`${requirement.stdout}\n${requirement.stderr}`.trim())
      .digest("hex");
    if (actual !== signer.designated_requirement_sha256) {
      throw signerMismatch("macOS designated requirement mismatch");
    }
  }
}

export type RuntimeStartupDependencies<T> = Readonly<{
  platform?: NodeJS.Platform;
  connect(lock: EngineLock): Promise<T>;
  access(path: string): Promise<void>;
  runner: ProcessRunner;
  wait(ms: number): Promise<void>;
  now(): number;
  macAppPath?: string;
}>;

export function boundedRuntimeStartupWait(delayMs: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, delayMs);
  });
}

async function connectWithStartup<T>(
  lock: EngineLock,
  dependencies: RuntimeStartupDependencies<T>,
): Promise<T> {
  try {
    return await dependencies.connect(lock);
  } catch (error) {
    if ((dependencies.platform ?? process.platform) !== "darwin" || !isRuntimeUnavailable(error)) {
      throw error;
    }
  }

  const appPath = dependencies.macAppPath ?? DEFAULT_MAC_APP_PATH;
  try {
    await dependencies.access(appPath);
  } catch {
    throw new ComputerUseError(
      "runtime_missing",
      "CuaDriver is not installed at the locked macOS application path",
      "setup",
      false,
    );
  }
  await verifyMacRuntimeSignature(lock, dependencies.runner, appPath);
  const started = await dependencies.runner.run(
    "/usr/bin/open",
    ["-g", appPath, "--args", "serve"],
    { timeoutMs: 30_000 },
  );
  if (started.code !== 0) {
    throw new ComputerUseError(
      "runtime_unavailable",
      "CuaDriver could not be started",
      "doctor",
      true,
    );
  }

  const deadline = dependencies.now() + READINESS_DEADLINE_MS;
  let attempt = 0;
  while (true) {
    try {
      return await dependencies.connect(lock);
    } catch (error) {
      if (!isRuntimeUnavailable(error)) throw error;
    }

    const remaining = deadline - dependencies.now();
    if (remaining <= 0) {
      throw new ComputerUseError(
        "runtime_unavailable",
        "CuaDriver did not become ready before the startup deadline",
        "doctor",
        true,
      );
    }
    const delayMs = READINESS_DELAYS_MS[Math.min(attempt, READINESS_DELAYS_MS.length - 1)]!;
    await dependencies.wait(Math.min(delayMs, remaining));
    attempt += 1;
  }
}

export function createRuntimeConnector<T>(
  dependencies: RuntimeStartupDependencies<T>,
): (lock: EngineLock) => Promise<T> {
  let pending: Promise<T> | undefined;
  return (lock: EngineLock): Promise<T> => {
    pending ??= connectWithStartup(lock, dependencies);
    return pending;
  };
}
