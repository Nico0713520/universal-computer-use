# Universal Computer Use v0.2.3 macOS Test Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the macOS Developer Preview acceptance lane deterministic and diagnostically truthful, without changing the two-tool MCP interface or the locked Cua runtime.

**Architecture:** Keep product behavior behind the existing `computer_observe` / `computer_act` interface. Add a small macOS interactive-session probe at the CLI seam, turn the development performance recorder into a correctness-plus-stage aggregator, collect existing redacted runtime metadata from stdio, and make each real performance scenario prepare only the state it owns. Fatal harness failures write a separate redacted diagnostic rather than forged partial evidence.

**Tech Stack:** TypeScript 5.7, Node.js 22.19+, Vitest 3.2, MCP SDK 1.30, Zod 4.4, JSON Schema 2020-12, macOS AppKit via read-only JXA, Cua Driver 0.22.2.

## Global Constraints

- Product version becomes `0.2.3`; protocol remains exactly `1.2.0`.
- Public MCP inventory remains exactly `computer_observe` and `computer_act`; request and response schemas do not change.
- Cua Driver remains locked to `0.22.2`; do not use private skip flags or copy Cua native code.
- No fixed universal action delay, hidden retry, duplicate input, raw sample list, screenshot, typed text, title, path, PID, native handle, ref, token, prompt, or environment dump enters evidence.
- Windows execution behavior is unchanged.
- Every implementation slice follows red → green and ends in a focused commit.
- A failed real run is retained as a failure and is never automatically rerun as a replacement sample.

---

### Task 1: Truthful macOS interactive-session probe

**Files:**
- Create: `product/src/cli/interactive-session.ts`
- Modify: `product/src/cli/doctor.ts`
- Modify: `product/src/cli/main.ts`
- Create: `product/tests/unit/interactive-session.test.ts`
- Modify: `product/tests/unit/cli-doctor.test.ts`

**Interfaces:**
- Produces: `probeMacInteractiveSession(runner: ProcessRunner): Promise<boolean | null>`.
- Extends: `DoctorDependencies` with `probeInteractiveSession: () => Promise<boolean | null>`.
- Preserves: one screenshot at most, zero input actions, existing `DoctorReport` JSON shape.

- [ ] **Step 1: Write the failing probe tests**

Create `interactive-session.test.ts` with a fake `ProcessRunner` and these literal cases:

```ts
expect(await probeMacInteractiveSession(runnerReturning({
  code: 0,
  stdout: '{"bundleIdentifier":"com.apple.loginwindow"}\n',
  stderr: "",
}))).toBe(false);

expect(await probeMacInteractiveSession(runnerReturning({
  code: 0,
  stdout: '{"bundleIdentifier":"com.google.Chrome"}\n',
  stderr: "",
}))).toBe(true);

for (const result of [
  { code: 1, stdout: "", stderr: "denied" },
  { code: 0, stdout: "not-json", stderr: "" },
  { code: 0, stdout: '{"bundleIdentifier":""}', stderr: "" },
]) {
  expect(await probeMacInteractiveSession(runnerReturning(result))).toBeNull();
}
```

Assert the runner receives `/usr/bin/osascript`, separate arguments `-l`, `JavaScript`, `-e`, a 2,000ms timeout, and no shell string.

- [ ] **Step 2: Write the failing doctor behavior tests**

In `cli-doctor.test.ts`, inject `probeInteractiveSession` in every call. Add three cases:

```ts
it("refuses loginwindow before capture", async () => {
  const engine = new FakeEngine({ platform: "macos" });
  const report = await runDoctor(
    { platform: "darwin", arch: "arm64" },
    {
      lock: await loadEngineLock(),
      connectEngine: async () => engine,
      probeInteractiveSession: async () => false,
    },
  );
  expect(report).toMatchObject({
    ok: false,
    engine_connected: true,
    required_tools_present: true,
    desktop_unlocked: false,
    observation_succeeded: false,
    screenshot: null,
    error: { code: "interactive_session_required" },
  });
  expect(engine.observations).toBe(0);
});
```

The unavailable case expects `desktop_unlocked:null`, `runtime_unavailable`, and zero observations. The unlocked case preserves the existing successful report and exactly one observation.

- [ ] **Step 3: Run the focused tests and confirm red**

Run:

