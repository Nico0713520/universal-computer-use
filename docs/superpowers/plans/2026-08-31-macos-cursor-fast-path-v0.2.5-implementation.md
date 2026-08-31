# macOS Cursor Fast Path v0.2.5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the locked Cua Agent Cursor integration so every UCU desktop/window session runs without the visible animated cursor, then prove the speed and execution route through focused, privacy-safe macOS evidence.

**Architecture:** Keep the public MCP surface and protocol unchanged. Add one private engine bootstrap policy that disables and verifies the Agent Cursor transactionally for both Cua sessions before `CuaEngine` becomes usable. Extend development-only performance evidence with route counts, add a focused single-profile lane, and keep all GUI-moving acceptance behind an explicit exclusive-desktop gate.

**Tech Stack:** TypeScript 5.7, Node.js 22.19+, Vitest 3.2, Zod 4, MCP SDK 1.30, locked `@trycua/cua-driver` 0.22.2, JSON Schema/Ajv 2020.

## Global Constraints

- Public MCP tools remain exactly `computer_observe` and `computer_act`.
- Protocol remains `1.2.0`; no request or response field changes.
- Product version advances from `0.2.4` to `0.2.5` only after all deterministic checks pass.
- Cua Driver remains locked to `0.22.2` and remains unmodified.
- Require only Cursor tools the product actually calls: `set_agent_cursor_enabled` and `get_agent_cursor_state`; do not require `set_agent_cursor_motion` in this phase.
- Both desktop and window sessions must be disabled and read back as `enabled:false` before `CuaEngine.fromSdk` resolves.
- Any Cursor setup or verification failure cleans up every successfully created session and fails closed; no half-initialized engine may escape.
- No fixed post-action delay, imitation-human pause, blind retry, action replay, or daemon restart recovery may be added.
- Route evidence contains aggregate enum counts only; it must not contain screenshots, text, prompts, paths, window titles, IDs, refs, tokens, or raw samples.
- Deterministic tests are non-invasive. Any lane that opens or activates GUI applications requires an explicit `--exclusive-desktop` acknowledgement and must not be run while the user is using the Mac.
- A failed measured action is recorded once and never replaced by a retry.
- “Cua daemon degradation” remains unproven and must not be documented as the cause unless the cursor-complete implementation still reproduces it with controlled evidence.

---

## File Structure

- Create `product/src/engine/agent-cursor.ts`: parse the minimal Cua Cursor state contract and disable/verify a list of already-created sessions.
- Modify `product/src/engine/cua.ts`: transactionally apply the private Cursor policy during two-session bootstrap and clean up on any failure.
- Modify `product/engine.lock.json`: require the two Cursor tools actually used by UCU.
- Modify `product/tests/helpers/fake-cua-sdk.ts`: model session-owned Cursor state by default and expose deterministic failure overrides.
- Create `product/tests/unit/agent-cursor.test.ts`: unit-test strict Cursor result parsing and fail-closed behavior.
- Modify `product/tests/unit/cua-connection.test.ts`: prove both sessions are configured before engine construction and all partial failures clean up.
- Modify `product/tests/contract/engine-lock.test.ts`: freeze the new required tool contract.
- Modify `product/tests/e2e/development/performance-recorder.ts`: attach a closed action-route enum to samples and emit aggregate `route_counts`.
- Modify `product/tests/e2e/development/macos-acceptance.spec.ts`: collect the route already returned in `action_result` for measured actions.
- Modify `product/tests/e2e/development/acceptance-recorder.ts`: preserve only aggregate route counts in schema-v4 evidence.
- Modify `product/tests/e2e/development/evidence.schema.json`: require route-count evidence and bump development evidence to schema version 4.
- Modify `product/scripts/run-development-acceptance.mjs`: validate schema v4 and require explicit exclusive-desktop acknowledgement.
- Create `product/tests/e2e/development/macos-single-profile.spec.ts`: run one named 5-warm-up/30-measured profile without correctness, reconnect, Calculator, or TextEdit phases.
- Create `product/tests/e2e/development/single-profile-recorder.ts`: emit one redacted focused-profile artifact.
- Create `product/tests/e2e/development/single-profile-evidence.schema.json`: validate focused profile evidence independently of full acceptance.
- Create `product/scripts/run-development-profile.mjs`: source-only launcher for one selected profile with explicit exclusive-desktop acknowledgement.
- Create `product/tests/e2e/development/macos-cursor-ab.spec.ts`: same-process, same-session, same-target Cursor enabled/disabled comparison on an owned pixel-only target.
- Create `product/tests/e2e/development/cursor-ab-evidence.schema.json`: redacted A/B evidence contract.
- Create `product/scripts/run-cursor-ab.mjs`: explicit development launcher; never part of ordinary tests or setup.
- Modify `product/tests/fixtures/desktop-harness/index.html`: add one owned canvas/pixel-only target whose effect is externally countable.
- Modify `product/package.json`, `product/src/version.ts`, `product/README.md`, `product/tests/e2e/development/README.md`, and root `README.md`: publish the truthful v0.2.5 behavior and commands.

