# Universal Computer Use v0.2.6 Mac Agent Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current v0.2.5 macOS implementation into a trustworthy v0.2.6 Developer Preview that Codex, HanaAgent, and WorkBuddy can connect to directly and test against the same public Git commit.

**Architecture:** Preserve the existing two-tool MCP facade and Cua 0.22.2 execution engine. This release improves the CLI/onboarding, host configuration, evidence contracts, and host-test handoff; it does not change the core MCP protocol or add a model. Real desktop testing remains an explicit user-gated phase after deterministic tests pass.

**Tech Stack:** TypeScript, Node.js, Vitest, Zod, AJV, Model Context Protocol, Cua Driver 0.22.2, pnpm.

## Frozen boundaries

- Product target: `0.2.6`; protocol remains `1.2.0`; Cua remains `0.22.2` at commit `d114f35fec05ecd37bf529e5587be86852205b64`.
- Keep exactly two public MCP tools: `computer_observe` and `computer_act`.
- Do not add an internal vision model, a third tool, a desktop GUI, a native execution fork, or a fixed sleep.
- Do not replay an action, restart Cua during an active session, or claim an effect that was not verified by a fresh observation.
- Do not implement multi-Agent concurrency, desktop locking, session arbitration, or simultaneous-host conflict handling in this release. Host tests run serially.
- Do not run real GUI acceptance without the user's explicit confirmation that the desktop is idle. Real evidence remains external and privacy-scrubbed.
- Keep release eligibility false. This milestone is a Mac Agent Preview, not a signed public Beta.
- Use test-driven development for every production change and commit after each coherent task.

## File map

### New files

- `product/src/cli/macos-permissions.ts`
- `product/src/cli/doctor-output.ts`
- `product/tests/unit/macos-permissions.test.ts`
- `product/tests/unit/doctor-output.test.ts`
- `product/integrations/hanaagent/README.md`
- `product/integrations/workbuddy/README.md`
- `product/scripts/render-host-test-prompt.mjs`
- `product/tests/contracts/host-test-prompt.test.ts`

### Modified files

- `product/src/cli/doctor.ts`
- `product/src/cli/config.ts`
- `product/src/cli/main.ts`
- CLI/config/doctor unit and integration tests under `product/tests/`
- `product/tests/e2e/host-development-evidence.schema.json`
- `product/tests/e2e/host-development.evidence.json`
- `product/tests/e2e/host/codex.md`
- `product/tests/e2e/host/hanaagent.md`
- `product/tests/e2e/host/workbuddy.md`
- `product/tests/release/host-development-evidence.test.ts`
- `product/package.json`
- `product/src/version.ts`
- `product/integrations/workbuddy/.codebuddy-plugin/plugin.json`
- Current product documentation and compatibility tables that still describe v0.2.5 behavior.

## Task 1: Add signed macOS permission diagnostics and human-readable doctor output

**Files:**

- Create: `product/src/cli/macos-permissions.ts`
- Create: `product/src/cli/doctor-output.ts`
- Create: `product/tests/unit/macos-permissions.test.ts`
- Create: `product/tests/unit/doctor-output.test.ts`
- Modify: `product/src/cli/doctor.ts`
- Modify: `product/src/cli/main.ts`
- Modify: existing doctor/CLI tests under `product/tests/unit/` and `product/tests/integration/`

### Public internal interfaces

```ts
export type PermissionState = "granted" | "required" | "unknown";

export interface MacPermissionProbeResult {
  accessibility: PermissionState;
  screen_recording: PermissionState;
  source: "driver-daemon" | "unknown";
}

export interface DoctorPermissionReport {
  accessibility: PermissionState;
  screen_recording: PermissionState;
  source: "driver-daemon" | "observation" | "unknown";
}
```

The probe must execute the signed Cua application binary, not an imported Node permission helper:

```text
/Applications/CuaDriver.app/Contents/MacOS/cua-driver permissions status --json
```