```bash
cd product
npx --yes pnpm@9.0.4 vitest run tests/unit/interactive-session.test.ts tests/unit/cli-doctor.test.ts
```

Expected: failure because `interactive-session.ts` and the new dependency do not exist.

- [ ] **Step 4: Implement the probe and doctor gate**

Create the module with this interface and projection:

```ts
export async function probeMacInteractiveSession(
  runner: ProcessRunner,
): Promise<boolean | null> {
  const script = [
    "ObjC.import('AppKit');",
    "const app = $.NSWorkspace.sharedWorkspace.frontmostApplication;",
    "JSON.stringify({bundleIdentifier: ObjC.unwrap(app.bundleIdentifier)});",
  ].join(" ");
  let result: ProcessResult;
  try {
    result = await runner.run(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", script],
      { timeoutMs: 2_000 },
    );
  } catch {
    return null;
  }
  if (result.code !== 0) return null;
  try {
    const value = JSON.parse(result.stdout) as { bundleIdentifier?: unknown };
    if (typeof value.bundleIdentifier !== "string" || value.bundleIdentifier === "") return null;
    return value.bundleIdentifier !== "com.apple.loginwindow";
  } catch {
    return null;
  }
}
```

In `runDoctor`, after version/inventory validation and before `engine.observe`, call the probe only when resolved platform is `macos`. For `false`, throw:

```ts
new ComputerUseError(
  "interactive_session_required",
  "The macOS login window is active",
  "stop",
  false,
);
```

For `null`, throw:

```ts
new ComputerUseError(
  "runtime_unavailable",
  "The macOS interactive session could not be verified",
  "doctor",
  true,
);
```

Pass the production probe from both `setup` and `doctor` branches in `main.ts`. Windows skips the probe and preserves the existing screenshot-derived behavior.

- [ ] **Step 5: Run focused and CLI regression tests**

Run:

```bash
npx --yes pnpm@9.0.4 vitest run tests/unit/interactive-session.test.ts tests/unit/cli-doctor.test.ts tests/unit/cli-setup.test.ts tests/unit/cli-mcp.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit**

```bash
git add product/src/cli/interactive-session.ts product/src/cli/doctor.ts product/src/cli/main.ts product/tests/unit/interactive-session.test.ts product/tests/unit/cli-doctor.test.ts
git commit -m "fix: make macos doctor session-aware"
```

---

### Task 2: Correctness-aware performance recorder

**Files:**
- Modify: `product/tests/e2e/development/performance-recorder.ts`
- Modify: `product/tests/e2e/development/macos-acceptance.spec.ts`
- Modify: `product/tests/unit/performance-recorder.test.ts`

**Interfaces:**
- Replaces: boolean-only `PerformanceSample` with an outcome and optional stage timings.
- Produces: exact correctness counts, failure counts, separate latency/correctness status, and per-stage aggregates.

- [ ] **Step 1: Write failing recorder tests for the schema-v3 profile**

Change the unit fixture to record samples in this shape:

```ts
{
  durationMs: 30,
  outcome: "passed",
  stages: {
    queue_wait: 1,
    post_action_observe: 20,
    projection: 2,
    tool_total: 23,
    transport_overhead: 7,
  },
}
```

Assert a successful observe profile equals:

```ts
{
  sample_count: 30,
  correct_count: 30,
  failed_count: 0,
  success_rate: 1,
  p50_ms: 15,
  p95_ms: 29,
  max_ms: 30,
  slo: { p50_ms: 700, p95_ms: 1500 },
  latency_status: "passed",
  correctness_status: "passed",
  failure_counts: {},
  stages: expect.objectContaining({
    tool_total: { sample_count: 30, p50_ms: 15, p95_ms: 29, max_ms: 30 },
  }),
  status: "passed",
}
```

Add one 29/30 case with `outcome:"oracle_mismatch"` and assert `success_rate` is `29 / 30`, `failure_counts:{oracle_mismatch:1}`, correctness fails, latency can still pass, and overall status fails. Add telemetry missing, invalid negative stage, 29/31 samples, and warm-up exclusion cases.

- [ ] **Step 2: Run the recorder test and confirm red**

```bash
cd product
npx --yes pnpm@9.0.4 vitest run tests/unit/performance-recorder.test.ts
```

Expected: TypeScript/test failures because the old recorder accepts `correctnessPassed` and emits one status.

- [ ] **Step 3: Implement the new sample and profile types**

Use the exact unions from the design:

```ts
export type PerformanceFailureKind =
  | "tool_error"
  | "contract_mismatch"
  | "oracle_mismatch"
  | "target_lost"
  | "fixture_unavailable"
  | "telemetry_missing";

