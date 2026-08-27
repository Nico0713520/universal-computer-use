import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const REAL_WINDOWS_LANE = process.env.CUA_E2E === "1";
const SCHEMA_PATH = new URL("./evidence.schema.json", import.meta.url);
const RUNNER_PATH = new URL("./run.ps1", import.meta.url);

type DoctorReport = Readonly<{
  ok?: unknown;
  platform?: unknown;
  expected_engine_version?: unknown;
  reported_engine_version?: unknown;
  desktop_unlocked?: unknown;
  observation_succeeded?: unknown;
  screenshot?: { width?: unknown; height?: unknown } | null;
}>;

function requiredNumber(name: string): number {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

describe("Windows DPI evidence contract", () => {
  it("is strict, stage-aware, and has no payload fields for screenshots or user content", async () => {
    const schema = JSON.parse(await readFile(SCHEMA_PATH, "utf8")) as {
      $schema?: unknown;
      additionalProperties?: unknown;
      required?: unknown;
      properties?: Record<string, unknown>;
      allOf?: unknown[];
      $defs?: Record<string, { type?: unknown; additionalProperties?: unknown }>;
    };

    expect(schema).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      additionalProperties: false,
      required: [
        "schema_version",
        "evidence_type",
        "stage",
        "promotable",
        "run_id",
        "generated_at",
        "engine",
        "host",
        "calibration",
        "signer",
        "runtime_report",
        "results",
        "limitations",
      ],
    });
    expect(schema.allOf).toHaveLength(2);
    for (const definition of Object.values(schema.$defs ?? {})) {
      if (definition.type === "object") expect(definition.additionalProperties).toBe(false);
    }
    const serialized = JSON.stringify(schema);
    for (const forbidden of [
      "screenshot_data",
      "typed_text",
      "keypress_values",
      "model_prompt",
      "environment_dump",
      "rawJson",
      "diagnostic_text",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("keeps the PowerShell lane fail-closed and evidence-only", async () => {
    const runner = await readFile(RUNNER_PATH, "utf8");
    expect(runner).toContain("CUA_E2E");
    expect(runner).toContain("CUA_REPEAT");
    expect(runner).toContain("CUA_E2E_CALIBRATION");
    expect(runner).toContain("Get-AuthenticodeSignature");
    expect(runner).toContain("WTSActive");
    expect(runner).toContain("GetDpiForSystem");
    expect(runner).toContain("tests/e2e/shared");
    expect(runner).not.toMatch(/Get-ChildItem\s+Env:|CUA_E2E_MODE\s*=\s*["']candidate["']/i);
  });
});

describe.skipIf(!REAL_WINDOWS_LANE)("real Windows DPI lane", () => {
  let doctor: DoctorReport;

  beforeAll(async () => {
    if (process.platform !== "win32" || process.arch !== "x64") {
      throw new Error("CUA_E2E=1 Windows evidence cannot run on a non-Windows x64 host");
    }
    if (process.env.CUA_E2E_RUNNER_GATED !== "1" || process.env.CUA_E2E_SHARED_INCLUDED !== "1") {
      throw new Error("run tests/e2e/windows/run.ps1 so all prerequisite and shared-oracle gates run");
    }
    if (process.env.CUA_E2E_MODE !== "development" && process.env.CUA_E2E_MODE !== "candidate") {
      throw new Error("CUA_E2E_MODE must be development or candidate");
    }
    if (![100, 125, 150].includes(requiredNumber("CUA_E2E_DPI"))) {
      throw new Error("CUA_E2E_DPI must be 100, 125 or 150");
    }
    expect(requiredNumber("CUA_E2E_SYSTEM_DPI")).toBe(requiredNumber("CUA_E2E_DPI"));
    requiredNumber("CUA_E2E_CONTENT_ORIGIN_X_PX");
    requiredNumber("CUA_E2E_CONTENT_ORIGIN_Y_PX");

    const cli = resolve("dist/cli/main.js");
    const completed = await execFileAsync(process.execPath, [cli, "doctor", "--json"], {
      cwd: process.cwd(),
      windowsHide: true,
      maxBuffer: 64 * 1024,
    });
    doctor = JSON.parse(completed.stdout.trim()) as DoctorReport;
  }, 30_000);

  for (const lane of [100, 125, 150] as const) {
    const laneTest = Number(process.env.CUA_E2E_DPI) === lane ? it : it.skip;
    laneTest(`proves only the separately configured ${lane}% machine lane`, () => {
      expect(requiredNumber("CUA_E2E_DPI")).toBe(lane);
      expect(doctor).toMatchObject({
        ok: true,
        platform: "windows",
        desktop_unlocked: true,
        observation_succeeded: true,
      });
      expect(doctor.reported_engine_version).toBe(doctor.expected_engine_version);
      expect(doctor.screenshot).toMatchObject({
        width: expect.any(Number),
        height: expect.any(Number),
      });
      const screenshot = doctor.screenshot;
      if (screenshot === null || typeof screenshot?.width !== "number" || typeof screenshot.height !== "number") {
        throw new Error("doctor did not report screenshot dimensions");
      }
      expect(requiredNumber("CUA_E2E_CONTENT_ORIGIN_X_PX")).toBeLessThan(screenshot.width);
      expect(requiredNumber("CUA_E2E_CONTENT_ORIGIN_Y_PX")).toBeLessThan(screenshot.height);
    });
  }
});
