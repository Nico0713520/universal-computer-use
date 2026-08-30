import { readFile, readdir } from "node:fs/promises";
import { delimiter, isAbsolute } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

const hostDirectory = new URL("../e2e/host/", import.meta.url);
const schemaUrl = new URL("../e2e/host/development-evidence.schema.json", import.meta.url);
const releaseEvidenceTestUrl = new URL("./host-evidence.test.ts", import.meta.url);
const releaseVerifierUrl = new URL("../../scripts/verify-release.mjs", import.meta.url);

type JsonRecord = Record<string, unknown>;

async function readJson(urlOrPath: URL | string): Promise<JsonRecord> {
  return JSON.parse(await readFile(urlOrPath, "utf8")) as JsonRecord;
}

async function evidenceParser(): Promise<z.ZodType> {
  const schema = await readJson(schemaUrl);
  const { oneOf, ...strictBase } = schema;
  if (!Array.isArray(oneOf)) throw new Error("host development status contract is missing");
  return z.pipe(
    z.fromJSONSchema(strictBase as never),
    z.fromJSONSchema(schema as never),
  );
}

function completeDevelopmentEvidence(): JsonRecord {
  return {
    schema_version: 1,
    evidence_type: "computer-use-host-development-loop",
    status: "development-passed",
    host: {
      name: "hanaagent",
      version: "2026.8.29",
      reported_model_id: "host:model-vision-1",
    },
    system: {
      platform: "macos",
      os_version: "15.6.1",
      engine_version: "0.22.2",
    },
    tools: ["computer_observe", "computer_act"],
    image_delivery: {
      mime_type: "image/png",
      first_turn_png: true,
      later_turn_png: true,
      same_host_reported_model: true,
    },
    continuous_loop: {
      repeated_tool_calls: true,
      turns_observed: 4,
    },
    automatic_mode: {
      plugin_confirmation_count: 0,
      host_authorization: "host-approval-observed",
    },
    task_results: {
      calculator: {
        result: "passed",
        expression: "37x19",
        visible_result: "703",
        exact_window_mode: true,
      },
      text_edit: {
        result: "passed",
        visible_gui_interaction: true,
        one_use_sentence_recorded: false,
      },
    },
    natural_stop: {
      result: "passed",
      tool_calls_after_visible_goal: 0,
    },
    timestamp: "2026-08-29T12:34:56.000Z",
    reviewer: {
      id: "reviewer-01",
      method: "manual-host-development-runbook",
    },
  };
}