export type PerformanceOutcome = "passed" | PerformanceFailureKind;
export type PerformanceStageName =
  | "queue_wait"
  | "engine_execute"
  | "post_action_observe"
  | "projection"
  | "tool_total"
  | "transport_overhead";
```

Validate every supplied stage as finite and nonnegative. Summarize a stage only when it has at least one valid measured value. `correctness_status` passes only at 30/30; `latency_status` uses the existing SLO; overall status requires both. Do not emit raw samples.

Migrate the existing acceptance call sites in the same slice so this commit remains type-safe: convert each old `correctnessPassed` sample to an `outcome` (`passed` or `oracle_mismatch`) and temporarily pass `stages:{}`. Task 4 replaces that temporary empty map with classified real telemetry; it is not permitted to leave a knowingly broken TypeScript commit between tasks.

- [ ] **Step 4: Run the focused test and typecheck**

```bash
npx --yes pnpm@9.0.4 vitest run tests/unit/performance-recorder.test.ts
npx --yes pnpm@9.0.4 typecheck
```

Expected: recorder tests and the complete typecheck pass.

- [ ] **Step 5: Commit**

```bash
git add product/tests/e2e/development/performance-recorder.ts product/tests/e2e/development/macos-acceptance.spec.ts product/tests/unit/performance-recorder.test.ts
git commit -m "test: report performance correctness separately"
```

---

### Task 3: Sequential redacted stdio timing collector

**Files:**
- Create: `product/tests/e2e/development/macos-acceptance-telemetry.ts`
- Create: `product/tests/unit/macos-acceptance-telemetry.test.ts`
- Modify: `product/tests/e2e/development/macos-acceptance-support.ts`
- Modify: `product/tests/unit/macos-acceptance-support.test.ts`

**Interfaces:**
- Produces: `AcceptanceTelemetryCollector.cursor()` and `consumeOne(cursor, expectedTool)`.
- Extends: development `Connection` with `telemetry: AcceptanceTelemetryCollector`.
- Consumes: existing redacted JSONL written to MCP stderr.

- [ ] **Step 1: Write failing collector tests**

Feed split chunks containing the ready line and JSONL records:

```ts
collector.ingest("computer-use-mcp: ready on stdio\n{\"tool_name\":\"computer_ob");
collector.ingest("serve\",\"timings\":{\"queue_wait_ms\":1,\"post_action_observe_ms\":8,\"projection_ms\":2,\"tool_total_ms\":11}}\n");
const cursor = 0;
expect(collector.consumeOne(cursor, "computer_observe")).toEqual({
  queue_wait: 1,
  post_action_observe: 8,
  projection: 2,
  tool_total: 11,
});
```

Add tests proving malformed JSON, a wrong tool, no record, duplicate matching records, negative timings, and unknown timing fields return `undefined` without throwing or preserving the raw line.

- [ ] **Step 2: Run the collector test and confirm red**

```bash
cd product
npx --yes pnpm@9.0.4 vitest run tests/unit/macos-acceptance-telemetry.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the collector**

The collector keeps only projected records:

```ts
type CollectedRecord = Readonly<{
  tool: "computer_observe" | "computer_act";
  stages: Partial<Record<PerformanceStageName, number>>;
}>;

export class AcceptanceTelemetryCollector {
  #pending = "";
  #records: CollectedRecord[] = [];
  ingest(chunk: string): void {
    this.#pending += chunk;
    const lines = this.#pending.split(/\r?\n/u);
    this.#pending = lines.pop() ?? "";
    const timingFields = [
      ["queue_wait_ms", "queue_wait"],
      ["engine_execute_ms", "engine_execute"],
      ["post_action_observe_ms", "post_action_observe"],
      ["projection_ms", "projection"],
      ["tool_total_ms", "tool_total"],
    ] as const;
    for (const line of lines) {
      let value: Record<string, unknown>;
      try {
        value = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (value.tool_name !== "computer_observe" && value.tool_name !== "computer_act") continue;
      if (typeof value.timings !== "object" || value.timings === null) continue;
      const input = value.timings as Record<string, unknown>;
      const stages: Partial<Record<PerformanceStageName, number>> = {};
      let valid = true;
      for (const [source, target] of timingFields) {
        const timing = input[source];
        if (timing === undefined) continue;
        if (typeof timing !== "number" || !Number.isFinite(timing) || timing < 0) {
          valid = false;
          break;
        }
        stages[target] = timing;
      }
      if (valid && Object.keys(stages).length > 0) {
        this.#records.push({ tool: value.tool_name, stages });
      }
    }
  }
  cursor(): number { return this.#records.length; }
  consumeOne(cursor: number, expectedTool: CollectedRecord["tool"]): CollectedRecord["stages"] | undefined {
    const candidates = this.#records.slice(cursor).filter((record) => record.tool === expectedTool);
    return candidates.length === 1 ? { ...candidates[0]!.stages } : undefined;
  }
}
```

