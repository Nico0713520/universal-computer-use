import { describe, expect, it } from "vitest";

import {
  matchIdentity,
  verifyWindowState,
  type VerificationExpectation,
} from "../../src/core/verifier.js";
import type { EngineElement, EngineWindowObservation } from "../../src/engine/port.js";
import type { ElementIdentity } from "../../src/snapshot-store.js";

const identity: ElementIdentity = {
  role: "textfield",
  label: "name",
  parentChain: [{ role: "group", label: "profile" }],
};

function elements(value: string): EngineElement[] {
  return [
    { index: 0, token: "parent", role: "AXGroup", label: "Profile", depth: 0 },
    {
      index: 1,
      token: "field",
      role: "AXTextField",
      label: "Name",
      value,
      enabled: true,
      parentIndex: 0,
      depth: 1,
    },
  ];
}

function observation(value: string, duplicates = 1): EngineWindowObservation {
  const base = elements(value);
  const projected = duplicates === 1
    ? base
    : [...base, { ...base[1]!, index: 2, token: "field-2" }];
  return {
    platform: "macos",
    target: {
      windowRef: "win_abcdefghijklmnop",
      appRef: "app_abcdefghijklmnop",
      appName: "Fixture",
      nativeKey: "window:7",
      ownerKey: "pid:42",
      title: "Fixture",
      bounds: { x: 0, y: 0, width: 400, height: 300 },
      focused: false,
      capabilities: ["observe"],
      native: { platform: "macos", pid: 42, window_id: 7 },
    },
    visualStatus: "not_requested",
    elements: projected,
    elementsComplete: true,
  };
}

describe("bounded window verification", () => {
  it("matches identity by role, label, and parent chain while ignoring value", () => {
    expect(matchIdentity(identity, elements("old"))).toMatchObject({
      kind: "unique",
      element: { token: "field", value: "old" },
    });
    expect(matchIdentity(identity, elements("new"))).toMatchObject({
      kind: "unique",
      element: { token: "field", value: "new" },
    });
    expect(matchIdentity(identity, [])).toEqual({ kind: "missing" });
    expect(matchIdentity(identity, observation("new", 2).elements)).toEqual({ kind: "multiple" });
  });

  it("observes immediately and uses bounded 50/100/200 backoff until satisfied", async () => {
    const values = ["old", "old", "old", "new"];
    const delays: number[] = [];
    const expectation: VerificationExpectation = {
      identity,
      valueEquals: "new",
      preSatisfied: false,
    };

    const result = await verifyWindowState({
      observe: async () => observation(values.shift()!),
      expectation,
      timeoutMs: 1_000,
      signal: new AbortController().signal,
      sleep: async (ms) => { delays.push(ms); },
    });

    expect(delays).toEqual([50, 100, 200]);
    expect(result.verification).toEqual({ status: "satisfied" });
    expect(result.transitioned).toBe(true);
    expect(result.observation.elements[1]?.value).toBe("new");
  });

  it("never sleeps first, and reports ambiguous or unsatisfied state without guessing", async () => {
    const delays: number[] = [];
    const ambiguous = await verifyWindowState({
      observe: async () => observation("new", 2),
      expectation: { identity, valueEquals: "new", preSatisfied: false },
      timeoutMs: 0,
      signal: new AbortController().signal,
      sleep: async (ms) => { delays.push(ms); },
    });
    expect(delays).toEqual([]);
    expect(ambiguous.verification).toEqual({ status: "unknown", reason: "element_not_unique" });

    const unsatisfied = await verifyWindowState({
      observe: async () => observation("old"),
      expectation: { identity, valueEquals: "new", preSatisfied: false },
      timeoutMs: 0,
      signal: new AbortController().signal,
      sleep: async () => undefined,
    });
    expect(unsatisfied.verification).toEqual({ status: "unsatisfied", reason: "predicate_unsatisfied" });
  });

  it("does not call a pre-satisfied condition a transition", async () => {
    const result = await verifyWindowState({
      observe: async () => observation("new"),
      expectation: { identity, valueEquals: "new", preSatisfied: true },
      timeoutMs: 5_000,
      signal: new AbortController().signal,
      sleep: async () => { throw new Error("must not sleep after immediate satisfaction"); },
    });
    expect(result.verification).toEqual({ status: "satisfied" });
    expect(result.transitioned).toBe(false);
  });
});
