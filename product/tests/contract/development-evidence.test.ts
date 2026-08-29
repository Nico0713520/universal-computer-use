import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { z } from "zod";

const schemaUrl = new URL("../e2e/development/evidence.schema.json", import.meta.url);

type JsonRecord = Record<string, unknown>;

async function evidenceParser(): Promise<z.ZodType> {
  const schema = JSON.parse(await readFile(schemaUrl, "utf8")) as JsonRecord;
  const { oneOf, ...strictBase } = schema;
  if (!Array.isArray(oneOf)) throw new Error("development evidence status contract is missing");
  return z.pipe(
    z.fromJSONSchema(strictBase as never),
    z.fromJSONSchema(schema as never),
  );
}

function completeEvidence(): JsonRecord {
  return {
    schema_version: 2,
    evidence_type: "computer-use-macos-development-acceptance",
    status: "passed",
    metadata: {
      product_version: "0.2.2",
      protocol_version: "1.2.0",
      engine_version: "0.22.2",
      macos_version: "15.6.1",
      architecture: "arm64",
    },
    scenarios: {
      two_tool_inventory: true,
      desktop_png: true,
      fresh_snapshot: true,
      stale_snapshot_rejected: true,
      exact_window_discovered: true,
      window_png_and_element: true,
      background_element_effect: true,
      window_coordinate_effect: true,
      old_refs_rejected_after_reconnect: true,
    },
    timings: [
      { name: "mcp_start", duration_ms: 100, target_ms: 2_000, hard_limit_ms: 10_000, status: "target_met" },
      { name: "desktop_observe", duration_ms: 100, target_ms: 1_000, hard_limit_ms: 3_000, status: "target_met" },
      { name: "window_discover", duration_ms: 100, target_ms: 1_000, hard_limit_ms: 3_000, status: "target_met" },
      { name: "window_observe", duration_ms: 100, target_ms: 1_000, hard_limit_ms: 3_000, status: "target_met" },
      { name: "coordinate_action", duration_ms: 100, target_ms: 1_000, hard_limit_ms: 3_000, status: "target_met" },
      { name: "element_action", duration_ms: 100, target_ms: 3_000, hard_limit_ms: 8_000, status: "target_met" },
      { name: "mcp_reconnect", duration_ms: 100, target_ms: 2_000, hard_limit_ms: 10_000, status: "target_met" },
    ],
    performance: {
      window_visual_observe: {
        sample_count: 30,
        p50_ms: 500,
        p95_ms: 1_200,
        max_ms: 1_300,
        slo: { p50_ms: 700, p95_ms: 1_500 },
        status: "passed",
      },
      window_semantic_observe: {
        sample_count: 30,
        p50_ms: 300,
        p95_ms: 800,
        max_ms: 900,
        slo: { p50_ms: 400, p95_ms: 1_000 },
        status: "passed",
      },
      semantic_action_next_state: {
        sample_count: 30,
        p50_ms: 800,
        p95_ms: 1_800,
        max_ms: 1_900,
        slo: { p50_ms: 1_000, p95_ms: 2_000 },
        status: "passed",
      },
      pixel_action_next_state: {
        sample_count: 30,
        p50_ms: 1_200,
        p95_ms: 2_800,
        max_ms: 2_900,
        slo: { p50_ms: 1_500, p95_ms: 3_000 },
        status: "passed",
      },
    },
    adaptive_correctness: {
      no_fixed_action_delay: true,
      semantic_sequence: true,
      pixel_once: true,
      unique_input_once: true,
      visual_recovery_once: true,
      focus_preserved: true,
    },
    real_app_smoke: {
      calculator_703: true,
      textedit_unique_value: true,
      textedit_single_write: true,
    },
    cleanup_passed: true,
    timestamp: "2026-08-29T12:34:56.000Z",
  };
}