- [ ] Write `macos-permissions.test.ts` first with a fake command runner. Assert the exact executable, arguments `permissions status --json`, and a 10,000 ms timeout.
- [ ] Add a passing fixture containing `accessibility: true`, `screen_recording: true`, `source.attribution: "driver-daemon"`, and `source.bundle_id: "com.trycua.driver"`.
- [ ] Add fixtures for one denied permission, malformed JSON, a non-zero exit, an unexpected attribution, and an unexpected bundle ID.
- [ ] Assert that malformed or untrusted results become `unknown`; never copy daemon PID, path, note, or arbitrary source fields into the returned report.
- [ ] Run the focused test and confirm it fails because the module does not exist.
- [ ] Implement `probeMacPermissions()` with a strict Zod boundary around the two booleans and signed-daemon identity. Permit unrelated input fields with `.passthrough()` but return only the normalized interface.
- [ ] Run the focused test until it passes.
- [ ] Extend the doctor tests before production edits. On macOS, test granted, denied, unknown, observation-permission failure, engine-unavailable, and non-macOS behavior.
- [ ] Change doctor flow so engine connection remains the first runtime proof. A trusted denied state returns `permission_required` before screenshot observation. An unknown probe may continue to one observation; only a recognized observation permission error may populate the report source as `observation`.
- [ ] Do not add another Cursor command to doctor: successful engine connection already proves both Cua sessions and their Cursor initialization completed.
- [ ] Write `doctor-output.test.ts` with complete report fixtures. Assert concise Chinese/plain-language output for pass and fail cases, including Runtime, Screen Recording, Accessibility, screenshot readiness, and session/Cursor initialization.
- [ ] Assert denied permissions include the exact System Settings path and identify `CuaDriver`; unknown states must say they could not be confirmed, not that they were granted.
- [ ] Preserve and test plain-language distinctions for CuaDriver missing, version/hash/signature mismatch, daemon recovery failure, locked/non-interactive desktop, desktop/window session failure, and Cursor disable/readback failure. Doctor must diagnose only; it must not click, type, or restart an already active MCP session.
- [ ] Implement `renderDoctorHuman(report)`. Keep `doctor --json` byte-for-byte machine-readable; make bare `doctor` human-readable.
- [ ] Update command help and CLI parsing tests for the split output behavior.
- [ ] Run focused tests, then the full product test suite, typecheck, and build.
- [ ] Commit:

```bash
git add product/src/cli product/tests
git commit -m "feat: explain mac computer use readiness"
```

## Task 2: Add named HanaAgent and WorkBuddy configuration paths

**Files:**

- Modify: `product/src/cli/config.ts`
- Modify: `product/src/cli/main.ts`
- Modify: config/CLI tests under `product/tests/`
- Create: `product/integrations/hanaagent/README.md`
- Create: `product/integrations/workbuddy/README.md`
- Modify: `product/integrations/workbuddy/.mcp.json`

- [ ] Extend config tests first so `ConfigClient` must accept `generic`, `codex`, `kimi`, `hanaagent`, and `workbuddy`.
- [ ] Assert `hanaagent` and `workbuddy` emit absolute stdio JSON using the built MCP entrypoint; they must not silently edit a user's host settings.
- [ ] Assert generated configs contain no model endpoint, API key, credential, native Cua binary, or duplicated loop prompt; they must reference the single Canonical Skill behavior.
- [ ] Keep Codex and Kimi command formats unchanged and keep generic JSON as the escape hatch.
- [ ] Assert stderr guidance names the selected host and says a host restart or new conversation is required before the two tools can appear.
- [ ] Add negative tests for unsupported client names, missing build output, relative executable paths, and JSON stdout polluted by logs.
- [ ] Implement the two named clients in `config.ts` and extend `main.ts` usage and parsing.
- [ ] Write HanaAgent and WorkBuddy integration READMEs with install/build, `setup`, `doctor`, named `config`, manual host registration, restart/new-session verification, and the canonical Skill path.
- [ ] Mark WorkBuddy integration experimental; do not advertise auto-install, an internal model, or verified compatibility.
- [ ] Run focused tests, full tests, typecheck, and build.
- [ ] Commit:

```bash
git add product/src/cli product/tests product/integrations
git commit -m "feat: configure mac agent preview hosts"
```

## Task 3: Replace self-declared host evidence with a strict v2 contract

**Files:**

- Modify: `product/tests/e2e/host-development-evidence.schema.json`
- Modify: `product/tests/e2e/host-development.evidence.json`
- Modify: `product/tests/release/host-development-evidence.test.ts`
- Modify: `product/tests/e2e/host/codex.md`
- Modify: `product/tests/e2e/host/hanaagent.md`
- Modify: `product/tests/e2e/host/workbuddy.md`

### Required evidence shape

```json
{
  "schema_version": 2,
  "build": {
    "repository": "https://github.com/Nico0713520/universal-computer-use",
    "git_commit": "40-lowercase-hex",
    "product": "0.2.6",
    "protocol": "1.2.0",
    "engine": "0.22.2"
  },
  "transport": {
    "direct_stdio": true,
    "shell_bridge": false,
    "builtin_computer_use": false
  }
}
```

