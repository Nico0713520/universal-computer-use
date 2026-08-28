# Universal Computer Use v0.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship protocol 1.1.0 window discovery, precise window observation, element-first/background actions, bounded verification, and truthful recovery while preserving the v0.1 desktop path and two-tool MCP surface.

**Architecture:** Keep `computer_observe` and `computer_act` as the only public tools. The runtime owns session-scoped opaque app/window refs and one single-use snapshot; a typed Cua adapter calls the pinned 0.22.2 raw tool boundary, validates every structured response, and hides PID/window IDs/paths/tokens. Window controls use Accessibility/UIA element tokens first, window screenshot pixels second, while desktop calls continue through the existing compatibility path.

**Tech Stack:** TypeScript 5.7, Node.js 22.19+, Zod 4.4, MCP SDK 1.30, Vitest 3.2, `@trycua/cua-driver` 0.22.2.

## Implementation status (2026-08-28)

- Tasks 1–9 and Task 10's policy, documentation, automated tests, and package verification are implemented.
- Automated result: 30 test files / 258 tests pass; typecheck and `npm pack --dry-run --json` pass.
- macOS precise-window E2E coverage is authored but remains development evidence until run with `CUA_E2E=1` on an authorized Retina machine.
- Source audit changed one assumption: Cua 0.22.2's Windows app/window/state tools are stubs. Windows therefore keeps the desktop compatibility path and actively returns `unsupported_platform` for precise requests. The originally planned Windows precision harness is deferred rather than replaced with fake evidence.
- Runtime 0.22.2 remains `release_eligible:false`; no Beta/Stable promotion is implied by automated tests.

## Global Constraints

- Public MCP tools remain exactly `computer_observe` and `computer_act`.
- Product version becomes `0.2.0`; protocol version becomes `1.1.0`.
- `computer_observe({})` and all v0.1 desktop action inputs remain valid.
- Every snapshot is consumed atomically before the first Cua mutation and can never be reused.
- `app_ref` and `window_ref` are transport-session scoped; `element_ref` is snapshot scoped.
- Cua Runtime remains unmodified and visibly signed as CuaDriver; UCU does not fork, copy, patch, re-sign, or disguise it.
- Cua 0.22.2 remains `release_eligible:false` until platform evidence passes.
- No unconditional settle sleep, no automatic mutation retry, no action batch, and no silent background-to-foreground escalation.
- Public output never exposes PID, window ID, bundle path, executable path, AUMID, upstream snapshot ID, or element token.
- macOS target is 14+ on Apple silicon/Intel; Windows target is 10 1903+/11 x64; Windows arm64 is out of scope.
- Browser/CDP, multi-display addressing, rich paste, trajectory recording, locked desktop, UAC secure desktop, and Session 0 stay out of scope.

## Confirmed test seams

1. MCP Interface through exported JSON schemas and MCP tool results.
2. EnginePort through a fake external Cua SDK boundary, not private adapter functions.
3. Snapshot/Target behavior through `ComputerUseRuntime.observe/act`.
4. CLI/engine lock through release and staging contract tests.
5. Real desktop through macOS/Windows/host evidence lanes.

---

### Task 1: Pin and stage the real Cua 0.22.2 contract

**Files:**
- Modify: `product/package.json`
- Modify: `product/pnpm-lock.yaml`
- Modify: `product/engine.lock.json`
- Modify: `product/src/version.ts`
- Modify: `product/scripts/select-engine-release.mjs`
- Modify: `product/tests/contract/engine-lock.test.ts`
- Modify: `product/tests/contract/engine-stage.test.ts`
- Modify: `product/tests/unit/cua-connection.test.ts`
- Modify: `docs/upstream-sources.md`

**Interfaces:**
- Consumes: existing `EngineLockSchema`, `CuaEngine.fromSdk`, release asset verification.
- Produces: exact SDK/runtime version `0.22.2`, source commit `d114f35fec05ecd37bf529e5587be86852205b64`, and required raw tools used by later tasks.

- [ ] **Step 1: Write the failing lock contract**

```ts
expect(lock.version).toBe("0.22.2");
expect(lock.source_commit).toBe("d114f35fec05ecd37bf529e5587be86852205b64");
expect(lock.required_tools).toEqual(expect.arrayContaining([
  "list_apps",
  "list_windows",
  "get_window_state",
  "verify_state",
  "launch_app",
  "invoke_menu",
  "set_value",
  "health_report",
]));
expect(lock.platforms.macos.release_eligible).toBe(false);
expect(lock.platforms.windows.release_eligible).toBe(false);
```

