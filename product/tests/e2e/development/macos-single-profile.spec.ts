import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { loadEngineLock } from "../../../src/engine/lock.js";
import { PRODUCT_VERSION, PROTOCOL_VERSION } from "../../../src/version.js";
import { performanceIteration } from "./macos-performance-profile.js";
import {
  PERFORMANCE_SCENARIO_NAMES,
  type PerformanceScenarioName,
} from "./performance-recorder.js";
import { establishPerformanceTelemetryBoundary } from "./performance-preparation.js";
import { SingleProfileRecorder } from "./single-profile-recorder.js";
import {
  CHROME_BUNDLE_ID,
  FOCUS_SENTINEL_WINDOW_TITLE,
  WINDOW_TITLE,
  activateOwnedApplication,
  callTool,
  cleanupBrowser,
  cleanupFocusSentinel,
  closeConnection,
  connectClient,
  frontmostIdentity,
  launchBrowser,
  macosVersion,
  requireInteractiveSession,
  requireWindow,
  resetFixture,
  startFixture,
  startFocusSentinel,
  stopOwnedProcess,
  waitForFixture,
  type BrowserProcess,
  type Connection,
  type FixtureLayout,
  type FixtureProcess,
  type FocusSentinel,
} from "./macos-acceptance-support.js";

const PROFILE = process.env.CUA_DEVELOPMENT_PROFILE;
const REAL_PROFILE = PERFORMANCE_SCENARIO_NAMES.includes(PROFILE as PerformanceScenarioName);
const EVIDENCE_SCHEMA = new URL("./single-profile-evidence.schema.json", import.meta.url);

async function discoverWindow(connection: Connection, title: string): Promise<string> {
  const result = await callTool(connection.client, "computer_observe", {
    target: { kind: "desktop" },
    discover: { windows: true, query: title },
  });
  if (result.isError === true) throw new Error("profile_window_discovery_failed");
  return requireWindow(result, title);
}

async function validateEvidence(value: unknown): Promise<void> {
  const schema = JSON.parse(await readFile(EVIDENCE_SCHEMA, "utf8")) as Record<string, unknown>;
  const validate = new Ajv2020({ allErrors: true, strict: false, validateFormats: false })
    .compile(schema);
  if (!validate(value)) throw new Error("profile_evidence_invalid");
}

describe("macOS focused performance profile opt-in", () => {
  it("stays disabled without a validated profile name", () => {
    if (!REAL_PROFILE) expect(process.env.CUA_DEVELOPMENT_PROFILE_EVIDENCE_PATH).toBeUndefined();
  });
});

describe.skipIf(!REAL_PROFILE)("macOS focused performance profile through public MCP", () => {
  it("runs one 5-warm-up/30-measured profile with owned resources", async () => {
    if (process.platform !== "darwin") throw new Error("profile_requires_darwin");
    const evidencePath = process.env.CUA_DEVELOPMENT_PROFILE_EVIDENCE_PATH;
    if (evidencePath === undefined || !evidencePath.startsWith("/")) {
      throw new Error("profile_evidence_path_missing");
    }
    const name = PROFILE as PerformanceScenarioName;
    const recorder = new SingleProfileRecorder(name);
    let fixture: FixtureProcess | undefined;
    let browser: BrowserProcess | undefined;
    let sentinel: FocusSentinel | undefined;
    let connection: Connection | undefined;
    let cleanupFailure: unknown;
    let windowRef: string | undefined;
    let sentinelWindowRef: string | undefined;
    let layout: FixtureLayout | undefined;

    try {
      requireInteractiveSession(await frontmostIdentity());
      if (name === "semantic_action_next_state") {
        sentinel = await startFocusSentinel();
      } else {
        fixture = await startFixture();
        browser = await launchBrowser(fixture.url);
        layout = await waitForFixture(fixture.url);
        await resetFixture(fixture.url);
        await activateOwnedApplication({
          bundleIdentifier: CHROME_BUNDLE_ID,
          processIdentifier: browser.pid,
        });
      }

      connection = await connectClient(`ucu-development-profile-${name}`);
      if (name === "semantic_action_next_state") {
        sentinelWindowRef = await discoverWindow(connection, FOCUS_SENTINEL_WINDOW_TITLE);
      } else {
        windowRef = await discoverWindow(connection, WINDOW_TITLE);
      }
      establishPerformanceTelemetryBoundary(connection.telemetry);

      for (let index = 0; index < 35; index += 1) {
        const sample = await performanceIteration(
          name,
          index,
          connection,
          fixture,
          windowRef,
          layout,
          sentinel,
          sentinelWindowRef,
        );
        if (index < 5) recorder.recordWarmup(sample);
        else recorder.recordMeasured(sample);
      }
    } finally {
      const cleanup = async (operation: () => Promise<void>): Promise<void> => {
        try {
          await operation();
        } catch (error) {
          cleanupFailure ??= error;
        }
      };
      await cleanup(async () => {
        await closeConnection(connection);
        connection = undefined;
      });
      await cleanup(async () => {
        await cleanupFocusSentinel(sentinel);
        sentinel = undefined;
      });
      await cleanup(async () => {
        await cleanupBrowser(browser);
        browser = undefined;
      });
      await cleanup(async () => {
        await stopOwnedProcess(fixture?.child);
        fixture = undefined;
      });
    }

    if (cleanupFailure !== undefined) throw cleanupFailure;
    const lock = await loadEngineLock();
    if (process.arch !== "arm64" && process.arch !== "x64") {
      throw new Error("profile_architecture_unsupported");
    }
    const evidence = recorder.evidence({
      product_version: PRODUCT_VERSION,
      protocol_version: PROTOCOL_VERSION,
      engine_version: lock.version,
      macos_version: await macosVersion(),
      architecture: process.arch === "arm64" ? "arm64" : "x86_64",
    }, true);
    await validateEvidence(evidence);
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
    expect(evidence.cleanup_passed).toBe(true);
    expect(evidence.status).toBe("passed");
  }, 240_000);
});
