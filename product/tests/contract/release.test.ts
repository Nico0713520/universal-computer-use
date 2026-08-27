import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadEngineLock } from "../../src/engine/lock.js";
import { PUBLIC_TOOL_SCHEMAS } from "../../src/protocol.js";

type PromoteModule = {
  promoteEngineRelease(options: {
    version: string;
    lockPath: string;
    macEvidencePath: string;
    windowsEvidencePath: string;
    macSchemaPath: string;
    windowsSchemaPath: string;
  }, dependencies: {
    isWorktreeClean(): Promise<boolean>;
    currentContractFingerprint(): Promise<string>;
    verifyContracts(): Promise<void>;
  }): Promise<{
    evidence_renames: Array<{ source: string; target: string; sha256: string }>;
  }>;
};

type SoakModule = {
  assertObservationIdentity(
    output: unknown,
    platform: "macos" | "windows",
    engineVersion: string,
  ): { platform: "macos" | "windows"; engineVersion: string };
  replaceVisualSession<T>(current: T, dependencies: {
    reset(session: T): Promise<void>;
    close(session: T): Promise<void>;
    start(): Promise<T>;
  }): Promise<T>;
  writeSoakEvidence(path: string, value: unknown): Promise<void>;
};

type VerifyReleaseModule = {
  inspectPackedArtifact(productDirectory: string): Promise<{
    files: string[];
    dependencies: string[];
  }>;
  verifyRelease(options: {
    channel: "beta" | "stable";
    lockPath: string;
    productDirectory: string;
    environment?: NodeJS.ProcessEnv;
  }): Promise<unknown>;
};

async function releaseModule(): Promise<VerifyReleaseModule> {
  const url = new URL("../../scripts/verify-release.mjs", import.meta.url);
  return (await import(url.href)) as unknown as VerifyReleaseModule;
}

async function promoteModule(): Promise<PromoteModule> {
  const url = new URL("../../scripts/select-engine-release.mjs", import.meta.url);
  return (await import(url.href)) as unknown as PromoteModule;
}