- [ ] **Step 2: Run the focused tests and verify red**

Run: `cd product && pnpm vitest run tests/contract/engine-lock.test.ts tests/unit/cua-connection.test.ts`

Expected: FAIL because the repository still pins 0.22.1 and the required inventory omits the v0.2 tools.

- [ ] **Step 3: Stage the dependency and verified lock**

Set `package.json` to `"@trycua/cua-driver":"0.22.2"`, regenerate `pnpm-lock.yaml` with `pnpm install --frozen-lockfile=false --ignore-scripts`, and use this verified lock data:

```json
{
  "version": "0.22.2",
  "tag": "cua-driver-rs-v0.22.2",
  "source_commit": "d114f35fec05ecd37bf529e5587be86852205b64",
  "required_fix_commits": ["90295148d34dac8e5a1307bac917e08171af5839"],
  "required_tools": [
    "click", "double_click", "right_click", "drag", "end_session",
    "get_desktop_state", "hotkey", "move_cursor", "press_key", "scroll",
    "start_session", "type_text", "list_apps", "list_windows",
    "get_window_state", "verify_state", "launch_app", "invoke_menu",
    "set_value", "health_report"
  ]
}
```

Use macOS asset `cua-driver-rs-0.22.2-darwin-universal.tar.gz` with SHA-256 `a9ca5891386a3a50b595b53329127e18b0326ce1cefd4e8dcd16efff0e58f4cc`; installer hashes are `install.sh=317ba3a49fdba10f2a7f1b9f392c1bc1b7657f3aae85e1e2e43684cf17a1bf3b`, release `_install-rust.sh=f7483c2d081ed836ba1f9cbad943037907f098cf1be45f37a94d7a2d21303940`, source `_install-common.sh=5bc3aa010eb8667a099b582a9ada9a8f93001745b842cc7cf3cc6c472520cf29`, and `uninstall.sh=fb5d6e89edfe89f5c3d2597cec9a8b73a89109a01cddc2dba11cafcef3777d57`.

Use Windows asset `cua-driver-rs-0.22.2-windows-x86_64.zip` with SHA-256 `03403da57c5e686c8bccb9b1d57a182e37cdf329c5f949eb54460aef554e6795`; installer hashes are release `install.ps1=3b10252d4bc2deff83bdc5d01fc971a3448e817f083e05c1a982a02ab00048fc`, source `_install-common.psm1=324bca98ad19f0487d4afd36a9e2d06478fcfb8e1e20225cdd8ec8ef5150e720`, and `uninstall.ps1=191c86cbae38b449f6ce69e833d3945691308776e7be70052866469dd52576a6`.

Change the stage script so `_install-rust.sh` is fetched from the release, not the tag source: the release helper bakes `0.22.2`, while the tag-source helper still bakes `0.22.1`. Keep `_install-common` on the source commit. Preserve both platform `release_eligible:false` flags. The platform archive SHA remains promotion evidence; setup's executable trust comes from verified installer siblings plus post-install code-signature and doctor checks, so documentation must not claim setup itself downloads the archive and compares the lock SHA. Set:

```ts
export const PRODUCT_VERSION = "0.2.0" as const;
export const PROTOCOL_VERSION = "1.1.0" as const;
```

Record the pinned tag, commit, npm package, exact adopted files, MIT license, and “dependency/raw tool adapter” adoption mode in `docs/upstream-sources.md`.

- [ ] **Step 4: Run staging, type, and lock tests**

Run: `cd product && pnpm typecheck && pnpm vitest run tests/contract/engine-lock.test.ts tests/contract/engine-stage.test.ts tests/unit/cua-connection.test.ts`

Expected: PASS, including rejection when any new required tool is absent.

- [ ] **Step 5: Commit**

```bash
git add product/package.json product/pnpm-lock.yaml product/engine.lock.json product/src/version.ts product/scripts/select-engine-release.mjs product/tests/contract/engine-lock.test.ts product/tests/contract/engine-stage.test.ts product/tests/unit/cua-connection.test.ts docs/upstream-sources.md
git commit -m "build: stage cua driver 0.22.2"
```

### Task 2: Freeze protocol 1.1 input/output unions

