import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, win32 } from "node:path";
import process from "node:process";

import {
  assertDevelopmentEligible,
  assertReleaseEligible,
  type EngineLock,
  type EnginePlatform,
} from "../engine/lock.js";
import { ComputerUseError } from "../errors.js";
import type { DoctorReport } from "./doctor.js";
import type { Downloader, ProcessRunner, ProcessResult } from "./process-runner.js";

const RELEASE_ROOT = "https://github.com/trycua/cua/releases/download";
const SOURCE_ROOT = "https://raw.githubusercontent.com/trycua/cua";
const PROCESS_TIMEOUT_MS = 120_000;

export type SetupOptions = Readonly<{
  development: boolean;
  platform?: NodeJS.Platform;
  arch?: string;
}>;

export type SetupReport = Readonly<{
  ok: true;
  platform: EnginePlatform;
  engine_version: string;
  development_only: boolean;
  warning?: Readonly<{
    development_only: true;
    code: "development_engine_not_for_release";
  }>;
  config_command: "computer-use config --client generic";
  doctor: DoctorReport;
}>;

export type SetupDependencies = Readonly<{
  lock: EngineLock;
  downloader: Downloader;
  runner: ProcessRunner;
  runDoctor: () => Promise<DoctorReport>;
  environment?: NodeJS.ProcessEnv;
  macAppPath?: string;
  macExecutablePath?: string;
  windowsExecutablePath?: string;
}>;

export function resolveEnginePlatform(
  platform: NodeJS.Platform,
  arch: string,
): EnginePlatform {
  if (platform === "darwin" && (arch === "arm64" || arch === "x64")) return "macos";
  if (platform === "win32" && arch === "x64") return "windows";
  throw new ComputerUseError(
    "unsupported_platform",
    `Unsupported platform or architecture: ${platform}/${arch}`,
    "stop",
    false,
  );
}

function fileUrl(lock: EngineLock, file: { name: string; source: string }): URL {
  if (file.source === "release") {
    return new URL(`${RELEASE_ROOT}/${lock.tag}/${file.name}`);
  }
  return new URL(
    `${SOURCE_ROOT}/${lock.source_commit}/libs/cua-driver/scripts/${file.name}`,
  );
}

function assertSafeInstallerFilename(name: string): void {
  if (
    name === "." ||
    name === ".." ||
    name !== basename(name) ||
    name !== win32.basename(name)
  ) {
    throw new Error(`unsafe installer filename: ${name}`);
  }
}

async function verifySha256(path: string, expected: string): Promise<void> {
  const actual = createHash("sha256").update(await readFile(path)).digest("hex");
  if (actual !== expected) throw new Error(`checksum mismatch: ${path}`);
}

