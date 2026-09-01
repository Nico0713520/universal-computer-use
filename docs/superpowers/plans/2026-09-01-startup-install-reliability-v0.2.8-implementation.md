# Universal Computer Use v0.2.8 Startup and Install Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the WorkBuddy Cursor startup failure and HanaAgent install/proxy blockers while preserving the two-tool protocol and fail-closed action safety.

**Architecture:** Four narrow public seams own the work: Cursor convergence, process timeout ownership, setup policy, and direct CLI proxy bootstrapping. Each is implemented as a vertical TDD slice, with no host-specific branch and no GUI action in automated verification.

**Tech Stack:** TypeScript 5.7, Node.js 22.21–22.x or 24.5+, Vitest 3.2, MCP SDK 1.30, locked Cua Driver 0.22.2.

## Global Constraints

- Keep exactly `computer_observe` and `computer_act` public.
- Never replay a GUI action.
- Never add a fixed action-loop delay.
- Never delete Cua's private install lock from UCU.
- Keep Cua 0.22.2 and existing checksums locked.
- Do not run Cua, doctor, screenshots, or GUI input during automated implementation.

---

### Task 1: Adaptive Cursor convergence

**Files:**
- Modify: `product/src/engine/agent-cursor.ts`
- Modify: `product/tests/unit/agent-cursor.test.ts`
- Modify if required by the timeout allowlist: `product/tests/contract/no-fixed-action-delay.test.ts`

**Interfaces:**
- Consumes: `AgentCursorSdk.callTool` and the existing Cursor state contract.
- Produces: `AgentCursorController.initialize` that tolerates only bounded, well-formed render convergence.

- [ ] Add a test SDK whose first state read returns default motion and whose next read returns `80/40/700`; assert initialization succeeds and configuration calls happen once.
- [ ] Run `pnpm exec vitest run tests/unit/agent-cursor.test.ts` and confirm the new test fails with `cursor_initialization_failed`.
- [ ] Add an injectable waiter and the exact `10,20,40,80,100,150ms` readback schedule.
- [ ] Add tests for immediate success, non-convergence, malformed state, wrong session, and `enabled:true` fail-closed behavior.
- [ ] Run the focused test and the fixed-delay contract to green.
- [ ] Commit the Cursor slice.

### Task 2: POSIX installer process-tree termination

**Files:**
- Modify: `product/src/cli/process-runner.ts`
- Modify: `product/tests/unit/cli-setup.test.ts`

**Interfaces:**
- Consumes: `ProcessRunner.run(command,args,options)`.
- Produces: optional `terminateTree` and `terminationGraceMs` policy with POSIX process-group ownership.

- [ ] Add a real shell fixture test that creates a child and a lock, then needs one second in its TERM trap; assert timeout rejects, the child is gone, and the lock is removed.
- [ ] Run the focused test and confirm a surviving child or lock makes it red.
- [ ] Implement independent POSIX groups and TERM-to-KILL group signaling without changing default Windows behavior.
- [ ] Keep cleanup bounded and classify process-group signals by group state: `ESRCH` means the owned group is gone, while `EPERM` during a liveness probe means it may still exist and escalation must remain armed.
- [ ] Run the focused process test repeatedly to prove it is deterministic and leaves no fixture process.
- [ ] Commit the process ownership slice.

### Task 3: Setup phase deadlines

**Files:**
- Modify: `product/src/cli/setup.ts`
- Modify: `product/tests/unit/cli-setup.test.ts`
- Modify: `product/tests/unit/cli-setup-command.test.ts`
- Modify: `docs/installation/macos.md`
- Modify: `docs/troubleshooting.md`

**Interfaces:**
- Consumes: `SetupDependencies.environment` and `ProcessRunner` options.
- Produces: a 20-minute default installer deadline, validated override, and tree-safe installer invocation.

- [ ] Add assertions that the macOS installer receives `timeoutMs:1_200_000`, `terminateTree:true`, and `terminationGraceMs:5_000`, while permission and launch deadlines stay unchanged.
- [ ] Add valid and invalid `COMPUTER_USE_INSTALL_TIMEOUT_MS` cases; invalid input must execute no installer.
- [ ] Run focused tests red.
- [ ] Split the installer, permission, and launch constants and implement strict override parsing.
- [ ] Document the override, 600-second upstream stale recovery, and the prohibition on blind lock deletion.
- [ ] Run focused tests green and commit.

### Task 4: Proxy-aware setup bootstrap

**Files:**
- Create: `product/src/cli/env-proxy.ts`
- Create: `product/tests/unit/env-proxy.test.ts`
- Modify: `product/src/cli/main.ts`
- Modify: `product/src/cli/process-runner.ts`
- Modify: `product/tests/unit/cli-entrypoint.test.ts` or the nearest direct-entrypoint test
- Modify: `product/package.json`
- Modify: `product/README.md`
- Modify: `docs/installation/macos.md`

**Interfaces:**
- Consumes: direct CLI argv, execArgv, process environment, and an injected re-exec function.
- Produces: one-time `setup` re-execution with Node's `--use-env-proxy`, plus a 60-second download deadline.

- [ ] Add pure policy tests covering uppercase/lowercase proxy variables, already-enabled proxy mode, recursion marker, non-setup commands, and redaction.
- [ ] Add a direct-entrypoint test that captures argv and exit status without network access.
- [ ] Run focused tests red.
- [ ] Implement the one-time re-exec policy and set `engines.node` to `^22.21.0 || >=24.5.0`.
- [ ] Add `AbortSignal.timeout(60_000)` to locked script downloads and a deterministic timeout test.
- [ ] Verify proxy values never appear in stdout, stderr, serialized errors, or snapshots.
- [ ] Run focused tests green and commit.

### Task 5: Integrated verification and release handoff

**Files:**
- Modify as required: `product/package.json`, lockfile, `README.md`, host documentation, version/protocol assertions.
- Do not change the public protocol version unless a snapshot proves the tool contract changed.

**Interfaces:**
- Consumes: all four completed slices.
- Produces: one reviewable v0.2.8 branch and external-host retest instructions.

- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm build`.
- [ ] Run `pnpm pack --dry-run` and verify no temporary fixture is packaged.
- [ ] Run the deterministic process-tree and Cursor tests three consecutive times.
- [ ] Review the branch for leaked proxy values, fixed action waits, private lock deletion, or host-specific production logic.
- [ ] Update version-facing documentation consistently without changing the two-tool protocol snapshot.
- [ ] Commit, push the branch, and publish the exact commit for HanaAgent and WorkBuddy retesting.
