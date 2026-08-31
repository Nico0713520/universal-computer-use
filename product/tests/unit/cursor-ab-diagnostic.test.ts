import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  CursorAbDiagnosticTracker,
  runCursorAbGuardedLifecycle,
} from "../e2e/development/cursor-ab-diagnostic.js";

const timestamp = "2026-08-31T00:00:00.000Z";
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("CursorAbDiagnosticTracker", () => {
  it.each([
    ["cursor_ab_route_mismatch", "measurement", "route_mismatch"],
    ["cursor_ab_state_invalid", "cursor_state", "cursor_state_failed"],
    ["cursor_ab_evidence_incomplete", "measurement", "effect_mismatch"],
    ["cursor_ab_target_lost", "invariants", "target_failed"],
    ["cursor_ab_evidence_invalid", "evidence", "invariants_failed"],
    ["cursor_ab_capture_missing", "setup", "capture_failed"],
    ["cursor_ab_session_invalid", "setup", "session_failed"],
    ["cursor_ab_engine_version_mismatch", "setup", "runtime_failed"],
  ] as const)("maps %s to a closed diagnostic", (message, phase, errorCode) => {
    const tracker = new CursorAbDiagnosticTracker({ timestamp: () => timestamp });
    tracker.setPhase(phase);

    expect(tracker.build(new Error(message), true)).toEqual({
      schema_version: 1,
      evidence_type: "computer-use-macos-cursor-ab-diagnostic",
      status: "failed",
      phase,
      error_code: errorCode,
      cleanup_passed: true,
      timestamp,
    });
  });

  it("projects unknown raw failures to internal_error without retaining their content", () => {
    const tracker = new CursorAbDiagnosticTracker({ timestamp: () => timestamp });
    tracker.setPhase("measurement");
    const diagnostic = tracker.build(
      new Error("secret-token /Users/alice/private/input.txt raw typed text"),
      true,
    );

    expect(diagnostic.error_code).toBe("internal_error");
    expect(JSON.stringify(diagnostic)).not.toMatch(/secret-token|\/Users\/alice|typed text/);
  });

  it("lets cleanup failure override the operation classification", () => {
    const tracker = new CursorAbDiagnosticTracker({ timestamp: () => timestamp });
    tracker.setPhase("measurement");

    expect(tracker.build(new Error("cursor_ab_route_mismatch"), false)).toMatchObject({
      phase: "cleanup",
      error_code: "cleanup_failed",
      cleanup_passed: false,
    });
  });

  it("builds only values allowed by the strict diagnostic schema", async () => {
    const schema = JSON.parse(await readFile(
      new URL("../e2e/development/cursor-ab-diagnostic.schema.json", import.meta.url),
      "utf8",
    )) as Record<string, unknown>;
    const validate = new Ajv2020({ allErrors: true, strict: false, validateFormats: false })
      .compile(schema);
    const tracker = new CursorAbDiagnosticTracker({ timestamp: () => timestamp });
    tracker.setPhase("invariants");
    const diagnostic = tracker.build(new Error("cursor_ab_target_lost"), true);

    expect(validate(diagnostic), JSON.stringify(validate.errors)).toBe(true);
    expect(Object.keys(diagnostic).sort()).toEqual([
      "cleanup_passed",
      "error_code",
      "evidence_type",
      "phase",
      "schema_version",
      "status",
      "timestamp",
    ]);
  });

  it("writes the redacted diagnostic only after owned-resource cleanup", async () => {
    const root = await mkdtemp(join(tmpdir(), "ucu-cursor-ab-diagnostic-test-"));
    temporaryRoots.push(root);
    const path = join(root, "cursor-ab.json.diagnostic.json");
    const order: string[] = [];
    const tracker = new CursorAbDiagnosticTracker({ timestamp: () => timestamp });
    tracker.setPhase("measurement");

    await expect(runCursorAbGuardedLifecycle({
      diagnosticPath: path,
      tracker,
      operation: async () => {
        order.push("operation");
        throw new Error("cursor_ab_route_mismatch:/Users/alice/secret-token");
      },
      cleanup: async () => {
        order.push("cleanup");
      },
    })).rejects.toThrow("cursor_ab_route_mismatch");

    order.push("read");
    const persisted = await readFile(path, "utf8");
    expect(order).toEqual(["operation", "cleanup", "read"]);
    expect(JSON.parse(persisted)).toMatchObject({
      phase: "measurement",
      error_code: "route_mismatch",
      cleanup_passed: true,
    });
    expect(persisted).not.toMatch(/\/Users\/alice|secret-token/);
  });
});