The full schema also requires the host/version/model, macOS version and architecture, host automatic/approval behavior, reported limitations, discovery of exactly two public tools, proof that both the first and second PNG observations reached the same host model in one direct loop, and all three acceptance tasks below.

- [ ] Write failing schema/validator tests for exact repository, 40-character lowercase commit, product/protocol/engine versions, platform, OS version, architecture, direct stdio, no shell bridge, and no built-in Computer Use.
- [ ] Add strict task requirements:
  - `calculator`: visible `37×19=703`, naturally stopped.
  - `unique_input`: exact unique value confirmed, `write_count: 1`, and `nonce_recorded: false`.
  - `covered_window`: semantic background effect, pixel-window effect, target remained background, and foreground fallback recorded only as `not-needed` or `reported`.
- [ ] Require `result: "pass"` for every task before a host result can pass overall.
- [ ] Extend privacy rejection beyond screenshots and user content to include prompts, nonces, tool arguments, clipboard contents, and raw image payloads.
- [ ] Add negative fixtures for a branch name instead of a commit, mixed builds, a bridge script, built-in computer tool use, only one screenshot, missing covered-window proof, duplicate text write, and stored nonce.
- [ ] Upgrade the JSON Schema and development evidence fixture to v2 only after tests fail for the old shape.
- [ ] Rewrite the three host runbooks to require a fresh clone or detached checkout of the exact commit, `git rev-parse HEAD`, the named config command, a host restart/new conversation, and serial execution.
- [ ] State in every runbook that a shell bridge, AppleScript, DOM automation, mental arithmetic, or host built-in Computer Use invalidates the result.
- [ ] Require each runbook to return only the privacy-safe v2 report, not screenshots, prompts, nonces, or tool call arguments.
- [ ] Run the contract tests, full tests, typecheck, and build.
- [ ] Commit:

```bash
git add product/tests/e2e product/tests/release
git commit -m "test: require direct mac host preview loops"
```

## Task 4: Generate commit-bound external host test prompts

**Files:**

- Create: `product/scripts/render-host-test-prompt.mjs`
- Create: `product/tests/contracts/host-test-prompt.test.ts`
- Modify: `product/package.json`

### Command contract

```bash
pnpm --silent host:test-prompt --host hanaagent \
  --repo https://github.com/Nico0713520/universal-computer-use \
  --commit 0123456789abcdef0123456789abcdef01234567
```

- [ ] Write renderer tests first for `codex`, `hanaagent`, and `workbuddy`.
- [ ] Assert every rendered prompt contains the exact public repository, exact commit, detached/fresh checkout requirement, `git rev-parse HEAD`, build/setup/doctor/named-config commands, restart/new-session instruction, and exactly two expected tool names.
- [ ] Assert every prompt forbids bridges, built-in Computer Use, AppleScript, DOM automation, and mental-arithmetic substitution.
- [ ] Assert every prompt requires two PNG observation turns, the calculator task, unique-input task, covered-window task, manual macOS permission handling, serial host testing, and the v2 report.
- [ ] Require either a fresh clone or a documented clean-worktree fast-forward/detached-checkout path; both routes must end in an exact commit comparison before build.
- [ ] Add negative tests for unknown host, non-HTTPS repository, embedded credentials, wrong repository path, non-lowercase or non-40-character commit, repeated flags, and missing flags. All invalid calls exit non-zero with `host_prompt_failed:invalid_arguments` on stderr and no stdout.
- [ ] Implement the renderer as a deterministic pure-output Node script; it must not read Git state, mutate host settings, start Cua, or run a test.
- [ ] Add `"host:test-prompt": "node scripts/render-host-test-prompt.mjs"` to `product/package.json` and include the script in pack/release file assertions.
- [ ] Run renderer contract tests, all tests, typecheck, build, and package-content checks.
- [ ] Commit:

```bash
git add product/scripts/render-host-test-prompt.mjs product/tests/contracts/host-test-prompt.test.ts product/package.json
git commit -m "feat: bind host tests to one preview commit"
```

## Task 5: Bump to v0.2.6 and align user-facing documentation

**Files:**

- Modify: `product/package.json`
- Modify: `product/src/version.ts`
- Modify: `product/integrations/workbuddy/.codebuddy-plugin/plugin.json`
- Modify: current version fixtures and assertions under `product/tests/`
- Modify: `README.md`
- Modify: `product/README.md`
- Modify: current architecture, installation, compatibility, and release documents under `docs/` and `product/docs/`

