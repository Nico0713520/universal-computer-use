# Universal Computer Use v0.2.1 macOS Developer Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one repeatable `pnpm acceptance:macos` loop that proves UCU's public two-tool MCP, exact-window/background paths, snapshot lifecycle, bounded latency, cleanup, and redacted development evidence on a real Mac, while keeping host-development evidence and release evidence truthfully separate.

**Architecture:** Keep the production surface at two MCP tools. Add concise initialization instructions to the existing server; build the acceptance system under `product/tests/e2e/development` so it is source-only; use one long-lived SDK client and the existing loopback/browser fixture; wrap public calls with a pure timing/evidence recorder; use a small Node launcher for preflight, exit codes, and artifact path management. Named-host proof remains manual and external, validated by a separate development-only schema that cannot satisfy release verification.

**Tech Stack:** TypeScript 5.7, Node.js 22.19+, Vitest 3.2, `@modelcontextprotocol/sdk` 1.30, Zod 4, JSON Schema 2020-12, Cua Driver 0.22.2, isolated Chrome app window on macOS.

**Approved test seams:** MCP public requests/results; acceptance recorder inputs/outputs; acceptance process exit/stdout/stderr/cleanup; host evidence JSON; real macOS fixture through the public MCP. Do not test private registries, native Cua tokens, PIDs, or window IDs.

---

## Task 1: Publish host-visible control-loop instructions

**Files:**
- Create: `product/src/mcp/instructions.ts`
- Modify: `product/src/mcp/server.ts`
- Modify: `product/tests/contract/mcp-server.test.ts`

- [ ] **Step 1: Write the failing initialization contract test**

Add a test after the tool-inventory test that connects through the existing in-memory transport and asserts `client.getInstructions()` is a string whose first 512 characters contain all seven concepts: observe before acting, discover/lock the exact window, one action, latest snapshot, inspect the fresh state returned by `computer_act`, no blind retry, and stop when the goal is proved. Also assert it does not mention an embedded model, approval bypass, or a third tool.

```ts
it("publishes a self-contained safe control loop in MCP initialization", async () => {
  const { runtime } = fixtureRuntime();
  const client = await connectedClient(runtime);
  const instructions = client.getInstructions();
  expect(instructions).toBeTypeOf("string");
  const opening = instructions!.slice(0, 512);
  for (const phrase of [
    "Observe before the first action",
    "exact window",
    "one action",
    "latest snapshot",
    "computer_act returns",
    "Never blindly retry",
    "stop",
  ]) expect(opening).toContain(phrase);
  expect(instructions).not.toMatch(/embedded model|bypass|computer_verify/i);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `cd product && npx --yes pnpm@9.0.4 exec vitest run tests/contract/mcp-server.test.ts`

Expected: FAIL because `client.getInstructions()` is undefined.

- [ ] **Step 3: Add the minimal instruction constant and server option**

Export one immutable English instruction string from `src/mcp/instructions.ts`. Keep the first paragraph below 512 characters and self-contained:

```ts
export const MCP_SERVER_INSTRUCTIONS = [
  "Observe before the first action. Discover and lock the exact window when possible. Execute one action at a time using only the latest snapshot. computer_act returns the fresh next state; inspect it instead of observing again. Never blindly retry unverifiable input. Stop as soon as the visible goal is proved.",
  "Prefer element_ref inside an exact window; use screenshot coordinates only when semantic elements are unavailable. Re-discover after a stale or lost target.",
].join(" ");
```

Pass it as the second `McpServer` constructor argument: `{ instructions: MCP_SERVER_INSTRUCTIONS }`.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `cd product && npx --yes pnpm@9.0.4 exec vitest run tests/contract/mcp-server.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the vertical slice**

```bash
git add product/src/mcp/instructions.ts product/src/mcp/server.ts product/tests/contract/mcp-server.test.ts
git commit -m "feat: publish MCP control loop instructions"
```

## Task 2: Add the pure timing and redacted-evidence core

**Files:**
- Create: `product/tests/e2e/development/acceptance-recorder.ts`
- Create: `product/tests/unit/acceptance-recorder.test.ts`
- Create: `product/tests/e2e/development/evidence.schema.json`
- Create: `product/tests/contract/development-evidence.test.ts`

