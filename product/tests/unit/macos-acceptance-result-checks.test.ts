import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

import {
  buildSemanticSetValueRequest,
  buildForegroundPositiveControlRequest,
  buildVerifiedSemanticClickRequest,
  validEmptyTextGrounding,
  validBackgroundSemanticResult,
  validFixtureObserve,
  validPixelActionResult,
  validSemanticSetValueResult,
} from "../e2e/development/macos-acceptance-result-checks.js";
import { ActInputSchema } from "../../src/protocol.js";

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");

function result(state: Record<string, unknown>, image = false): CallToolResult {
  return {
    content: image
      ? [{ type: "image", mimeType: "image/png", data: PNG }]
      : [{ type: "text", text: "ok" }],
    structuredContent: state,
  };
}

const ELEMENTS = [
  { element_ref: "alpha", label: "Semantic Alpha" },
  { element_ref: "text", label: "Unique text value", value: "nonce" },
  { element_ref: "overlay", label: "Toggle pixel overlay" },
];

describe("macOS acceptance result checks", () => {
  it("builds a schema-valid set_value request without a forbidden delivery override", () => {
    const request = buildSemanticSetValueRequest(
      "snap_grounding123",
      "el_text123456789012",
      "nonce",
    );
    expect(ActInputSchema.parse(request)).toEqual(request);
    expect(request).not.toHaveProperty("delivery");
  });

  it("uses the reset oracle for an empty text precondition when Cua omits empty AXValue", () => {
    expect(validEmptyTextGrounding(
      { text: "", text_write_count: 0 },
      { elementRef: "el_text", value: undefined },
    )).toBe(true);
    expect(validEmptyTextGrounding(
      { text: "", text_write_count: 0 },
      { elementRef: "el_text", value: "stale" },
    )).toBe(false);
    expect(validEmptyTextGrounding(
      { text: "not-empty", text_write_count: 0 },
      { elementRef: "el_text", value: undefined },
    )).toBe(false);
  });

  it("builds a semantic button click with a transition expectation", () => {
    const request = buildVerifiedSemanticClickRequest(
      "snap_grounding123",
      "el_button1234567890",
      "background",
    );
    expect(ActInputSchema.parse(request)).toEqual(request);
    expect(request).toMatchObject({
      delivery: "background",
      expect: { element: { selected: true } },
      next_observation: { mode: "semantic" },
    });
  });

  it("builds a desktop-global positive control without window-only delivery or next observation", () => {
    const request = buildForegroundPositiveControlRequest("snap_desktop123");
    expect(ActInputSchema.parse(request)).toEqual(request);
    expect(request).toEqual({
      snapshot_id: "snap_desktop123",
      action: { type: "keypress", keys: ["cmd", "tab"] },
    });
    expect(request).not.toHaveProperty("delivery");
  });

  it("requires a nonempty fixed control set for visual and semantic window observations", () => {
    expect(validFixtureObserve(result({
      snapshot_id: "fresh",
      observation_mode: "visual",
      visual_status: "available",
      elements: ELEMENTS,
    }, true), true)).toBe(true);
    expect(validFixtureObserve(result({
      snapshot_id: "fresh",
      observation_mode: "semantic",
      visual_status: "not_requested",
      elements: [],
    }), false)).toBe(false);
  });

  it("requires a fresh semantic next state, background delivery and exactly one public nonce", () => {
    const valid = result({
      snapshot_id: "fresh",
      consumed_snapshot_id: "grounding",
      observation_mode: "semantic",
      visual_status: "not_requested",
      action_result: { status: "executed", effect: "confirmed", delivery: "background" },
      verification: { status: "satisfied" },
      elements: ELEMENTS,
    });
    expect(validSemanticSetValueResult(valid, {
      groundingSnapshot: "grounding",
      nonce: "nonce",
      oracleText: "nonce",
      oracleWriteCount: 1,
    })).toBe(true);
    expect(validSemanticSetValueResult(result({
      ...valid.structuredContent as Record<string, unknown>,
      snapshot_id: "grounding",
      action_result: { status: "executed", effect: "confirmed", delivery: "unknown" },
      elements: [...ELEMENTS, { element_ref: "duplicate", label: "duplicate", value: "nonce" }],
    }), {
      groundingSnapshot: "grounding",
      nonce: "nonce",
      oracleText: "nonce",
      oracleWriteCount: 1,
    })).toBe(false);
  });

  it("requires a fresh foreground visual next state and an exactly-once pixel oracle", () => {
    const valid = result({
      snapshot_id: "fresh",
      consumed_snapshot_id: "grounding",
      observation_mode: "visual",
      visual_status: "available",
      action_result: { status: "executed", effect: "confirmed", delivery: "foreground" },
      elements: ELEMENTS,
    }, true);
    expect(validPixelActionResult(valid, {
      groundingSnapshot: "grounding",
      beforeClicks: 4,
      afterClicks: 5,
    })).toBe(true);
    expect(validPixelActionResult(valid, {
      groundingSnapshot: "grounding",
      beforeClicks: 4,
      afterClicks: 6,
    })).toBe(false);
  });

  it("ties focus evidence to the actual background-action grounding snapshot", () => {
    const state = result({
      snapshot_id: "after-background",
      consumed_snapshot_id: "background-grounding",
      observation_mode: "semantic",
      visual_status: "not_requested",
      action_result: { status: "executed", effect: "confirmed", delivery: "background" },
      verification: { status: "satisfied" },
    });
    expect(validBackgroundSemanticResult(state, "background-grounding")).toBe(true);
    expect(validBackgroundSemanticResult(state, "foreground-grounding")).toBe(false);
  });
});