async function soakModule(): Promise<SoakModule> {
  const url = new URL("../e2e/soak/run.ts", import.meta.url);
  return (await import(url.href)) as unknown as SoakModule;
}

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function sha256(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function macEvidence(lock: Awaited<ReturnType<typeof loadEngineLock>>, fingerprint: string) {
  return {
    schema_version: 1,
    platform: "macos",
    mode: "candidate",
    generated_at: "2026-08-27T12:34:56.000Z",
    promotion_authority: "task15-only",
    release_eligible_at_test: false,
    engine: {
      name: "cua-driver",
      version: lock.version,
      tag: lock.tag,
      source_commit: lock.source_commit,
      asset: lock.platforms.macos.asset,
      asset_sha256: lock.platforms.macos.sha256,
      required_fix_commits: lock.required_fix_commits,
    },
    contract_fingerprint_sha256: fingerprint,
    system: {
      os_version: "15.6.1",
      architecture: "arm64",
      interactive_aqua: true,
      desktop_unlocked: true,
      permissions: { accessibility: "granted", screen_recording: "granted" },
      display: {
        screenshot_width: 2560,
        screenshot_height: 1600,
        backing_scale: 2,
        content_origin_x: 80,
        content_origin_y: 160,
        origin_source: "injected-visible-marker-measurement",
      },
    },
    signature: {
      app_location: "/Applications/CuaDriver.app",
      app_path_sha256: "1".repeat(64),
      bundle_id: "com.trycua.driver",
      team_identifier: "ABCDEFGHIJ",
      designated_requirement_sha256: "2".repeat(64),
      codesign: "valid",
      gatekeeper: "accepted",
    },
    results: {
      repeat_requested: 20,
      repeat_completed: 20,
      plugin_seam_failures: 0,
      shared_lane: "passed",
      retina_lane: "passed",
      permission_contract_lane: "passed-controlled-fixture",
      restart_lane: "passed-real-runtime",
    },
  };
}

function windowsEvidence(
  lock: Awaited<ReturnType<typeof loadEngineLock>>,
  fingerprint: string,
  dpi: 100 | 125 | 150,
) {
  return {
    schema_version: 1,
    evidence_type: "computer-use-windows-e2e",
    stage: "candidate",
    promotable: true,
    run_id: `12345678-1234-4123-8123-${String(dpi).padStart(12, "0")}`,
    generated_at: "2026-08-27T12:34:56.000Z",
    engine: {
      name: "cua-driver",
      version: lock.version,
      tag: lock.tag,
      source_commit: lock.source_commit,
      asset: lock.platforms.windows.asset,
      asset_sha256: lock.platforms.windows.sha256,
      runtime_executable_sha256: "3".repeat(64),
      required_fix_commits: lock.required_fix_commits,
      required_tools: lock.required_tools,
      contract_fingerprint_sha256: fingerprint,
    },
    host: {
      os_name: "Windows",
      os_build: "22631",
      architecture: "x64",
      session_id: 1,
      session_state: "active",
      desktop_state: "unlocked",
      dpi_percent: dpi,
      browser: { name: "edge", version: "140.0.1.2", executable_sha256: "4".repeat(64) },
    },
    calibration: {
      method: "visible-origin-marker-screenshot-pixel-measurement",
      measured_at: "2026-08-27T11:34:56.000Z",
      content_origin_x_px: 80,
      content_origin_y_px: 160,
      screenshot_width_px: 1920,
      screenshot_height_px: 1080,
      source_screenshot_sha256: "5".repeat(64),
      zoom_percent: 100,
    },
    signer: {
      kind: "authenticode",
      status: "Valid",
      subject: "CN=Cua Driver Release",
      thumbprint: "A".repeat(40),
    },
    runtime_report: {
      source: "computer-use doctor --json",
      report_sha256: "6".repeat(64),
      permissions: "granted",
      desktop_unlocked: true,
      observation_succeeded: true,
      integrity: "not_reported_by_runtime",
    },
    results: {
      passed: true,
      iterations_expected: 20,
      iterations_passed: 20,
      action_protocol_variants: 9,
      successful_actions_per_iteration: 11,
      stale_snapshot_rejections: 20,
      new_snapshot_assertions: 220,
      plugin_seam_failures: 0,
      fixture_oracle: "loopback-http-state",
    },
    limitations: { target_privilege_mismatch: "not_detected", uac_secure_desktop: "unsupported" },
  };
}

async function promotionFixture() {
  const root = await mkdtemp(join(tmpdir(), "computer-use-promote-test-"));
  temporaryRoots.push(root);
  const lockPath = join(root, "engine.lock.json");
  const macEvidencePath = join(root, "mac.json");
  const windowsEvidencePath = join(root, "windows");
  await mkdir(windowsEvidencePath);
  const lock = structuredClone(await loadEngineLock());
  const fingerprint = sha256(JSON.stringify(PUBLIC_TOOL_SCHEMAS));
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  await writeFile(macEvidencePath, `${JSON.stringify(macEvidence(lock, fingerprint))}\n`);
  for (const dpi of [100, 125, 150] as const) {
    await writeFile(
      join(windowsEvidencePath, `windows-${dpi}.json`),
      `${JSON.stringify(windowsEvidence(lock, fingerprint, dpi))}\n`,
    );
  }
  return {
    root,
    lock,
    lockPath,
    macEvidencePath,
    windowsEvidencePath,
    fingerprint,
    options: {
      version: lock.version,
      lockPath,
      macEvidencePath,
      windowsEvidencePath,
      macSchemaPath: fileURLToPath(new URL("../e2e/macos/evidence.schema.json", import.meta.url)),
      windowsSchemaPath: fileURLToPath(new URL("../e2e/windows/evidence.schema.json", import.meta.url)),
    },
  };
}

function hostEvidence(
  host: "codex" | "kimi",
  lock: Awaited<ReturnType<typeof loadEngineLock>>,
  reference: string,
  evidenceSha: string,
) {
  return {
    schema_version: 1,
    evidence_type: "computer-use-host-loop",
    status: "verified",
    host: { name: host, version: "1.2.3", reported_model_id: "host:vision-model" },
    system: { platform: "macos", os_version: "15.6.1", engine_version: lock.version },
    eligible_platform_evidence: { reference, sha256: evidenceSha, release_eligible: true },
    tools: ["computer_observe", "computer_act"],
    image_delivery: {
      mime_type: "image/png",
      byte_valid_png: true,
      first_turn_png: true,
      second_turn_png: true,
      same_host_reported_model: true,
    },
    continuous_loop: { repeated_tool_calls: true, turns_observed: 4 },
    automatic_mode: { plugin_confirmation_count: 0, host_authorization: "host-approval-observed" },
    task_results: {
      visible_text_entry: { result: "passed", visible_keyboard_launch: true, one_use_sentence_recorded: false },
      calculator: { result: "passed", expression: "37x19", visible_result: "703" },
    },
    natural_stop: { result: "passed", tool_calls_after_visible_goal: 0 },
    timestamp: "2026-08-27T12:34:56.000Z",
    reviewer: { id: "release-reviewer", method: "manual-host-runbook" },
  };
}

async function promotedEvidenceBundle(iterations = 20) {
  const fixture = await promotionFixture();
  if (iterations !== 20) {
    const mac = JSON.parse(await readFile(fixture.macEvidencePath, "utf8"));
    mac.results.repeat_requested = iterations;
    mac.results.repeat_completed = iterations;
    await writeFile(fixture.macEvidencePath, `${JSON.stringify(mac)}\n`);
    for (const dpi of [100, 125, 150]) {
      const path = join(fixture.windowsEvidencePath, `windows-${dpi}.json`);
      const evidence = JSON.parse(await readFile(path, "utf8"));
      evidence.results.iterations_expected = iterations;
      evidence.results.iterations_passed = iterations;
      evidence.results.stale_snapshot_rejections = iterations;
      evidence.results.new_snapshot_assertions = iterations * 11;
      await writeFile(path, `${JSON.stringify(evidence)}\n`);
    }
  }
  const { promoteEngineRelease } = await promoteModule();
  const promoted = await promoteEngineRelease(fixture.options, {
    isWorktreeClean: async () => true,
    currentContractFingerprint: async () => fixture.fingerprint,
    verifyContracts: async () => undefined,
  });
  const evidenceRoot = join(fixture.root, "bundle");
  for (const mapping of promoted.evidence_renames) {
    const destination = join(evidenceRoot, mapping.target);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(mapping.source));
  }
  const lock = JSON.parse(await readFile(fixture.lockPath, "utf8"));
  const macReference = lock.platforms.macos.e2e_evidence[0] as string;
  const macBytes = await readFile(join(evidenceRoot, macReference));
  const hostPaths: string[] = [];
  for (const host of ["codex", "kimi"] as const) {
    const path = join(evidenceRoot, `${host}.json`);
    await writeFile(path, `${JSON.stringify(hostEvidence(host, lock, macReference, sha256(macBytes)))}\n`);
    hostPaths.push(path);
  }
  return { ...fixture, evidenceRoot, hostPaths, promotedLock: lock };
}

