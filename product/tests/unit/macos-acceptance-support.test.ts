import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  attachAcceptanceTelemetry,
  backgroundTargetStayedCovered,
  buildOwnedApplicationActivationScript,
  parseFocusSentinelStateLine,
  requireInteractiveSession,
  waitForOwnedPidExit,
} from "../e2e/development/macos-acceptance-support.js";

describe("macOS acceptance MCP transport", () => {
  it("continuously drains piped stderr into the redacted collector", async () => {
    const stderr = new PassThrough();
    const telemetry = attachAcceptanceTelemetry({ stderr });

    stderr.write(Buffer.alloc(2 * 1024 * 1024, 32));
    stderr.write("\n");
    await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));

    expect(stderr.readableFlowing).toBe(true);
    expect(stderr.readableLength).toBe(0);
    expect(telemetry.consumeOne(0, "computer_observe")).toBeUndefined();
    stderr.end();
  });

  it("proves an owned child PID has exited instead of trusting transport close alone", async () => {
    await expect(waitForOwnedPidExit(2_147_483_647, 0)).resolves.toBeUndefined();
    await expect(waitForOwnedPidExit(process.pid, 0)).rejects.toThrow(
      "acceptance_cleanup_mcp_process_alive",
    );
  });
});

describe("owned AppKit fixture state", () => {
  it("accepts only complete machine-readable native text state lines", () => {
    expect(parseFocusSentinelStateLine(JSON.stringify({
      event: "state",
      reset_generation: 4,
      text: "nonce",
      text_write_count: 1,
    }))).toEqual({ reset_generation: 4, text: "nonce", text_write_count: 1 });
    expect(parseFocusSentinelStateLine('{"event":"ready","pid":42}')).toBeUndefined();
    expect(parseFocusSentinelStateLine("not json")).toBeUndefined();
    expect(parseFocusSentinelStateLine(JSON.stringify({
      event: "state",
      reset_generation: 4,
      text: "nonce",
      text_write_count: -1,
    }))).toBeUndefined();
  });

  it("builds an activation command bound to the exact owned application identity", () => {
    const script = buildOwnedApplicationActivationScript({
      bundleIdentifier: "com.google.Chrome",
      processIdentifier: 4242,
    });

    expect(script).toContain("runningApplicationWithProcessIdentifier(4242)");
    expect(script).toContain(JSON.stringify("com.google.Chrome"));
    expect(script).toContain("activateWithOptions");
    expect(() => buildOwnedApplicationActivationScript({
      bundleIdentifier: "com.google.Chrome",
      processIdentifier: 0,
    })).toThrow("owned_application_identity_invalid");
  });

  it("rejects the macOS login window before starting owned GUI resources", () => {
    expect(() => requireInteractiveSession({
      bundleIdentifier: "com.apple.loginwindow",
      processIdentifier: 404,
    })).toThrow("acceptance_preflight_interactive_session_required");
    expect(() => requireInteractiveSession({
      bundleIdentifier: "com.apple.finder",
      processIdentifier: 405,
    })).not.toThrow();
  });

  it("attributes focus correctly when an unrelated app wins the foreground", () => {
    const chrome = { bundleIdentifier: "com.google.Chrome", processIdentifier: 101 };
    const target = { bundleIdentifier: "dev.ucu.target", processIdentifier: 202 };

    expect(backgroundTargetStayedCovered(chrome, chrome, chrome, target)).toBe(true);
    expect(backgroundTargetStayedCovered(
      chrome,
      { bundleIdentifier: "com.openai.codex", processIdentifier: 303 },
      chrome,
      target,
    )).toBe(true);
    expect(backgroundTargetStayedCovered(chrome, target, chrome, target)).toBe(false);
    expect(backgroundTargetStayedCovered(
      { bundleIdentifier: "com.apple.Finder", processIdentifier: 404 },
      chrome,
      chrome,
      target,
    )).toBe(false);
  });
});