Map snake-case log keys to the six evidence stage names except `transport_overhead`, which the measured-call wrapper computes later. Never retain timestamps, hashes, errors, or unrecognized fields in the collector.

- [ ] **Step 4: Wire the collector to the test-only connection**

Replace `drainTransportStderr` with a collector listener before `client.connect`. Return it on `Connection`. The production MCP process is unchanged.

- [ ] **Step 5: Run focused tests**

```bash
npx --yes pnpm@9.0.4 vitest run tests/unit/macos-acceptance-telemetry.test.ts tests/unit/macos-acceptance-support.test.ts tests/unit/runtime-timing.test.ts tests/unit/redaction.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit**

```bash
git add product/tests/e2e/development/macos-acceptance-telemetry.ts product/tests/e2e/development/macos-acceptance-support.ts product/tests/unit/macos-acceptance-telemetry.test.ts product/tests/unit/macos-acceptance-support.test.ts
git commit -m "test: collect redacted mcp stage timings"
```

---

### Task 4: Scenario-owned preparation and classified measured calls

**Files:**
- Create: `product/tests/e2e/development/performance-preparation.ts`
- Create: `product/tests/unit/performance-preparation.test.ts`
- Modify: `product/tests/e2e/development/macos-acceptance.spec.ts`

**Interfaces:**
- Produces: `preparePerformanceScenario(name, dependencies)` returning only the owned pre-state.
- Consumes: `Connection.telemetry` and the Task 2 recorder sample shape.

- [ ] **Step 1: Write failing preparation tests**

Use spies for `readFixtureState` and `resetSentinelText`. Assert:

```ts
await preparePerformanceScenario("window_visual_observe", deps);
await preparePerformanceScenario("window_semantic_observe", deps);
expect(deps.readFixtureState).not.toHaveBeenCalled();
expect(deps.resetSentinelText).not.toHaveBeenCalled();

expect(await preparePerformanceScenario("semantic_action_next_state", deps))
  .toEqual({ sentinelState });
expect(deps.resetSentinelText).toHaveBeenCalledTimes(1);

expect(await preparePerformanceScenario("pixel_action_next_state", deps))
  .toEqual({ fixtureState });
expect(deps.readFixtureState).toHaveBeenCalledTimes(1);
```

No dependency named `resetFixture` is present in this interface.

- [ ] **Step 2: Run the preparation test and confirm red**

```bash
cd product
npx --yes pnpm@9.0.4 vitest run tests/unit/performance-preparation.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement scenario preparation**

Implement a discriminated return type:

```ts
export type PreparedPerformanceState =
  | Readonly<{ kind: "observe" }>
  | Readonly<{ kind: "semantic"; sentinelState: FocusSentinelState }>
  | Readonly<{ kind: "pixel"; fixtureState: HarnessState }>;
```

Observe scenarios return immediately. Semantic calls only `resetSentinelText`. Pixel calls only `readFixtureState`.

- [ ] **Step 4: Replace the unconditional reset in the real runner**

Delete `const initialState = await resetFixture(fixture.url)` from the top of `performanceIteration`. Pass the whole `Connection`, take a telemetry cursor immediately before the measured MCP call, and create a sample with:

```ts
const stages = connection.telemetry.consumeOne(cursor, expectedTool);
const toolTotal = stages?.tool_total;
const withTransport = stages === undefined ? undefined : {
  ...stages,
  transport_overhead: Math.max(0, measured.durationMs - (toolTotal ?? measured.durationMs)),
};
```