async function requireSuccess(
  result: ProcessResult,
  label: string,
): Promise<ProcessResult> {
  if (result.code !== 0) {
    throw new Error(`${label} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result;
}

async function verifyMacSignature(
  lock: EngineLock,
  runner: ProcessRunner,
  appPath: string,
): Promise<void> {
  await requireSuccess(
    await runner.run("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath], {
      timeoutMs: 30_000,
    }),
    "codesign verification",
  );
  await requireSuccess(
    await runner.run("/usr/sbin/spctl", ["--assess", "--type", "execute", appPath], {
      timeoutMs: 30_000,
    }),
    "Gatekeeper assessment",
  );

  const signer = lock.platforms.macos.signer;
  if (signer.kind !== "apple") throw new Error("invalid macOS signer lock");
  if (signer.team_id === null && signer.bundle_id === null && signer.designated_requirement_sha256 === null) {
    return;
  }
  const details = await requireSuccess(
    await runner.run("/usr/bin/codesign", ["-dv", "--verbose=4", appPath], {
      timeoutMs: 30_000,
    }),
    "codesign identity inspection",
  );
  const text = `${details.stdout}\n${details.stderr}`;
  if (signer.team_id !== null && !text.split(/\r?\n/).includes(`TeamIdentifier=${signer.team_id}`)) {
    throw new Error("macOS signer TeamIdentifier mismatch");
  }
  if (signer.bundle_id !== null && !text.split(/\r?\n/).includes(`Identifier=${signer.bundle_id}`)) {
    throw new Error("macOS signer bundle identifier mismatch");
  }
  if (signer.designated_requirement_sha256 !== null) {
    const requirement = await requireSuccess(
      await runner.run("/usr/bin/codesign", ["-dr", "-", appPath], { timeoutMs: 30_000 }),
      "designated requirement inspection",
    );
    const actual = createHash("sha256")
      .update(`${requirement.stdout}\n${requirement.stderr}`.trim())
      .digest("hex");
    if (actual !== signer.designated_requirement_sha256) {
      throw new Error("macOS designated requirement mismatch");
    }
  }
}

type WindowsSignature = {
  Status?: string;
  Subject?: string;
  Thumbprint?: string;
};

async function verifyWindowsSignature(
  lock: EngineLock,
  runner: ProcessRunner,
  executablePath: string,
): Promise<void> {
  const script =
    "$s=Get-AuthenticodeSignature -LiteralPath $args[0];" +
    "@{Status=[string]$s.Status;Subject=[string]$s.SignerCertificate.Subject;" +
    "Thumbprint=[string]$s.SignerCertificate.Thumbprint}|ConvertTo-Json -Compress";
  const inspected = await requireSuccess(
    await runner.run("powershell.exe", ["-NoProfile", "-Command", script, executablePath], {
      timeoutMs: 30_000,
    }),
    "Authenticode inspection",
  );
  let signature: WindowsSignature;
  try {
    signature = JSON.parse(inspected.stdout) as WindowsSignature;
  } catch {
    throw new Error("Authenticode inspection returned malformed JSON");
  }
  if (signature.Status !== "Valid") throw new Error("Authenticode signature is not Valid");
  const signer = lock.platforms.windows.signer;
  if (signer.kind !== "authenticode") throw new Error("invalid Windows signer lock");
  if (signer.subject !== null && signature.Subject !== signer.subject) {
    throw new Error("Authenticode subject mismatch");
  }
  if (
    signer.thumbprint !== null &&
    signature.Thumbprint?.toUpperCase() !== signer.thumbprint.toUpperCase()
  ) {
    throw new Error("Authenticode thumbprint mismatch");
  }
}

function defaultWindowsExecutable(environment: NodeJS.ProcessEnv): string {
  const localAppData = environment.LOCALAPPDATA;
  if (localAppData === undefined || localAppData.length === 0) {
    throw new Error("LOCALAPPDATA is required to locate cua-driver.exe");
  }
  return join(localAppData, "Programs", "Cua", "cua-driver", "bin", "cua-driver.exe");
}

export async function runSetup(
  options: SetupOptions,
  dependencies: SetupDependencies,
): Promise<SetupReport> {
  const platform = resolveEnginePlatform(
    options.platform ?? process.platform,
    options.arch ?? process.arch,
  );
  if (options.development) {
    assertDevelopmentEligible(dependencies.lock, platform);
  } else {
    assertReleaseEligible(dependencies.lock, platform);
  }

  const platformLock = dependencies.lock.platforms[platform];
  for (const file of platformLock.installer_files) {
    assertSafeInstallerFilename(file.name);
  }
  const tempDirectory = await mkdtemp(join(tmpdir(), "computer-use-setup-"));
  try {
    const destinations = new Map<string, string>();
    for (const file of platformLock.installer_files) {
      const destination = join(tempDirectory, file.name);
      await dependencies.downloader.download(fileUrl(dependencies.lock, file), destination);
      await verifySha256(destination, file.sha256);
      destinations.set(file.name, destination);
    }
    const entrypoint = destinations.get(platformLock.installer_entrypoint);
    if (entrypoint === undefined) throw new Error("installer entry point missing");

    const environment = { ...(dependencies.environment ?? process.env) };
    if (platform === "macos") {
      environment.CUA_DRIVER_RS_VERSION = dependencies.lock.version;
      await requireSuccess(
        await dependencies.runner.run("/bin/bash", [entrypoint, "--autostart"], {
          env: environment,
          timeoutMs: PROCESS_TIMEOUT_MS,
        }),
        "Cua installer",
      );
      const appPath = dependencies.macAppPath ?? "/Applications/CuaDriver.app";
      const executablePath =
        dependencies.macExecutablePath ??
        "/Applications/CuaDriver.app/Contents/MacOS/cua-driver";
      await verifyMacSignature(dependencies.lock, dependencies.runner, appPath);
      await requireSuccess(
        await dependencies.runner.run(executablePath, ["autostart", "kick"], {
          timeoutMs: 30_000,
        }),
        "Cua daemon startup",
      );
      await requireSuccess(
        await dependencies.runner.run(executablePath, ["permissions", "grant"], {
          timeoutMs: PROCESS_TIMEOUT_MS,
        }),
        "Cua permission flow",
      );
    } else {
      await requireSuccess(
        await dependencies.runner.run(
          "powershell.exe",
          [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            entrypoint,
            "-Release",
            dependencies.lock.version,
            "-AutoStart",
          ],
          { env: environment, timeoutMs: PROCESS_TIMEOUT_MS },
        ),
        "Cua installer",
      );
      const executablePath =
        dependencies.windowsExecutablePath ?? defaultWindowsExecutable(environment);
      await verifyWindowsSignature(dependencies.lock, dependencies.runner, executablePath);
      await requireSuccess(
        await dependencies.runner.run(executablePath, ["autostart", "kick"], {
          timeoutMs: 30_000,
        }),
        "Cua daemon startup",
      );
    }

    const doctor = await dependencies.runDoctor();
    if (!doctor.ok || doctor.reported_engine_version !== dependencies.lock.version) {
      throw new Error("installed Cua Runtime failed doctor or version verification");
    }
    return {
      ok: true,
      platform,
      engine_version: dependencies.lock.version,
      development_only: options.development,
      ...(options.development
        ? {
            warning: {
              development_only: true as const,
              code: "development_engine_not_for_release" as const,
            },
          }
        : {}),
      config_command: "computer-use config --client generic",
      doctor,
    };
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}
