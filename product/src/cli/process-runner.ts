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
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
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
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new Error(`process timeout: ${command}`));
          return;
        }
        resolve({ code: code ?? 1, stdout, stderr });
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
