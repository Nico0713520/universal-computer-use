# Universal Computer Use v0.2.7 Adaptive Cursor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v0.2.6 always-hidden Cua Cursor bootstrap with a Mac-first `auto | visible | hidden` adaptive presentation layer that stays quiet in background work and gives fast, simple feedback for foreground pointer actions.

**Architecture:** Parse one process-scoped Cursor mode, calculate visibility with a pure action policy, and apply only necessary Cua session transitions through a verified controller. Keep the public MCP protocol unchanged; observations always hide the overlay before capture.

**Tech Stack:** TypeScript 5.7, Node.js 22, Vitest, Zod, MCP SDK 1.30, locked `@trycua/cua-driver` 0.22.2.

## Global Constraints

- Product target is `0.2.7`; protocol stays `1.2.0`; Cua stays `0.22.2` at `d114f35fec05ecd37bf529e5587be86852205b64`.
- Public MCP surface remains exactly `computer_observe` and `computer_act`.
- Default Cursor mode is `auto`; valid values are `auto`, `visible`, and `hidden`.
- Motion starts at 80 ms glide, 40 ms click dwell, 700 ms idle hide, `cua.default`, reduced motion `auto`.
- No general post-action sleep, action replay, new model, GUI, Cua fork, or multi-Agent coordination.
- Real GUI acceptance requires explicit `--exclusive-desktop` and a user-confirmed idle desktop.

---

### Task 1: Cursor mode and public configuration

**Files:**
- Create: `product/src/engine/cursor-mode.ts`
- Modify: `product/src/cli/config.ts`
- Modify: `product/src/cli/main.ts`
- Modify: `product/src/mcp/main.ts`
- Test: `product/tests/unit/cursor-mode.test.ts`
- Test: `product/tests/unit/cli-config.test.ts`
- Test: `product/tests/unit/cli-config-command.test.ts`

**Interfaces:**
- Produces: `CursorMode`, `parseCursorMode(value)`, `resolveCursorMode(argv, environment)`.
- Produces: `renderConfig(client, nodePath, mcpPath, cursorMode = "auto")`.
- Consumes later: `CuaEngine.connect(lock, { cursorMode })`.

- [ ] Write a failing table test for valid modes, default `auto`, CLI precedence, and invalid/duplicate/missing `--cursor` values.
- [ ] Run `pnpm exec vitest run tests/unit/cursor-mode.test.ts tests/unit/cli-config.test.ts tests/unit/cli-config-command.test.ts` and confirm red failures.
- [ ] Implement strict parsing and extend `config`/`mcp` commands with `--cursor <mode>` while keeping errors free of user paths and environment content.
- [ ] Make every generated host command/config pass `--cursor <mode>` after the MCP script path.
- [ ] Re-run the focused tests and commit `feat: add adaptive cursor configuration`.

### Task 2: Pure Cursor policy

**Files:**
- Create: `product/src/engine/cursor-policy.ts`
- Test: `product/tests/unit/cursor-policy.test.ts`

**Interfaces:**
- Consumes: `CursorMode`, `EngineAction`.
- Produces: `desiredCursorVisibility(mode, action): "show" | "hide"`.

- [ ] Write failing literal matrix tests for desktop pointer actions, background/foreground window pointer actions, non-pointer actions, and all three modes.
- [ ] Run `pnpm exec vitest run tests/unit/cursor-policy.test.ts` and confirm the missing module/function failure.
- [ ] Implement only the tested action classification; treat omitted window delivery as background.
- [ ] Re-run the focused test and commit `feat: define adaptive cursor policy`.

### Task 3: Verified Cua Cursor controller

**Files:**
- Modify: `product/src/engine/agent-cursor.ts`
- Modify: `product/tests/helpers/fake-cua-sdk.ts`
- Modify: `product/tests/unit/agent-cursor.test.ts`
- Modify: `product/engine.lock.json`
- Modify: `product/tests/contract/engine-lock.test.ts`

**Interfaces:**
- Produces: `AgentCursorController.initialize(sdk, sessions, mode)`.
- Produces: `controller.prepare(session, "show" | "hide", signal?)` and verified per-session cache.
- Requires: `set_agent_cursor_enabled`, `set_agent_cursor_motion`, `set_agent_cursor_theme`, `get_agent_cursor_state`.

- [ ] Replace the old always-disabled test with a failing initialization test asserting theme, motion, disabled state and full readback for both sessions.
- [ ] Add one failing test each for cached no-op transitions, foreground enable degradation, required hide failure, malformed state, and duplicate/blank sessions.
- [ ] Run the focused test and confirm red failures before implementation.
- [ ] Implement Zod parsing, staged parallel initialization, verified cache and transition failure semantics.
- [ ] Extend the fake SDK at the Cua boundary to return real locked-contract shapes for theme, motion and state.
- [ ] Add the two missing required tools to the lock and make the contract test green.
- [ ] Run focused tests and commit `feat: control verified cua cursor sessions`.