Classify outcomes by independent evidence:

- thrown/errored tool call → `tool_error`;
- public envelope missing required structure → `contract_mismatch`;
- `target_lost` or `window_not_found` tool code → `target_lost`;
- fixture/sentinel setup or oracle read failure → `fixture_unavailable`;
- valid tool result but wrong native counter/value → `oracle_mismatch`;
- missing stage record after an otherwise valid call → `telemetry_missing`;
- otherwise → `passed`.

Use the pixel prepared counter instead of a reset result. Keep five warm-ups plus thirty measured calls and do not retry.

- [ ] **Step 5: Run focused and full deterministic tests**

```bash
npx --yes pnpm@9.0.4 vitest run tests/unit/performance-preparation.test.ts tests/unit/performance-recorder.test.ts tests/unit/macos-acceptance-telemetry.test.ts
npx --yes pnpm@9.0.4 typecheck
```

Expected: all selected tests and typecheck pass.

- [ ] **Step 6: Commit**

```bash
git add product/tests/e2e/development/performance-preparation.ts product/tests/e2e/development/macos-acceptance.spec.ts product/tests/unit/performance-preparation.test.ts
git commit -m "test: isolate macos performance scenario state"
```

---

### Task 5: Schema-v3 evidence and fatal diagnostics

**Files:**
- Create: `product/tests/e2e/development/fatal-diagnostic.ts`
- Create: `product/tests/e2e/development/fatal-diagnostic.schema.json`
- Create: `product/tests/unit/fatal-diagnostic.test.ts`
- Modify: `product/tests/e2e/development/acceptance-recorder.ts`
- Modify: `product/tests/e2e/development/evidence.schema.json`
- Modify: `product/tests/e2e/development/macos-acceptance.spec.ts`
- Modify: `product/tests/e2e/development/source-checkout.ts`
- Modify: `product/scripts/run-development-acceptance.mjs`
- Modify: `product/tests/unit/acceptance-recorder.test.ts`
- Modify: `product/tests/contract/development-evidence.test.ts`
- Modify: `product/tests/contract/development-acceptance-cli.test.ts`

**Interfaces:**
- Advances: development evidence `schema_version` from 2 to 3.
- Produces: `FatalDiagnosticTracker` and a sibling `<evidence-name>.diagnostic.json` on fatal failure.

- [ ] **Step 1: Make schema-v3 contract tests red**

Update the complete evidence fixtures to require the Task 2 profile fields. Add assertions that:

```ts
profile.sample_count === 30;
profile.correct_count + profile.failed_count === 30;
profile.success_rate === profile.correct_count / 30;
profile.correctness_status === (profile.correct_count === 30 ? "passed" : "failed");
profile.status === (
  profile.correctness_status === "passed" && profile.latency_status === "passed"
    ? "passed"
    : "failed"
);
```

Reject raw samples, unknown failure names, incorrect sums, success rates outside 0..1, a passed correctness status at 29/30, missing applicable telemetry stages, and product version `0.2.2` in a v3 artifact.

- [ ] **Step 2: Write fatal-diagnostic tests**

Prove the tracker emits only:

```ts
{
  schema_version: 1,
  evidence_type: "computer-use-macos-development-fatal-diagnostic",
  status: "failed",
  phase: "performance",
  scenario: "semantic_action_next_state",
  sample_kind: "measured",
  sample_index: 4,
  error_code: "fixture_reset_ack_timeout",
  elapsed_ms: 103000,
  owned_processes: { fixture: false, browser: false, sentinel: false, mcp: false },
  last_tool: { name: "computer_act", error_code: null },
  cleanup_passed: true,
  timestamp: "2026-08-30T00:00:00.000Z",
}
```

Reject or project away stack traces, paths, PIDs, screenshots, text, refs, and arbitrary error messages.

- [ ] **Step 3: Run evidence and diagnostic tests and confirm red**

```bash
cd product
npx --yes pnpm@9.0.4 vitest run tests/unit/fatal-diagnostic.test.ts tests/unit/acceptance-recorder.test.ts tests/contract/development-evidence.test.ts tests/contract/development-acceptance-cli.test.ts
```

Expected: failures on missing v3 fields/modules and old schema constants.

- [ ] **Step 4: Implement v3 projection, semantic validation, and JSON schema**

