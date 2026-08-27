# Cross-Platform Computer Use Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a model-free, cross-platform Computer Use plugin that lets an existing multimodal Agent observe, act on, and verify a macOS or Windows desktop through three stable MCP tools.

**Architecture:** Keep the model loop in the host Agent. Add one isolated TypeScript product workspace that exposes `computer_observe`, `computer_act`, and `computer_verify`, translates them into pinned Cua Driver calls, binds all actions to fresh snapshots, and ships thin host-specific manifests. Treat Cua Driver as a pinned upstream dependency first; retain a source fork only if Phase 0 proves a missing native capability.

**Tech Stack:** Node.js 22.19+, TypeScript 5.7, pnpm 9, Zod 4, MCP TypeScript SDK 1.30, Vitest, Cua Driver `0.22.1` / commit `c60ef6ad2db8774fb342938843e2f17f26c68240`, macOS shell packaging, Windows PowerShell packaging, GitHub Actions.

**Approved specification:** `docs/superpowers/specs/2026-08-27-cross-platform-computer-use-plugin-design.md`

## Global constraints

- The plugin contains no model client, API key, planner, hidden decision loop, or chat GUI.
- The host Agent's current multimodal model reads every returned screenshot and decides every next action.
- The public MCP surface contains exactly three tools in v1: `computer_observe`, `computer_act`, `computer_verify`.
- State-changing calls require a current `snapshot_id`; a successful or partially executed batch invalidates the old snapshot.
- A batch contains at most eight actions and stops at the first failure, refusal, partial effect, or suspected no-op.
- macOS and Windows publish the same protocol schemas and error codes.
- Product code stays under `product/`; do not edit upstream Rust/native code until a reproducible contract test demonstrates the need.
- All platform installers pin Cua Driver `0.22.1`; upgrades require passing the contract and E2E suites.
- Test the protocol and adapter with a fake driver before touching the real desktop.
- Never silently turn `unverifiable` into `confirmed`.
- Keep commits small enough to revert one capability without reverting unrelated work.

## Target repository layout

```text
product/
  package.json
  pnpm-workspace.yaml
  pnpm-lock.yaml
  tsconfig.base.json
  vitest.workspace.ts
  packages/
    protocol/
      package.json
      src/
      test/
    cua-runtime/
      package.json
      src/
      test/
  apps/
    mcp/
      package.json
      src/
      test/
  skills/
    computer-use/
      SKILL.md
  plugins/
    generic-mcp/
    kimi/
    workbuddy/
    deepseek-harness/
  packaging/
    macos/
    windows/
  scripts/
  tests/
    contract/
    fixtures/
    host-compat/
    e2e/
docs/
  installation/
  compatibility.md
  upstream-cua.md
```

## Delivery waves and size gates

| Wave | Outcome | Tasks | Exit gate |
|---|---|---|---|
| A | Protocol plus macOS developer MVP | 1–10 | A visual MCP host completes TextEdit and Calculator fixtures on macOS |
| B | Windows MVP | 11 | The identical schemas complete Notepad and Calculator fixtures on Windows |
| C | Host packaging and release hardening | 12–15 | Four host classes pass discovery/image/loop/stop checks and signed artifacts are reproducible |

Do not start Wave B until the Wave A protocol contract is frozen. Do not start host-specific wrappers until the generic MCP package works; wrappers must remain configuration-only or thin translation layers.

---

### Task 1: Record and verify the pinned Cua baseline

**Files:**

- Create: `docs/upstream-cua.md`
- Create: `product/scripts/verify-upstream.mjs`
- Create: `product/tests/contract/upstream-pin.test.ts`
- Create: `product/cua-pin.json`
- Create: `product/package.json`
- Create: `product/pnpm-workspace.yaml`
- Create: `product/tsconfig.base.json`
- Create: `product/vitest.workspace.ts`
- Create: `product/.npmrc`

- [ ] **Step 1: Write a failing pin test**

