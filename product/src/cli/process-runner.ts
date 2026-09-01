import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

export type ProcessResult = Readonly<{
  code: number;
  stdout: string;
  stderr: string;
}>;

export interface ProcessRunner {
  run(
    command: string,
    args: string[],
    options: {
      env?: NodeJS.ProcessEnv;
      timeoutMs: number;
      terminateTree?: boolean;
      terminationGraceMs?: number;
    },
  ): Promise<ProcessResult>;
}

export interface Downloader {
  download(url: URL, destination: string): Promise<void>;
}

const DEFAULT_TERMINATION_GRACE_MS = 250;

export const nodeProcessRunner: ProcessRunner = {
  run(command, args, options) {
    return new Promise((resolve, reject) => {
      const terminateTree = options.terminateTree === true && process.platform !== "win32";
      const child = spawn(command, args, {
        detached: terminateTree,
        env: options.env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      let forceTimer: NodeJS.Timeout | undefined;
      const TERMINATION_GRACE_MS =
        options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;
      const finish = (result: ProcessResult | Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (forceTimer !== undefined) clearTimeout(forceTimer);
        if (result instanceof Error) reject(result);
        else resolve(result);
      };
      const timeoutError = (): Error => new Error(`process timeout: ${command}`);
      const childExited = (): boolean => child.exitCode !== null || child.signalCode !== null;
      const signalOwnedProcess = (signal: NodeJS.Signals): boolean => {
        if (!terminateTree || child.pid === undefined) {
          child.kill(signal);
          return !childExited();
        }
        try {
          process.kill(-child.pid, signal);
          return true;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ESRCH" || code === "EPERM") return false;
          finish(error instanceof Error ? error : new Error(String(error)));
          return false;
        }
      };
      const ownedProcessTreeIsAlive = (): boolean => {
        if (!terminateTree || child.pid === undefined) return !childExited();
        try {
          process.kill(-child.pid, 0);
          return true;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ESRCH") return false;
          if (code === "EPERM") return true;
          finish(error instanceof Error ? error : new Error(String(error)));
          return false;
        }
      };
      const timer = setTimeout(() => {
        timedOut = true;
        signalOwnedProcess("SIGTERM");
        if (settled) return;
        forceTimer = setTimeout(() => {
          if (ownedProcessTreeIsAlive()) signalOwnedProcess("SIGKILL");
          finish(timeoutError());
        }, TERMINATION_GRACE_MS);
      }, options.timeoutMs);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.once("error", (error) => {
        finish(timedOut ? timeoutError() : error);
      });
      child.once("close", (code) => {
        if (timedOut) {
          if (terminateTree && ownedProcessTreeIsAlive()) return;
          finish(timeoutError());
          return;
        }
        finish({ code: code ?? 1, stdout, stderr });
      });
    });
  },
};

export const fetchDownloader: Downloader = {
  async download(url, destination) {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new Error(`download failed (${response.status}): ${url.href}`);
    }
    await writeFile(destination, new Uint8Array(await response.arrayBuffer()), {
      flag: "wx",
      mode: 0o600,
    });
  },
};