Make `AcceptanceRecorder` project, semantically validate, and copy the new profile fields without raw samples. The TypeScript semantic validator enforces the cross-field arithmetic (`correct_count + failed_count`, exact `success_rate`, and the three status relationships) because standard JSON Schema 2020-12 cannot express division or sums across sibling fields. Change only the development artifact schema to version 3 and use it for structural types, ranges, constants, conditional required fields, and redaction closure. Preserve existing legacy scenario, timing, adaptive-correctness, smoke, and cleanup requirements.

The passed branch of the JSON schema requires all four profile statuses, correctness statuses, and latency statuses to be `passed`, with `correct_count:30`, `failed_count:0`, and `success_rate:1`. The failed branch accepts truthful failed profiles; the schema enforces closed/redacted structure while the semantic validator enforces arithmetic and status consistency before writing.

- [ ] **Step 5: Implement fatal diagnostic writing**

Track phase/scenario/sample context before each fatal-capable operation. After owned-resource cleanup, if no complete evidence can be built, write the strict diagnostic with `flag:"wx"` to the path supplied in `CUA_DEVELOPMENT_DIAGNOSTIC_PATH`, then rethrow the stable failure.

Add both new diagnostic files to `SOURCE_ACCEPTANCE_FILES` so source-checkout execution and installed-package refusal remain explicit. In the launcher:

```js
const diagnosticPath = `${selected.path}.diagnostic.json`;
```

Require both selected paths not to exist. Pass the diagnostic path to the child. If evidence is absent but the diagnostic validates, print its path to stderr and preserve the containing temporary directory. Never accept a diagnostic as passing evidence.

- [ ] **Step 6: Run focused tests**

```bash
npx --yes pnpm@9.0.4 vitest run tests/unit/fatal-diagnostic.test.ts tests/unit/acceptance-recorder.test.ts tests/contract/development-evidence.test.ts tests/contract/development-acceptance-cli.test.ts
npx --yes pnpm@9.0.4 typecheck
```

Expected: all selected tests and typecheck pass.

- [ ] **Step 7: Commit**

```bash
git add product/tests/e2e/development/fatal-diagnostic.ts product/tests/e2e/development/fatal-diagnostic.schema.json product/tests/e2e/development/acceptance-recorder.ts product/tests/e2e/development/evidence.schema.json product/tests/e2e/development/macos-acceptance.spec.ts product/tests/e2e/development/source-checkout.ts product/scripts/run-development-acceptance.mjs product/tests/unit/fatal-diagnostic.test.ts product/tests/unit/acceptance-recorder.test.ts product/tests/contract/development-evidence.test.ts product/tests/contract/development-acceptance-cli.test.ts
git commit -m "test: emit truthful macos acceptance evidence"
```

---

### Task 6: Locked Cua 0.22.2 raw contract fixtures

**Files:**
- Create: `product/tests/fixtures/cua/0.22.2/list-apps.json`
- Create: `product/tests/fixtures/cua/0.22.2/list-windows.json`
- Create: `product/tests/fixtures/cua/0.22.2/window-state.json`
- Create: `product/tests/fixtures/cua/0.22.2/health-report.json`
- Create: `product/tests/fixtures/cua/0.22.2/README.md`
- Modify: `product/tests/unit/cua-json.test.ts`
- Modify: `product/tests/unit/cua-connection.test.ts`
- Modify: `docs/upstream-sources.md`

**Interfaces:**
- Consumes: public parser functions and `CuaEngine.fromSdk`.
- Proves: locked response-field spelling and source attribution without shipping user data.

- [ ] **Step 1: Add failing fixture-loading tests**

Load the expected paths explicitly, for example:

```ts
const fixtureUrls = {
  apps: new URL("../fixtures/cua/0.22.2/list-apps.json", import.meta.url),
  windows: new URL("../fixtures/cua/0.22.2/list-windows.json", import.meta.url),
  windowState: new URL("../fixtures/cua/0.22.2/window-state.json", import.meta.url),
  health: new URL("../fixtures/cua/0.22.2/health-report.json", import.meta.url),
} as const;
const listApps = JSON.parse(await readFile(fixtureUrls.apps, "utf8"));
```

Assert the window fixture uses:

```json
{"bounds":{"x":100,"y":100,"width":460,"height":816}}
```

and the element fixture uses:

