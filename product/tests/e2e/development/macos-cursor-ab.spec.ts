import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

import { CaptureScope, CuaDriver, EffectiveScope, type CuaDriverLike, type ToolResult } from "@trycua/cua-driver";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { parseAppList, parseWindowList, parseWindowState } from "../../../src/engine/cua-json.js";
import { loadEngineLock } from "../../../src/engine/lock.js";
import { mapCuaResult } from "../../../src/engine/result-mapper.js";
import { PRODUCT_VERSION } from "../../../src/version.js";
import {
  CursorAbDiagnosticTracker,
  runCursorAbGuardedLifecycle,
} from "./cursor-ab-diagnostic.js";
import {
  CursorAbRecorder,
  type CursorAbMode,
  type CursorAbSample,
} from "./cursor-ab-recorder.js";
import {
  CHROME_BUNDLE_ID,
  WINDOW_TITLE,
  activateOwnedApplication,
  cleanupBrowser,
  fixtureJson,
  frontmostIdentity,
  launchBrowser,
  macosVersion,
  requireInteractiveSession,
  resetFixture,
  startFixture,
  stopOwnedProcess,
  waitForFixture,
  waitForState,
  type BrowserProcess,
  type FixtureLayout,
  type FixtureProcess,
  type HarnessState,
} from "./macos-acceptance-support.js";

const REAL_CURSOR_AB = process.env.CUA_CURSOR_AB_ACCEPTANCE === "1";
const EVIDENCE_SCHEMA = new URL("./cursor-ab-evidence.schema.json", import.meta.url);

function cursorState(result: ToolResult, session: string, enabled: boolean): void {
  if (result.isError) throw new Error("cursor_ab_state_failed");
  let value: unknown;
  try {
    value = JSON.parse(result.structuredJson ?? "");
  } catch {
    throw new Error("cursor_ab_state_invalid");
  }
  if (
    typeof value !== "object" || value === null ||
    (value as Record<string, unknown>).session !== session ||
    (value as Record<string, unknown>).enabled !== enabled
  ) throw new Error("cursor_ab_state_invalid");
}

async function setAndReadCursor(
  sdk: CuaDriverLike,
  session: string,
  enabled: boolean,
): Promise<void> {
  const configured = await sdk.setAgentCursorEnabled({ session, enabled });
  if (configured.isError) throw new Error("cursor_ab_state_failed");
  cursorState(await sdk.getAgentCursorState({ session }), session, enabled);
}

function pointForCanvas(layout: FixtureLayout, width: number, height: number): Readonly<{ x: number; y: number }> {
  const control = layout.controls?.["cursor-ab-target"];
  const browser = layout.viewport?.browser_css;
  if (control === undefined || browser === null || browser === undefined) {
    throw new Error("cursor_ab_geometry_missing");
  }
  const values = [browser.outer_width, browser.outer_height, browser.inner_width, browser.inner_height];
  if (!values.every((value) => typeof value === "number" && Number.isFinite(value) && value > 0)) {
    throw new Error("cursor_ab_geometry_invalid");
  }
  const [outerWidth, outerHeight, innerWidth, innerHeight] = values as number[];
  return {
    x: Math.round(((outerWidth - innerWidth) / 2 + control.x) * (width / outerWidth)),
    y: Math.round((outerHeight - innerHeight + control.y) * (height / outerHeight)),
  };
}

async function validateEvidence(value: unknown): Promise<void> {
  const schema = JSON.parse(await readFile(EVIDENCE_SCHEMA, "utf8")) as Record<string, unknown>;
  const validate = new Ajv2020({ allErrors: true, strict: false, validateFormats: false })
    .compile(schema);
  if (!validate(value)) throw new Error("cursor_ab_evidence_invalid");
}

describe("macOS Cursor A/B opt-in", () => {
  it("stays disabled unless the guarded launcher marks the real lane", () => {
    if (!REAL_CURSOR_AB) expect(process.env.CUA_CURSOR_AB_EVIDENCE_PATH).toBeUndefined();
  });
});

