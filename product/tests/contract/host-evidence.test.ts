import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { loadEngineLock } from "../../src/engine/lock.js";
import { renderConfig } from "../../src/cli/config.js";

const hostDirectory = new URL("../e2e/host/", import.meta.url);
const schemaUrl = new URL("../e2e/host/evidence.schema.json", import.meta.url);
const compatibilityUrl = new URL("../../../docs/host-compatibility.md", import.meta.url);

type JsonRecord = Record<string, unknown>;

async function readJson(urlOrPath: URL | string): Promise<JsonRecord> {
  return JSON.parse(await readFile(urlOrPath, "utf8")) as JsonRecord;
}

async function evidenceParser(): Promise<z.ZodType> {
  const schema = await readJson(schemaUrl);
  const { oneOf, ...strictBase } = schema;
  if (!Array.isArray(oneOf)) throw new Error("host evidence status contract is missing");
  return z.pipe(
    z.fromJSONSchema(strictBase as never),
    z.fromJSONSchema(schema as never),
  );
}

function completeEvidence(): JsonRecord {
  return {
    schema_version: 1,
    evidence_type: "computer-use-host-loop",
    status: "verified",
    host: {
      name: "codex",
      version: "1.2.3",
      reported_model_id: "host:model-vision-1",
    },
    system: {
      platform: "macos",
      os_version: "15.6.1",
      engine_version: "0.22.1",
    },
    eligible_platform_evidence: {
      reference: "platform/macos-candidate.json",
      sha256: "a".repeat(64),
      release_eligible: true,
    },
    tools: ["computer_observe", "computer_act"],
    image_delivery: {
      mime_type: "image/png",
      byte_valid_png: true,
      first_turn_png: true,
      second_turn_png: true,
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
      visible_text_entry: {
        result: "passed",
        visible_keyboard_launch: true,
        one_use_sentence_recorded: false,
      },
      calculator: {
        result: "passed",
        expression: "37x19",
        visible_result: "703",
      },
    },
    natural_stop: {
      result: "passed",
      tool_calls_after_visible_goal: 0,
    },
    timestamp: "2026-08-27T12:34:56.000Z",
    reviewer: {
      id: "reviewer-01",
      method: "manual-host-runbook",
    },
  };
}

async function validateVerifiedEvidenceLink(
  evidence: JsonRecord,
  lock: Awaited<ReturnType<typeof loadEngineLock>>,
  hostEvidencePath: string,
): Promise<void> {
  if (evidence.status !== "verified") return;

  const system = evidence.system as JsonRecord;
  const platform = system.platform as "macos" | "windows";
  const platformEvidence = evidence.eligible_platform_evidence as JsonRecord;
  const platformLock = lock.platforms[platform];
  if (!platformLock.release_eligible) throw new Error("host_platform_not_release_eligible");
  if (system.engine_version !== lock.version) throw new Error("host_engine_version_mismatch");

  const reference = String(platformEvidence.reference);
  if (!platformLock.e2e_evidence.includes(reference)) {
    throw new Error("host_platform_evidence_not_in_lock");
  }

  const evidenceRoot = dirname(resolve(hostEvidencePath));
  const referencedPath = resolve(evidenceRoot, reference);
  const referencedRelative = relative(evidenceRoot, referencedPath);
  if (
    referencedRelative === ".." ||
    referencedRelative.startsWith(`..${sep}`) ||
    isAbsolute(referencedRelative)
  ) {
    throw new Error("host_platform_evidence_outside_bundle");
  }

  const digest = createHash("sha256")
    .update(await readFile(referencedPath))
    .digest("hex");
  if (digest !== platformEvidence.sha256) {
    throw new Error("host_platform_evidence_hash_mismatch");
  }
}

