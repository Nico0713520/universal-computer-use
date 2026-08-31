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
    schema_version: 2,
    evidence_type: "computer-use-host-development-loop",
    status: "verified-development",
    build: {
      repository: "https://github.com/Nico0713520/universal-computer-use",
      git_commit: "0123456789abcdef0123456789abcdef01234567",
      product: "0.2.6",
      protocol: "1.2.0",
      engine: "0.22.2",
    },
    host: {
      name: "hanaagent",
      version: "2026.8.31",
      reported_model_id: "host:model-vision-1",
    },
    system: {
      platform: "macos",
      os_version: "15.6.1",
      arch: "arm64",
    },
    transport: {
      direct_stdio: true,
      shell_bridge: false,
      builtin_computer_use: false,
    },
    mcp: {
      server_name: "computer-use",
      tools: ["computer_observe", "computer_act"],
    },
    image_delivery: {
      mime_type: "image/png",
      first_turn_png: true,
      second_turn_png: true,
      same_host_reported_model: true,
      same_direct_loop: true,
    },
    continuous_loop: {
      repeated_tool_calls: true,
      turns_observed: 6,
    },
    automatic_mode: {
      plugin_confirmation_count: 0,
      host_authorization: "no-host-prompt-observed",
    },
    task_results: {
      calculator: {
        result: "pass",
        visible_expression: "37×19",
        visible_result: "703",
        naturally_stopped: true,
      },
      unique_input: {
        result: "pass",
        exact_value_confirmed: true,
        write_count: 1,
        nonce_recorded: false,
        naturally_stopped: true,
      },
      covered_window: {
        result: "pass",
        semantic_background_effect: true,
        pixel_window_effect: true,
        target_remained_background: true,
        foreground_fallback: "not-needed",
        naturally_stopped: true,
      },
    },
    natural_stop: {
      result: "pass",
      tool_calls_after_goal: 0,
    },
    limitations: [],
    timestamp: "2026-08-31T12:34:56.000Z",
    reviewer: {
      id: "reviewer-01",
      method: "manual-host-development-runbook",
    },
  };
}