**Files:**
- Modify: `product/src/protocol.ts`
- Modify: `product/src/errors.ts`
- Modify: `product/tests/unit/protocol.test.ts`
- Modify: `product/tests/contract/protocol-snapshot.test.ts`
- Modify: `product/tests/contract/mcp-server.test.ts`

**Interfaces:**
- Consumes: protocol 1.1.0 and the exact action/capability tables in the approved spec.
- Produces: `ObserveInput`, `ActInput`, `ObservationOutput`, `ActOutput`, `McpErrorOutput`, `PUBLIC_TOOL_SCHEMAS`.

- [ ] **Step 1: Add failing public-schema tests one vertical case at a time**

```ts
expect(ObserveInputSchema.parse({
  target: { kind: "desktop" },
  discover: { apps: true, windows: true, query: "Calculator" },
})).toMatchObject({ discover: { apps: true, windows: true } });

expect(ObserveInputSchema.parse({
  target: { kind: "window", window_ref: "win_abcdefghijklmnop" },
  include_screenshot: false,
  elements: { max_elements: 100, max_depth: 10 },
}).target.kind).toBe("window");

expect(ActInputSchema.parse({
  snapshot_id: "snap_abcdefgh",
  action: { type: "set_value", element_ref: "el_abcdefghijklmnop", value: "hello" },
  expect: { element: { element_ref: "el_abcdefghijklmnop", value_equals: "hello" } },
}).action.type).toBe("set_value");
```

Also assert strict rejection of `actions:[]`, unknown fields, desktop delivery, desktop expect, mixed element/coordinate addressing, window `move`, `launch_app` expect, oversized query/text/menu/key arrays, and invalid ref formats.

- [ ] **Step 2: Verify red**

Run: `cd product && pnpm vitest run tests/unit/protocol.test.ts tests/contract/protocol-snapshot.test.ts tests/contract/mcp-server.test.ts`

Expected: FAIL on the first new observe/action shape.

- [ ] **Step 3: Implement strict Zod discriminated unions**

Keep the current desktop action objects byte-compatible and add exact window variants. Export these stable primitives:

```ts
export const AppRefSchema = z.string().regex(/^app_[A-Za-z0-9_-]{16,}$/);
export const WindowRefSchema = z.string().regex(/^win_[A-Za-z0-9_-]{16,}$/);
export const ElementRefSchema = z.string().regex(/^el_[A-Za-z0-9_-]{16,}$/);
export const DeliverySchema = z.enum(["background", "foreground"]);
export const VerificationStatusSchema = z.enum([
  "not_requested", "satisfied", "unsatisfied", "unknown",
]);
```

Define `ActOutputSchema` as a `next_state:"available" | "unavailable"` discriminated union. Require `action_result.evidence` on every successful output, reject contradictory status/effect combinations with `superRefine`, and keep `dom`/`trusted_input` in the route enum for v0.1 compatibility.

- [ ] **Step 4: Make the schema and snapshot contracts green**

Run: `cd product && pnpm vitest run tests/unit/protocol.test.ts tests/contract/protocol-snapshot.test.ts tests/contract/mcp-server.test.ts`

Expected: PASS with exactly two public tools.

- [ ] **Step 5: Commit**

```bash
git add product/src/protocol.ts product/src/errors.ts product/tests/unit/protocol.test.ts product/tests/contract/protocol-snapshot.test.ts product/tests/contract/mcp-server.test.ts
git commit -m "feat: define computer use protocol 1.1"
```

### Task 3: Freeze hard deadlines and snapshot-consumption error phases

**Files:**
- Modify: `product/src/errors.ts`
- Modify: `product/src/core/observe.ts`
- Modify: `product/src/core/runtime.ts`
- Modify: `product/src/mcp/handlers.ts`
- Modify: `product/tests/unit/act.test.ts`
- Modify: `product/tests/contract/mcp-server.test.ts`

**Interfaces:**
- Consumes: protocol 1.1 available/unavailable action outputs from Task 2.
- Produces: hard deadlines even when the SDK ignores abort, stable MCP errors with optional `snapshot_consumed:true`, and preservation of action results when only the next observation fails.

- [ ] **Step 1: Write the failing public consumption matrix**

Through the runtime and MCP handler seam, prove these four literals independently:

```ts
expect(outOfBounds.isError).toBe(true);
expect(outOfBounds.structuredContent).not.toHaveProperty("snapshot_consumed");
expect((await handleAct(runtime, validActionOnSameSnapshot)).isError).not.toBe(true);

expect(timeout.isError).toBe(true);
expect(timeout.structuredContent).toMatchObject({
  code: "action_timeout",
  snapshot_consumed: true,
});
expect((await handleAct(runtime, sameTimedOutSnapshot)).structuredContent).toMatchObject({ code: "stale_snapshot" });

expect(targetLost.isError).not.toBe(true);
expect(targetLost.structuredContent).toMatchObject({
  next_state: "unavailable",
  action_result: { status: "executed" },
  next_observation_error: { code: "target_lost" },
});
expect(targetLost.content.every((item) => item.type !== "image")).toBe(true);
```

Also make the fake SDK ignore AbortSignal and assert the timeout promise still settles within a controlled fake-clock boundary.

- [ ] **Step 2: Verify red**

Run: `cd product && pnpm vitest run tests/unit/act.test.ts tests/contract/mcp-server.test.ts`

Expected: FAIL because action timeout is currently converted to `failedExecution`, re-observation errors throw away `action_result`, and timeout waits forever when an SDK ignores abort.

- [ ] **Step 3: Implement the phase boundary**

Implement `withTimeout` using an abort plus a rejecting timer race; attach a rejection handler to the underlying operation so a late SDK rejection cannot become unhandled. Validate all policy before `SnapshotStore.consume`. After consumption, let `action_timeout`, `engine_contract_changed`, and `engine_unhealthy` escape as a `ComputerUseError` carrying `snapshotConsumed:true`; map next-observation loss to the normal unavailable output union. Extend error MCP serialization only when that boolean is true.

- [ ] **Step 4: Verify green**

Run: `cd product && pnpm typecheck && pnpm vitest run tests/unit/act.test.ts tests/contract/mcp-server.test.ts`

Expected: PASS with no mutation replay.

- [ ] **Step 5: Commit**

```bash
git add product/src/errors.ts product/src/core/observe.ts product/src/core/runtime.ts product/src/mcp/handlers.ts product/tests/unit/act.test.ts product/tests/contract/mcp-server.test.ts
git commit -m "fix: preserve snapshot consumption semantics"
```

### Task 4: Add opaque target registry and snapshot-scoped elements

**Files:**
- Create: `product/src/target-registry.ts`
- Create: `product/tests/unit/target-registry.test.ts`
- Modify: `product/src/snapshot-store.ts`
- Modify: `product/tests/unit/snapshot-store.test.ts`

**Interfaces:**
- Consumes: opaque native targets from EnginePort.
- Produces: `TargetRegistry.registerApps/registerWindows/resolveApp/resolveWindow/invalidateWindow/clear` and expanded `SnapshotStore.create/requireCurrent/consume/clear`.

- [ ] **Step 1: Write failing behavior tests**

```ts
const registry = new TargetRegistry({ token: () => "abcdefghijklmnop" });
const [app] = registry.registerApps([{ nativeKey: "bundle:a", displayName: "Calculator", running: true }]);
expect(app.appRef).toMatch(/^app_/);
expect(registry.resolveApp(app.appRef).nativeKey).toBe("bundle:a");

const snapshot = store.create({
  sessionId: "session",
  target: { kind: "window", windowRef: "win_abcdefghijklmnop" },
  visual: { status: "available", width: 460, height: 816 },
  elements: [{ elementRef: "el_abcdefghijklmnop", token: "private-token", identity: identity("button", "7") }],
  observeOptions: { includeScreenshot: true, maxElements: 150, maxDepth: 12 },
});
expect(store.resolveElement(snapshot.id, "el_abcdefghijklmnop").token).toBe("private-token");
store.consume(snapshot.id);
expect(() => store.resolveElement(snapshot.id, "el_abcdefghijklmnop")).toThrowError(/stale_snapshot/);
```

Cover deterministic reuse for the same native target, app/window caps, no live-ref eviction, 30-minute idle expiry, owner change invalidation, transport clear, and element refs expiring with the snapshot.

- [ ] **Step 2: Verify red**

Run: `cd product && pnpm vitest run tests/unit/target-registry.test.ts tests/unit/snapshot-store.test.ts`

Expected: FAIL because `TargetRegistry` and the expanded snapshot record do not exist.

- [ ] **Step 3: Implement the registries**

Use `randomBytes(18).toString("base64url")` and prefix refs with `app_`, `win_`, `el_`. Keep native identifiers only inside frozen records. `ElementIdentity` contains normalized role, normalized label, and a frozen parent role/label chain; it never contains value, state, bounds, or array position.

