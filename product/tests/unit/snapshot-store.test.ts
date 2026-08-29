import { describe, expect, it } from "vitest";

import { ComputerUseError } from "../../src/errors.js";
import { SnapshotStore } from "../../src/snapshot-store.js";

const identity = (role: string, label: string) => ({
  role,
  label,
  parentChain: [{ role: "window", label: "Calculator" }],
});

describe("SnapshotStore", () => {
  it("keeps exactly one current snapshot", () => {
    const tokens = ["token_a", "token_b"];
    const store = new SnapshotStore(() => 1_000, () => tokens.shift()!);

    const first = store.create("ses_a", 100, 80);
    const second = store.create("ses_a", 120, 90);

    expect(() => store.requireCurrent(first.id)).toThrowError("stale_snapshot");
    expect(store.requireCurrent(second.id)).toMatchObject({
      id: "snap_token_b",
      sessionId: "ses_a",
      width: 120,
      height: 90,
      createdAtMs: 1_000,
    });
  });

  it("consumes the current snapshot exactly once", () => {
    const store = new SnapshotStore(() => 1_000, () => "token_c");
    const snapshot = store.create("ses_a", 100, 80);

    expect(store.consume(snapshot.id)).toBe(snapshot);

    let staleError: unknown;
    try {
      store.consume(snapshot.id);
    } catch (error) {
      staleError = error;
    }
    expect(staleError).toBeInstanceOf(ComputerUseError);
    expect(staleError).toMatchObject({
      code: "stale_snapshot",
      message: "stale_snapshot",
      recovery: "observe_again",
      retryable: true,
    });
  });

  it("expires the current snapshot after thirty idle minutes", () => {
    let now = 0;
    const store = new SnapshotStore(() => now, () => "token_d");
    const snapshot = store.create("ses_a", 100, 80);

    now = 30 * 60 * 1_000 + 1;
    store.expireIdle();

    expect(() => store.requireCurrent(snapshot.id)).toThrowError("stale_snapshot");
  });

  it("clears the current snapshot", () => {
    const store = new SnapshotStore(() => 1_000, () => "token_e");
    const snapshot = store.create("ses_a", 100, 80);

    store.clear();

    expect(() => store.requireCurrent(snapshot.id)).toThrowError("stale_snapshot");
  });

  it("replaces the prior session's snapshot when a new session observes", () => {
    const tokens = ["token_f", "token_g"];
    const store = new SnapshotStore(() => 1_000, () => tokens.shift()!);
    const priorSession = store.create("ses_a", 100, 80);

    const nextSession = store.create("ses_b", 100, 80);

    expect(() => store.requireCurrent(priorSession.id)).toThrowError("stale_snapshot");
    expect(store.requireCurrent(nextSession.id).sessionId).toBe("ses_b");
  });

  it.each([
    [0, 80],
    [-1, 80],
    [1.5, 80],
    [100, 0],
    [100, -1],
    [100, 1.5],
  ])("rejects malformed %s x %s dimensions without replacing the current snapshot", (width, height) => {
    const store = new SnapshotStore(() => 1_000, () => "token_h");
    const current = store.create("ses_a", 100, 80);

    expect(() => store.create("ses_a", width, height)).toThrow(
      "Snapshot dimensions must be positive integers",
    );
    expect(store.requireCurrent(current.id)).toBe(current);
  });

  it("keeps private window and element targets inside one snapshot lifetime", () => {
    const store = new SnapshotStore(() => 1_000, () => "snapshot_token");
    const snapshot = store.create({
      sessionId: "ses_a",
      target: { kind: "window", windowRef: "win_abcdefghijklmnop" },
      observationMode: "visual",
      visual: { status: "available", width: 460, height: 816 },
      coordinateSpace: "window_screenshot_pixels",
      upstreamSnapshotId: "cua-private-snapshot",
      windowTarget: {
        windowRef: "win_abcdefghijklmnop",
        appRef: "app_abcdefghijklmnop",
        nativeKey: "7",
        ownerKey: "pid:42",
      },
      elements: [{
        elementRef: "el_abcdefghijklmnop",
        token: "cua-private-element",
        identity: identity("button", "7"),
        capabilities: ["click"],
      }],
      observeOptions: {
        includeScreenshot: true,
        maxElements: 150,
        maxDepth: 12,
      },
    });

    expect(store.resolveElement(snapshot.id, "el_abcdefghijklmnop")).toMatchObject({
      token: "cua-private-element",
      identity: { role: "button", label: "7" },
    });
    expect(snapshot).toMatchObject({
      observationMode: "visual",
      visualStatus: "available",
      width: 460,
      height: 816,
      upstreamSnapshotId: "cua-private-snapshot",
    });

    store.consume(snapshot.id);
    expect(() => store.resolveElement(snapshot.id, "el_abcdefghijklmnop")).toThrowError("stale_snapshot");
  });

  it("supports semantic-only window snapshots but rejects pixel assumptions", () => {
    const store = new SnapshotStore(() => 1_000, () => "semantic_token");
    const snapshot = store.create({
      sessionId: "ses_a",
      target: { kind: "window", windowRef: "win_abcdefghijklmnop" },
      observationMode: "semantic",
      visual: { status: "capture_unavailable" },
      coordinateSpace: "window_screenshot_pixels",
      windowTarget: {
        windowRef: "win_abcdefghijklmnop",
        appRef: "app_abcdefghijklmnop",
        nativeKey: "7",
        ownerKey: "pid:42",
      },
      elements: [],
      observeOptions: {
        includeScreenshot: true,
        maxElements: 100,
        maxDepth: 10,
      },
    });

    expect(snapshot).toMatchObject({ observationMode: "semantic", visualStatus: "capture_unavailable" });
    expect(snapshot.width).toBeUndefined();
    expect(snapshot.height).toBeUndefined();
  });

  it("rejects unknown or duplicate element refs without replacing the current snapshot", () => {
    const store = new SnapshotStore(() => 1_000, () => "elements_token");
    const current = store.create("ses_a", 100, 80);
    const duplicate = {
      elementRef: "el_abcdefghijklmnop",
      token: "private",
      identity: identity("button", "7"),
      capabilities: ["click"] as const,
    };

    expect(() => store.create({
      sessionId: "ses_a",
      target: { kind: "window", windowRef: "win_abcdefghijklmnop" },
      observationMode: "visual",
      visual: { status: "available", width: 100, height: 80 },
      coordinateSpace: "window_screenshot_pixels",
      windowTarget: {
        windowRef: "win_abcdefghijklmnop",
        appRef: "app_abcdefghijklmnop",
        nativeKey: "7",
        ownerKey: "pid:42",
      },
      elements: [duplicate, duplicate],
      observeOptions: { includeScreenshot: true, maxElements: 100, maxDepth: 10 },
    })).toThrow("Duplicate element_ref");
    expect(store.requireCurrent(current.id)).toBe(current);
    expect(() => store.resolveElement(current.id, "el_abcdefghijklmnop")).toThrowError("stale_element_ref");
  });

  it("never stores an observation mode on desktop snapshots", () => {
    const store = new SnapshotStore(() => 1_000, () => "desktop_token");
    const snapshot = store.create({
      sessionId: "ses_a",
      target: { kind: "desktop" },
      visual: { status: "available", width: 100, height: 80 },
      coordinateSpace: "desktop_screenshot_pixels",
      observeOptions: { includeScreenshot: true, maxElements: 0, maxDepth: 0 },
    });

    expect(snapshot).not.toHaveProperty("observationMode");
  });
});