describe("named-host development evidence v2", () => {
  it("accepts one strict v2 record for each Preview host and rejects the v1 identity", async () => {
    const schema = await readJson(schemaUrl);
    const parser = await evidenceParser();

    expect(schema).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://universal-computer-use.invalid/schemas/host-development-evidence-v2.json",
      type: "object",
      additionalProperties: false,
    });
    expect(parser.safeParse(completeDevelopmentEvidence()).success).toBe(true);

    for (const host of ["codex", "hanaagent", "workbuddy"]) {
      const candidate = completeDevelopmentEvidence();
      (candidate.host as JsonRecord).name = host;
      expect(parser.safeParse(candidate).success, host).toBe(true);
    }

    const oldIdentity = completeDevelopmentEvidence();
    oldIdentity.schema_version = 1;
    expect(parser.safeParse(oldIdentity).success).toBe(false);
  });

  it("rejects mixed builds, branch names, indirect transport, wrong platform, and an altered MCP surface", async () => {
    const parser = await evidenceParser();
    expect(parser.safeParse(completeDevelopmentEvidence()).success).toBe(true);
    const mutations: Array<[string, (value: JsonRecord) => void]> = [
      ["repository", (value) => { (value.build as JsonRecord).repository = "https://github.com/other/project"; }],
      ["branch", (value) => { (value.build as JsonRecord).git_commit = "main"; }],
      ["uppercase commit", (value) => { (value.build as JsonRecord).git_commit = "A".repeat(40); }],
      ["short commit", (value) => { (value.build as JsonRecord).git_commit = "a".repeat(39); }],
      ["product", (value) => { (value.build as JsonRecord).product = "0.2.5"; }],
      ["protocol", (value) => { (value.build as JsonRecord).protocol = "1.1.0"; }],
      ["engine", (value) => { (value.build as JsonRecord).engine = "0.22.1"; }],
      ["platform", (value) => { (value.system as JsonRecord).platform = "windows"; }],
      ["OS", (value) => { (value.system as JsonRecord).os_version = "latest"; }],
      ["arch", (value) => { (value.system as JsonRecord).arch = "universal"; }],
      ["not direct", (value) => { (value.transport as JsonRecord).direct_stdio = false; }],
      ["shell bridge", (value) => { (value.transport as JsonRecord).shell_bridge = true; }],
      ["builtin tool", (value) => { (value.transport as JsonRecord).builtin_computer_use = true; }],
      ["server name", (value) => { (value.mcp as JsonRecord).server_name = "other"; }],
      ["third tool", (value) => { (value.mcp as JsonRecord).tools = ["computer_observe", "computer_act", "computer_verify"]; }],
      ["tool order", (value) => { (value.mcp as JsonRecord).tools = ["computer_act", "computer_observe"]; }],
      ["first PNG", (value) => { (value.image_delivery as JsonRecord).first_turn_png = false; }],
      ["second PNG", (value) => { (value.image_delivery as JsonRecord).second_turn_png = false; }],
      ["different model", (value) => { (value.image_delivery as JsonRecord).same_host_reported_model = false; }],
      ["different loop", (value) => { (value.image_delivery as JsonRecord).same_direct_loop = false; }],
      ["one turn", (value) => { (value.continuous_loop as JsonRecord).turns_observed = 1; }],
      ["no repeat", (value) => { (value.continuous_loop as JsonRecord).repeated_tool_calls = false; }],
      ["plugin prompt", (value) => { (value.automatic_mode as JsonRecord).plugin_confirmation_count = 1; }],
      ["host blocked", (value) => { (value.automatic_mode as JsonRecord).host_authorization = "host-policy-blocked"; }],
    ];

    for (const [label, mutate] of mutations) {
      const candidate = completeDevelopmentEvidence();
      mutate(candidate);
      expect(parser.safeParse(candidate).success, label).toBe(false);
    }
  });

  it("requires all three tasks, exactly-once input, background proof, and natural stopping", async () => {
    const parser = await evidenceParser();
    expect(parser.safeParse(completeDevelopmentEvidence()).success).toBe(true);
    const mutations: Array<[string, (value: JsonRecord) => void]> = [
      ["calculator failed", (value) => { ((value.task_results as JsonRecord).calculator as JsonRecord).result = "fail"; }],
      ["calculator expression", (value) => { ((value.task_results as JsonRecord).calculator as JsonRecord).visible_expression = "37x19"; }],
      ["calculator result", (value) => { ((value.task_results as JsonRecord).calculator as JsonRecord).visible_result = "not-observed"; }],
      ["calculator kept going", (value) => { ((value.task_results as JsonRecord).calculator as JsonRecord).naturally_stopped = false; }],
      ["unique failed", (value) => { ((value.task_results as JsonRecord).unique_input as JsonRecord).result = "fail"; }],
      ["unique not exact", (value) => { ((value.task_results as JsonRecord).unique_input as JsonRecord).exact_value_confirmed = false; }],
      ["duplicate write", (value) => { ((value.task_results as JsonRecord).unique_input as JsonRecord).write_count = 2; }],
      ["stored nonce", (value) => { ((value.task_results as JsonRecord).unique_input as JsonRecord).nonce_recorded = true; }],
      ["unique kept going", (value) => { ((value.task_results as JsonRecord).unique_input as JsonRecord).naturally_stopped = false; }],
      ["covered failed", (value) => { ((value.task_results as JsonRecord).covered_window as JsonRecord).result = "fail"; }],
      ["semantic foreground", (value) => { ((value.task_results as JsonRecord).covered_window as JsonRecord).semantic_background_effect = false; }],
      ["pixel missing", (value) => { ((value.task_results as JsonRecord).covered_window as JsonRecord).pixel_window_effect = false; }],
      ["focus stolen", (value) => { ((value.task_results as JsonRecord).covered_window as JsonRecord).target_remained_background = false; }],
      ["foreground fallback", (value) => { ((value.task_results as JsonRecord).covered_window as JsonRecord).foreground_fallback = "reported"; }],
      ["fallback hidden", (value) => { ((value.task_results as JsonRecord).covered_window as JsonRecord).foreground_fallback = "silent"; }],
      ["covered kept going", (value) => { ((value.task_results as JsonRecord).covered_window as JsonRecord).naturally_stopped = false; }],
      ["overall failed", (value) => { (value.natural_stop as JsonRecord).result = "fail"; }],
      ["extra tool call", (value) => { (value.natural_stop as JsonRecord).tool_calls_after_goal = 1; }],
    ];

    for (const [label, mutate] of mutations) {
      const candidate = completeDevelopmentEvidence();
      mutate(candidate);
      expect(parser.safeParse(candidate).success, label).toBe(false);
    }
  });

  it("rejects release links and all raw user, prompt, nonce, argument, clipboard, or image material", async () => {
    const parser = await evidenceParser();
    expect(parser.safeParse(completeDevelopmentEvidence()).success).toBe(true);
    const injections: Array<[string, (value: JsonRecord) => void]> = [
      ["release evidence", (value) => { value.eligible_platform_evidence = { reference: "mac.json" }; }],
      ["hash", (value) => { value.sha256 = "a".repeat(64); }],
      ["screenshot", (value) => { value.screenshot = "base64-png"; }],
      ["raw image", (value) => { value.raw_image_payload = "iVBOR"; }],
      ["prompt", (value) => { value.prompt = "private prompt"; }],
      ["nonce", (value) => { value.nonce = "private nonce"; }],
      ["tool arguments", (value) => { value.tool_arguments = { text: "private" }; }],
      ["clipboard", (value) => { value.clipboard_content = "private"; }],
      ["user content", (value) => { value.user_content = "private"; }],
      ["path", (value) => { value.path = "/private/work"; }],
      ["environment", (value) => { value.environment = { HOME: "/private/user" }; }],
      ["identity", (value) => { value.username = "private-user"; }],
      ["hostname", (value) => { value.hostname = "private-host"; }],
      ["pid", (value) => { value.pid = 123; }],
      ["window id", (value) => { value.window_id = 456; }],
      ["snapshot", (value) => { value.snapshot_id = "snap-secret"; }],
      ["ref", (value) => { value.window_ref = "win-secret"; }],
      ["token", (value) => { value.element_token = "token-secret"; }],
      ["free limitation", (value) => { value.limitations = ["private details"]; }],
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

  it("ships exact-commit, direct, serial, privacy-safe Preview runbooks for the three target hosts", async () => {
    for (const host of ["codex", "hanaagent", "workbuddy"] as const) {
      const runbook = await readFile(new URL(`${host}.md`, hostDirectory), "utf8");

      expect(runbook).toContain("https://github.com/Nico0713520/universal-computer-use");
      expect(runbook).toContain("40-character lowercase commit");
      expect(runbook).toContain("git checkout --detach");
      expect(runbook).toContain("git rev-parse HEAD");
      expect(runbook).toContain(`config --client ${host}`);
      expect(runbook).toContain("setup --development");
      expect(runbook).toContain("doctor --json");
      expect(runbook).toMatch(/restart/i);
      expect(runbook).toContain("new conversation");
      expect(runbook).toContain("serial");
      expect(runbook).toContain("direct stdio");
      expect(runbook).toContain("computer_observe");
      expect(runbook).toContain("computer_act");
      expect(runbook).toContain("first PNG");
      expect(runbook).toContain("second PNG");
      expect(runbook).toContain("same host-reported model");
      expect(runbook).toContain("Calculator");
      expect(runbook).toContain("37 × 19");
      expect(runbook).toContain("703");
      expect(runbook).toContain("unique_input");
      expect(runbook).toContain("write_count: 1");
      expect(runbook).toContain("covered_window");
      expect(runbook).toContain("semantic background");
      expect(runbook).toContain("pixel-window");
      expect(runbook).toContain("natural stop");
      expect(runbook).toContain("shell bridge");
      expect(runbook).toContain("AppleScript");
      expect(runbook).toContain("DOM automation");
      expect(runbook).toContain("mental arithmetic");
      expect(runbook).toContain("built-in Computer Use");
      expect(runbook).toContain("invalidates the result");
      expect(runbook).toContain("schema_version: 2");
      expect(runbook).toContain("verified-development");
      expect(runbook).toContain("CUA_HOST_DEVELOPMENT_EVIDENCE_FILES");
      expect(runbook).toContain("Return only");
      for (const forbiddenEvidence of [
        "screenshots",
        "prompts",
        "nonces",
        "tool arguments",
        "clipboard contents",
        "raw image payloads",
      ]) {
        expect(runbook).toContain(forbiddenEvidence);
      }
      expect(runbook).not.toContain("`development-passed`");
    }
  });

  it("retires the old Kimi development lane without changing its release runbook", async () => {
    const runbook = await readFile(new URL("kimi.md", hostDirectory), "utf8");

    expect(runbook).toContain("Kimi is not part of the v0.2.6 Mac Agent Preview host set");
    expect(runbook).not.toContain("development-evidence.schema.json");
    expect(runbook).not.toContain("CUA_HOST_DEVELOPMENT_EVIDENCE_FILES");
    expect(runbook).toContain("CUA_HOST_EVIDENCE_FILES");
  });
});
