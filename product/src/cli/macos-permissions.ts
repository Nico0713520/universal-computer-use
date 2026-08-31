import { z } from "zod";

import type { ProcessRunner } from "./process-runner.js";

export type PermissionState = "granted" | "required" | "unknown";

export interface MacPermissionProbeResult {
  accessibility: PermissionState;
  screen_recording: PermissionState;
  source: "driver-daemon" | "unknown";
}

const DEFAULT_CUA_EXECUTABLE =
  "/Applications/CuaDriver.app/Contents/MacOS/cua-driver";
const PROBE_TIMEOUT_MS = 10_000;

const PermissionResponseSchema = z
  .object({
    accessibility: z.boolean(),
    screen_recording: z.boolean(),
    source: z
      .object({
        attribution: z.literal("driver-daemon"),
        bundle_id: z.literal("com.trycua.driver"),
      })
      .passthrough(),
  })
  .passthrough();

const UNKNOWN_RESULT: MacPermissionProbeResult = {
  accessibility: "unknown",
  screen_recording: "unknown",
  source: "unknown",
};

export async function probeMacPermissions(
  runner: ProcessRunner,
  executablePath = DEFAULT_CUA_EXECUTABLE,
): Promise<MacPermissionProbeResult> {
  try {
    const result = await runner.run(
      executablePath,
      ["permissions", "status", "--json"],
      { timeoutMs: PROBE_TIMEOUT_MS },
    );
    if (result.code !== 0) return UNKNOWN_RESULT;

    const parsed = PermissionResponseSchema.safeParse(JSON.parse(result.stdout) as unknown);
    if (!parsed.success) return UNKNOWN_RESULT;
    return {
      accessibility: parsed.data.accessibility ? "granted" : "required",
      screen_recording: parsed.data.screen_recording ? "granted" : "required",
      source: "driver-daemon",
    };
  } catch {
    return UNKNOWN_RESULT;
  }
}