describe("host acceptance evidence", () => {
  it("accepts only a complete, strict and versioned host-loop record", async () => {
    const schema = await readJson(schemaUrl);
    const parser = await evidenceParser();

    expect(schema).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
    });
    expect(parser.safeParse(completeEvidence()).success).toBe(true);

    for (const status of ["verified", "experimental", "not-compatible", "not-tested"]) {
      const candidate = completeEvidence();
      candidate.status = status;
      if (status !== "verified") {
        candidate.eligible_platform_evidence = {
          reference: "platform/macos-candidate.json",
          sha256: "a".repeat(64),
          release_eligible: false,
        };
      }
      expect(parser.safeParse(candidate).success, status).toBe(true);
    }

    const wrongTools = completeEvidence();
    wrongTools.tools = ["computer_observe", "computer_act", "computer_verify"];
    expect(parser.safeParse(wrongTools).success).toBe(false);
  });

  it("requires verified evidence to prove image continuation, both tasks and natural stop", async () => {
    const parser = await evidenceParser();
    const mutations: Array<(value: JsonRecord) => void> = [
      (value) => {
        (value.eligible_platform_evidence as JsonRecord).release_eligible = false;
      },
      (value) => {
        (value.image_delivery as JsonRecord).byte_valid_png = false;
      },
      (value) => {
        (value.image_delivery as JsonRecord).second_turn_png = false;
      },
      (value) => {
        (value.continuous_loop as JsonRecord).repeated_tool_calls = false;
      },
      (value) => {
        (value.automatic_mode as JsonRecord).host_authorization = "host-policy-blocked";
      },
      (value) => {
        const tasks = value.task_results as JsonRecord;
        (tasks.visible_text_entry as JsonRecord).result = "failed";
      },
      (value) => {
        const tasks = value.task_results as JsonRecord;
        (tasks.calculator as JsonRecord).visible_result = "not-observed";
      },
      (value) => {
        (value.natural_stop as JsonRecord).tool_calls_after_visible_goal = 1;
      },
    ];

    for (const mutate of mutations) {
      const candidate = completeEvidence();
      mutate(candidate);
      expect(parser.safeParse(candidate).success).toBe(false);
    }
  });

  it("rejects screenshots, prompts, typed sentences, secrets and free-form environment data", async () => {
    const parser = await evidenceParser();
    const injections: Array<[string, (value: JsonRecord) => void]> = [
      ["screenshot", (value) => { value.screenshot = "base64-png"; }],
      ["prompt", (value) => { value.prompt = "hidden prompt"; }],
      ["secret", (value) => { value.api_key = "secret"; }],
      ["environment", (value) => { value.environment = { HOME: "/private/user" }; }],
      ["typed sentence", (value) => {
        const tasks = value.task_results as JsonRecord;
        (tasks.visible_text_entry as JsonRecord).typed_sentence = "do not retain me";
      }],
    ];

    for (const [label, inject] of injections) {
      const candidate = completeEvidence();
      inject(candidate);
      expect(parser.safeParse(candidate).success, label).toBe(false);
    }
  });

  it("ships executable Codex and Kimi runbooks without committing test content", async () => {
    for (const host of ["codex", "kimi"] as const) {
      const runbook = await readFile(new URL(`${host}.md`, hostDirectory), "utf8");
      expect(runbook).toContain(`computer-use config --client ${host}`);
      expect(runbook).toContain("computer_observe");
      expect(runbook).toContain("computer_act");
      expect(runbook).toContain("TextEdit");
      expect(runbook).toContain("Notepad");
      expect(runbook).toContain("37 × 19");
      expect(runbook).toContain("703");
      expect(runbook).toContain("one-use sentence");
      expect(runbook).toContain("host approval");
      expect(runbook).toContain("outside this repository");
      expect(runbook).not.toMatch(/## Control loop/);
      expect(runbook).not.toMatch(/api[_ -]?key|model[_ -]?endpoint|tokenhub/i);
    }
  });

  it("keeps generic MCP model-free and experimental without named-host evidence", async () => {
    const nodePath = process.platform === "win32" ? "C:\\Node\\node.exe" : "/opt/node/bin/node";
    const scriptPath = process.platform === "win32"
      ? "C:\\Plugin\\dist\\mcp\\main.js"
      : "/opt/plugin/dist/mcp/main.js";
    const rendered = renderConfig("generic", nodePath, scriptPath);
    const config = JSON.parse(rendered.stdout) as JsonRecord;
    const serialized = JSON.stringify(config);
    const compatibility = await readFile(compatibilityUrl, "utf8");

    expect(config).toEqual({
      mcpServers: {
        "computer-use": { command: nodePath, args: [scriptPath] },
      },
    });
    expect(serialized).not.toMatch(/model|token|api[_-]?key|endpoint/i);
    expect(compatibility).toMatch(/^\| Generic MCP \| experimental \|/m);
    expect(compatibility).toMatch(/^\| Codex \| not-tested \|/m);
    expect(compatibility).toMatch(/^\| Kimi \| not-tested \|/m);
    expect(compatibility).not.toMatch(/^\| (Codex|Kimi) \| verified \|/m);
  });

  it("validates external evidence and release eligibility without inventing a pass", async () => {
    const configuredPaths = process.env.CUA_HOST_EVIDENCE_FILES;
    if (!configuredPaths) {
      const repositoryFiles = await readdir(hostDirectory);
      expect(repositoryFiles.filter((name) => name.endsWith(".json"))).toEqual([
        "evidence.schema.json",
      ]);
      return;
    }

    const parser = await evidenceParser();
    const lock = await loadEngineLock();
    const evidencePaths = configuredPaths.split(delimiter).filter(Boolean);
    expect(evidencePaths.length).toBeGreaterThan(0);

    for (const evidencePath of evidencePaths) {
      expect(isAbsolute(evidencePath)).toBe(true);
      const evidence = parser.parse(await readJson(evidencePath)) as JsonRecord;
      await validateVerifiedEvidenceLink(evidence, lock, evidencePath);
    }
  });

  it("fails closed until the referenced platform lane is eligible and hash-matched", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "computer-use-host-evidence-"));
    try {
      const platformDirectory = join(temporaryRoot, "platform");
      const platformPath = join(platformDirectory, "macos-candidate.json");
      const hostEvidencePath = join(temporaryRoot, "codex.json");
      const platformBytes = Buffer.from('{"redacted_platform_evidence":true}\n', "utf8");
      await mkdir(platformDirectory);
      await writeFile(platformPath, platformBytes);

      const evidence = completeEvidence();
      (evidence.eligible_platform_evidence as JsonRecord).sha256 = createHash("sha256")
        .update(platformBytes)
        .digest("hex");
      const lock = structuredClone(await loadEngineLock());

      await expect(validateVerifiedEvidenceLink(evidence, lock, hostEvidencePath)).rejects.toThrow(
        "host_platform_not_release_eligible",
      );

      lock.platforms.macos.release_eligible = true;
      lock.platforms.macos.e2e_evidence = ["platform/macos-candidate.json"];
      await expect(validateVerifiedEvidenceLink(evidence, lock, hostEvidencePath)).resolves.toBeUndefined();

      (evidence.eligible_platform_evidence as JsonRecord).sha256 = "b".repeat(64);
      await expect(validateVerifiedEvidenceLink(evidence, lock, hostEvidencePath)).rejects.toThrow(
        "host_platform_evidence_hash_mismatch",
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