describe("macOS development acceptance evidence", () => {
  it("accepts only the complete versioned and redacted development record", async () => {
    const schema = JSON.parse(await readFile(schemaUrl, "utf8")) as JsonRecord;
    const parser = await evidenceParser();

    expect(schema).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
    });
    expect(parser.safeParse(completeEvidence()).success).toBe(true);

    const degraded = completeEvidence();
    degraded.status = "degraded";
    ((degraded.timings as JsonRecord[])[5]).duration_ms = 3_001;
    ((degraded.timings as JsonRecord[])[5]).status = "degraded";
    expect(parser.safeParse(degraded).success).toBe(true);
  });

  it("requires all nine successful scenarios and all seven fixed timings", async () => {
    const parser = await evidenceParser();

    const missingScenario = completeEvidence();
    delete (missingScenario.scenarios as JsonRecord).desktop_png;
    expect(parser.safeParse(missingScenario).success).toBe(false);

    const failedScenario = completeEvidence();
    (failedScenario.scenarios as JsonRecord).desktop_png = false;
    expect(parser.safeParse(failedScenario).success).toBe(false);
    failedScenario.status = "failed";
    expect(parser.safeParse(failedScenario).success).toBe(true);

    const missingTiming = completeEvidence();
    (missingTiming.timings as JsonRecord[]).pop();
    expect(parser.safeParse(missingTiming).success).toBe(false);

    const wrongTimingName = completeEvidence();
    (wrongTimingName.timings as JsonRecord[])[0].name = "window_observe";
    expect(parser.safeParse(wrongTimingName).success).toBe(false);
  });

  it("rejects passed status when any timing is degraded", async () => {
    const parser = await evidenceParser();
    const evidence = completeEvidence();
    (evidence.timings as JsonRecord[])[1].duration_ms = 1_001;
    (evidence.timings as JsonRecord[])[1].status = "degraded";

    expect(parser.safeParse(evidence).success).toBe(false);
  });

  it("accepts a truthful failed artifact when a legacy timing exceeds its hard limit", async () => {
    const parser = await evidenceParser();
    const evidence = completeEvidence();
    evidence.status = "failed";
    (evidence.timings as JsonRecord[])[5].duration_ms = 8_001;
    (evidence.timings as JsonRecord[])[5].status = "failed";

    expect(parser.safeParse(evidence).success).toBe(true);
  });

  it("requires all four fixed 30-sample aggregate profiles and real-app smoke", async () => {
    const parser = await evidenceParser();

    const missingProfile = completeEvidence();
    delete (missingProfile.performance as JsonRecord).window_semantic_observe;
    expect(parser.safeParse(missingProfile).success).toBe(false);

    for (const sampleCount of [29, 31]) {
      const wrongCount = completeEvidence();
      ((wrongCount.performance as JsonRecord).window_visual_observe as JsonRecord).sample_count = sampleCount;
      expect(parser.safeParse(wrongCount).success, `sample_count=${sampleCount}`).toBe(false);
    }

    const missingSmoke = completeEvidence();
    delete missingSmoke.real_app_smoke;
    expect(parser.safeParse(missingSmoke).success).toBe(false);
  });

  it("rejects an impossible passed aggregate and raw sample arrays", async () => {
    const parser = await evidenceParser();
    const incorrectRank = completeEvidence();
    ((incorrectRank.performance as JsonRecord).window_visual_observe as JsonRecord).p50_ms = 701;
    expect(parser.safeParse(incorrectRank).success).toBe(false);

    const rawSamples = completeEvidence();
    ((rawSamples.performance as JsonRecord).window_visual_observe as JsonRecord).samples = [100];
    expect(parser.safeParse(rawSamples).success).toBe(false);
  });

  it("requires overall status to reflect performance and real-app smoke", async () => {
    const parser = await evidenceParser();

    const failedProfile = completeEvidence();
    ((failedProfile.performance as JsonRecord).window_semantic_observe as JsonRecord).status = "failed";
    expect(parser.safeParse(failedProfile).success).toBe(false);
    failedProfile.status = "failed";
    expect(parser.safeParse(failedProfile).success).toBe(true);

    const falseSmoke = completeEvidence();
    (falseSmoke.real_app_smoke as JsonRecord).textedit_unique_value = false;
    expect(parser.safeParse(falseSmoke).success).toBe(false);
    falseSmoke.status = "failed";
    (falseSmoke.real_app_smoke as JsonRecord).error_code = "verification_failed";
    expect(parser.safeParse(falseSmoke).success).toBe(true);

    const cleanupFailure = completeEvidence();
    cleanupFailure.status = "failed";
    (cleanupFailure.real_app_smoke as JsonRecord).cleanup_failed = true;
    expect(parser.safeParse(cleanupFailure).success).toBe(true);
  });

  it("requires explicit static and adaptive correctness evidence", async () => {
    const parser = await evidenceParser();
    const missing = completeEvidence();
    delete missing.adaptive_correctness;
    expect(parser.safeParse(missing).success).toBe(false);

    const falseProof = completeEvidence();
    (falseProof.adaptive_correctness as JsonRecord).no_fixed_action_delay = false;
    expect(parser.safeParse(falseProof).success).toBe(false);
    falseProof.status = "failed";
    expect(parser.safeParse(falseProof).success).toBe(true);

    const unknown = completeEvidence();
    (unknown.adaptive_correctness as JsonRecord).raw_findings = [];
    expect(parser.safeParse(unknown).success).toBe(false);
  });

  it("rejects screenshots, content, machine identity and opaque execution references recursively", async () => {
    const parser = await evidenceParser();
    const injections: Array<[string, (value: JsonRecord) => void]> = [
      ["screenshot", (value) => { value.screenshot = "png"; }],
      ["base64", (value) => { value.base64 = "iVBORw0KGgo="; }],
      ["hash", (value) => { value.sha256 = "a".repeat(64); }],
      ["title", (value) => { value.window_title = "private title"; }],
      ["text", (value) => { value.typed_text = "private text"; }],
      ["path", (value) => { value.evidence_path = "/private/tmp/evidence.json"; }],
      ["environment", (value) => { value.environment = { HOME: "/private/user" }; }],
      ["username", (value) => { (value.metadata as JsonRecord).username = "private-user"; }],
      ["hostname", (value) => { (value.metadata as JsonRecord).hostname = "private-host"; }],
      ["pid", (value) => { (value.metadata as JsonRecord).pid = 123; }],
      ["window id", (value) => { (value.metadata as JsonRecord).window_id = 456; }],
      ["snapshot", (value) => { (value.timings as JsonRecord[])[0].snapshot_id = "snap_private"; }],
      ["ref", (value) => { (value.timings as JsonRecord[])[0].window_ref = "wref_private"; }],
      ["token", (value) => { (value.timings as JsonRecord[])[0].element_token = "token_private"; }],
      ["performance screenshot", (value) => {
        ((value.performance as JsonRecord).window_visual_observe as JsonRecord).screenshot = "png";
      }],
      ["performance text", (value) => {
        ((value.performance as JsonRecord).window_visual_observe as JsonRecord).text = "private text";
      }],
      ["performance ref", (value) => {
        ((value.performance as JsonRecord).window_visual_observe as JsonRecord).window_ref = "wref_private";
      }],
      ["performance path", (value) => {
        ((value.performance as JsonRecord).window_visual_observe as JsonRecord).path = "/private/tmp";
      }],
      ["performance pid", (value) => {
        ((value.performance as JsonRecord).window_visual_observe as JsonRecord).pid = 123;
      }],
      ["smoke environment", (value) => {
        (value.real_app_smoke as JsonRecord).environment = { HOME: "/private/user" };
      }],
    ];

    for (const [label, inject] of injections) {
      const candidate = completeEvidence();
      inject(candidate);
      expect(parser.safeParse(candidate).success, label).toBe(false);
    }
  });

  it("requires semantic versions, a supported architecture, successful cleanup and UTC time", async () => {
    const parser = await evidenceParser();
    const mutations: Array<(value: JsonRecord) => void> = [
      (value) => { (value.metadata as JsonRecord).product_version = "v0.2.2"; },
      (value) => { (value.metadata as JsonRecord).architecture = "x64"; },
      (value) => { value.cleanup_passed = false; },
      (value) => { value.timestamp = "2026-08-29 12:34:56"; },
    ];

    for (const mutate of mutations) {
      const candidate = completeEvidence();
      mutate(candidate);
      expect(parser.safeParse(candidate).success).toBe(false);
    }
  });
});