- [ ] **Step 4: Verify green**

Run: `cd product && pnpm vitest run tests/unit/target-registry.test.ts tests/unit/snapshot-store.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add product/src/target-registry.ts product/src/snapshot-store.ts product/tests/unit/target-registry.test.ts product/tests/unit/snapshot-store.test.ts
git commit -m "feat: add opaque targets and scoped elements"
```

### Task 5: Expand EnginePort and parse Cua discovery/window state

**Files:**
- Create: `product/src/engine/cua-json.ts`
- Create: `product/tests/unit/cua-json.test.ts`
- Modify: `product/src/engine/port.ts`
- Modify: `product/src/engine/cua.ts`
- Modify: `product/tests/helpers/fake-cua-sdk.ts`
- Modify: `product/tests/helpers/fake-engine.ts`
- Modify: `product/tests/unit/cua-connection.test.ts`

**Interfaces:**
- Consumes: Cua raw tools through `CuaSdkLike.callTool(name, argumentsJson, {signal})`.
- Produces:

```ts
interface EnginePort {
  discover(input: EngineDiscoverInput, signal: AbortSignal): Promise<EngineDiscovery>;
  observe(input: EngineObserveInput, signal: AbortSignal): Promise<EngineObservation>;
  execute(input: EngineAction, signal: AbortSignal): Promise<EngineExecution>;
  verify(input: EngineVerification, signal: AbortSignal): Promise<EngineVerificationResult>;
  health(signal: AbortSignal): Promise<boolean>;
  close(): Promise<void>;
}
```

- [ ] **Step 1: Write parser/port boundary tests from fixed literals**

Use literal fixtures shaped like Cua 0.22.2 `list_apps`, `list_windows`, and `get_window_state` output. Assert that one window observation keeps internal PID/window ID/element token, returns `visualStatus:"available"`, exactly one PNG, bounded elements, parent indices, and truncation. Assert malformed JSON, owner mismatch, multiple images, incoherent dimensions, and unknown platform fail closed.

```ts
const value = parseWindowState(toolResult({
  structuredJson: JSON.stringify({
    platform: "macos",
    pid: 42,
    window_id: 7,
    snapshot_id: "cua-private",
    screenshot_width: 460,
    screenshot_height: 816,
    elements: [{ element_index: 3, element_token: "private", role: "button", label: "7", depth: 2 }],
    truncated: false,
  }),
  images: [{ mimeType: "image/png", dataBase64: "cG5n" }],
}));
expect(value.elements[0]?.token).toBe("private");
```

- [ ] **Step 2: Verify red**

Run: `cd product && pnpm vitest run tests/unit/cua-json.test.ts tests/unit/cua-connection.test.ts`

Expected: FAIL because the parsers and expanded EnginePort are absent.

- [ ] **Step 3: Implement the raw-tool adapter**

Keep `CuaSdkLike` as the external mock seam. `discover` calls `list_apps` and/or `list_windows`; `observe` calls `get_desktop_state` or `get_window_state`; `health` calls `health_report`. Parse JSON with strict local Zod schemas, enforce image count and pixel metadata, and map `px_capture_unavailable`/`px_frame_mismatch` to visual degradation rather than inventing coordinates.

- [ ] **Step 4: Verify green and type safety**

Run: `cd product && pnpm typecheck && pnpm vitest run tests/unit/cua-json.test.ts tests/unit/cua-connection.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add product/src/engine/cua-json.ts product/src/engine/port.ts product/src/engine/cua.ts product/tests/unit/cua-json.test.ts product/tests/helpers/fake-cua-sdk.ts product/tests/helpers/fake-engine.ts product/tests/unit/cua-connection.test.ts
git commit -m "feat: adapt cua window observations"
```

### Task 6: Deliver desktop discovery and precise window observation

**Files:**
- Modify: `product/src/core/observe.ts`
- Modify: `product/src/core/runtime.ts`
- Modify: `product/src/mcp/handlers.ts`
- Modify: `product/tests/unit/observe.test.ts`
- Create: `product/tests/unit/window-runtime.test.ts`
- Modify: `product/tests/contract/mcp-server.test.ts`

**Interfaces:**
- Consumes: `TargetRegistry`, expanded `SnapshotStore`, EnginePort discovery/observation.
- Produces: public desktop discovery and window observation envelopes, with zero or one MCP ImageContent block according to `visual_status`.

- [ ] **Step 1: Write the failing runtime tracer bullet**