---

### Task 1: Lock and parse the Cursor capability

**Files:**
- Create: `product/src/engine/agent-cursor.ts`
- Create: `product/tests/unit/agent-cursor.test.ts`
- Modify: `product/engine.lock.json`
- Modify: `product/tests/contract/engine-lock.test.ts`

**Interfaces:**
- Consumes: an SDK object exposing `callTool(name, argumentsJson, options?)` and already-created Cua session names.
- Produces: `disableAndVerifyAgentCursor(sdk, sessions): Promise<void>`; it resolves only when every named session reads back `enabled:false`.

- [ ] **Step 1: Freeze the required tool list with a failing contract test**

Update the expected `required_tools` array in `product/tests/contract/engine-lock.test.ts` by appending the capabilities beside the other state/configuration tools:

```ts
"set_agent_cursor_enabled",
"get_agent_cursor_state",
```

Run:

```bash
cd product
npx --yes pnpm@9.0.4 vitest run tests/contract/engine-lock.test.ts
```

Expected: FAIL because `engine.lock.json` does not yet contain both names.

- [ ] **Step 2: Add only the two used Cursor tools to the lock**

Add the following entries to `required_tools` in `product/engine.lock.json` without changing version, asset hashes, signer metadata, or eligibility:

```json
"set_agent_cursor_enabled",
"get_agent_cursor_state"
```

Run the contract test again. Expected: PASS.

- [ ] **Step 3: Write failing Cursor-policy tests**

Create `product/tests/unit/agent-cursor.test.ts` with cases that prove:

```ts
it("disables and verifies every supplied session", async () => {
  await disableAndVerifyAgentCursor(sdk, ["desktop", "window"]);
  expect(sdk.calls).toEqual([
    ["set_agent_cursor_enabled", { session: "desktop", enabled: false }],
    ["set_agent_cursor_enabled", { session: "window", enabled: false }],
    ["get_agent_cursor_state", { session: "desktop" }],
    ["get_agent_cursor_state", { session: "window" }],
  ]);
});

it.each([
  ["set tool error", setToolErrorSdk()],
  ["get tool error", getToolErrorSdk()],
  ["malformed JSON", malformedStateSdk()],
  ["wrong session", wrongSessionSdk()],
  ["still enabled", enabledStateSdk()],
])("fails closed for %s", async (_name, candidate) => {
  await expect(disableAndVerifyAgentCursor(candidate, ["desktop", "window"]))
    .rejects.toMatchObject({ code: "engine_contract_changed", recovery: "doctor" });
});
```

The test helper must return ordinary `ToolResult` values and must not throw private/raw Cua data into assertions.

Run:

```bash
npx --yes pnpm@9.0.4 vitest run tests/unit/agent-cursor.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 4: Implement the minimal private Cursor policy**

Create `product/src/engine/agent-cursor.ts` with a narrow structural SDK type, a strict minimal Zod schema, and parallel per-phase calls:

```ts
import type { ToolResult } from "@trycua/cua-driver";
import { z } from "zod";

import { ComputerUseError } from "../errors.js";