### Task 4: Integrate policy into CuaEngine

**Files:**
- Modify: `product/src/engine/cua.ts`
- Modify: `product/src/mcp/main.ts`
- Modify: `product/src/cli/main.ts`
- Modify: `product/tests/unit/cua-connection.test.ts`
- Modify: relevant execution tests under `product/tests/unit/window-runtime.test.ts`

**Interfaces:**
- Consumes: parsed `CursorMode`, `desiredCursorVisibility`, `AgentCursorController`.
- Preserves: `EnginePort` and all public MCP request/response types.

- [ ] Write a failing engine-boundary test proving `auto` shows a desktop click, hides a background window click, shows a foreground window click, and hides before both observation scopes.
- [ ] Add failing tests proving an enable failure still dispatches once while a required hide failure dispatches zero actions and returns a stable error.
- [ ] Run focused tests and confirm red failures.
- [ ] Add the controller to `CuaEngine`; generate short unique public session labels; apply policy before dispatch and hide before observations.
- [ ] Thread mode parsing through direct MCP and `computer-use mcp` startup without changing the two-tool surface.
- [ ] Re-run connection/runtime tests and commit `feat: apply cursor policy to cua actions`.

### Task 5: Diagnostics, versions and user documentation

**Files:**
- Modify: `product/src/cli/doctor.ts`
- Modify: `product/src/cli/doctor-output.ts`
- Modify: `product/tests/unit/cli-doctor.test.ts`
- Modify: `product/tests/unit/doctor-output.test.ts`
- Modify: `product/package.json`
- Modify: `product/src/version.ts`
- Modify: `README.md`
- Modify: `product/README.md`
- Modify: `docs/installation/macos.md`
- Modify: `docs/troubleshooting.md`
- Modify: `docs/host-compatibility.md`
- Modify: current v0.2.7 evidence schemas and fixtures only where product constants require it.

**Interfaces:**
- Produces: human-readable Adaptive Cursor mode/readiness and JSON `cursor_mode`, `cursor_ready`.
- Preserves: protocol `1.2.0`, Developer Preview and release-ineligible claims.

- [ ] Write failing doctor/config/doc contract assertions for `auto`, Adaptive Cursor wording and version `0.2.7`.
- [ ] Run the focused tests and confirm red failures.
- [ ] Add non-sensitive doctor fields, update human copy, bump current product manifests/schemas and remove current claims that Cursor is always disabled.
- [ ] Keep historical specifications and old evidence immutable unless they are executable current-version fixtures.
- [ ] Run focused tests and commit `chore: prepare adaptive cursor preview v0.2.7`.

### Task 6: Deterministic regression and package verification

**Files:**
- Modify only files identified by failing tests.

**Interfaces:**
- Verifies: public two-tool contract, snapshot consumption, action verification, Cua lock, package contents and no fixed sleep.

- [ ] Run `pnpm test` from `product`.
- [ ] Run `pnpm typecheck` and `pnpm build`.
- [ ] Run `pnpm pack --dry-run --json` and verify no Cua binary, screenshots, credentials or generated evidence enters the package.
- [ ] Search production code for fixed post-action waits and confirm only the explicit user `wait` action remains.
- [ ] Fix one failing behavior at a time with a red-green cycle; do not loosen assertions or timing gates.
- [ ] Commit `test: verify adaptive cursor regressions` only if test-driven fixes were required.

### Task 7: Mac non-invasive and exclusive-desktop acceptance

**Files:**
- Modify: `product/tests/e2e/development/macos-cursor-ab.spec.ts` only if the existing seam cannot represent `auto`.
- Modify: Cursor evidence schema/recorder only for aggregate mode/timing fields.

**Interfaces:**
- Produces: privacy-safe aggregate evidence for hidden/auto/visible behavior.

- [ ] Run doctor and source-only checks that do not move input or activate apps.
- [ ] Stop before GUI acceptance unless the user explicitly confirms the desktop is idle.
- [ ] With confirmation, run the pixel-only owned fixture for hidden/auto timing and visual presence, then the focused background and foreground profiles.
- [ ] Require 30/30 exactly-once, background focus preservation, clean post-action screenshots and the latency budgets from the spec.
- [ ] Do not restart Cua, replay actions, collect user content or broaden release eligibility.
- [ ] Record the exact commit and report any blocked real-machine evidence honestly.

## Self-Review

- Every approved mode, policy row, startup/readback rule, failure rule, speed parameter and test gate maps to a task.
- No new MCP tool, model, GUI, Cua fork, multi-Agent lock or Windows promotion is introduced.
- All new tests use the agreed config, engine and MCP/runtime seams; Cua itself is mocked only at the external SDK boundary.
- No placeholder, `TODO`, unspecified handler or invented host syntax remains.