- [ ] Change version assertions in tests from `0.2.5` to `0.2.6` first and confirm failure.
- [ ] Bump product package, runtime version constant, and WorkBuddy manifest to `0.2.6`. Do not rewrite historical specifications or old evidence merely to remove the older string.
- [ ] Keep protocol `1.2.0`, Cua `0.22.2`, locked commit/hash, and release eligibility unchanged.
- [ ] Update current docs to call this a Mac Agent Preview or Developer Preview, never a signed public Beta.
- [ ] Document the signed-daemon permission states, human `doctor`, JSON `doctor --json`, named HanaAgent/WorkBuddy config, and mandatory host restart/new conversation.
- [ ] Make host truth explicit: Codex, HanaAgent, and WorkBuddy remain `not-tested` or `experimental` until exact-commit external evidence passes.
- [ ] State that host testing is serial and that multi-Agent concurrent control is intentionally deferred.
- [ ] Keep manual Screen Recording and Accessibility authorization, visible Cua attribution, no lock-screen/UAC guarantees, and no internal vision model prominent.
- [ ] Remove any pre-evidence speed claim. Performance numbers may only come from the user-gated real Mac run in Task 7.
- [ ] Run all tests, typecheck, build, `pnpm pack --dry-run`, release eligibility checks, and no-fixed-delay contract checks.
- [ ] Commit:

```bash
git add README.md docs product
git commit -m "chore: prepare mac agent preview v0.2.6"
```

## Task 6: Pass the deterministic pre-desktop review gate

**Files:** No intended product changes. Fix defects through the preceding TDD task if this gate exposes one.

- [ ] Review `git status --short`, `git log --oneline 5d5a686..HEAD`, and `git diff --check 5d5a686..HEAD`.
- [ ] Inspect the complete diff against `5d5a686` for accidental protocol expansion, model coupling, hidden waits, replay, daemon restart, concurrency scope, user-content logging, and release overclaims.
- [ ] Run the full unit/integration/contract/release suite.
- [ ] Run typecheck and production build from a clean dependency state supported by the lockfile.
- [ ] Run package-content and compressed/uncompressed size assertions.
- [ ] Run the no-fixed-delay and action-safety contracts.
- [ ] Run safe CLI smoke checks only: help, JSON doctor, human doctor, and all five config clients. Do not execute GUI acceptance here.
- [ ] Confirm JSON commands emit clean stdout and all prose stays on stderr or in human mode.
- [ ] If any check fails, stop this gate, add a reproducing test in the owning task, fix it, and repeat the entire deterministic gate. Do not continue to real desktop testing with a known failure.

## Task 7: Collect the first v0.2.6 real Mac execution evidence

**Files:** Evidence must be written only to a temporary external directory, never committed.

Before this task, ask the user to confirm that the desktop is idle. Explain that acceptance may open or focus the deterministic Chrome fixture, a native sentinel window, Calculator, and TextEdit. Do not start from silence or infer permission from an earlier test.

- [ ] Create an isolated evidence directory with `mktemp -d -t ucu-v026-mac-evidence.XXXXXX` and record the exact product commit under test.
- [ ] Run the existing Cursor on/off A/B against one private window session, the same canvas target, and the same Cua daemon/session identity: 5 warmups plus 30 measured actions per state. Require 30/30 exactly-once hits and `synthetic_events` for both Cursor states; record p50, p95, max, and the arithmetic difference without inventing a minimum improvement.
- [ ] Record action path aggregation (`accessibility` versus `synthetic_events`) and end-to-end timings without storing screenshots, text values, prompts, clipboard contents, or tool arguments.
- [ ] Run the `window_visual_observe` performance profile with `--exclusive-desktop`; require 30/30, p50 ≤ 700 ms, and p95 ≤ 1,500 ms.
- [ ] Run the `window_semantic_observe` performance profile with `--exclusive-desktop`; require 30/30, p50 ≤ 400 ms, and p95 ≤ 1,000 ms.
- [ ] Run the `semantic_action_next_state` performance profile with `--exclusive-desktop`; require 30/30, p50 ≤ 1,500 ms, and p95 ≤ 2,000 ms.
- [ ] Run the `pixel_action_next_state` performance profile with `--exclusive-desktop`; require 30/30, p50 ≤ 1,500 ms, and p95 ≤ 3,000 ms.
- [ ] Run the complete schema-v4 macOS acceptance suite once with `--exclusive-desktop`, including window discovery, covered-window semantic action, covered-window pixel-window action, focus preservation, semantic sequence, visual recovery, MCP reconnect, exact-once text input, stale snapshot/reference rejection, Calculator completion/cleanup to `0`, TextEdit owned-document cleanup, and all owned-resource cleanup.
- [ ] Verify fresh snapshots after every action and reject any report that infers success from the action response alone.
- [ ] Scan the schema-v4 evidence and temporary directory for PNG/JPEG/base64 payloads, prompts, unique test values, clipboard data, raw arguments, user paths, window titles, PID, window ID, snapshot/ref/token, and other raw identifiers. Delete the temporary evidence after extracting only aggregate pass/fail, path counts, and timing percentiles.
- [ ] If any case fails, stop. Diagnose and fix through a reproducing test; do not rerun until the cause is understood, do not replace a failed report, and do not push external host-test prompts.
- [ ] If the run passes, report the measured p50/p95 and path mix as Mac Preview evidence only, not universal performance guarantees.