```ts
const desktop = await runtime.observe({
  target: { kind: "desktop" },
  discover: { apps: true, windows: true, query: "Calculator" },
});
const windowRef = desktop.structured.windows?.[0]?.window_ref;
const window = await runtime.observe({
  target: { kind: "window", window_ref: windowRef! },
  include_screenshot: true,
  elements: { max_elements: 100, max_depth: 10 },
});
expect(window.structured.target.kind).toBe("window");
expect(window.structured.elements?.[0]).toMatchObject({ role: "button", label: "7" });
expect(JSON.stringify(window.structured)).not.toContain("private-token");
```

Add a second test for `visual_status:"capture_unavailable"`: it returns semantic elements, no screenshot metadata, no image block, no untrusted bounds, and still creates an element-actionable snapshot.

- [ ] **Step 2: Verify red**

Run: `cd product && pnpm vitest run tests/unit/observe.test.ts tests/unit/window-runtime.test.ts tests/contract/mcp-server.test.ts`

Expected: FAIL because runtime observation accepts no input and handlers always require an image.

- [ ] **Step 3: Implement observation projection**

Filter and sort apps/windows independently of upstream array order; apply caps and truncation flags; mint refs; project only allowlisted element fields/actions. Update MCP success handling to append ImageContent only when the envelope has an image:

```ts
const content: CallToolResult["content"] = [
  { type: "text", text: JSON.stringify(value.structured) },
  ...(value.image === undefined ? [] : [{ type: "image" as const, mimeType: value.image.mimeType, data: value.image.dataBase64 }]),
];
```

- [ ] **Step 4: Verify green**

Run: `cd product && pnpm typecheck && pnpm vitest run tests/unit/observe.test.ts tests/unit/window-runtime.test.ts tests/contract/mcp-server.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add product/src/core/observe.ts product/src/core/runtime.ts product/src/mcp/handlers.ts product/tests/unit/observe.test.ts product/tests/unit/window-runtime.test.ts product/tests/contract/mcp-server.test.ts
git commit -m "feat: observe apps and precise windows"
```

### Task 7: Map element-first and window-pixel actions

**Files:**
- Modify: `product/src/engine/action-mapper.ts`
- Modify: `product/src/engine/result-mapper.ts`
- Modify: `product/src/engine/port.ts`
- Modify: `product/src/engine/cua.ts`
- Modify: `product/tests/unit/action-mapper.test.ts`
- Modify: `product/tests/unit/result-mapper.test.ts`
- Modify: `product/tests/unit/cua-connection.test.ts`

**Interfaces:**
- Consumes: a consumed internal snapshot and resolved element target.
- Produces: one `EngineAction` mapped to exactly one Cua raw action call and a normalized `EngineExecution` with required evidence array.

- [ ] **Step 1: Add one failing action case at a time**

```ts
expect(mapAction({
  target: windowTarget,
  action: { type: "click", address: { kind: "element", token: "private" } },
  delivery: "background",
  sessionId: "session",
})).toEqual({
  tool: "click",
  args: { session: "session", element_token: "private", delivery_mode: "background" },
});
```

Then cover window pixel click/drag/scroll, element set_value/type_text/keypress, addressless target-process input, invoke_menu, desktop compatibility, and foreground passthrough. Assert exactly one tool call and no `bring_to_front` call.

- [ ] **Step 2: Verify red**

Run: `cd product && pnpm vitest run tests/unit/action-mapper.test.ts tests/unit/result-mapper.test.ts tests/unit/cua-connection.test.ts`

Expected: FAIL on element targeting.

- [ ] **Step 3: Implement action mapping and safe result normalization**

Require `evidence:[]` on every mapped result. Unknown status triggers `engine_contract_changed`; unknown effect becomes unverifiable; unknown route/delivery becomes unknown; unknown evidence is dropped. Enforce refused/failed combinations and allow only stable public error/escalation codes.

- [ ] **Step 4: Verify green**

Run: `cd product && pnpm typecheck && pnpm vitest run tests/unit/action-mapper.test.ts tests/unit/result-mapper.test.ts tests/unit/cua-connection.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add product/src/engine/action-mapper.ts product/src/engine/result-mapper.ts product/src/engine/port.ts product/src/engine/cua.ts product/tests/unit/action-mapper.test.ts product/tests/unit/result-mapper.test.ts product/tests/unit/cua-connection.test.ts
git commit -m "feat: execute precise window actions"
```

