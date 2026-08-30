import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  FatalDiagnosticTracker,
  runFatalGuardedLifecycle,
  type FatalDiagnostic,
} from "../e2e/development/fatal-diagnostic.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
});

async function parser(): Promise<Readonly<{
  safeParse: (value: unknown) => Readonly<{ success: boolean }>;
}>> {
  const schema = JSON.parse(await readFile(
    new URL("../e2e/development/fatal-diagnostic.schema.json", import.meta.url),
    "utf8",
  ));
  const validate = new Ajv2020({ allErrors: true, strict: false, validateFormats: false })
    .compile(schema);
  return { safeParse: (value) => ({ success: validate(value) }) };
}

function expectedDiagnostic(): FatalDiagnostic {
  return {
    schema_version: 1,
    evidence_type: "computer-use-macos-development-fatal-diagnostic",
    status: "failed",
    phase: "performance",
    scenario: "semantic_action_next_state",
    sample_kind: "measured",
    sample_index: 4,
    error_code: "fixture_reset_ack_timeout",
    elapsed_ms: 103_000,
    owned_processes: { fixture: false, browser: false, sentinel: false, mcp: false },
    last_tool: { name: "computer_act", error_code: null },
    cleanup_passed: true,
    timestamp: "2026-08-30T00:00:00.000Z",
  };
}