describe("release verification", () => {
  it("builds ignored dist artifacts before tests, packing, and release verification", async () => {
    const productDirectory = fileURLToPath(new URL("../../", import.meta.url));
    const packageManifest = JSON.parse(
      await readFile(join(productDirectory, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageManifest.scripts).toMatchObject({
      pretest: "pnpm build",
      prepack: "pnpm build",
      "prerelease:verify": "pnpm build",
    });
  });

  it("inspects the real npm tar manifest and ships only the model-free plugin surface", async () => {
    const { inspectPackedArtifact } = await releaseModule();
    const productDirectory = fileURLToPath(new URL("../../", import.meta.url));

    const inspected = await inspectPackedArtifact(productDirectory);

    expect(inspected.files).toEqual(expect.arrayContaining([
      "dist/mcp/main.js",
      "dist/mcp/server.js",
      "dist/protocol.js",
      "skills/computer-use/SKILL.md",
      "integrations/generic/mcp.json",
      "integrations/codex/README.md",
      "integrations/kimi/README.md",
      "engine.lock.json",
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
    ]));
    expect(inspected.files).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/(?:^|\/)\.env(?:\.|$)/i),
      expect.stringMatching(/\.(?:rs|dylib|dll|exe|app|png|jpe?g|trace|zip|tar\.gz)$/i),
    ]));
    expect(inspected.dependencies).toEqual([
      "@modelcontextprotocol/sdk",
      "@trycua/cua-driver",
      "zod",
    ]);
    expect(inspected.dependencies.join("\n")).not.toMatch(
      /(?:^|\/)(?:openai|anthropic|google-generativeai|mistralai|cohere|together|replicate)(?:$|\/)/i,
    );
  });

  it("fails the current beta gate only because both engine lanes are not release eligible", async () => {
    const { verifyRelease } = await releaseModule();
    const productDirectory = fileURLToPath(new URL("../../", import.meta.url));
    const lockPath = fileURLToPath(new URL("../../engine.lock.json", import.meta.url));

    await expect(verifyRelease({
      channel: "beta",
      lockPath,
      productDirectory,
      environment: {},
    })).rejects.toThrow("engine_not_release_eligible");
  });

  it("requires external verified Codex and Kimi evidence before an eligible beta passes", async () => {
    const { verifyRelease } = await releaseModule();
    const fixture = await promotedEvidenceBundle();
    const productDirectory = fileURLToPath(new URL("../../", import.meta.url));

    await expect(verifyRelease({
      channel: "beta",
      lockPath: fixture.lockPath,
      productDirectory,
      environment: { CUA_RELEASE_PLATFORM_EVIDENCE_ROOT: fixture.evidenceRoot },
    })).rejects.toThrow("host_evidence_required");

    await expect(verifyRelease({
      channel: "beta",
      lockPath: fixture.lockPath,
      productDirectory,
      environment: {
        CUA_RELEASE_PLATFORM_EVIDENCE_ROOT: fixture.evidenceRoot,
        CUA_HOST_EVIDENCE_FILES: fixture.hostPaths.join(delimiter),
      },
    })).resolves.toMatchObject({ channel: "beta", verified: true });
  });

  it("requires 100 platform iterations and one passing soak per platform for stable", async () => {
    const { verifyRelease } = await releaseModule();
    const weak = await promotedEvidenceBundle();
    const productDirectory = fileURLToPath(new URL("../../", import.meta.url));
    await expect(verifyRelease({
      channel: "stable",
      lockPath: weak.lockPath,
      productDirectory,
      environment: {
        CUA_RELEASE_PLATFORM_EVIDENCE_ROOT: weak.evidenceRoot,
        CUA_HOST_EVIDENCE_FILES: weak.hostPaths.join(delimiter),
      },
    })).rejects.toThrow("stable_platform_iterations_insufficient");

    const ready = await promotedEvidenceBundle(100);
    const soakPaths: string[] = [];
    for (const platform of ["macos", "windows"] as const) {
      const path = join(ready.evidenceRoot, `soak-${platform}.json`);
      await writeFile(path, `${JSON.stringify({
        schema_version: 1,
        evidence_type: "computer-use-soak",
        platform,
        generated_at: "2026-08-27T12:34:56.000Z",
        engine_version: ready.promotedLock.version,
        duration_seconds: 1800,
        actions_completed: 200,
        complete_cycles: 5,
        plugin_seam_failures: 0,
        stale_snapshot_acceptances: 0,
        coordinate_mismatches: 0,
        deadlocks: 0,
        unclassified_timeouts: 0,
        malformed_pngs: 0,
        sensitive_log_events: 0,
        rss_warm_mib: 80,
        rss_final_mib: 120,
        rss_delta_mib: 40,
        fixture_oracle: "loopback-http-state",
      })}\n`);
      soakPaths.push(path);
    }
    await expect(verifyRelease({
      channel: "stable",
      lockPath: ready.lockPath,
      productDirectory,
      environment: {
        CUA_RELEASE_PLATFORM_EVIDENCE_ROOT: ready.evidenceRoot,
        CUA_HOST_EVIDENCE_FILES: ready.hostPaths.join(delimiter),
        CUA_SOAK_EVIDENCE_FILES: soakPaths.join(delimiter),
      },
    })).resolves.toMatchObject({ channel: "stable", verified: true });
  });

  it("rejects soak evidence unless both thresholds and every strict scalar contract pass", async () => {
    const { verifyRelease } = await releaseModule();
    const fixture = await promotedEvidenceBundle(100);
    const productDirectory = fileURLToPath(new URL("../../", import.meta.url));
    const paths: string[] = [];
    for (const platform of ["macos", "windows"] as const) {
      const path = join(fixture.evidenceRoot, `invalid-soak-${platform}.json`);
      await writeFile(path, `${JSON.stringify({
        schema_version: 1,
        evidence_type: "computer-use-soak",
        platform,
        generated_at: "2026-08-27T12:34:56.000Z",
        engine_version: fixture.promotedLock.version,
        duration_seconds: platform === "macos" ? 1800 : 60,
        actions_completed: platform === "windows" ? 200 : 50,
        complete_cycles: 5,
        plugin_seam_failures: 0,
        stale_snapshot_acceptances: 0,
        coordinate_mismatches: 0,
        deadlocks: 0,
        unclassified_timeouts: 0,
        malformed_pngs: 0,
        sensitive_log_events: 0,
        rss_warm_mib: 80,
        rss_final_mib: 120,
        rss_delta_mib: 40,
        fixture_oracle: "loopback-http-state",
      })}\n`);
      paths.push(path);
    }
    const options = {
      channel: "stable" as const,
      lockPath: fixture.lockPath,
      productDirectory,
      environment: {
        CUA_RELEASE_PLATFORM_EVIDENCE_ROOT: fixture.evidenceRoot,
        CUA_HOST_EVIDENCE_FILES: fixture.hostPaths.join(delimiter),
        CUA_SOAK_EVIDENCE_FILES: paths.join(delimiter),
      },
    };
    await expect(verifyRelease(options)).rejects.toThrow("stable_soak_evidence_invalid");

    for (const path of paths) {
      const valid = JSON.parse(await readFile(path, "utf8"));
      valid.duration_seconds = 1800;
      valid.actions_completed = 200;
      await writeFile(path, `${JSON.stringify(valid)}\n`);
    }
    const malformed = JSON.parse(await readFile(paths[0], "utf8"));
    malformed.duration_seconds = 1800.5;
    malformed.generated_at = "not-a-date";
    await writeFile(paths[0], `${JSON.stringify(malformed)}\n`);
    await expect(verifyRelease(options)).rejects.toThrow("stable_soak_evidence_invalid");
  });

  it("validates the raw engine lock before trusting release eligibility or external evidence", async () => {
    const { verifyRelease } = await releaseModule();
    const fixture = await promotedEvidenceBundle();
    const productDirectory = fileURLToPath(new URL("../../", import.meta.url));
    const lock = JSON.parse(await readFile(fixture.lockPath, "utf8"));
    lock.unreviewed = true;
    await writeFile(fixture.lockPath, `${JSON.stringify(lock)}\n`);
    await expect(verifyRelease({
      channel: "beta",
      lockPath: fixture.lockPath,
      productDirectory,
      environment: {},
    })).rejects.toThrow("engine_lock_invalid");

    delete lock.unreviewed;
    lock.tag = `moving-${lock.version}`;
    await writeFile(fixture.lockPath, `${JSON.stringify(lock)}\n`);
    await expect(verifyRelease({
      channel: "beta",
      lockPath: fixture.lockPath,
      productDirectory,
      environment: {},
    })).rejects.toThrow("engine_lock_formal_release_invalid");

    lock.tag = `cua-driver-rs-v${lock.version}`;
    lock.required_fix_commits = [];
    await writeFile(fixture.lockPath, `${JSON.stringify(lock)}\n`);
    await expect(verifyRelease({
      channel: "beta",
      lockPath: fixture.lockPath,
      productDirectory,
      environment: {},
    })).rejects.toThrow("engine_lock_formal_release_invalid");

    lock.required_fix_commits = fixture.lock.required_fix_commits;
    lock.platforms.macos.signer.team_id = null;
    await writeFile(fixture.lockPath, `${JSON.stringify(lock)}\n`);
    await expect(verifyRelease({
      channel: "beta",
      lockPath: fixture.lockPath,
      productDirectory,
      environment: {},
    })).rejects.toThrow("engine_lock_invalid");
  });
});