### Task 8: Add bounded verification and duplicate-input protection

**Files:**
- Create: `product/src/core/verifier.ts`
- Create: `product/tests/unit/verifier.test.ts`
- Modify: `product/src/core/act.ts`
- Modify: `product/src/core/runtime.ts`
- Modify: `product/tests/unit/act.test.ts`
- Modify: `product/tests/unit/window-runtime.test.ts`

**Interfaces:**
- Consumes: pre-action `ElementIdentity`, explicit `expect`, post-action EngineObservation, and EnginePort verification/state reads.
- Produces: `VerificationResult`, truthfully normalized action effect, one fresh public snapshot, and no mutation retry.

- [ ] **Step 1: Write failing verification tests**

```ts
expect(matchIdentity(
  { role: "textbox", label: "Name", parents: [{ role: "group", label: "Profile" }] },
  [{ role: "textbox", label: "Name", value: "new", parents: [{ role: "group", label: "Profile" }] }],
)).toMatchObject({ kind: "unique", index: 0 });
```

Test zero/multiple matches as unknown; value excluded from identity; `set_value` auto readback; pre-satisfied predicate cannot alone upgrade effect; false-to-true predicate can confirm; unknown/unsatisfied never confirms; input that returns unverifiable is executed once only; wait sequence is immediate then 50/100/200/400/500 ms capped and cancellable.

- [ ] **Step 2: Verify red**

Run: `cd product && pnpm vitest run tests/unit/verifier.test.ts tests/unit/act.test.ts tests/unit/window-runtime.test.ts`

Expected: FAIL because Verifier and expect orchestration do not exist.

- [ ] **Step 3: Implement the verifier and action lifecycle**

Validate and resolve before consumption; consume immediately before EnginePort mutation; execute once; verify only the allowed predicate; reobserve the same target; return one public next snapshot. A structured refusal/failure still reobserves. Engine timeout/contract failure clears the store and returns an MCP error with `snapshot_consumed:true`. Never call `execute` twice inside one `act`.

- [ ] **Step 4: Verify green**

Run: `cd product && pnpm typecheck && pnpm vitest run tests/unit/verifier.test.ts tests/unit/act.test.ts tests/unit/window-runtime.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add product/src/core/verifier.ts product/src/core/act.ts product/src/core/runtime.ts product/tests/unit/verifier.test.ts product/tests/unit/act.test.ts product/tests/unit/window-runtime.test.ts
git commit -m "feat: verify actions without blind retries"
```

### Task 9: Implement safe app launch and engine health recovery

**Files:**
- Modify: `product/src/core/runtime.ts`
- Modify: `product/src/engine/cua.ts`
- Modify: `product/src/errors.ts`
- Modify: `product/src/mcp/handlers.ts`
- Modify: `product/tests/unit/window-runtime.test.ts`
- Modify: `product/tests/unit/cua-connection.test.ts`
- Modify: `product/tests/contract/mcp-server.test.ts`

**Interfaces:**
- Consumes: desktop snapshot plus opaque `app_ref`.
- Produces: unique-window migration, bounded zero/multiple-window outcomes, and fail-closed unhealthy recovery.

- [ ] **Step 1: Write failing launch/recovery tests**

```ts
const launched = await runtime.act({
  snapshot_id: desktopId,
  action: { type: "launch_app", app_ref: calculatorRef },
});
expect(launched.structured.next_state).toBe("available");
expect(launched.structured.target.kind).toBe("window");
expect(launched.structured.action_result).toMatchObject({
  status: "executed",
  effect: "confirmed",
  evidence: expect.arrayContaining(["window_ready"]),
});
```

Cover zero windows (`partial/window_not_ready` with fresh desktop), multiple equal candidates (`partial/window_target_ambiguous` without choosing first), request-accepted without process proof (`unverifiable`), owner change, target lost, post-consumption timeout with `snapshot_consumed:true`, unhealthy refusal, and recovery only after `health_report` passes.

- [ ] **Step 2: Verify red**

Run: `cd product && pnpm vitest run tests/unit/window-runtime.test.ts tests/unit/cua-connection.test.ts tests/contract/mcp-server.test.ts`

Expected: FAIL on launch migration and unhealthy state.

- [ ] **Step 3: Implement launch and health state machine**

Resolve the app ref internally, call Cua once, immediately inspect process/window state, and conditionally poll for at most five seconds without a fixed initial sleep. Do not expose native identifiers. Once unhealthy, reject action calls with `engine_unhealthy` until `health_report` returns a trusted healthy classification; the health check never repeats the mutation.