describe("FatalDiagnosticTracker", () => {
  it("projects fatal context to the closed redacted diagnostic shape", () => {
    let now = 0;
    const tracker = new FatalDiagnosticTracker({
      now: () => now,
      timestamp: () => "2026-08-30T00:00:00.000Z",
    });
    tracker.setPerformanceSample("semantic_action_next_state", "measured", 4);
    tracker.recordTool("computer_act", "private_internal_error");
    now = 103_000;

    const error = new Error("fixture_reset_ack_timeout:/private/user/secret");
    error.stack = "private stack with snapshot_ref and typed text";
    const diagnostic = tracker.build(error, {
      fixture: false,
      browser: false,
      sentinel: false,
      mcp: false,
    }, true);

    expect(diagnostic).toEqual(expectedDiagnostic());
    expect(JSON.stringify(diagnostic)).not.toMatch(
      /private|stack|snapshot|typed text|\.test\.ts|pid|\/Users\//,
    );
  });

  it("uses separate zero-based indexes for warm-ups and measured samples", () => {
    const tracker = new FatalDiagnosticTracker({
      now: () => 0,
      timestamp: () => "2026-08-30T00:00:00.000Z",
    });

    tracker.setPerformanceSample("window_visual_observe", "warmup", 0);
    expect(tracker.build("unexpected", {
      fixture: true,
      browser: true,
      sentinel: true,
      mcp: true,
    }, false)).toMatchObject({ sample_kind: "warmup", sample_index: 0 });

    tracker.setPerformanceSample("window_visual_observe", "measured", 0);
    expect(tracker.build("unexpected", {
      fixture: false,
      browser: false,
      sentinel: false,
      mcp: false,
    }, true)).toMatchObject({ sample_kind: "measured", sample_index: 0 });

    expect(() => tracker.setPerformanceSample("window_visual_observe", "warmup", 5))
      .toThrow("invalid_sample_index");
    expect(() => tracker.setPerformanceSample("window_visual_observe", "measured", 30))
      .toThrow("invalid_sample_index");
  });

  it("clears stale tool context on phase changes and projects only public result error codes", () => {
    const tracker = new FatalDiagnosticTracker({
      now: () => 0,
      timestamp: () => "2026-08-30T00:00:00.000Z",
    });
    const owned = { fixture: false, browser: false, sentinel: false, mcp: false };

    tracker.recordTool("computer_observe", "action_timeout");
    tracker.setPhase("reconnect");
    expect(tracker.build("unexpected", owned, true).last_tool).toBeNull();

    tracker.recordToolResult("computer_act", {
      content: [],
      isError: true,
      structuredContent: { action_result: { error_code: "action_timeout" } },
    });
    expect(tracker.build("unexpected", owned, true).last_tool).toEqual({
      name: "computer_act",
      error_code: "action_timeout",
    });

    tracker.recordToolResult("computer_act", {
      content: [],
      isError: true,
      structuredContent: { code: "private_internal_error" },
    });
    expect(tracker.build("unexpected", owned, true).last_tool).toEqual({
      name: "computer_act",
      error_code: null,
    });
  });

  it.each([
    ["acceptance_preflight_interactive_session_required", "interactive_session_required"],
    ["fixture_start:ready_timeout", "fixture_start_failed"],
    ["fixture_viewport_timeout", "fixture_unavailable"],
    ["acceptance_browser_bundle_unsupported", "browser_launch_failed"],
    ["focus_sentinel_launch_failed:exited:1:private", "focus_sentinel_unavailable"],
    ["acceptance_mcp_pid_unavailable", "mcp_connection_failed"],
    ["fixture_discovery_failed", "target_lost"],
  ] as const)("normalizes actual harness failure %s", (message, errorCode) => {
    const tracker = new FatalDiagnosticTracker({
      now: () => 0,
      timestamp: () => "2026-08-30T00:00:00.000Z",
    });
    const diagnostic = tracker.build(new Error(message), {
      fixture: false,
      browser: false,
      sentinel: false,
      mcp: false,
    }, true);

    expect(diagnostic.error_code).toBe(errorCode);
    expect(JSON.stringify(diagnostic)).not.toContain("private");
  });

  it("enforces phase, sample, cleanup, and owned-process relationships in the schema", async () => {
    const validate = await parser();
    const performance = expectedDiagnostic();

    expect(validate.safeParse({ ...performance, phase: "reconnect" }).success).toBe(false);
    expect(validate.safeParse({
      ...performance,
      scenario: null,
      sample_kind: null,
      sample_index: null,
    }).success).toBe(false);
    expect(validate.safeParse({
      ...performance,
      owned_processes: { ...performance.owned_processes, fixture: true },
    }).success).toBe(false);
    expect(validate.safeParse({
      ...performance,
      cleanup_passed: false,
      error_code: "fixture_unavailable",
    }).success).toBe(false);

    const tracker = new FatalDiagnosticTracker({
      now: () => 0,
      timestamp: () => "2026-08-30T00:00:00.000Z",
    });
    tracker.setPhase("reconnect");
    expect(validate.safeParse(tracker.build("unexpected", {
      fixture: false,
      browser: true,
      sentinel: false,
      mcp: false,
    }, false)).success).toBe(true);
  });

  it("writes a fatal diagnostic only after guarded cleanup finishes", async () => {
    const root = await mkdtemp(join(tmpdir(), "ucu-fatal-lifecycle-test-"));
    temporaryRoots.push(root);
    const path = join(root, "evidence.json.diagnostic.json");
    const events: string[] = [];
    const failure = new Error("fixture_start:ready_timeout");
    const tracker = new FatalDiagnosticTracker({
      now: () => 5,
      timestamp: () => "2026-08-30T00:00:00.000Z",
    });

    await expect(runFatalGuardedLifecycle({
      diagnosticPath: path,
      tracker,
      operation: async () => {
        events.push("operation");
        throw failure;
      },
      cleanup: async () => {
        events.push("cleanup");
        await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
        return {
          ownedProcesses: { fixture: false, browser: false, sentinel: false, mcp: false },
        };
      },
    })).rejects.toBe(failure);

    expect(events).toEqual(["operation", "cleanup"]);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      error_code: "fixture_start_failed",
      cleanup_passed: true,
      owned_processes: { fixture: false, browser: false, sentinel: false, mcp: false },
    });
  });

  it("turns an internal deadline into cleanup followed by a fatal diagnostic", async () => {
    const root = await mkdtemp(join(tmpdir(), "ucu-fatal-deadline-test-"));
    temporaryRoots.push(root);
    const path = join(root, "evidence.json.diagnostic.json");
    const events: string[] = [];
    const tracker = new FatalDiagnosticTracker({
      now: () => 10,
      timestamp: () => "2026-08-30T00:00:00.000Z",
    });

    await expect(runFatalGuardedLifecycle({
      diagnosticPath: path,
      tracker,
      timeoutMs: 5,
      operation: async (signal) => new Promise<never>((_resolve, reject) => {
        events.push("operation");
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
      cleanup: async () => {
        events.push("cleanup");
        return {
          ownedProcesses: { fixture: false, browser: false, sentinel: false, mcp: false },
        };
      },
    })).rejects.toThrow("acceptance_deadline_exceeded");

    expect(events).toEqual(["operation", "cleanup"]);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      error_code: "acceptance_deadline_exceeded",
      cleanup_passed: true,
    });
  });

  it("writes once with wx and conforms to the strict schema", async () => {
    const root = await mkdtemp(join(tmpdir(), "ucu-fatal-diagnostic-test-"));
    temporaryRoots.push(root);
    const path = join(root, "evidence.json.diagnostic.json");
    let now = 0;
    const tracker = new FatalDiagnosticTracker({
      now: () => now,
      timestamp: () => "2026-08-30T00:00:00.000Z",
    });
    tracker.setPerformanceSample("semantic_action_next_state", "measured", 4);
    tracker.recordTool("computer_act", null);
    now = 103_000;

    await expect(tracker.write(path, new Error("fixture_reset_ack_timeout:private"), {
      fixture: false,
      browser: false,
      sentinel: false,
      mcp: false,
    }, true)).resolves.toEqual(expectedDiagnostic());
    await expect(tracker.write(path, "unexpected", {
      fixture: false,
      browser: false,
      sentinel: false,
      mcp: false,
    }, true)).rejects.toMatchObject({ code: "EEXIST" });

    const written = JSON.parse(await readFile(path, "utf8"));
    expect((await parser()).safeParse(written).success).toBe(true);
    for (const privateField of ["stack", "path", "pid", "screenshot", "text", "ref", "message"]) {
      expect((await parser()).safeParse({ ...written, [privateField]: "private" }).success)
        .toBe(false);
    }
  });
});