## Task 8: Push one exact GitHub commit, then render the user’s host-test prompts

**Files:** No product file should change during this task.

- [ ] Confirm the worktree is clean and `origin` resolves to `https://github.com/Nico0713520/universal-computer-use.git` or its normalized no-suffix equivalent.
- [ ] Fetch `origin` and verify `origin/main` is an ancestor of local `HEAD`. If not, stop and reconcile without force-push, reset, or history rewriting.
- [ ] Push `main` normally with `git push origin main`.
- [ ] Capture `git rev-parse HEAD` and compare it with `git ls-remote origin refs/heads/main`. They must be identical before any testing prompt is shared.
- [ ] Render the Codex prompt using `pnpm --silent host:test-prompt` with the exact public repository and pushed commit.
- [ ] Render the HanaAgent prompt with the same repository and commit.
- [ ] Render the WorkBuddy prompt with the same repository and commit.
- [ ] Give the user all three prompts, clearly instructing them to run one host at a time and to return only the v2 evidence report.
- [ ] Do not ask any host to discover “latest,” reuse the current checkout, or test a moving branch.

## Task 9: Validate returned host evidence and close the Preview milestone honestly

**Files:**

- Modify only after valid evidence exists: current compatibility/status docs under `README.md`, `product/README.md`, `docs/`, and `product/docs/`.

- [ ] Store returned reports in a private temporary directory outside the repository and validate each independently against schema v2 through `CUA_HOST_DEVELOPMENT_EVIDENCE_FILES`.
- [ ] Confirm all three reports name the same repository, exact pushed commit, product `0.2.6`, protocol `1.2.0`, Cua `0.22.2`, direct stdio transport, and no built-in or bridge path.
- [ ] Confirm each host discovered exactly two tools and passed calculator, exact-once unique input, and covered-window operation with fresh PNG observations.
- [ ] Reject a report that includes raw prompts, nonces, screenshots, tool arguments, clipboard content, or unverifiable self-claims.
- [ ] If any host is blocked or fails, preserve that truthful status and stop the Preview-completion update. Do not silently omit it or substitute another host.
- [ ] If all three pass, update only the development compatibility rows with host/version/OS/commit and validation date. Never promote them to signed-release or cross-platform verified status.
- [ ] Run the complete deterministic gate again after documentation changes.
- [ ] Commit and push the evidence-backed documentation update:

```bash
git add README.md docs product/README.md product/docs
git commit -m "docs: record mac agent preview host results"
git push origin main
```

## Final self-review checklist

- [ ] Every approved v0.2.6 specification requirement maps to a task and an executable check.
- [ ] No step adds a model, GUI, third MCP tool, native Cua fork, fixed delay, action replay, or automatic daemon restart.
- [ ] Multi-Agent simultaneous control is explicitly deferred and absent from code scope.
- [ ] macOS permission reporting is derived from the signed Cua daemon or stays unknown; it is never guessed from the calling Node process.
- [ ] Host configuration is named but non-mutating, and restart/new-session requirements are unavoidable in docs and prompts.
- [ ] Evidence is bound to one public commit, direct stdio, two tools, fresh PNG observations, three tasks, and privacy-safe reports.
- [ ] GitHub is updated before external prompts are given to the user.
- [ ] Real GUI tests are the only desktop-disruptive stage and require fresh user confirmation.
- [ ] Release eligibility remains false until later signing, packaging, clean-account, soak, upgrade, and uninstall work is completed.