- [ ] **Step 4: Verify green**

Run: `cd product && pnpm typecheck && pnpm vitest run tests/unit/window-runtime.test.ts tests/unit/cua-connection.test.ts tests/contract/mcp-server.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add product/src/core/runtime.ts product/src/engine/cua.ts product/src/errors.ts product/src/mcp/handlers.ts product/tests/unit/window-runtime.test.ts product/tests/unit/cua-connection.test.ts product/tests/contract/mcp-server.test.ts
git commit -m "feat: launch apps and recover engine health"
```

### Task 10: Update the agent policy, docs, evidence gates, and full regression

**Files:**
- Modify: `product/skills/computer-use/SKILL.md`
- Modify: `product/README.md`
- Modify: `docs/troubleshooting.md`
- Modify: `docs/host-compatibility.md`
- Modify: `product/tests/contract/skill-policy.test.ts`
- Modify: `product/tests/e2e/macos/retina.spec.ts`
- Modify: `product/tests/e2e/windows/dpi.spec.ts`
- Create: `product/tests/e2e/shared/window-precision-harness.spec.ts`
- Modify: `product/tests/e2e/macos/README.md`
- Modify: `product/tests/e2e/windows/README.md`

**Interfaces:**
- Consumes: complete protocol 1.1 runtime.
- Produces: correct host loop instructions, documented limitations, and non-promotable development evidence lanes.

- [ ] **Step 1: Write failing policy/evidence assertions**

```ts
expect(skill).toContain("discover apps and windows before guessing coordinates");
expect(skill).toContain("prefer element_ref");
expect(skill).toContain("do not repeat unverifiable text input");
expect(skill).not.toContain("sleep 3");
expect(skill).not.toContain("bring_to_front");
```

Add fixture assertions for foreground sentinel preservation, window pixel area at most 50% of desktop for the fixed Calculator fixture, Retina/100/125/150 percent coordinate evidence, target loss, and `visual_status` pixel refusal.

- [ ] **Step 2: Verify red**

Run: `cd product && pnpm vitest run tests/contract/skill-policy.test.ts tests/e2e/macos/retina.spec.ts tests/e2e/windows/dpi.spec.ts`

Expected: FAIL because v0.1 policy/evidence files do not describe window precision.

- [ ] **Step 3: Update policy and evidence documentation**

Teach the host: desktop discover → select exact window → prefer element ref → one action → inspect fresh state → stop or continue. Document background limitations, no blind text retry, visual degradation, permissions, Cua identity, and Windows experimental status. Keep real screenshots, text, prompts, paths, usernames, and native identifiers outside repository evidence.

- [ ] **Step 4: Run the complete non-destructive verification suite**

Run: `cd product && pnpm typecheck && pnpm test && pnpm pack --dry-run`

Expected: all unit/contract tests pass, package contains only the declared model-free surface, and both engine platforms remain non-release-eligible.

- [ ] **Step 5: Run development E2E where hardware is available**

Run on macOS: `cd product && CUA_E2E=1 ./tests/e2e/macos/run.sh`

Run independently on Windows x64 100/125/150 percent: `cd product; $env:CUA_E2E='1'; ./tests/e2e/windows/run.ps1`

Expected: development evidence only. A platform without real hardware evidence remains Experimental and does not block truthful completion of the implementation.

- [ ] **Step 6: Commit**

```bash
git add product/skills/computer-use/SKILL.md product/README.md docs/troubleshooting.md docs/host-compatibility.md product/tests/contract/skill-policy.test.ts product/tests/e2e
git commit -m "docs: teach window precise computer use"
```

## Self-review result

- Spec coverage: sections 1–10 map to Tasks 1–9; TDD seams, acceptance, host compatibility, and release gates map to Task 10.
- Placeholder scan: no TBD/TODO/“similar to” implementation placeholders remain.
- Type consistency: protocol refs are public strings; native targets/tokens exist only in TargetRegistry/SnapshotStore/EnginePort; every action receives one consumed snapshot and produces one next-state union.
- Scope control: Browser/CDP, multi-display, batching, rich paste, native Runtime ownership, and installer replacement have no implementation task.
- Execution choice: the user already selected Subagent-Driven. The named superpowers sub-skill is not installed in this environment, so collaboration subagents perform bounded read-only research/review while the primary agent executes each TDD slice and reviews every commit.
