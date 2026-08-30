import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const SWIFTC = "/usr/bin/swiftc";
const SOURCE = resolve("tests/fixtures/vision-ocr/main.swift");
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_STDOUT = 64 * 1024;

function exactValue(value: string): string {
  return value.normalize("NFKC").replace(/[\s,，]/gu, "");
}

export function recognizedTextContainsExactValue(
  recognized: readonly string[],
  expected: string,
): boolean {
  const normalizedExpected = exactValue(expected);
  return normalizedExpected.length > 0 &&
    recognized.filter((value) => exactValue(value) === normalizedExpected).length === 1;
}

function pngBytes(result: CallToolResult): Buffer {
  const images = result.content.filter((item) => item.type === "image");
  const image = images[0];
  if (images.length !== 1 || image?.type !== "image" || image.mimeType !== "image/png") {
    throw new Error("visual_oracle_png_missing");
  }
  const bytes = Buffer.from(image.data, "base64");
  if (!bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    throw new Error("visual_oracle_png_invalid");
  }
  return bytes;
}

async function runChecked(command: string, args: readonly string[], errorCode: string): Promise<string> {
  const child = spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    if (stdout.length <= MAX_STDOUT) stdout += chunk;
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 30_000);
  const [code] = await once(child, "exit") as [number | null];
  clearTimeout(timeout);
  if (code !== 0 || stdout.length > MAX_STDOUT) throw new Error(errorCode);
  return stdout;
}

export async function verifyExactVisibleText(
  result: CallToolResult,
  expected: string,
): Promise<boolean> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "ucu-visual-oracle-"));
  const executable = join(temporaryRoot, "vision-ocr");
  const imagePath = join(temporaryRoot, "window.png");
  try {
    await writeFile(imagePath, pngBytes(result), { flag: "wx" });
    await runChecked(
      SWIFTC,
      [SOURCE, "-framework", "Vision", "-framework", "ImageIO", "-o", executable],
      "visual_oracle_compile_failed",
    );
    const stdout = await runChecked(executable, [imagePath], "visual_oracle_recognition_failed");
    const parsed = JSON.parse(stdout) as unknown;
    if (!Array.isArray(parsed) || parsed.length > 100 ||
        parsed.some((value) => typeof value !== "string" || value.length > 256)) {
      throw new Error("visual_oracle_output_invalid");
    }
    return recognizedTextContainsExactValue(parsed as string[], expected);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