describe("named-host development evidence", () => {
  it("accepts only the strict, non-promotable host-development record", async () => {
    const schema = await readJson(schemaUrl);
    const parser = await evidenceParser();

    expect(schema).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
    });
    expect(parser.safeParse(completeDevelopmentEvidence()).success).toBe(true);

    for (const host of ["codex", "kimi", "hanaagent", "workbuddy"]) {
      const candidate = completeDevelopmentEvidence();
      (candidate.host as JsonRecord).name = host;
      expect(parser.safeParse(candidate).success, host).toBe(true);
    }
    for (const status of ["development-passed", "failed", "blocked", "not-run"]) {
      const candidate = completeDevelopmentEvidence();
      candidate.status = status;
      expect(parser.safeParse(candidate).success, status).toBe(true);
    }

    const wrongTools = completeDevelopmentEvidence();
    wrongTools.tools = ["computer_observe", "computer_act", "computer_verify"];
    expect(parser.safeParse(wrongTools).success).toBe(false);
  });

  it("requires every development-passed safety and task condition", async () => {
    const parser = await evidenceParser();
    const mutations: Array<(value: JsonRecord) => void> = [
      (value) => { (value.image_delivery as JsonRecord).first_turn_png = false; },
      (value) => { (value.image_delivery as JsonRecord).later_turn_png = false; },
      (value) => { (value.image_delivery as JsonRecord).same_host_reported_model = false; },
      (value) => { (value.continuous_loop as JsonRecord).repeated_tool_calls = false; },
      (value) => { (value.continuous_loop as JsonRecord).turns_observed = 1; },
      (value) => { (value.automatic_mode as JsonRecord).plugin_confirmation_count = 1; },
      (value) => { (value.automatic_mode as JsonRecord).host_authorization = "host-policy-blocked"; },
      (value) => {
        const tasks = value.task_results as JsonRecord;
        (tasks.calculator as JsonRecord).result = "failed";
      },
      (value) => {
        const tasks = value.task_results as JsonRecord;
        (tasks.calculator as JsonRecord).exact_window_mode = false;
      },
      (value) => {
        const tasks = value.task_results as JsonRecord;
        (tasks.text_edit as JsonRecord).result = "failed";
      },
      (value) => {
        const tasks = value.task_results as JsonRecord;
        (tasks.text_edit as JsonRecord).visible_gui_interaction = false;
      },
      (value) => { (value.natural_stop as JsonRecord).result = "failed"; },
      (value) => { (value.natural_stop as JsonRecord).tool_calls_after_visible_goal = 1; },
    ];

    for (const mutate of mutations) {
      const candidate = completeDevelopmentEvidence();
      mutate(candidate);
      expect(parser.safeParse(candidate).success).toBe(false);
    }
  });

  it("rejects release links and every sensitive or free-form field", async () => {
    const parser = await evidenceParser();
    const injections: Array<[string, (value: JsonRecord) => void]> = [
      ["release evidence", (value) => { value.eligible_platform_evidence = { reference: "mac.json" }; }],
      ["hash", (value) => { value.sha256 = "a".repeat(64); }],
      ["screenshot", (value) => { value.screenshot = "base64-png"; }],
      ["text", (value) => { value.typed_sentence = "private sentence"; }],
      ["path", (value) => { value.path = "/private/work"; }],
      ["environment", (value) => { value.environment = { HOME: "/private/user" }; }],
      ["identity", (value) => { value.username = "private-user"; }],
      ["hostname", (value) => { value.hostname = "private-host"; }],
      ["pid", (value) => { value.pid = 123; }],
      ["window id", (value) => { value.window_id = 456; }],
      ["snapshot", (value) => { value.snapshot_id = "snap-secret"; }],
      ["ref", (value) => { value.window_ref = "win-secret"; }],
      ["token", (value) => { value.element_token = "token-secret"; }],
    ];

    for (const [label, inject] of injections) {
      const candidate = completeDevelopmentEvidence();
      inject(candidate);
      expect(parser.safeParse(candidate).success, label).toBe(false);
    }
  });

  it("keeps development evidence external and outside release promotion", async () => {
    const releaseVerifier = await readFile(releaseVerifierUrl, "utf8");
    const releaseEvidenceTest = await readFile(releaseEvidenceTestUrl, "utf8");
    for (const source of [releaseVerifier, releaseEvidenceTest]) {
      expect(source).not.toContain("development-evidence.schema.json");
      expect(source).not.toContain("CUA_HOST_DEVELOPMENT_EVIDENCE_FILES");
    }

    const configuredPaths = process.env.CUA_HOST_DEVELOPMENT_EVIDENCE_FILES;
    if (!configuredPaths) {
      const repositoryFiles = await readdir(hostDirectory);
      expect(repositoryFiles.filter((name) => name.endsWith(".json") && !name.endsWith(".schema.json")))
        .toEqual([]);
      return;
    }

    const parser = await evidenceParser();
    const evidencePaths = configuredPaths.split(delimiter).filter(Boolean);
    expect(evidencePaths.length).toBeGreaterThan(0);
    for (const evidencePath of evidencePaths) {
      expect(isAbsolute(evidencePath)).toBe(true);
      parser.parse(await readJson(evidencePath));
    }
  });

  it("ships the same development acceptance requirements for all four hosts", async () => {
    for (const host of ["codex", "kimi", "hanaagent", "workbuddy"] as const) {
      const runbook = await readFile(new URL(`${host}.md`, hostDirectory), "utf8");
      expect(runbook).toContain("setup --development");
      expect(runbook).toContain("doctor --json");
      expect(runbook).toMatch(/restart/i);
      expect(runbook).toContain("computer_observe");
      expect(runbook).toContain("computer_act");
      expect(runbook).toContain("37 × 19");
      expect(runbook).toContain("703");
      expect(runbook).toMatch(/exact-window/i);
      expect(runbook).toContain("TextEdit");
      expect(runbook).toContain("one-use sentence");
      expect(runbook).toMatch(/visible GUI interaction/i);
      expect(runbook).toContain("first PNG");
      expect(runbook).toContain("later PNG");
      expect(runbook).toContain("same host-reported model");
      expect(runbook).toContain("repeated tool calls");
      expect(runbook).toContain("natural stop");
      expect(runbook).toContain("plugin confirmation count is zero");
      expect(runbook).toContain("host approval");
      expect(runbook).toContain("CUA_HOST_DEVELOPMENT_EVIDENCE_FILES");
      expect(runbook).toContain("`development-passed` is not `verified`");
      expect(runbook).toContain("cannot satisfy release verification");
    }

    for (const host of ["codex", "hanaagent", "workbuddy"] as const) {
      const runbook = await readFile(new URL(`${host}.md`, hostDirectory), "utf8");
      expect(runbook).toContain("quit only the installed CuaDriver");
      expect(runbook).toContain("without a fixed sleep");
      expect(runbook).toMatch(/bridge script|shell-driven JSON-RPC/);
      expect(runbook).toContain("does not count as direct");
    }

    for (const host of ["hanaagent", "workbuddy"] as const) {
      const runbook = await readFile(new URL(`${host}.md`, hostDirectory), "utf8");
      expect(runbook).toContain("absolute");
      expect(runbook).toContain("stdio");
      expect(runbook).not.toMatch(/automatic(?:ally)? install/i);
    }
  });
});