- [ ] **Step 1: Write failing recorder tests with a fixed monotonic clock**

Define tests for these exact public exports:

```ts
export type AcceptanceTimingName =
  | "mcp_start" | "desktop_observe" | "window_discover"
  | "window_observe" | "coordinate_action" | "element_action"
  | "mcp_reconnect";

export class AcceptanceRecorder {
  constructor(now?: () => number);
  measure<T>(name: AcceptanceTimingName, operation: () => Promise<T>): Promise<T>;
  recordScenario(name: AcceptanceScenarioName, passed: boolean): void;
  evidence(metadata: AcceptanceMetadata, cleanupPassed: boolean): DevelopmentEvidence;
}
```

Use a manually advanced clock to prove exact boundaries: `duration <= target` gives `target_met`; `target < duration <= hard_limit` gives `degraded`; `duration > hard_limit` rejects with `acceptance_timing_exceeded:<name>` and records `failed`. Assert the evidence object contains only enumerated metadata, scenarios, timings, cleanup, and timestamp—never arbitrary context supplied to `measure`.

Use these immutable thresholds:

```ts
const LIMITS = {
  mcp_start: [2_000, 10_000], desktop_observe: [1_000, 3_000],
  window_discover: [1_000, 3_000], window_observe: [1_000, 3_000],
  coordinate_action: [1_000, 3_000], element_action: [3_000, 8_000],
  mcp_reconnect: [2_000, 10_000],
} as const;
```

- [ ] **Step 2: Run recorder tests and confirm RED**

Run: `cd product && npx --yes pnpm@9.0.4 exec vitest run tests/unit/acceptance-recorder.test.ts`

Expected: FAIL because the recorder does not exist.

- [ ] **Step 3: Implement the recorder without process or filesystem access**

Use `performance.now` by default. `measure` must record in a `finally` path, classify with the fixed limits, rethrow operation failures unchanged, and throw the stable hard-limit error only after a successful operation exceeds its hard limit. `evidence` must derive overall status as `degraded` when any timing is degraded, otherwise `passed`; a failed timing cannot produce passing evidence.

The scenario enum must cover exactly:

```ts
type AcceptanceScenarioName =
  | "two_tool_inventory" | "desktop_png" | "fresh_snapshot"
  | "stale_snapshot_rejected" | "exact_window_discovered"
  | "window_png_and_element" | "background_element_effect"
  | "window_coordinate_effect" | "old_refs_rejected_after_reconnect";
```

- [ ] **Step 4: Write the strict evidence schema and failing schema tests**

The JSON schema must require:

- `schema_version: 1`
- `evidence_type: "computer-use-macos-development-acceptance"`
- `status: "passed" | "degraded"`
- product/protocol/engine versions as SemVer strings
- macOS version and `arm64 | x86_64`
- all nine scenario booleans, each `true`
- seven unique timing objects with fixed names, integer nonnegative duration/target/hard limit, and `target_met | degraded`
- `cleanup_passed: true`
- UTC timestamp

Set `additionalProperties:false` recursively. The contract test must parse a complete fixture through `z.fromJSONSchema`, reject missing scenarios, screenshots/base64, hashes, titles, text, paths, environment maps, usernames, hostnames, PID/window/snapshot/ref/token fields, and reject `status:"passed"` when any timing is degraded.

- [ ] **Step 5: Implement schema-aligned evidence and confirm GREEN**

Run:

```bash
cd product
npx --yes pnpm@9.0.4 exec vitest run tests/unit/acceptance-recorder.test.ts tests/contract/development-evidence.test.ts
npx --yes pnpm@9.0.4 typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the vertical slice**

```bash
git add product/tests/e2e/development/acceptance-recorder.ts product/tests/unit/acceptance-recorder.test.ts product/tests/e2e/development/evidence.schema.json product/tests/contract/development-evidence.test.ts
git commit -m "test: define macOS development evidence"
```

## Task 3: Build the source-only macOS acceptance launcher

**Files:**
- Create: `product/scripts/run-development-acceptance.mjs`
- Create: `product/tests/contract/development-acceptance-cli.test.ts`
- Modify: `product/package.json`

- [ ] **Step 1: Write failing process-boundary tests**

Spawn the launcher with a deliberately minimal test environment and use explicit dependency injection variables available only under `CUA_ACCEPTANCE_TEST_MODE=1`:

- `CUA_ACCEPTANCE_TEST_PLATFORM`
- `CUA_ACCEPTANCE_TEST_DOCTOR_JSON`
- `CUA_ACCEPTANCE_TEST_BROWSER`
- `CUA_ACCEPTANCE_TEST_CHILD_RESULT`

Tests must prove:

1. non-macOS exits nonzero, writes one stable `acceptance_preflight_failed:darwin_required` line to stderr, no stdout JSON, and does not create the evidence path;
2. failed doctor exits with `acceptance_preflight_failed:doctor_failed` before the child acceptance lane starts;
3. a simulated successful child result exits zero and emits exactly one JSON object on stdout with `status`, `evidence_path`, and `cleanup_passed`, while the evidence file itself contains no path;
4. an existing `--evidence` path fails closed rather than overwriting;
5. a simulated child cleanup failure exits nonzero with `acceptance_failed:cleanup_failed`.

The test-only injection must be rejected unless `NODE_ENV === "test"`; production runs always use real platform/doctor/browser/process checks.

- [ ] **Step 2: Run the CLI tests and confirm RED**

Run: `cd product && npx --yes pnpm@9.0.4 exec vitest run tests/contract/development-acceptance-cli.test.ts`

Expected: FAIL because the launcher and script do not exist.

- [ ] **Step 3: Implement deterministic preflight and child orchestration**

The launcher must:

1. parse only optional `--evidence /absolute/new/file.json`;
2. default to a newly created file under `mkdtemp(join(tmpdir(), "ucu-acceptance-"))`;
3. require Darwin and Node 22.19+;
4. run `pnpm build`;
5. parse `node dist/cli/main.js doctor --json` and require exact engine connection, tools, unlocked desktop, permissions/capture success, and locked version;
6. locate Chrome from `CUA_E2E_BROWSER` or `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`;
7. spawn one Vitest file with `CUA_DEVELOPMENT_ACCEPTANCE=1`, the selected browser, and the evidence path;
8. capture child stdout/stderr, forward diagnostics only on failure, parse the written schema-shaped evidence, and emit one summary JSON on success;
9. never restart or stop a shared Cua daemon;
10. remove an empty default temporary directory on failure.

Add:

```json
"acceptance:macos": "node scripts/run-development-acceptance.mjs"
```

- [ ] **Step 4: Confirm GREEN at the process seam**

Run:

```bash
cd product
npx --yes pnpm@9.0.4 exec vitest run tests/contract/development-acceptance-cli.test.ts
npx --yes pnpm@9.0.4 typecheck
```

Expected: PASS without touching the real desktop.

- [ ] **Step 5: Commit the vertical slice**

```bash
git add product/scripts/run-development-acceptance.mjs product/tests/contract/development-acceptance-cli.test.ts product/package.json
git commit -m "feat: add macOS development acceptance command"
```

## Task 4: Implement the real long-lived public-MCP acceptance loop

**Files:**
- Create: `product/tests/e2e/development/macos-acceptance.spec.ts`
- Create: `product/tests/e2e/development/README.md`
- Reuse unchanged: `product/tests/fixtures/desktop-harness/server.mjs`
- Reuse unchanged: `product/tests/fixtures/desktop-harness/index.html`

- [ ] **Step 1: Add a skipped-by-default real-lane shell test**

The file must include one unskipped guard test proving it does nothing without `CUA_DEVELOPMENT_ACCEPTANCE=1`, and one `describe.skipIf` real scenario. Before adding the scenario, run the direct Vitest file and confirm the guard passes while the real lane is skipped.

Run: `cd product && npx --yes pnpm@9.0.4 exec vitest run tests/e2e/development/macos-acceptance.spec.ts`

Expected: one guard PASS, real test SKIP.

- [ ] **Step 2: Implement one owned lifecycle, not multiple loosely coupled tests**

Inside one real `it`, use `try/finally` to own and clean:

- loopback fixture process;
- isolated Chrome `--app=<fixture-url>` profile;
- first `Client + StdioClientTransport`;
- replacement client/transport after reconnect;
- temporary browser profile.

Reuse the proven launch flags from `retina.spec.ts`. Never run DOM automation; only fetch `/state` as the independent effect oracle. Verify PNG magic bytes from MCP image content. Generate evidence only after cleanup completes successfully.

- [ ] **Step 3: Add the stateful acceptance sequence through only two tools**

Execute this exact order and record each scenario:

1. time MCP connect; assert `client.getInstructions()` and exact tool list;
2. time desktop `computer_observe`; assert one valid PNG and capture its snapshot;
3. call `computer_act` with `wait(0)`; assert consumed ID and a new PNG/snapshot;
4. reuse the consumed ID; assert `isError:true` and `code:"stale_snapshot"`;
5. time desktop observe with `discover:{windows:true, query:"Computer Use Deterministic Desktop Harness"}`; assert exactly one matching titled result but do not write title/ref into evidence;
6. time exact-window observe with screenshot and `elements:{query:"Single click"}`; assert window PNG, local coordinate space, and one element with label `Single click`;
7. time background element click; require returned next window state and independently poll `/state` for `clicks + 1`;
8. take the newest exact-window snapshot and time a local-coordinate click on the fixed `double-target` center `(320,140)` scaled from the 1280×800 fixture canvas into the exact window PNG; independently poll `/state` for `double_clicks + 1`;
9. save the old snapshot/window/element refs in memory, close the first transport, time a new MCP connect, assert an action with the old snapshot returns `stale_snapshot`, and assert exact-window observe with the old window ref returns `window_not_found`;
10. close all resources, delete the profile, create evidence with `cleanup_passed:true`, validate against the schema, and write to the new absolute path with `{ flag: "wx" }`.

Every `computer_act` must consume the newest matching snapshot. The coordinate action must use the action response's fresh window snapshot; do not add an extra observe between the semantic action and coordinate action.

- [ ] **Step 4: Document truthful requirements and output**

`README.md` must say the command is development-only, requires a signed installed Cua 0.22.2 with Screen Recording and Accessibility, an unlocked macOS 14+ desktop, Chrome, and no other agent fighting for the same desktop during the fixture run. It must explain `--evidence`, the default temporary evidence path, degraded timings, and that the record cannot unlock Beta/Stable.

- [ ] **Step 5: Run the real lane and fix only reproducible product/runner defects**

Run:

```bash
cd product
npx --yes pnpm@9.0.4 acceptance:macos -- --evidence /tmp/ucu-macos-development-v0.2.1.json
```

Expected: exit 0; stdout contains one JSON summary; external evidence validates; no screenshot or opaque ref is persisted. If the fixture/browser title or AX label differs on this machine, inspect the actual public MCP response and make the narrowest fixture/query correction—do not bypass the public MCP with native Cua calls.

- [ ] **Step 6: Prove cleanup and no repository evidence leakage**

Run:

```bash
test -f /tmp/ucu-macos-development-v0.2.1.json
git status --short
pgrep -fal 'computer-use-e2e-browser|desktop-harness/server.mjs' || true
```

Expected: external evidence exists; no evidence JSON appears under the repository; no fixture or isolated browser process remains.

- [ ] **Step 7: Commit the real lane**

```bash
git add product/tests/e2e/development/macos-acceptance.spec.ts product/tests/e2e/development/README.md
git commit -m "test: prove macOS precise control through MCP"
```

## Task 5: Add non-promotable named-host development evidence

**Files:**
- Create: `product/tests/e2e/host/development-evidence.schema.json`
- Create: `product/tests/contract/host-development-evidence.test.ts`
- Create: `product/tests/e2e/host/hanaagent.md`
- Create: `product/tests/e2e/host/workbuddy.md`
- Modify: `product/tests/e2e/host/codex.md`
- Modify: `product/tests/e2e/host/kimi.md`

- [ ] **Step 1: Write failing strict-schema tests**

The development schema must accept only:

- `schema_version:1`
- `evidence_type:"computer-use-host-development-loop"`
- `status: development-passed | failed | blocked | not-run`
- host name `codex | kimi | hanaagent | workbuddy`, exact nonempty host version and host-reported model ID
- platform `macos`, OS version, engine version
- exact two-tool list
- first/later PNG booleans and same-model boolean
- repeated calls and turn count
- plugin confirmation count fixed at zero plus truthful host approval enum
- Calculator fixed expression/result and TextEdit result without typed sentence
- natural-stop result and tool calls after goal
- UTC timestamp and reviewer ID/method

`development-passed` must require both tasks passed, two PNGs to the same model, repeated calls, zero post-goal calls, and zero plugin confirmations. Reject every release-evidence link/hash field and every screenshot/text/path/env/identity/token field.

The contract test must also prove `product/scripts/verify-release.mjs` and `tests/contract/host-evidence.test.ts` never load `development-evidence.schema.json` or `CUA_HOST_DEVELOPMENT_EVIDENCE_FILES`.

- [ ] **Step 2: Confirm RED**

Run: `cd product && npx --yes pnpm@9.0.4 exec vitest run tests/contract/host-development-evidence.test.ts`

Expected: FAIL because the schema and four complete runbooks do not exist.

- [ ] **Step 3: Add the schema and external-file validator**

When `CUA_HOST_DEVELOPMENT_EVIDENCE_FILES` is absent, the test must assert no real development evidence JSON is committed. When present, split with `path.delimiter`, require absolute paths, parse each external file strictly, and never change `docs/host-compatibility.md`.

- [ ] **Step 4: Add one shared development section to all four runbooks**

Each runbook must include:

1. build, `setup --development`, doctor, host registration, and required host restart;
2. exact two-tool check;
3. Calculator `37 × 19 = 703` using exact-window mode;
4. TextEdit one-use sentence through visible GUI interaction;
5. two PNG turns to the same host-reported model, repeated calls, natural stop, plugin confirmations zero, and truthful host approvals;
6. external development evidence validation command;
7. explicit statement that `development-passed` is not `verified` and cannot satisfy release verification.

Preserve the existing stricter release-evidence sections for Codex/Kimi. HanaAgent and WorkBuddy must use generic absolute-path stdio configuration where no audited generator exists; do not claim automatic installation.

- [ ] **Step 5: Confirm GREEN**

Run:

```bash
cd product
npx --yes pnpm@9.0.4 exec vitest run tests/contract/host-development-evidence.test.ts tests/contract/host-evidence.test.ts
```

Expected: PASS; release evidence behavior unchanged.

- [ ] **Step 6: Commit the vertical slice**

```bash
git add product/tests/e2e/host/development-evidence.schema.json product/tests/contract/host-development-evidence.test.ts product/tests/e2e/host/hanaagent.md product/tests/e2e/host/workbuddy.md product/tests/e2e/host/codex.md product/tests/e2e/host/kimi.md
git commit -m "docs: add named host development acceptance"
```

## Task 6: Version the preview and publish a truthful progress matrix

**Files:**
- Modify: `product/package.json`
- Modify: `product/src/version.ts`
- Modify: `product/tests/contract/engine-lock.test.ts`
- Modify: `product/tests/unit/cli-doctor.test.ts`
- Modify: `product/tests/unit/cli-setup.test.ts`
- Modify: `README.md`
- Modify: `product/README.md`
- Modify: `docs/host-compatibility.md`

- [ ] **Step 1: Write the failing version and documentation assertions**

Update the existing exact version expectations to `0.2.1` before production constants. Extend a contract test to require the root README matrix rows and these independent columns: `Code`, `Contract`, `macOS real`, `Named host`, `Release`. Require Windows exact-window to remain `blocked upstream`, Windows DPI to remain `pending real hardware`, and every release cell to remain `blocked`.

- [ ] **Step 2: Confirm RED**

Run:

```bash
cd product
npx --yes pnpm@9.0.4 exec vitest run tests/contract/engine-lock.test.ts tests/unit/cli-doctor.test.ts tests/unit/cli-setup.test.ts
```

Expected: FAIL on the old product version.

- [ ] **Step 3: Bump product version only; keep protocol and engine versions unchanged**

Set package and `PRODUCT_VERSION` to `0.2.1`. Do not change `PROTOCOL_VERSION` (`1.1.0`), Cua lock (`0.22.2`), or engine eligibility. Update descriptive `0.2.0` product-version wording without rewriting dependency-version statements.

- [ ] **Step 4: Replace stale status counts with evidence-based status**

Root and product README must link the development acceptance guide and show the approved matrix:

| Capability | Code | Contract | macOS real | Named host | Release |
|---|---|---|---|---|---|
| Desktop observe/act | complete | passed | development-passed | pending | blocked |
| macOS exact window | complete | passed | development-passed | pending | blocked |
| macOS background semantic action | complete | passed | development-passed | pending | blocked |
| Windows desktop | complete | passed | n/a in this lane | pending | blocked |
| Windows DPI | harness complete | passed | pending real hardware | pending | blocked |
| Windows exact window | blocked upstream | truthful refusal | unavailable | unavailable | blocked |

Only write `development-passed` for macOS rows after Task 4 created and validated real evidence. If the real run is degraded but otherwise passes, label it `development-passed (degraded timing)`. If it fails, label the row `failed development acceptance` and do not mark the task complete.

`docs/host-compatibility.md` must mention the separate development schema/runbooks but leave its production status table unchanged until real eligible-runtime host evidence exists.

- [ ] **Step 5: Confirm GREEN**

Run:

```bash
cd product
npx --yes pnpm@9.0.4 test
npx --yes pnpm@9.0.4 typecheck
```

Expected: PASS with no release-eligibility change.

- [ ] **Step 6: Commit the vertical slice**

```bash
git add product/package.json product/src/version.ts product/tests/contract/engine-lock.test.ts product/tests/unit/cli-doctor.test.ts product/tests/unit/cli-setup.test.ts README.md product/README.md docs/host-compatibility.md
git commit -m "release: prepare 0.2.1 developer preview"
```

## Task 7: Full regression, privacy audit, package audit, and public push

**Files:**
- Verify all changed files
- Modify only defects found by the checks below

- [ ] **Step 1: Run the complete automated suite**

```bash
cd product
npx --yes pnpm@9.0.4 test
npx --yes pnpm@9.0.4 typecheck
npx --yes pnpm@9.0.4 build
npm pack --dry-run --json
```

Expected: all tests and type checks pass; the source-only acceptance scripts/tests are not added to the published `files` list.

- [ ] **Step 2: Re-run real macOS acceptance from a clean build**

Use a new evidence path; do not overwrite the previous record:

```bash
cd product
npx --yes pnpm@9.0.4 acceptance:macos -- --evidence /tmp/ucu-macos-development-v0.2.1-final.json
```

Expected: pass or pass-with-degraded-timing, no cleanup failure, exact two-tool inventory, and a schema-valid external record.

- [ ] **Step 3: Audit the artifact for prohibited data**

```bash
rg -n 'data:image|iVBOR|snapshot_|win_|el_|app_|/Users/|HOME|hostname|window_id|pid|token|Computer Use Deterministic Desktop Harness|Single click' /tmp/ucu-macos-development-v0.2.1-final.json
```

Expected: no matches. Then validate it through the contract test by setting only the development evidence variable agreed by its schema test.

- [ ] **Step 4: Review scope and repository cleanliness**

```bash
git status --short
git diff --check HEAD~7..HEAD
git diff --stat HEAD~7..HEAD
git log --oneline -10
```

Confirm no real evidence, browser profile, screenshot, bridge script, host config, credential, or unrelated local change is staged.

- [ ] **Step 5: Push the completed branch**

```bash
git push origin main
```

Expected: remote contains all v0.2.1 commits; local `main` is synchronized. If branch protection rejects direct push, stop and report the exact rejection rather than changing repository policy.

- [ ] **Step 6: Final user handoff**

Report:

- what `0.2.1` now proves;
- actual real-Mac timings and whether any were degraded;
- external evidence path (not its private contents);
- named-host tasks still pending until the user runs them in Codex/Kimi/HanaAgent/WorkBuddy;
- Windows exact-window/DPI and Beta/Stable blockers;
- pushed commit IDs and GitHub URL.

Do not claim the plugin is production-ready, Windows-precise, or host-verified.