```json
{"frame":{"x":110,"y":610,"w":100,"h":80}}
```

Pass the raw objects through `parseAppList`, `parseWindowList`, `parseWindowState`, and `parseHealth`. Assert public normalized bounds always use `width`/`height` and malformed spelling fails closed.

- [ ] **Step 2: Run parser tests and confirm red**

```bash
cd product
npx --yes pnpm@9.0.4 vitest run tests/unit/cua-json.test.ts tests/unit/cua-connection.test.ts
```

Expected: missing fixture-file failures.

- [ ] **Step 3: Add sanitized locked fixtures and attribution**

Use only the minimal Calculator-like values already present in unit tests. `README.md` records:

```text
Release: cua-driver-rs-v0.22.2
Commit: d114f35fec05ecd37bf529e5587be86852205b64
Tools: list_apps, list_windows, get_window_state, health_report
Adoption: reference-only + contract fixture
License: MIT
```

Do not include a real hostname, username, path, PID from the current machine, title from a user window, or screenshot data.

- [ ] **Step 4: Run parser, upstream-source, and redaction tests**

```bash
npx --yes pnpm@9.0.4 vitest run tests/unit/cua-json.test.ts tests/unit/cua-connection.test.ts tests/contract/upstream-sources.test.ts tests/unit/redaction.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add product/tests/fixtures/cua/0.22.2 product/tests/unit/cua-json.test.ts product/tests/unit/cua-connection.test.ts docs/upstream-sources.md
git commit -m "test: pin cua 0.22.2 response fixtures"
```

---

### Task 7: Version, documentation, and deterministic verification

**Files:**
- Modify: `product/package.json`
- Modify: `product/pnpm-lock.yaml`
- Modify: `product/src/version.ts`
- Modify: `README.md`
- Modify: `product/README.md`
- Modify: `docs/host-compatibility.md`
- Modify: `docs/troubleshooting.md`
- Modify: `product/tests/e2e/development/README.md`
- Modify: `product/tests/contract/development-acceptance-cli.test.ts`
- Modify: `product/tests/contract/development-evidence.test.ts`
- Modify: `product/tests/contract/engine-lock.test.ts`
- Modify: `product/tests/contract/upstream-sources.test.ts`
- Modify: `product/tests/e2e/development/acceptance-recorder.ts`
- Modify: `product/tests/e2e/development/evidence.schema.json`
- Modify: `product/tests/unit/acceptance-recorder.test.ts`
- Modify: `product/tests/unit/cli-doctor.test.ts`
- Modify: `product/tests/unit/cli-setup.test.ts`

**Interfaces:**
- Publishes: product `0.2.3`, protocol `1.2.0`, Developer Preview only.
- Preserves: engine lock `0.22.2`, host statuses, and release-ineligible state.

- [ ] **Step 1: Make version/status contract tests red**

Update contract expectations to require `0.2.3`, schema-v3 development evidence, and wording that distinguishes historical v0.2.1 evidence from failed v0.2.2 attempts and current v0.2.3 results. Keep named hosts `not-tested`/`experimental` and Windows exact-window `blocked upstream`.

- [ ] **Step 2: Run version-sensitive tests and confirm red**

```bash
cd product
npx --yes pnpm@9.0.4 vitest run tests/contract/engine-lock.test.ts tests/contract/upstream-sources.test.ts tests/contract/protocol-snapshot.test.ts tests/contract/integrations.test.ts
```

Expected: failures while product/docs still say `0.2.2`.

- [ ] **Step 3: Bump the patch version and update docs**

Set:

```ts
export const PRODUCT_VERSION = "0.2.3" as const;
export const PROTOCOL_VERSION = "1.2.0" as const;
```

Update package and lockfile mechanically with pnpm. Document that v0.2.3 changes test truth and macOS diagnostics, not public tool behavior or Cua action latency. Remove the ambiguous bare `development-passed` wording unless it names the evidence version.

The historical v0.2.1/v0.2.2 specifications and implementation plans remain immutable records. In test files, change only product-version and evidence-version assertions; never rewrite the Cua `0.22.2` engine lock.

- [ ] **Step 4: Run the complete deterministic suite five times**

Run this loop without modifying files between iterations:

```bash
cd product
for run in 1 2 3 4 5; do
  npx --yes pnpm@9.0.4 test || exit 1
done
npx --yes pnpm@9.0.4 typecheck
npm pack --dry-run --json
```

