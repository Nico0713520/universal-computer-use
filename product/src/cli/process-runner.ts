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
    options: { env?: NodeJS.ProcessEnv; timeoutMs: number },
  ): Promise<ProcessResult>;
}

export interface Downloader {
  download(url: URL, destination: string): Promise<void>;
}

const TERMINATION_GRACE_MS = 250;

export const nodeProcessRunner: ProcessRunner = {
  run(command, args, options) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        env: options.env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      let forceTimer: NodeJS.Timeout | undefined;
      const finish = (result: ProcessResult | Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (forceTimer !== undefined) clearTimeout(forceTimer);
        if (result instanceof Error) reject(result);
        else resolve(result);
      };
      const timeoutError = (): Error => new Error(`process timeout: ${command}`);
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        forceTimer = setTimeout(() => {
          child.kill("SIGKILL");
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
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(`download failed (${response.status}): ${url.href}`);
    }
    await writeFile(destination, new Uint8Array(await response.arrayBuffer()), {
      flag: "wx",
      mode: 0o600,
    });
  },
};