describe("soak runner safety seams", () => {
  it("replaces the entire browser/fixture session between complete cycles", async () => {
    const { replaceVisualSession } = await soakModule();
    const order: string[] = [];
    const replacement = await replaceVisualSession("old", {
      reset: async (session) => { order.push(`reset:${session}`); },
      close: async (session) => { order.push(`close:${session}`); },
      start: async () => { order.push("start"); return "new"; },
    });
    expect(replacement).toBe("new");
    expect(order).toEqual(["reset:old", "close:old", "start"]);
  });

  it("binds every cycle's observation to the actual platform and locked engine", async () => {
    const { assertObservationIdentity } = await soakModule();
    expect(assertObservationIdentity({
      platform: "macos",
      engine: { name: "cua-driver", version: "1.2.3" },
    }, "macos", "1.2.3")).toEqual({ platform: "macos", engineVersion: "1.2.3" });
    expect(() => assertObservationIdentity({
      platform: "windows",
      engine: { name: "cua-driver", version: "1.2.3" },
    }, "macos", "1.2.3")).toThrow("observation_engine_identity_mismatch");
    expect(() => assertObservationIdentity({
      platform: "macos",
      engine: { name: "other", version: "1.2.3" },
    }, "macos", "1.2.3")).toThrow("observation_engine_identity_mismatch");
  });

  it("never replaces an existing final evidence path and removes staging files", async () => {
    const { writeSoakEvidence } = await soakModule();
    const root = await mkdtemp(join(tmpdir(), "computer-use-soak-write-test-"));
    temporaryRoots.push(root);
    const path = join(root, "evidence.json");
    await writeFile(path, "original\n");

    await expect(writeSoakEvidence(path, { replacement: true })).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("original\n");
    expect(await readdir(root)).toEqual(["evidence.json"]);
  });
});