```ts
// product/tests/contract/upstream-pin.test.ts
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("Cua upstream pin", () => {
  it("pins the approved release and source commit", async () => {
    const pin = JSON.parse(await readFile(new URL("../../cua-pin.json", import.meta.url), "utf8"));
    expect(pin.version).toBe("0.22.1");
    expect(pin.commit).toBe("c60ef6ad2db8774fb342938843e2f17f26c68240");
    expect(pin.npmPackage).toBe("@trycua/cua-driver");
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails because the workspace and pin do not exist**

Run: `cd product && corepack pnpm exec vitest run tests/contract/upstream-pin.test.ts`

Expected: FAIL with a missing `cua-pin.json` or missing Vitest configuration.

- [ ] **Step 3: Create the workspace and exact dependency pins**

```json
// product/package.json
{
  "name": "universal-computer-use-product",
  "private": true,
  "packageManager": "pnpm@9.0.4",
  "engines": { "node": ">=22.19.0" },
  "scripts": {
    "build": "pnpm -r build",
    "test": "vitest run",
    "typecheck": "pnpm -r typecheck",
    "verify:upstream": "node scripts/verify-upstream.mjs"
  },
  "devDependencies": {
    "typescript": "5.7.3",
    "vitest": "3.2.4"
  }
}
```

```yaml
# product/pnpm-workspace.yaml
packages:
  - packages/*
  - apps/*
```

```json
// product/cua-pin.json
{
  "version": "0.22.1",
  "commit": "c60ef6ad2db8774fb342938843e2f17f26c68240",
  "tag": "cua-driver-rs-v0.22.1",
  "npmPackage": "@trycua/cua-driver"
}
```

The verifier must compare `cua-pin.json`, the installed package version, and—when this is a Cua source checkout—`libs/cua-driver/rust/VERSION`. It exits nonzero on any mismatch.

- [ ] **Step 4: Document the fork decision procedure**

`docs/upstream-cua.md` must include:

- exact version, tag, and commit;
- MIT attribution requirements;
- `git remote add cua-upstream https://github.com/trycua/cua.git` sync instructions;
- the rule that native edits require a failing contract/E2E reproduction;
- a patch ledger table with columns `date`, `platform`, `upstream issue`, `local commit`, `removal condition`;
- the default decision: consume the published SDK/runtime without maintaining native divergence.

- [ ] **Step 5: Install, test, and verify**

Run: `cd product && corepack pnpm install --frozen-lockfile=false && corepack pnpm test && corepack pnpm verify:upstream`

Expected: all tests pass and the verifier prints `Cua Driver pin verified: 0.22.1`.

- [ ] **Step 6: Commit**

```bash
git add product docs/upstream-cua.md
git commit -m "chore: pin cua driver product baseline"
```

---

### Task 2: Define the stable protocol schemas

**Files:**

- Create: `product/packages/protocol/package.json`
- Create: `product/packages/protocol/tsconfig.json`
- Create: `product/packages/protocol/src/actions.ts`
- Create: `product/packages/protocol/src/observation.ts`
- Create: `product/packages/protocol/src/results.ts`
- Create: `product/packages/protocol/src/errors.ts`
- Create: `product/packages/protocol/src/tools.ts`
- Create: `product/packages/protocol/src/index.ts`
- Create: `product/packages/protocol/test/actions.test.ts`
- Create: `product/packages/protocol/test/tools.test.ts`

- [ ] **Step 1: Write failing schema tests**

Cover all v1 actions, both target forms, maximum batch length, required `snapshot_id`, scope defaults, delivery defaults, postcondition variants, error enums, and rejection of unknown fields.

```ts
it("rejects a ninth action", () => {
  const input = { snapshot_id: "snap_1", actions: Array.from({ length: 9 }, () => ({ type: "wait", ms: 50 })) };
  expect(() => ComputerActInputSchema.parse(input)).toThrow();
});

it("accepts element and pixel targets", () => {
  expect(TargetSchema.parse({ element_token: "el_7" })).toEqual({ element_token: "el_7" });
  expect(TargetSchema.parse({ x: 40, y: 90 })).toEqual({ x: 40, y: 90 });
});
```

- [ ] **Step 2: Run the tests and confirm exports are missing**

Run: `cd product && corepack pnpm exec vitest run packages/protocol/test`

Expected: FAIL because `ComputerActInputSchema` and related schemas do not exist.

- [ ] **Step 3: Implement discriminated Zod schemas and inferred types**

The action union must be exactly:

```ts
type ComputerAction =
  | { type: "click" | "double_click" | "right_click"; target: Target }
  | { type: "move"; target: Target; duration_ms?: number }
  | { type: "drag"; from: Target; to: Target; duration_ms?: number }
  | { type: "scroll"; delta_x?: number; delta_y: number; target?: Target }
  | { type: "type"; text: string; target?: Target; replace?: boolean }
  | { type: "keypress"; keys: string[] }
  | { type: "wait"; ms: number }
  | { type: "screenshot" };
```

Define `ActionEffect`, `ComputerUseErrorCode`, `Recovery`, `Observation`, `ActionResult`, `ComputerActOutput`, and `VerificationOutput` from schemas. Use `.strict()` for public input objects. Export protocol version `1.0.0`.

- [ ] **Step 4: Add JSON Schema snapshots for all three MCP tools**

`tools.test.ts` must assert stable names and required fields so a later dependency upgrade cannot accidentally change the public contract.

- [ ] **Step 5: Run focused and full checks**

Run: `cd product && corepack pnpm exec vitest run packages/protocol/test && corepack pnpm --filter @computer-use/protocol typecheck`

Expected: all protocol tests pass; TypeScript exits 0.

- [ ] **Step 6: Commit**

```bash
git add product/packages/protocol product/pnpm-lock.yaml
git commit -m "feat: define computer use protocol"
```

---

### Task 3: Implement snapshot identity and invalidation

**Files:**

- Create: `product/packages/cua-runtime/package.json`
- Create: `product/packages/cua-runtime/tsconfig.json`
- Create: `product/packages/cua-runtime/src/snapshot-store.ts`
- Create: `product/packages/cua-runtime/src/clock.ts`
- Create: `product/packages/cua-runtime/test/snapshot-store.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Test creation, lookup, TTL expiry, session mismatch, single-use invalidation after a mutating batch, explicit session cleanup, and that screenshots created by `computer_act` become the only current snapshots.

```ts
it("rejects a superseded snapshot", () => {
  const first = store.create(observationA);
  store.replace(first.sessionId, observationB);
  expect(() => store.requireCurrent(first.id, first.sessionId)).toThrowError("stale_snapshot");
});
```

- [ ] **Step 2: Run and see the missing module failure**

Run: `cd product && corepack pnpm exec vitest run packages/cua-runtime/test/snapshot-store.test.ts`

Expected: FAIL with module not found.

- [ ] **Step 3: Implement a small in-memory store**

Expose only:

```ts
interface SnapshotStore {
  create(input: SnapshotRecordInput): SnapshotRecord;
  requireCurrent(snapshotId: string, sessionId?: string): SnapshotRecord;
  replace(sessionId: string, input: SnapshotRecordInput): SnapshotRecord;
  invalidateSession(sessionId: string): void;
  sweepExpired(): number;
}
```

Use cryptographically random IDs, an injected clock for deterministic tests, a 30-minute default TTL, and no persistence of screenshot bytes. Store dimensions, coordinate transform, target window identity, and element-token mapping.

- [ ] **Step 4: Verify behavior and types**

Run: `cd product && corepack pnpm exec vitest run packages/cua-runtime/test/snapshot-store.test.ts && corepack pnpm --filter @computer-use/cua-runtime typecheck`

Expected: all lifecycle cases pass.

- [ ] **Step 5: Commit**

```bash
git add product/packages/cua-runtime
git commit -m "feat: bind actions to current snapshots"
```

---

### Task 4: Create the narrow Cua driver port and deterministic fake

**Files:**

- Create: `product/packages/cua-runtime/src/driver-port.ts`
- Create: `product/packages/cua-runtime/src/cua-driver-client.ts`
- Create: `product/packages/cua-runtime/src/cua-tool-result.ts`
- Create: `product/packages/cua-runtime/test/fakes/fake-driver.ts`
- Create: `product/packages/cua-runtime/test/cua-driver-client.test.ts`

- [ ] **Step 1: Write failing adapter-boundary tests**

Test session creation/reuse/end, JSON serialization into `callTool`, abort-signal propagation, malformed Cua results, and runtime disconnection.

- [ ] **Step 2: Run and confirm the port does not exist**

Run: `cd product && corepack pnpm exec vitest run packages/cua-runtime/test/cua-driver-client.test.ts`

Expected: FAIL due to missing `DriverPort`.

- [ ] **Step 3: Define the only runtime dependency interface**

```ts
export interface DriverPort {
  startSession(signal?: AbortSignal): Promise<{ sessionId: string }>;
  callTool(name: CuaToolName, args: unknown, signal?: AbortSignal): Promise<RawCuaToolResult>;
  endSession(sessionId: string, signal?: AbortSignal): Promise<void>;
}
```

`CuaDriverClient` wraps `CuaDriver.createConfigured(...)` or `CuaDriver.connect(...)` and calls the published SDK's `startSession`, `callTool`, and `endSession`. The fake records calls and queues exact results/errors; it must not emulate desktop behavior.

- [ ] **Step 4: Add compile-time protection for the upstream API**

The package must depend on `@trycua/cua-driver` exactly `0.22.1`. Add a test that constructs the wrapper with a structural fake matching the SDK methods, so renamed methods fail typechecking.

- [ ] **Step 5: Run tests and typecheck**

Run: `cd product && corepack pnpm exec vitest run packages/cua-runtime/test/cua-driver-client.test.ts && corepack pnpm --filter @computer-use/cua-runtime typecheck`

Expected: PASS; no desktop permissions are requested in unit tests.

- [ ] **Step 6: Commit**

```bash
git add product/packages/cua-runtime product/pnpm-lock.yaml
git commit -m "feat: add cua driver boundary"
```

---

### Task 5: Normalize Cua errors and action effects

**Files:**

- Create: `product/packages/cua-runtime/src/error-mapper.ts`
- Create: `product/packages/cua-runtime/src/result-mapper.ts`
- Create: `product/packages/cua-runtime/test/error-mapper.test.ts`
- Create: `product/packages/cua-runtime/test/result-mapper.test.ts`

- [ ] **Step 1: Write a table-driven failing test for every stable error**

Map raw outcomes into:

```text
permission_required        -> grant_permission
stale_snapshot             -> observe_again
window_not_found           -> choose_target
ambiguous_window           -> choose_target
element_not_found          -> observe_again
coordinate_out_of_bounds   -> observe_again
target_privilege_mismatch  -> use_foreground or stop
capture_failed             -> observe_again
action_timeout             -> observe_again
runtime_unavailable        -> restart_runtime
unsupported_action         -> stop
```

Tests must also assert `retryable`, retain a scrubbed diagnostic cause, and never expose clipboard contents or typed text.

- [ ] **Step 2: Run the tests and confirm mapping functions are absent**

Run: `cd product && corepack pnpm exec vitest run packages/cua-runtime/test/error-mapper.test.ts packages/cua-runtime/test/result-mapper.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement explicit switch-based mappings**

Unknown Cua failures map to `runtime_unavailable` only when transport is lost; otherwise return a non-retryable `unsupported_action` diagnostic. Do not use substring matching when Cua provides a structured code.

- [ ] **Step 4: Test effect preservation**

Assert that `confirmed`, `partial`, `unverifiable`, `suspected_noop`, and `refused` remain distinct. Assert that `unverifiable` does not become a failure, but forces an after-observation unless the caller explicitly selected `after: none` for a non-mutating action.

- [ ] **Step 5: Run focused checks**

Run: `cd product && corepack pnpm exec vitest run packages/cua-runtime/test/{error-mapper,result-mapper}.test.ts`

Expected: all table rows pass.

- [ ] **Step 6: Commit**

```bash
git add product/packages/cua-runtime
git commit -m "feat: normalize computer use outcomes"
```

---

### Task 6: Build the observe flow and coordinate contract

**Files:**

- Create: `product/packages/cua-runtime/src/observe.ts`
- Create: `product/packages/cua-runtime/src/coordinates.ts`
- Create: `product/packages/cua-runtime/src/image-content.ts`
- Create: `product/packages/cua-runtime/test/observe.test.ts`
- Create: `product/packages/cua-runtime/test/coordinates.test.ts`
- Create: `product/tests/fixtures/cua/desktop-state-retina.json`
- Create: `product/tests/fixtures/cua/desktop-state-windows-150.json`

- [ ] **Step 1: Write failing fixture tests**

Cover desktop/window/auto scope, PID/window selection, ambiguous windows, missing Accessibility tree fallback, Retina 2x screenshots, Windows 150% DPI, image MIME validation, and element-token generation.

```ts
it("keeps model coordinates in screenshot pixels", () => {
  const transform = CoordinateTransform.from({ screenshot: [2880, 1800], logical: [1440, 900] });
  expect(transform.screenshotToDesktop({ x: 1440, y: 900 })).toEqual({ x: 720, y: 450 });
});
```

- [ ] **Step 2: Run and confirm failures**

Run: `cd product && corepack pnpm exec vitest run packages/cua-runtime/test/{observe,coordinates}.test.ts`

Expected: FAIL due to missing observation implementation.

- [ ] **Step 3: Implement observation using Cua `get_desktop_state`**

`observe()` must:

1. ensure one live Cua session;
2. call `get_desktop_state` with requested scope and selectors;
3. validate and extract image data;
4. normalize window/application metadata;
5. convert accessible elements to opaque, snapshot-local `element_token` values;
6. store the exact coordinate transform;
7. return an MCP-compatible image block plus structured observation.

Element tokens must not expose raw platform handles to the model and must expire with the snapshot.

- [ ] **Step 4: Verify degraded mode**

When screen capture succeeds but Accessibility/UIA fails, return the screenshot, an empty semantic tree, and a structured degradation reason. When capture fails, return `capture_failed` and no usable snapshot.

- [ ] **Step 5: Run tests and typecheck**

Run: `cd product && corepack pnpm exec vitest run packages/cua-runtime/test/{observe,coordinates}.test.ts && corepack pnpm typecheck`

Expected: PASS on both platform fixtures without a real desktop.

- [ ] **Step 6: Commit**

```bash
git add product/packages/cua-runtime product/tests/fixtures/cua
git commit -m "feat: observe desktop through cua"
```

---

### Task 7: Translate and execute ordered action batches

**Files:**

- Create: `product/packages/cua-runtime/src/action-mapper.ts`
- Create: `product/packages/cua-runtime/src/act.ts`
- Create: `product/packages/cua-runtime/src/batch-policy.ts`
- Create: `product/packages/cua-runtime/test/action-mapper.test.ts`
- Create: `product/packages/cua-runtime/test/act.test.ts`

- [ ] **Step 1: Write one failing mapping test per action type**

The expected Cua tools are `click`, `drag`, `move_cursor`, `scroll`, `type_text`, `hotkey`/`press_key`, plus local cancellable wait and observation. Include double/right click arguments, element-target resolution, bounds checks, replace-text behavior, and delivery hints.

- [ ] **Step 2: Write failing batch-policy tests**

Assert:

- strict input order;
- at most eight actions;
- `stale_snapshot` before the first driver call;
- stop and mark the remainder `skipped` after error, `refused`, `partial`, or `suspected_noop`;
- continue after `confirmed` and `unverifiable`;
- invalidate the source snapshot once any state-changing action reaches the driver;
- generate a fresh after-snapshot unless `after: none` is valid;
- return actual `route` and `delivery` for every executed action.

- [ ] **Step 3: Run and confirm missing implementation**

Run: `cd product && corepack pnpm exec vitest run packages/cua-runtime/test/{action-mapper,act}.test.ts`

Expected: FAIL.

- [ ] **Step 4: Implement pure action mapping, then orchestration**

Keep coordinate conversion and element resolution outside switch branches. `act()` owns timeouts, sequence, fail-stop, invalidation, skipped results, and after-observation. It does not retry actions automatically.

```ts
export interface ActDependencies {
  driver: DriverPort;
  snapshots: SnapshotStore;
  observe: ObserveAfterAction;
  actionTimeoutMs: number;
}
```

- [ ] **Step 5: Run tests with forced transport errors and aborts**

Run: `cd product && corepack pnpm exec vitest run packages/cua-runtime/test/act.test.ts --reporter=verbose`

Expected: PASS, including timeout and mid-batch failure cases.

- [ ] **Step 6: Commit**

```bash
git add product/packages/cua-runtime
git commit -m "feat: execute snapshot-bound action batches"
```

---

### Task 8: Implement semantic verification

**Files:**

- Create: `product/packages/cua-runtime/src/verify.ts`
- Create: `product/packages/cua-runtime/test/verify.test.ts`

- [ ] **Step 1: Write failing tests for every v1 postcondition**

Cover element exists/absent, label/value contains text, window exists/absent/title matches, active application/window matches, Cua unsupported verification, and missing Accessibility/UIA.

- [ ] **Step 2: Run the test and confirm failure**

Run: `cd product && corepack pnpm exec vitest run packages/cua-runtime/test/verify.test.ts`

Expected: FAIL due to missing `verify()`.

- [ ] **Step 3: Map postconditions to Cua `verify_state`**

Return only `satisfied`, `unsatisfied`, or `unknown`. `unknown` must include a reason and recovery suggestion; it must never be promoted to success by the runtime.

- [ ] **Step 4: Run focused and package tests**

Run: `cd product && corepack pnpm exec vitest run packages/cua-runtime/test/verify.test.ts && corepack pnpm --filter @computer-use/cua-runtime test`

Expected: all verification and runtime tests pass.

- [ ] **Step 5: Commit**

```bash
git add product/packages/cua-runtime
git commit -m "feat: verify computer state semantically"
```

---

### Task 9: Expose exactly three tools through an MCP stdio server

**Files:**

- Create: `product/apps/mcp/package.json`
- Create: `product/apps/mcp/tsconfig.json`
- Create: `product/apps/mcp/src/server.ts`
- Create: `product/apps/mcp/src/handlers.ts`
- Create: `product/apps/mcp/src/main.ts`
- Create: `product/apps/mcp/src/config.ts`
- Create: `product/apps/mcp/test/server.test.ts`
- Create: `product/apps/mcp/test/stdio-smoke.test.ts`

- [ ] **Step 1: Write a failing MCP contract test**

Using the MCP SDK's in-memory transport, assert:

- tool listing is exactly the three approved names;
- input schemas equal protocol package snapshots;
- observe and act responses contain MCP image content plus structured content;
- errors are returned as tool errors with stable structured codes;
- stdout contains MCP frames only; diagnostics go to stderr.
- runtime defaults are action timeout 20 seconds, session idle timeout 30 minutes, metadata-only recording, and no action-approval path.

- [ ] **Step 2: Run the test and confirm there is no server**

Run: `cd product && corepack pnpm exec vitest run apps/mcp/test/server.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement dependency-injected handlers and stdio entry point**

```ts
export function createComputerUseServer(deps: RuntimeDependencies): Server;
export async function runStdioServer(config: RuntimeConfig): Promise<void>;
```

Configuration may contain runtime path, log level, metadata recording, timeouts, and emergency-stop hotkey. It must reject model endpoint, model name, and API key fields.

- [ ] **Step 4: Add process lifecycle handling**

On `SIGINT`, `SIGTERM`, or stdin close: abort the active batch, end the Cua session, invalidate snapshots, flush metadata, and exit. Do not leave input hooks running.

- [ ] **Step 5: Build and execute the smoke test**

Run: `cd product && corepack pnpm --filter @computer-use/mcp build && corepack pnpm exec vitest run apps/mcp/test`

Expected: PASS; the smoke test initializes, lists three tools, and shuts down cleanly using a fake runtime.

- [ ] **Step 6: Commit**

```bash
git add product/apps/mcp product/pnpm-lock.yaml
git commit -m "feat: expose universal computer use mcp"
```

---

### Task 10: Ship the canonical Skill, macOS installer, and macOS E2E MVP

**Files:**

- Create: `product/skills/computer-use/SKILL.md`
- Create: `product/plugins/generic-mcp/mcp.json`
- Create: `product/packaging/macos/install.sh`
- Create: `product/packaging/macos/uninstall.sh`
- Create: `product/packaging/macos/doctor.sh`
- Create: `product/tests/contract/skill-policy.test.ts`
- Create: `product/tests/e2e/macos/textedit.spec.ts`
- Create: `product/tests/e2e/macos/calculator.spec.ts`
- Create: `docs/installation/macos.md`

- [ ] **Step 1: Write a failing Skill policy test**

The test must assert the Skill instructs an Agent to observe before acting, use the newest snapshot only, prefer element tokens, keep dependent UI changes in separate batches, inspect every after-screenshot, recover from known effects/errors, and stop naturally when the goal is met. It must also assert the Skill never asks for a model key or tells the plugin to decide the next action.

- [ ] **Step 2: Run and confirm the Skill is missing**

Run: `cd product && corepack pnpm exec vitest run tests/contract/skill-policy.test.ts`

Expected: FAIL.

- [ ] **Step 3: Write the Skill and generic MCP configuration**

The Skill is the single source of loop instructions. Host wrappers in Task 12 reference it rather than copying it. `mcp.json` launches the built stdio entry point and contains no secrets.

- [ ] **Step 4: Write installer/doctor tests before implementing scripts**

Use shell-level tests that install into a temporary prefix and fake the Cua download. Assert the installer pins `CUA_DRIVER_RS_VERSION=0.22.1`, refuses unsupported architecture, preserves existing user configuration on upgrade, and that uninstall removes product-owned files only.

- [ ] **Step 5: Implement the macOS scripts**

The installer must:

1. require Apple Silicon for v1;
2. install the MCP package and pinned Cua Driver runtime;
3. reuse Cua's signed authorization host where required;
4. print deterministic Screen Recording and Accessibility instructions;
5. install `computer-use doctor` and an emergency-stop command;
6. never modify an Agent's config without an explicit install target argument.

`doctor.sh` checks runtime version, process reachability, screen capture permission, Accessibility permission, active display geometry, and returns machine-readable JSON with a nonzero exit code on failure.

- [ ] **Step 6: Run macOS tests in permission-safe order**

Run: `cd product && corepack pnpm test`

Expected: all unit/contract tests pass without prompting.

Run after granting OS permissions: `cd product && CUA_E2E=1 corepack pnpm exec vitest run tests/e2e/macos --sequence.concurrent=false`

Expected: TextEdit receives a unique text token and Calculator displays the expected result; screenshots and coordinates align on a Retina display.

- [ ] **Step 7: Document first-run and recovery paths**

`docs/installation/macos.md` must show install, MCP connection, OS permission grant, doctor output, upgrade, uninstall, stale authorization recovery, and an explicit statement that no separate model is configured.

- [ ] **Step 8: Commit**

```bash
git add product/skills product/plugins/generic-mcp product/packaging/macos product/tests docs/installation/macos.md
git commit -m "feat: deliver macos computer use mvp"
```

**Wave A gate:** Connect one image-capable MCP host on macOS. Run the user-level tasks “open TextEdit and type a unique sentence” and “calculate 37 × 19”. Save trace metadata and confirm the Agent stops without a plugin-side `finished` action.

---

### Task 11: Add Windows packaging and E2E parity

**Files:**

- Create: `product/packaging/windows/install.ps1`
- Create: `product/packaging/windows/uninstall.ps1`
- Create: `product/packaging/windows/doctor.ps1`
- Create: `product/tests/e2e/windows/notepad.spec.ts`
- Create: `product/tests/e2e/windows/calculator.spec.ts`
- Create: `product/tests/e2e/windows/privilege-mismatch.spec.ts`
- Create: `product/tests/contract/windows-packaging.test.ts`
- Create: `docs/installation/windows.md`

- [ ] **Step 1: Write script contract tests on a Windows CI runner**

Assert Windows 10 1903+/Windows 11 x64 detection, pinned Cua `0.22.1`, temporary-prefix installation, idempotent upgrade, product-only uninstall, and machine-readable doctor output.

- [ ] **Step 2: Run and confirm the missing-script failures**

Run on Windows: `cd product; corepack pnpm exec vitest run tests/contract/windows-packaging.test.ts`

Expected: FAIL because PowerShell entry points are absent.

- [ ] **Step 3: Implement Windows install lifecycle**

Install the same MCP JavaScript bundle and Cua Windows runtime. Use a per-user installation by default. If autostart is enabled, create a named, product-owned scheduled task and record its exact name for uninstall. Never request elevation merely to run ordinary user applications.

- [ ] **Step 4: Make privilege mismatch explicit**

When a non-elevated runtime targets an elevated application, return `target_privilege_mismatch`, actual delivery mode, and recovery `use_foreground` or `stop`. Do not silently retry with elevation.

- [ ] **Step 5: Run Windows E2E at 100% and 150% DPI**

Run on Windows: `cd product; $env:CUA_E2E='1'; corepack pnpm exec vitest run tests/e2e/windows --sequence.concurrent=false`

Expected: Notepad receives a unique token; Calculator returns the expected result at both DPI settings; the elevated fixture returns the stable mismatch error.

- [ ] **Step 6: Verify cross-platform schema identity**

Run: `cd product; corepack pnpm exec vitest run tests/contract`

Expected: one protocol snapshot is used by both platforms; there are no platform-specific public tool fields.

- [ ] **Step 7: Commit**

```bash
git add product/packaging/windows product/tests docs/installation/windows.md
git commit -m "feat: deliver windows computer use mvp"
```

**Wave B gate:** Complete “type a unique sentence in Notepad” and “calculate 37 × 19” through the same host-visible MCP schemas used on macOS.

---

### Task 12: Package thin adapters for Kimi, WorkBuddy, and DeepSeek Harness

**Files:**

- Create: `product/plugins/kimi/kimi.plugin.json`
- Create: `product/plugins/kimi/mcp.json`
- Create: `product/plugins/workbuddy/.codebuddy-plugin/plugin.json`
- Create: `product/plugins/workbuddy/.mcp.json`
- Create: `product/plugins/deepseek-harness/package.json`
- Create: `product/plugins/deepseek-harness/index.js`
- Create: `product/plugins/deepseek-harness/cordis.patch.yml`
- Create: `product/tests/host-compat/manifests.test.ts`
- Create: `docs/compatibility.md`

- [ ] **Step 1: Write failing manifest-validation tests**

Assert each wrapper resolves the canonical Skill and launches the same MCP entry point. Reject copied loop prose, model dependencies, API key fields, host-specific tool schemas, and additional Computer Use tools.

- [ ] **Step 2: Run and confirm manifests are missing**

Run: `cd product && corepack pnpm exec vitest run tests/host-compat/manifests.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement Kimi and WorkBuddy manifests**

Use Kimi's `kimi.plugin.json` with relative Skill/MCP paths. Use WorkBuddy/CodeBuddy's `.codebuddy-plugin/plugin.json` and root `.mcp.json`. Both wrappers should be data files only.

- [ ] **Step 4: Implement the DeepSeek Harness adapter**

Use the community DSH plugin shape (`dsh` bundle metadata plus Cordis patch) only as a host adapter. `index.js` starts or registers the universal MCP server; it must not include DSH's separate vision client or internal planning loop.

- [ ] **Step 5: Perform host discovery smoke tests**

For each installed host, verify tool discovery, image delivery, one action, after-image delivery, and natural stop. Record exact host version, OS, pass/fail, and limitations in `docs/compatibility.md`.

- [ ] **Step 6: Run all static compatibility tests**

Run: `cd product && corepack pnpm exec vitest run tests/host-compat`

Expected: all manifests resolve locally and expose the same protocol version.

- [ ] **Step 7: Commit**

```bash
git add product/plugins product/tests/host-compat docs/compatibility.md
git commit -m "feat: package computer use host adapters"
```

---

### Task 13: Add redacted local traces and operational diagnostics

**Files:**

- Create: `product/apps/mcp/src/trace-writer.ts`
- Create: `product/apps/mcp/src/redaction.ts`
- Create: `product/apps/mcp/src/doctor-command.ts`
- Create: `product/apps/mcp/test/trace-writer.test.ts`
- Create: `product/apps/mcp/test/redaction.test.ts`
- Create: `docs/troubleshooting.md`

- [ ] **Step 1: Write failing privacy tests**

Assert metadata mode records timestamps, session/snapshot IDs, action type, route, delivery, effect, stable errors, window/app identity, and durations. It must not record typed text, clipboard bodies, full screenshots, environment variables, or model prompts.

- [ ] **Step 2: Run and confirm trace modules are absent**

Run: `cd product && corepack pnpm exec vitest run apps/mcp/test/{trace-writer,redaction}.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement bounded JSONL traces**

Default to `metadata`; allow `off`. Rotate by size and age, create files user-readable only, and expose a command that prints the trace path without dumping trace contents. Screenshot retention must require an explicit debugging flag and a visible warning.

- [ ] **Step 4: Add deterministic diagnostics**

The unified doctor command aggregates platform script results, runtime pin, MCP build version, protocol version, permissions, driver connection, displays, and host config discovery. Exit 0 only when a basic observation can succeed.

- [ ] **Step 5: Test and commit**

Run: `cd product && corepack pnpm exec vitest run apps/mcp/test && corepack pnpm typecheck`

Expected: PASS and no sensitive fixture value appears in snapshots.

```bash
git add product/apps/mcp docs/troubleshooting.md
git commit -m "feat: add private traces and diagnostics"
```

---

### Task 14: Automate build, license, artifact, and upgrade checks

**Files:**

- Create: `.github/workflows/product-ci.yml`
- Create: `.github/workflows/product-release.yml`
- Create: `product/scripts/check-licenses.mjs`
- Create: `product/scripts/build-artifacts.mjs`
- Create: `product/scripts/generate-sbom.mjs`
- Create: `product/tests/contract/artifacts.test.ts`
- Create: `THIRD_PARTY_NOTICES.md`
- Modify: `product/package.json`

- [ ] **Step 1: Write a failing artifact contract test**

Assert artifact names, embedded protocol/Cua versions, checksum files, license notice, SBOM, executable entry point, and absence of source maps containing local paths.

- [ ] **Step 2: Run and confirm no artifacts exist**

Run: `cd product && corepack pnpm exec vitest run tests/contract/artifacts.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement the CI matrix**

Pull requests run format/type/unit/contract tests on macOS and Windows. Protected hardware E2E jobs run serially on labeled macOS and Windows machines. The workflow fails on Cua pin drift, schema drift, unapproved native-file edits, or incompatible licenses.

- [ ] **Step 4: Build release artifacts**

Produce:

```text
computer-use-macos-arm64-<version>.tar.gz
computer-use-windows-x64-<version>.zip
SHA256SUMS
THIRD_PARTY_NOTICES.md
sbom.spdx.json
```

Add root product scripts `check:licenses`, `build:artifacts`, and `generate:sbom`; `build:artifacts` must invoke the other two before packaging.

macOS signing/notarization and Windows signing credentials remain in CI secret storage. Release scripts must fail closed when signing is required but unavailable.

- [ ] **Step 5: Test clean install, upgrade, rollback, and uninstall**

On each platform install the previous released fixture, upgrade to the candidate, run doctor/E2E, roll back, and uninstall. Assert user-owned host configuration and trace data follow documented preservation rules.

- [ ] **Step 6: Run release checks and commit**

Run: `cd product && corepack pnpm test && corepack pnpm typecheck && corepack pnpm build && node scripts/check-licenses.mjs && node scripts/build-artifacts.mjs && corepack pnpm exec vitest run tests/contract/artifacts.test.ts`

Expected: two platform artifacts validate, license scan passes, checksums and SBOM are present.

```bash
git add .github product/scripts product/tests/contract THIRD_PARTY_NOTICES.md
git commit -m "ci: build signed computer use releases"
```

---

### Task 15: Run the cross-host acceptance benchmark and freeze v1

**Files:**

- Create: `product/tests/fixtures/tasks/basic-agent-tasks.json`
- Create: `product/scripts/run-acceptance.mjs`
- Create: `docs/acceptance-v1.md`
- Modify: `product/package.json`
- Modify: `docs/compatibility.md`
- Modify: `docs/upstream-cua.md`

- [ ] **Step 1: Define deterministic acceptance tasks**

Use 20 runs per platform across application launch, text entry, button click, simple calculation, window switching, and visible result reading. Exclude payments, account changes, destructive deletion, and external publishing. Each task has a setup reset, visible success oracle, timeout, and trace correlation ID.

- [ ] **Step 2: Write a failing result-validator test**

The validator must reject missing runs, success below 80%, schema mismatches, action confirmations without evidence, unclassified failures, or an Agent that continues calling tools after the goal is met.

- [ ] **Step 3: Run the benchmark on the reference host/model combinations**

Add `"acceptance": "node scripts/run-acceptance.mjs"` to `product/package.json`, then run:

Run on each test machine: `cd product && corepack pnpm acceptance -- --platform current --runs 20 --output artifacts/acceptance.json`

Expected: at least 16/20 successful runs on each platform; every failure links to redacted trace metadata.

- [ ] **Step 4: Complete the compatibility matrix**

For Codex, Kimi, WorkBuddy/CodeBuddy, DeepSeek Harness, and generic MCP, record:

- tested version and operating system;
- whether MCP images reach the current model;
- three-tool discovery;
- after-image loop continuity;
- automatic mode behavior;
- natural stopping behavior;
- known limitation or unsupported status.

- [ ] **Step 5: Re-evaluate the Cua fork decision**

If all requirements pass through the public SDK, record “no native fork retained.” If a native patch was necessary, link its failing test, upstream issue/PR, isolated commit, and removal condition in the patch ledger. No undocumented native divergence may enter v1.

- [ ] **Step 6: Freeze protocol `1.0.0` and tag the candidate**

Run: `cd product && corepack pnpm test && corepack pnpm typecheck && corepack pnpm build && git diff --check`

Expected: all checks pass and the working tree is clean after committing results.

```bash
git add product/tests/fixtures product/scripts/run-acceptance.mjs docs
git commit -m "test: certify computer use v1 acceptance"
git tag computer-use-v1.0.0-rc.1
```

**Wave C gate:** Both platform artifacts install cleanly, four host classes complete the full observe–act–observe loop, benchmark success is at least 80%, all failures are explainable from redacted traces, and the repository states whether a native Cua fork is actually needed.

## Final verification checklist

- [ ] `corepack pnpm test` passes from `product/`.
- [ ] `corepack pnpm typecheck` passes from `product/`.
- [ ] `corepack pnpm build` produces no untracked generated source.
- [ ] `node product/scripts/verify-upstream.mjs` verifies Cua `0.22.1`.
- [ ] MCP lists exactly three tools and returns image plus structured content.
- [ ] No package depends on a model SDK or reads a model API key.
- [ ] No host adapter duplicates the canonical decision-loop instructions.
- [ ] macOS and Windows use byte-identical public JSON Schemas.
- [ ] Old snapshots are rejected after any attempted state change.
- [ ] Batches stop on failure, refusal, partial effect, and suspected no-op.
- [ ] macOS permission failures and Windows privilege mismatch are explicit.
- [ ] Install, upgrade, rollback, uninstall, and emergency stop are tested.
- [ ] Traces exclude typed text, clipboard bodies, prompts, and default screenshots.
- [ ] License notice, SBOM, checksums, and signatures accompany releases.
- [ ] The v1 acceptance report contains 20 runs per platform at 80%+ success.

## Effort guardrails

The expected custom product layer is approximately 3,000–6,000 lines of production TypeScript/configuration plus a comparable amount of tests, fixtures, packaging, and documentation. This is a planning range, not a delivery promise. The observe–act loop itself is small; most effort belongs to platform permission identity, signing, DPI/Retina correctness, Windows privilege behavior, host compatibility, and repeatable E2E testing.

If Phase 0 works through the published Cua SDK, this remains a medium product project. If implementation starts changing Cua's Rust platform crates before a contract test proves the gap, stop and review scope: that path changes the project into a large, long-term cross-platform runtime fork.