type CursorSdk = Readonly<{
  callTool(
    name: string,
    argumentsJson: string,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<ToolResult>;
}>;

const DisabledCursorStateSchema = z.object({
  session: z.string().min(1),
  enabled: z.literal(false),
}).passthrough();

function contractFailure(): ComputerUseError {
  return new ComputerUseError(
    "engine_contract_changed",
    "Cua did not disable the Agent Cursor for every UCU session",
    "doctor",
    false,
  );
}

function disabledState(result: ToolResult, expectedSession: string): void {
  if (result.isError) throw contractFailure();
  let value: unknown;
  try {
    value = JSON.parse(result.structuredJson ?? "");
  } catch {
    throw contractFailure();
  }
  const parsed = DisabledCursorStateSchema.safeParse(value);
  if (!parsed.success || parsed.data.session !== expectedSession) throw contractFailure();
}

export async function disableAndVerifyAgentCursor(
  sdk: CursorSdk,
  sessions: readonly string[],
): Promise<void> {
  const setResults = await Promise.all(sessions.map(async (session) => ({
    session,
    result: await sdk.callTool(
      "set_agent_cursor_enabled",
      JSON.stringify({ session, enabled: false }),
    ),
  })));
  if (setResults.some(({ result }) => result.isError)) throw contractFailure();

  const states = await Promise.all(sessions.map(async (session) => ({
    session,
    result: await sdk.callTool(
      "get_agent_cursor_state",
      JSON.stringify({ session }),
    ),
  })));
  for (const { session, result } of states) disabledState(result, session);
}
```

Do not add a public setting or environment flag that allows an Agent to re-enable the cursor.

- [ ] **Step 5: Run focused deterministic checks**

Run:

```bash
npx --yes pnpm@9.0.4 vitest run \
  tests/unit/agent-cursor.test.ts \
  tests/contract/engine-lock.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the capability boundary**

```bash
git add product/src/engine/agent-cursor.ts \
  product/tests/unit/agent-cursor.test.ts \
  product/engine.lock.json \
  product/tests/contract/engine-lock.test.ts
git commit -m "feat: lock cua agent cursor control"
```

---

### Task 2: Make dual-session bootstrap transactional

**Files:**
- Modify: `product/src/engine/cua.ts`
- Modify: `product/tests/helpers/fake-cua-sdk.ts`
- Modify: `product/tests/unit/cua-connection.test.ts`

**Interfaces:**
- Consumes: `disableAndVerifyAgentCursor(sdk, [desktopSession, windowSession])` from Task 1.
- Produces: `CuaEngine.fromSdk` that never resolves with Cursor-enabled or partially configured sessions.

- [ ] **Step 1: Teach the fake SDK session-owned Cursor state**

Extend `FakeSdkOptions` with deterministic overrides:

```ts
cursorSetErrorFor?: string;
cursorGetErrorFor?: string;
cursorReadbackEnabledFor?: string;
```

Inside `fakeSdk`, maintain:

```ts
const cursorEnabled = new Map<string, boolean>();
```

When `startSession` succeeds, initialize the named session to `true`. When `callTool` receives `set_agent_cursor_enabled`, parse `{session, enabled}`, record the call, update the map unless configured to fail, and return a successful `ToolResult`. When it receives `get_agent_cursor_state`, return `{session, enabled}` from that map unless configured to fail or force `true`. Preserve existing explicit `toolResults` precedence so current tests can still inject raw Cua results.

- [ ] **Step 2: Write failing two-session lifecycle tests**

Add these cases to `product/tests/unit/cua-connection.test.ts`:

```ts
it("disables and verifies the Agent Cursor for desktop and window sessions", async () => {
  const engine = await CuaEngine.fromSdk(sdk, lock);
  const sessions = sdk.startSessionCalls.map(({ session }) => session);
  expect(sdk.callToolCalls.filter(({ name }) => name.includes("agent_cursor")))
    .toEqual([
      ...sessions.map((session) => ({
        name: "set_agent_cursor_enabled",
        argumentsJson: JSON.stringify({ session, enabled: false }),
      })),
      ...sessions.map((session) => ({
        name: "get_agent_cursor_state",
        argumentsJson: JSON.stringify({ session }),
      })),
    ]);
  await engine.close();
});

it.each([
  ["desktop set failure", { cursorSetErrorFor: "desktop" }],
  ["window set failure", { cursorSetErrorFor: "window" }],
  ["desktop get failure", { cursorGetErrorFor: "desktop" }],
  ["window still enabled", { cursorReadbackEnabledFor: "window" }],
])("cleans every active session after %s", async (_name, cursorOptions) => {
  await expect(CuaEngine.fromSdk(fakeSdk({ ...base, ...cursorOptions }), lock))
    .rejects.toMatchObject({ code: "engine_contract_changed" });
  expect(sdk.endSessionCalls).toEqual([
    { session: windowSession },
    { session: desktopSession },
  ]);
});
```

Use the generated session names captured from `startSessionCalls`; do not hard-code UUIDs.

Run:

```bash
npx --yes pnpm@9.0.4 vitest run tests/unit/cua-connection.test.ts
```

Expected: FAIL because `CuaEngine.fromSdk` does not invoke the Cursor policy.

- [ ] **Step 3: Apply Cursor policy before engine construction**

Import Task 1’s helper in `product/src/engine/cua.ts`. After both scope checks pass, but before `new CuaEngine(...)`, configure the two validated session names:

```ts
const sessions = [desktop.value.state.session, window.value.state.session] as const;
try {
  await disableAndVerifyAgentCursor(sdk, sessions);
} catch (error) {
  await Promise.allSettled(
    [...sessions].reverse().map(async (session) => sdk.endSession({ session })),
  );
  throw error;
}

return new CuaEngine(sdk, lock.version, sessions[0], sessions[1]);
```

Do not retry a failed Cursor call. Do not start or restart the daemon. Do not return the engine if cleanup itself fails.

- [ ] **Step 4: Verify failure mapping remains truthful**

Add one test where `callTool` rejects with `DriverError.Transport` during Cursor setup through `CuaEngine.connect`. Expected public error remains:

```ts
{
  code: "runtime_unavailable",
  recovery: "doctor",
  retryable: true,
}
```

Direct `fromSdk` contract mismatches remain `engine_contract_changed`; only the outer daemon connector maps a transport loss to `runtime_unavailable`.

- [ ] **Step 5: Run the full engine test slice**

```bash
npx --yes pnpm@9.0.4 vitest run \
  tests/unit/agent-cursor.test.ts \
  tests/unit/cua-connection.test.ts \
  tests/unit/runtime-startup.test.ts \
  tests/unit/mcp-runtime-startup.test.ts \
  tests/contract/engine-lock.test.ts
```

Expected: PASS, with no GUI applications opened.

- [ ] **Step 6: Commit transactional session bootstrap**

```bash
git add product/src/engine/cua.ts \
  product/tests/helpers/fake-cua-sdk.ts \
  product/tests/unit/cua-connection.test.ts
git commit -m "fix: disable cua cursor for every session"
```

---

### Task 3: Aggregate execution routes in performance evidence

**Files:**
- Modify: `product/tests/e2e/development/performance-recorder.ts`
- Modify: `product/tests/unit/performance-recorder.test.ts`
- Modify: `product/tests/e2e/development/macos-acceptance.spec.ts`
- Modify: `product/tests/e2e/development/acceptance-recorder.ts`
- Modify: `product/tests/unit/acceptance-recorder.test.ts`
- Modify: `product/tests/e2e/development/evidence.schema.json`
- Modify: `product/scripts/run-development-acceptance.mjs`
- Modify: `product/tests/contract/development-evidence.test.ts`

**Interfaces:**
- Consumes: the existing public `action_result.route` value already returned by UCU.
- Produces: aggregate `route_counts` for every performance profile; action profiles must account for all successful measured calls.

- [ ] **Step 1: Add failing route-aggregation tests**

In `product/tests/unit/performance-recorder.test.ts`, add action samples with a deterministic split and assert:

```ts
expect(evidence.semantic_action_next_state.route_counts).toEqual({
  accessibility: 30,
});
expect(evidence.pixel_action_next_state.route_counts).toEqual({
  accessibility: 12,
  synthetic_events: 18,
});
expect(evidence.window_visual_observe.route_counts).toEqual({});
```

Also assert that:

- a passed action sample with no route is rejected;
- an observe sample with a route is rejected;
- an unknown route string is rejected;
- failed action samples may omit a route, and route totals then remain less than 30 while correctness fails.

Run:

```bash
npx --yes pnpm@9.0.4 vitest run tests/unit/performance-recorder.test.ts
```

Expected: FAIL because samples do not preserve routes.

- [ ] **Step 2: Extend the closed sample and aggregate types**

Add:

```ts
export const PERFORMANCE_ACTION_ROUTES = [
  "accessibility",
  "synthetic_events",
  "global_input",
  "system_api",
  "dom",
  "trusted_input",
  "unknown",
] as const;

export type PerformanceActionRoute = typeof PERFORMANCE_ACTION_ROUTES[number];

export type PerformanceSample = Readonly<{
  durationMs: number;
  outcome: PerformanceOutcome;
  stages: PerformanceStageTimings;
  route?: PerformanceActionRoute;
}>;
```

Add `route_counts: Readonly<Partial<Record<PerformanceActionRoute, number>>>` to every emitted profile. Change validation to receive the profile name so action/observe route rules are enforced at record time. Aggregate counts only; never retain the raw sample array in evidence.

- [ ] **Step 3: Collect routes from the measured public response**

In `macos-acceptance.spec.ts`, add a closed parser:

```ts
function measuredRoute(call: TimedToolCall): PerformanceActionRoute | undefined {
  if (!("result" in call)) return undefined;
  const route = structuredIfPresent(call.result)?.action_result?.route;
  return PERFORMANCE_ACTION_ROUTES.includes(route as PerformanceActionRoute)
    ? route as PerformanceActionRoute
    : undefined;
}
```

Pass that value into `measuredSample` for `semantic_action_next_state` and `pixel_action_next_state`. Do not derive the route from duration and do not treat `delivery` as a route.

- [ ] **Step 4: Advance development evidence to schema version 4**

In `evidence.schema.json`:

```json
"schema_version": { "const": 4 }
```

Add a `routeCounts` definition with the seven closed keys, non-negative integer values, and no extra properties. Require `route_counts` in every performance profile. For passed action profiles, require the sum of route counts to equal 30 through semantic validation in `acceptance-recorder.ts` and `run-development-acceptance.mjs`; observe profiles must emit `{}`.

Update fixture builders and contract tests from schema 3 to schema 4. Do not change protocol version.

- [ ] **Step 5: Run evidence and logging checks**

```bash
npx --yes pnpm@9.0.4 vitest run \
  tests/unit/performance-recorder.test.ts \
  tests/unit/acceptance-recorder.test.ts \
  tests/unit/redaction.test.ts \
  tests/contract/development-evidence.test.ts \
  tests/contract/logging-surface.test.ts
```

Expected: PASS. Grep the schema and projected evidence tests to confirm there are no raw route arrays or raw samples.

- [ ] **Step 6: Commit truthful route evidence**

```bash
git add product/tests/e2e/development/performance-recorder.ts \
  product/tests/unit/performance-recorder.test.ts \
  product/tests/e2e/development/macos-acceptance.spec.ts \
  product/tests/e2e/development/acceptance-recorder.ts \
  product/tests/unit/acceptance-recorder.test.ts \
  product/tests/e2e/development/evidence.schema.json \
  product/scripts/run-development-acceptance.mjs \
  product/tests/contract/development-evidence.test.ts
git commit -m "test: record aggregate cua action routes"
```

---

### Task 4: Add a focused profile lane and prevent accidental desktop disruption

**Files:**
- Create: `product/tests/e2e/development/single-profile-recorder.ts`
- Create: `product/tests/unit/single-profile-recorder.test.ts`
- Create: `product/tests/e2e/development/single-profile-evidence.schema.json`
- Create: `product/tests/e2e/development/macos-single-profile.spec.ts`
- Create: `product/scripts/run-development-profile.mjs`
- Create: `product/tests/contract/development-profile-cli.test.ts`
- Modify: `product/scripts/run-development-acceptance.mjs`
- Modify: `product/tests/contract/development-acceptance-cli.test.ts`
- Modify: `product/package.json`
- Modify: `product/tests/e2e/development/README.md`

**Interfaces:**
- Produces: `pnpm acceptance:macos:profile -- --profile <name> --exclusive-desktop [--evidence /abs/path]`.
- Produces: full acceptance that also requires `--exclusive-desktop` before it opens any GUI resource.

- [ ] **Step 1: Write launcher guard tests before changing behavior**

Add contract tests proving both launchers fail before doctor/build/GUI work when acknowledgement is missing:

```ts
expect(run([])).toMatchObject({
  exitCode: 1,
  stderr: expect.stringContaining("exclusive_desktop_confirmation_required"),
});
```

Accepted focused syntax is exactly:

```text
--profile window_visual_observe --exclusive-desktop
--profile window_semantic_observe --exclusive-desktop
--profile semantic_action_next_state --exclusive-desktop
--profile pixel_action_next_state --exclusive-desktop
```

Reject duplicate flags, unknown profiles, relative evidence paths, existing paths, and test injection outside `NODE_ENV=test`.

- [ ] **Step 2: Implement the explicit exclusive-desktop gate**

Change full acceptance argument parsing from an optional evidence pair to:

```text
--exclusive-desktop [--evidence /absolute/new/path]
```

The failure message must state that the lane may activate owned Chrome, the focus sentinel, Calculator, and TextEdit. It must not claim the ordinary MCP product always takes foreground focus.

- [ ] **Step 3: Build a single-profile recorder with a separate schema**

The focused artifact must contain only:

```ts
type SingleProfileEvidence = Readonly<{
  schema_version: 1;
  evidence_type: "computer-use-macos-development-profile";
  status: "passed" | "failed";
  metadata: {
    product_version: string;
    protocol_version: "1.2.0";
    engine_version: "0.22.2";
    macos_version: string;
    architecture: "arm64" | "x86_64";
  };
  profile_name: PerformanceScenarioName;
  performance: CorrectnessAwarePerformanceProfile;
  cleanup_passed: true;
  timestamp: string;
}>;
```

The recorder requires exactly five warm-ups and 30 measured samples for the selected profile. It reuses the same SLO and route validation as the full recorder and cannot be mistaken for full acceptance evidence.

- [ ] **Step 4: Implement the focused real-Mac spec**

Extract or reuse the existing `performanceIteration` logic without duplicating action semantics. The focused spec starts only the owned dependencies needed by the selected profile:

- visual/semantic window observe: loopback fixture + isolated browser + MCP;
- semantic action: focus sentinel + MCP; no Calculator or TextEdit;
- pixel action: loopback pixel-only fixture + isolated browser + MCP; no focus sentinel, Calculator, or TextEdit.

It performs one profile, writes the focused artifact, cleans its resources, and exits. It never runs reconnect tests or real-app smoke.

- [ ] **Step 5: Add package commands**

Add:

```json
"acceptance:macos": "node scripts/run-development-acceptance.mjs",
"acceptance:macos:profile": "node scripts/run-development-profile.mjs"
```

Do not add the focused lane to `pretest`, `test`, `build`, `prepack`, or `release:verify`.

- [ ] **Step 6: Verify the default suite remains non-invasive**

Run while observing the active desktop:

```bash
npx --yes pnpm@9.0.4 test
npx --yes pnpm@9.0.4 typecheck
```

Expected: PASS and no GUI application activation. Then run each acceptance command without `--exclusive-desktop`; expected: immediate refusal and no GUI changes.

- [ ] **Step 7: Commit focused and guarded test tooling**

```bash
git add product/tests/e2e/development/single-profile-recorder.ts \
  product/tests/unit/single-profile-recorder.test.ts \
  product/tests/e2e/development/single-profile-evidence.schema.json \
  product/tests/e2e/development/macos-single-profile.spec.ts \
  product/scripts/run-development-profile.mjs \
  product/tests/contract/development-profile-cli.test.ts \
  product/scripts/run-development-acceptance.mjs \
  product/tests/contract/development-acceptance-cli.test.ts \
  product/package.json \
  product/tests/e2e/development/README.md
git commit -m "test: add guarded macos performance profile"
```

---

### Task 5: Prove Cursor on/off behavior on the same pixel fallback

**Files:**
- Modify: `product/tests/fixtures/desktop-harness/index.html`
- Create: `product/tests/e2e/development/cursor-ab-recorder.ts`
- Create: `product/tests/unit/cursor-ab-recorder.test.ts`
- Create: `product/tests/e2e/development/cursor-ab-evidence.schema.json`
- Create: `product/tests/e2e/development/macos-cursor-ab.spec.ts`
- Create: `product/scripts/run-cursor-ab.mjs`
- Create: `product/tests/contract/cursor-ab-cli.test.ts`
- Modify: `product/package.json`
- Modify: `product/tests/e2e/development/README.md`

**Interfaces:**
- Produces: `pnpm acceptance:macos:cursor-ab -- --exclusive-desktop [--evidence /abs/path]`.
- Evidence compares Cursor `enabled` and `disabled` using one Cua process, one named window session, one owned target, and one verified `synthetic_events` route.

- [ ] **Step 1: Add an owned pixel-only oracle**

Add a canvas target to the existing isolated desktop fixture. It must:

- increment a dedicated `canvas_clicks` counter only for clicks inside a fixed rectangle;
- expose the rectangle in the existing fixture layout endpoint;
- expose the counter in `/state`;
- avoid a button/link/label accessibility node at the click point;
- reset only its owned counter through the existing reset endpoint.

Add fixture tests proving one synthetic DOM click inside increments once and a click outside does not increment.

- [ ] **Step 2: Write A/B recorder tests**

The recorder accepts 30 enabled and 30 disabled samples, each with duration, correctness, and route. It must reject evidence unless:

- both modes have exactly 30/30 correct actions;
- all 60 measured calls report `synthetic_events`;
- both states were read back before their blocks;
- `same_driver_process`, `same_session`, and `same_target` are true;
- cleanup succeeded.

It reports p50/p95/max and aggregate route counts for each mode. It does not impose a fabricated percentage improvement threshold; the measured difference is reported, and UCU’s ordinary focused profile remains the product SLO gate.

- [ ] **Step 3: Implement same-process Cursor A/B**

The real-Mac test must:

1. start one owned fixture/browser target;
2. connect once to the already installed locked Cua daemon;
3. start one window-scoped named session;
4. verify target identity and fixed canvas coordinates;
5. run five enabled warm-ups and 30 enabled measured clicks;
6. call `set_agent_cursor_enabled(false)` outside the measured interval;
7. call `get_agent_cursor_state` and require `enabled:false`;
8. run five disabled warm-ups and 30 disabled measured clicks at the same coordinates;
9. confirm every click exactly once through `/state` and every result route is `synthetic_events`;
10. end the session and clean all owned resources.

No failed action is retried. The script never restarts the daemon and never changes an unrelated Cua session.

- [ ] **Step 4: Guard the A/B launcher**

Require `--exclusive-desktop`; refuse before GUI setup without it. Keep the script out of normal package lifecycle commands.

Add:

```json
"acceptance:macos:cursor-ab": "node scripts/run-cursor-ab.mjs"
```

- [ ] **Step 5: Run deterministic A/B tooling tests**

```bash
npx --yes pnpm@9.0.4 vitest run \
  tests/unit/cursor-ab-recorder.test.ts \
  tests/contract/cursor-ab-cli.test.ts
```

Expected: PASS without opening GUI applications.

- [ ] **Step 6: Run the real A/B only in an agreed idle window**

Do not run this step while the user is working. At an agreed idle time:

```bash
cd product
npx --yes pnpm@9.0.4 acceptance:macos:cursor-ab -- \
  --exclusive-desktop \
  --evidence /absolute/private/new/cursor-ab.json
```

Required result: both modes 30/30, both route sets exclusively `synthetic_events`, same-process/session/target booleans true, cleanup true. Report the observed p50/p95 difference without claiming daemon degradation.

- [ ] **Step 7: Run UCU’s focused pixel profile in the same idle window**

```bash
npx --yes pnpm@9.0.4 acceptance:macos:profile -- \
  --profile pixel_action_next_state \
  --exclusive-desktop \
  --evidence /absolute/private/new/ucu-pixel-disabled.json
```

Required result: 30/30 correct, route counts present, existing p50/p95 SLO passed, cleanup true, and no visible purple Agent Cursor during the UCU session.

- [ ] **Step 8: Commit the controlled proof tooling**

```bash
git add product/tests/fixtures/desktop-harness/index.html \
  product/tests/e2e/development/cursor-ab-recorder.ts \
  product/tests/unit/cursor-ab-recorder.test.ts \
  product/tests/e2e/development/cursor-ab-evidence.schema.json \
  product/tests/e2e/development/macos-cursor-ab.spec.ts \
  product/scripts/run-cursor-ab.mjs \
  product/tests/contract/cursor-ab-cli.test.ts \
  product/package.json \
  product/tests/e2e/development/README.md
git commit -m "test: prove cua cursor fast path"
```

---

### Task 6: Version, document, and verify v0.2.5

**Files:**
- Modify: `product/package.json`
- Modify: `product/src/version.ts`
- Modify: `product/tests/contract/engine-lock.test.ts`
- Modify: `product/tests/e2e/development/evidence.schema.json`
- Modify: `product/README.md`
- Modify: `README.md`
- Modify: `product/tests/e2e/development/README.md`

**Interfaces:**
- Produces: a source-complete `0.2.5` checkout; publishing remains a separate explicit action.

- [ ] **Step 1: Bump product-only version fields**

Change:

```json
"version": "0.2.5"
```

and:

```ts
export const PRODUCT_VERSION = "0.2.5" as const;
export const PROTOCOL_VERSION = "1.2.0" as const;
```

Update schema metadata and exact version contract expectations to `0.2.5`. Keep Cua at `0.22.2`.

- [ ] **Step 2: Document only verified behavior**

Add a concise v0.2.5 note:

- UCU disables and verifies Cua’s session-owned Agent Cursor for both internal sessions;
- ordinary automation does not inherit Cua’s visible cursor animation;
- there is still no fixed post-action delay;
- foreground delivery can still change focus, and full acceptance intentionally activates owned apps;
- aggregate routes distinguish `accessibility` from `synthetic_events`;
- no automatic Cua daemon restart is performed after session start.

Do not state a new millisecond claim until Task 5’s same-target evidence exists.

- [ ] **Step 3: Run all deterministic release checks**

```bash
cd product
npx --yes pnpm@9.0.4 test
npx --yes pnpm@9.0.4 typecheck
npx --yes pnpm@9.0.4 build
npm pack --dry-run --json
node scripts/verify-release.mjs
```

Expected:

- all unit and contract tests pass;
- typecheck/build pass;
- package contains no native Cua binary, screenshot, private evidence, credentials, or model SDK;
- ordinary release remains blocked because locked platform `release_eligible` is still false.

- [ ] **Step 4: Re-run the no-fixed-delay proof**

```bash
npx --yes pnpm@9.0.4 vitest run tests/contract/no-fixed-action-delay.test.ts
```

Expected: PASS. Search source and canonical Skill for fixed post-action waits; expected zero findings.

- [ ] **Step 5: Run full macOS acceptance only when the desktop is free**

After the focused Cursor evidence passes and only in an agreed idle window:

```bash
npx --yes pnpm@9.0.4 acceptance:macos -- \
  --exclusive-desktop \
  --evidence /absolute/private/new/macos-v025.json
```

Required result: full schema-v4 evidence valid, every correctness gate passed, all four profiles 30/30, route counts internally consistent, Calculator/TextEdit smoke passed, cleanup true.

- [ ] **Step 6: Commit the v0.2.5 release candidate**

```bash
git add product/package.json product/src/version.ts \
  product/tests/contract/engine-lock.test.ts \
  product/tests/e2e/development/evidence.schema.json \
  product/README.md product/tests/e2e/development/README.md README.md
git commit -m "chore: prepare computer use v0.2.5"
```

- [ ] **Step 7: Review and push only after evidence review**

```bash
git status --short
git log --oneline --decorate -8
git diff HEAD~6..HEAD --stat
```

Expected: clean tree and only planned files changed. Review the redacted evidence summaries outside the repository. Push to GitHub only after the user asks to publish this version.

---

## Post-v0.2.5 Roadmap

### v0.2.6 — Host usability and direct integration

- Prove direct, bridge-free HanaAgent, WorkBuddy, and Codex sessions after host restart.
- Add one-command host configuration only for formats verified against named versions; otherwise continue generating explicit config.
- Improve plain-language diagnosis for permissions, frozen tool inventory, daemon state, and missing image forwarding.
- Test multiple hosts connected concurrently while UCU serializes actions safely; never restart a shared daemon during active sessions.
- Keep the host’s own multimodal model as the only decision model.

### macOS Beta gate

- Three clean-account consecutive full acceptance runs.
- Long-running soak with repeated connect/close and no stale session/cursor overlay leakage.
- Signed installer/update/uninstall proof and stable CuaDriver permission identity.
- Permission onboarding verified with a non-technical user.
- At least two named hosts complete Calculator and TextEdit tasks directly and stop naturally.
- Publish a Beta only when the engine lock has truthful release eligibility and external evidence paths.

### Windows v0.3

- Real hardware at 100%, 125%, and 150% DPI.
- Standard-user/admin target boundary and truthful UAC refusal.
- Exact-window discovery/observation only when the locked Cua contract supports it; otherwise keep explicit refusal.
- Background input, foreground fallback, multi-monitor coordinates, installer signing, SmartScreen, upgrade, and uninstall evidence.
- Direct named-host tests repeated on Windows; do not infer them from macOS results.

### Later product capability, after both platforms are stable

- Browser/CDP route for web-native precision and lower screenshot cost.
- Multi-display target selection.
- Clipboard, file upload/download, and rich-text workflows with explicit privacy boundaries.
- Region/delta screenshots only if they preserve fresh-snapshot and exactly-once invariants.
- A proprietary native runtime only if dependence on Cua becomes a proven product blocker; do not fork native code pre-emptively.

---

## Self-Review Results

- **Scope coverage:** Cursor lock, dual-session fail-closed bootstrap, route evidence, focused profile, controlled A/B, exclusive GUI guard, version/docs, and later roadmap all have an owning task.
- **No placeholders:** No task contains `TBD`, `TODO`, “similar to,” or an unspecified error-handling instruction.
- **Type consistency:** `PerformanceActionRoute`, `PerformanceSample.route`, and `route_counts` use one closed seven-value enum across recorder, acceptance, and schema.
- **Safety consistency:** deterministic tests never require GUI; every real GUI lane requires `--exclusive-desktop`; no plan step restarts Cua or retries an action.
- **Product-boundary consistency:** two MCP tools, protocol 1.2.0, host model ownership, locked Cua 0.22.2, and single-use snapshots remain unchanged.