describe("engine candidate promotion", () => {
  it("validates every lane before atomically promoting normalized signer and content-addressed references", async () => {
    const fixture = await promotionFixture();
    const { promoteEngineRelease } = await promoteModule();
    const verifyContracts = vi.fn(async () => undefined);

    const result = await promoteEngineRelease(fixture.options, {
      isWorktreeClean: async () => true,
      currentContractFingerprint: async () => fixture.fingerprint,
      verifyContracts,
    });

    const promoted = JSON.parse(await readFile(fixture.lockPath, "utf8"));
    expect(promoted.platforms.macos).toMatchObject({
      release_eligible: true,
      signer: {
        kind: "apple",
        team_id: "ABCDEFGHIJ",
        bundle_id: "com.trycua.driver",
        designated_requirement_sha256: "2".repeat(64),
      },
    });
    expect(promoted.platforms.windows).toMatchObject({
      release_eligible: true,
      signer: {
        kind: "authenticode",
        subject: "CN=Cua Driver Release",
        thumbprint: "A".repeat(40),
      },
    });
    expect(promoted.platforms.macos.e2e_evidence).toHaveLength(1);
    expect(promoted.platforms.windows.e2e_evidence).toHaveLength(3);
    const serialized = JSON.stringify(promoted);
    expect(serialized).not.toContain(fixture.root);
    for (const reference of [
      ...promoted.platforms.macos.e2e_evidence,
      ...promoted.platforms.windows.e2e_evidence,
    ]) {
      expect(reference).toMatch(/^platform\/(?:macos|windows-(?:100|125|150))-r20-[0-9a-f]{64}\.json$/);
    }
    expect(result.evidence_renames).toHaveLength(4);
    expect(result.evidence_renames.map(({ target }) => target).sort()).toEqual([
      ...promoted.platforms.macos.e2e_evidence,
      ...promoted.platforms.windows.e2e_evidence,
    ].sort());
    expect(verifyContracts).toHaveBeenCalledOnce();
  });

  it("rejects a signer mismatch and restores the exact prior lock when post-write contracts fail", async () => {
    const { promoteEngineRelease } = await promoteModule();
    const mismatch = await promotionFixture();
    const mismatchPath = join(mismatch.windowsEvidencePath, "windows-125.json");
    const mismatchEvidence = JSON.parse(await readFile(mismatchPath, "utf8"));
    mismatchEvidence.signer.subject = "CN=Different Signer";
    await writeFile(mismatchPath, `${JSON.stringify(mismatchEvidence)}\n`);
    const beforeMismatch = await readFile(mismatch.lockPath, "utf8");

    await expect(promoteEngineRelease(mismatch.options, {
      isWorktreeClean: async () => true,
      currentContractFingerprint: async () => mismatch.fingerprint,
      verifyContracts: async () => undefined,
    })).rejects.toThrow("windows_signer_mismatch");
    expect(await readFile(mismatch.lockPath, "utf8")).toBe(beforeMismatch);

    const rollback = await promotionFixture();
    const beforeRollback = await readFile(rollback.lockPath, "utf8");
    await expect(promoteEngineRelease(rollback.options, {
      isWorktreeClean: async () => true,
      currentContractFingerprint: async () => rollback.fingerprint,
      verifyContracts: async () => { throw new Error("contract failed"); },
    })).rejects.toThrow("contract failed");
    expect(await readFile(rollback.lockPath, "utf8")).toBe(beforeRollback);
  });

  it("fails closed on moving versions, dirty state, missing DPI, weak runs, or contract drift", async () => {
    const { promoteEngineRelease } = await promoteModule();
    const cases: Array<{
      label: string;
      mutate(fixture: Awaited<ReturnType<typeof promotionFixture>>): Promise<void>;
      error: string;
      dirty?: boolean;
    }> = [
      {
        label: "nightly",
        mutate: async (fixture) => { fixture.options.version = "nightly"; },
        error: "stable SemVer",
      },
      {
        label: "dirty",
        mutate: async () => undefined,
        error: "dirty worktree",
        dirty: true,
      },
      {
        label: "missing dpi",
        mutate: async (fixture) => rm(join(fixture.windowsEvidencePath, "windows-150.json")),
        error: "windows_evidence_requires_exact_dpi_lanes",
      },
      {
        label: "weak mac run",
        mutate: async (fixture) => {
          const evidence = JSON.parse(await readFile(fixture.macEvidencePath, "utf8"));
          evidence.results.repeat_completed = 19;
          await writeFile(fixture.macEvidencePath, `${JSON.stringify(evidence)}\n`);
        },
        error: "macos_candidate_runs_insufficient",
      },
      {
        label: "contract drift",
        mutate: async (fixture) => {
          const evidence = JSON.parse(await readFile(fixture.macEvidencePath, "utf8"));
          evidence.contract_fingerprint_sha256 = "e".repeat(64);
          await writeFile(fixture.macEvidencePath, `${JSON.stringify(evidence)}\n`);
        },
        error: "contract_fingerprint_mismatch",
      },
    ];

    for (const testCase of cases) {
      const fixture = await promotionFixture();
      await testCase.mutate(fixture);
      const before = await readFile(fixture.lockPath, "utf8");
      await expect(promoteEngineRelease(fixture.options, {
        isWorktreeClean: async () => testCase.dirty !== true,
        currentContractFingerprint: async () => fixture.fingerprint,
        verifyContracts: async () => undefined,
      }), testCase.label).rejects.toThrow(testCase.error);
      expect(await readFile(fixture.lockPath, "utf8"), testCase.label).toBe(before);
    }
  });
});
