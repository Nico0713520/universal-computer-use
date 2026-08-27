import { describe, expect, it } from "vitest";

import { ComputerUseError } from "../../src/errors.js";
import { SnapshotStore } from "../../src/snapshot-store.js";

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
});