Expected: five complete green runs, typecheck success, and a package containing no evidence or diagnostic artifacts.

- [ ] **Step 5: Prove the public protocol snapshot did not change**

```bash
npx --yes pnpm@9.0.4 vitest run tests/contract/protocol-snapshot.test.ts tests/contract/mcp-server.test.ts tests/contract/no-fixed-action-delay.test.ts
```

Expected: unchanged two-tool snapshot and fixed-delay scan pass.

- [ ] **Step 6: Commit**

```bash
git add product/package.json product/pnpm-lock.yaml product/src/version.ts README.md product/README.md docs/host-compatibility.md docs/troubleshooting.md product/tests/e2e/development/README.md
git add product/tests/contract/development-acceptance-cli.test.ts product/tests/contract/development-evidence.test.ts product/tests/contract/engine-lock.test.ts product/tests/contract/upstream-sources.test.ts product/tests/e2e/development/acceptance-recorder.ts product/tests/e2e/development/evidence.schema.json product/tests/unit/acceptance-recorder.test.ts product/tests/unit/cli-doctor.test.ts product/tests/unit/cli-setup.test.ts
git commit -m "release: prepare developer preview 0.2.3"
```

---

### Task 8: Three real macOS acceptances and GitHub publication

**Files:**
- No production file is modified unless a real failure produces a separately diagnosed red-green fix.
- Evidence and fatal diagnostics remain outside the repository under private `mktemp -d` directories.

**Interfaces:**
- Exercises: `npm run acceptance:macos` through the public stdio MCP tools.
- Publishes: reviewed commits to `origin/main` only after all gates pass.

- [ ] **Step 1: Verify the interactive preflight**

```bash
cd product
node dist/cli/main.js doctor --json
```

Expected: `ok:true`, `desktop_unlocked:true`, engine `0.22.2`, product `0.2.3`, protocol `1.2.0`, and one valid screenshot size. If loginwindow is active, stop; do not bypass the gate.

- [ ] **Step 2: Run three independent real acceptances**

For each run create a new explicit directory with `mktemp -d` and run:

```bash
npx --yes pnpm@9.0.4 acceptance:macos -- --evidence /absolute/new-directory/macos-development.json
```

Expected for each run:

- exit 0;
- schema version 3;
- status `passed` or `degraded`, never `failed`;
- all four profiles `correct_count:30`, `failed_count:0`, `success_rate:1`;
- every profile correctness status `passed`;
- cleanup passed;
- no fatal diagnostic file.

- [ ] **Step 3: Audit the three aggregate reports**

Record, without copying private artifacts into git:

- p50/p95/max wall time for each profile;
- p50/p95 for every applicable stage;
- whether latency status passed;
- zero failure counts;
- absence of raw samples and private fields.

If any run fails, preserve that external diagnostic, stop publication, form ranked hypotheses, add a regression test at an approved seam, and repeat the red-green cycle. Do not count a later retry as replacing the failed run; after a fix, start a fresh sequence of three consecutive runs.

- [ ] **Step 4: Verify cleanup and release gate**

```bash
pgrep -af 'ucu-development-browser|desktop-harness/server.mjs|UCUAcceptanceFocusSentinel|dist/mcp/main.js'
npm run release:verify -- --channel beta
```

Expected: `pgrep` exits 1 and prints nothing because no owned acceptance process remains; Beta verification exits nonzero with `engine_not_release_eligible`.

- [ ] **Step 5: Review repository state**

```bash
git diff --check
git status --short --branch
git log --oneline origin/main..HEAD
```

Expected: clean worktree, no evidence files, and only the reviewed v0.2.2/v0.2.3 commits ahead of origin.

- [ ] **Step 6: Push GitHub**

```bash
git push origin main
```

Expected: push succeeds and `git status --short --branch` no longer reports `ahead`. If GitHub TLS fails, retry only the same non-destructive push after verifying remote identity; do not rewrite history or force-push.

- [ ] **Step 7: Final handoff**

Report:

- pushed commit range and final HEAD;
- deterministic and three-run real acceptance results;
- measured macOS speed and exact correctness;
- remaining Cua action-latency limitation;
- HanaAgent/WorkBuddy test prompt and the fact that named-host compatibility remains unverified until those runs complete.