describe.skipIf(!REAL_CURSOR_AB)("macOS Cua Cursor A/B on one pixel fallback", () => {
  it("compares enabled and disabled on one daemon, session, window, and canvas point", async () => {
    if (process.platform !== "darwin") throw new Error("cursor_ab_requires_darwin");
    const evidencePath = process.env.CUA_CURSOR_AB_EVIDENCE_PATH;
    if (evidencePath === undefined || !evidencePath.startsWith("/")) {
      throw new Error("cursor_ab_evidence_path_missing");
    }
    const diagnosticPath = `${evidencePath}.diagnostic.json`;
    const diagnostic = new CursorAbDiagnosticTracker();
    const recorder = new CursorAbRecorder();
    let fixture: FixtureProcess | undefined;
    let browser: BrowserProcess | undefined;
    let sdk: CuaDriverLike | undefined;
    let session: string | undefined;
    let initialSession: string | undefined;
    let cleanupFailure: unknown;
    let initialDriverPid: number | undefined;
    let finalDriverPid: number | undefined;
    let finalSession: string | undefined;
    let initialTarget: string | undefined;
    let finalTarget: string | undefined;
    let initialPoint: string | undefined;
    let finalPoint: string | undefined;

    const lock = await runCursorAbGuardedLifecycle({
      diagnosticPath,
      tracker: diagnostic,
      operation: async () => {
      requireInteractiveSession(await frontmostIdentity());
      const activeLock = await loadEngineLock();
      fixture = await startFixture();
      browser = await launchBrowser(fixture.url);
      const layout = await waitForFixture(fixture.url);
      await resetFixture(fixture.url);
      await activateOwnedApplication({
        bundleIdentifier: CHROME_BUNDLE_ID,
        processIdentifier: browser.pid,
      });

      sdk = CuaDriver.connect(undefined);
      const metadata = await sdk.metadata();
      if (metadata.driverVersion !== activeLock.version) throw new Error("cursor_ab_engine_version_mismatch");
      initialDriverPid = metadata.pid;
      session = `ucu_cursor_ab_${randomUUID()}`;
      initialSession = session;
      const started = await sdk.startSession({ session, captureScope: CaptureScope.Window });
      if (
        started.state.session !== session ||
        started.state.captureScope !== CaptureScope.Window ||
        started.state.effectiveScope !== EffectiveScope.Window
      ) throw new Error("cursor_ab_session_invalid");

      const apps = parseAppList(await sdk.callTool("list_apps", "{}"), "macos");
      const windows = parseWindowList(await sdk.callTool("list_windows", "{}"), apps, "macos");
      const targets = windows.filter((window) => window.title === WINDOW_TITLE);
      if (targets.length !== 1) throw new Error("cursor_ab_target_ambiguous");
      const target = targets[0]!;
      const native = target.native;
      if (!Number.isSafeInteger(native.pid) || !Number.isSafeInteger(native.window_id)) {
        throw new Error("cursor_ab_target_invalid");
      }
      initialTarget = `${native.pid}:${native.window_id}`;
      const internalTarget = {
        ...target,
        windowRef: "cursor-ab-window",
        appRef: "cursor-ab-app",
        appName: target.appName ?? target.app.displayName,
      };
      const state = parseWindowState(await sdk.callTool("get_window_state", JSON.stringify({
        session,
        pid: native.pid,
        window_id: native.window_id,
        include_screenshot: true,
        max_elements: 1,
        max_depth: 1,
      })), internalTarget, true);
      if (state.image === undefined) throw new Error("cursor_ab_capture_missing");
      const point = pointForCanvas(layout, state.image.width, state.image.height);
      initialPoint = `${point.x}:${point.y}`;

      const runMode = async (mode: CursorAbMode, enabled: boolean): Promise<void> => {
        if (sdk === undefined || session === undefined || fixture === undefined) {
          throw new Error("cursor_ab_runtime_missing");
        }
        diagnostic.setPhase("cursor_state");
        await setAndReadCursor(sdk, session, enabled);
        recorder.recordReadback(mode, enabled);
        diagnostic.setPhase("measurement");
        for (let index = 0; index < 35; index += 1) {
          const before = await fixtureJson<HarnessState>(fixture.url, "/state");
          const startedAt = performance.now();
          const result = await sdk.callTool("click", JSON.stringify({
            session,
            pid: native.pid,
            window_id: native.window_id,
            x: point.x,
            y: point.y,
            button: "middle",
            count: 1,
            delivery_mode: "background",
          }));
          const durationMs = Math.ceil(Math.max(0, performance.now() - startedAt));
          const execution = mapCuaResult(result);
          const after = await waitForState(
            fixture.url,
            (candidate) => candidate.canvas_clicks >= before.canvas_clicks + 1,
          ).catch(() => fixtureJson<HarnessState>(fixture!.url, "/state"));
          if (execution.route !== "synthetic_events") {
            diagnostic.recordObservedRoute(execution.route);
            throw new Error("cursor_ab_route_mismatch");
          }
          const sample: CursorAbSample = {
            durationMs,
            correct: after.canvas_clicks === before.canvas_clicks + 1,
            route: "synthetic_events",
          };
          if (index < 5) recorder.recordWarmup(mode, sample);
          else recorder.recordMeasured(mode, sample);
        }
      };

      await runMode("enabled", true);
      await runMode("disabled", false);

      diagnostic.setPhase("invariants");
      const finalMetadata = await sdk.metadata();
      finalDriverPid = finalMetadata.pid;
      finalSession = (await sdk.getSessionState({ session })).session;
      const finalApps = parseAppList(await sdk.callTool("list_apps", "{}"), "macos");
      const finalWindows = parseWindowList(await sdk.callTool("list_windows", "{}"), finalApps, "macos");
      const finalTargets = finalWindows.filter((window) => window.title === WINDOW_TITLE);
      if (finalTargets.length !== 1) throw new Error("cursor_ab_target_lost");
      const finalNative = finalTargets[0]!.native;
      finalTarget = `${finalNative.pid}:${finalNative.window_id}`;
      const finalTargetForParse = {
        ...finalTargets[0]!,
        windowRef: "cursor-ab-window",
        appRef: "cursor-ab-app",
        appName: finalTargets[0]!.appName ?? finalTargets[0]!.app.displayName,
      };
      const finalState = parseWindowState(await sdk.callTool("get_window_state", JSON.stringify({
        session,
        pid: finalNative.pid,
        window_id: finalNative.window_id,
        include_screenshot: true,
        max_elements: 1,
        max_depth: 1,
      })), finalTargetForParse, true);
      if (finalState.image === undefined) throw new Error("cursor_ab_capture_missing");
      const endPoint = pointForCanvas(layout, finalState.image.width, finalState.image.height);
      finalPoint = `${endPoint.x}:${endPoint.y}`;
      return activeLock;
      },
      cleanup: async () => {
      const cleanup = async (operation: () => Promise<void>): Promise<void> => {
        try {
          await operation();
        } catch (error) {
          cleanupFailure ??= error;
        }
      };
      await cleanup(async () => {
        if (sdk !== undefined && session !== undefined) await sdk.endSession({ session });
        session = undefined;
        sdk = undefined;
      });
      await cleanup(async () => {
        await cleanupBrowser(browser);
        browser = undefined;
      });
      await cleanup(async () => {
        await stopOwnedProcess(fixture?.child);
        fixture = undefined;
      });
      if (cleanupFailure !== undefined) throw cleanupFailure;
      },
    });

    diagnostic.setPhase("evidence");
    try {
      if (process.arch !== "arm64" && process.arch !== "x64") {
        throw new Error("cursor_ab_architecture_unsupported");
      }
      const evidence = recorder.evidence({
        product_version: PRODUCT_VERSION,
        engine_version: lock.version,
        macos_version: await macosVersion(),
        architecture: process.arch === "arm64" ? "arm64" : "x86_64",
      }, {
        same_driver_process: initialDriverPid !== undefined && initialDriverPid === finalDriverPid,
        same_session: initialSession !== undefined && initialSession === finalSession,
        same_target: initialTarget !== undefined && initialTarget === finalTarget &&
          initialPoint !== undefined && initialPoint === finalPoint,
      }, true);
      await validateEvidence(evidence);
      await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
      expect(evidence.status).toBe("passed");
    } catch (error) {
      await diagnostic.write(diagnosticPath, error, true);
      throw error;
    }
  }, 240_000);
});
