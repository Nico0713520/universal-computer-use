# Universal Computer Use macOS Host Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a truthful `0.2.4` macOS developer preview whose stdio MCP entrypoint can start an already-installed, signature-verified CuaDriver daemon with bounded readiness polling, then prove direct use from named Agent hosts without changing the two-tool protocol.

**Architecture:** Add one engine-connection coordinator before `ComputerUseRuntime` is created. Reuse a single exported macOS signature verifier from setup and startup, keep post-connection health behavior unchanged, and treat clean-account plus named-host runs as external development evidence rather than release promotion.

**Tech Stack:** TypeScript 5.7, Node.js 22.19+, Vitest 3.2, MCP SDK 1.30, Zod 4.4, Cua Driver 0.22.2, macOS `codesign`, `spctl`, and `open` through the existing argv-safe process runner.

## Global Constraints

- Public MCP tools remain exactly `computer_observe` and `computer_act`.
- Product becomes `0.2.4`; protocol remains exactly `1.2.0`; Cua remains exactly `0.22.2` and `release_eligible:false`.
- No model, API key, OCR engine, planner, GUI, native Cua fork, hidden host modification, or Windows behavior change.
- Runtime startup occurs only before snapshot state exists and never replays an observe or act call.
- Only an initial `runtime_unavailable` on macOS may start the verified installed app.
- No fixed post-action delay, imitation-human pause, blind input retry, or multi-action batch.
- Readiness polling exits on the first successful connection, targets 2 seconds, and has a 10-second hard deadline.
- Logs and evidence never contain screenshots, prompts, typed text, clipboard data, environment dumps, user paths, native IDs, refs, or tokens.
- Development and host evidence remain external and cannot set engine or release eligibility.

---

### Task 1: Add the bounded engine-connection coordinator

**Files:**
- Create: `product/src/engine/runtime-startup.ts`
- Create: `product/tests/unit/runtime-startup.test.ts`
- Modify: `product/tests/helpers/fixed-delay-scan.ts`
- Test: `product/tests/contract/no-fixed-action-delay.test.ts`

**Interfaces:**
- Consumes: `EngineLock`, `ComputerUseError`, `ProcessRunner`, and a dependency-injected `connect(lock)` function.
- Produces: `createRuntimeConnector<T>(dependencies): (lock: EngineLock) => Promise<T>` and `verifyMacRuntimeSignature(lock, runner, appPath): Promise<void>`.

- [ ] **Step 1: Write the first red test at the connection seam**

Create `runtime-startup.test.ts` with a fixture lock and assert that a healthy first connection returns the engine, performs no filesystem access, invokes no process, and performs no wait:

```ts
it("connects once without startup when the installed Runtime is already ready", async () => {
  const engine = { id: "ready" };
  const connect = vi.fn(async () => engine);
  const access = vi.fn(async () => undefined);
  const runner = { run: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })) };
  const wait = vi.fn(async () => undefined);
  const connector = createRuntimeConnector({
    platform: "darwin",
    connect,
    access,
    runner,
    wait,
    now: () => 0,
  });

  await expect(connector(await loadEngineLock())).resolves.toBe(engine);
  expect(connect).toHaveBeenCalledTimes(1);
  expect(access).not.toHaveBeenCalled();
  expect(runner.run).not.toHaveBeenCalled();
  expect(wait).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused test and confirm red**

Run:

```bash
cd product
npx --yes pnpm@9.0.4 vitest run tests/unit/runtime-startup.test.ts
```

Expected: FAIL because `src/engine/runtime-startup.ts` does not exist.

- [ ] **Step 3: Implement the healthy tracer path**

Create the module with these public types and a single-flight closure. The initial implementation calls `connect(lock)` and returns its result; it stores the in-flight promise so concurrent callers share one startup path:

```ts
export type RuntimeStartupDependencies<T> = Readonly<{
  platform?: NodeJS.Platform;
  connect(lock: EngineLock): Promise<T>;
  access(path: string): Promise<void>;
  runner: ProcessRunner;
  wait(ms: number): Promise<void>;
  now(): number;
  macAppPath?: string;
}>;

export function createRuntimeConnector<T>(dependencies: RuntimeStartupDependencies<T>) {
  let pending: Promise<T> | undefined;
  return (lock: EngineLock): Promise<T> => {
    pending ??= connectWithStartup(lock, dependencies);
    return pending;
  };
}
```

- [ ] **Step 4: Run the focused test and confirm green**

Run the same Vitest command. Expected: one passing test.

- [ ] **Step 5: Add red tests for the complete failure matrix**

Add one behavior test per cycle, running the focused file after each addition. Reuse this complete boundary fixture in the test file:

```ts
function runtimeUnavailable() {
  return new ComputerUseError(
    "runtime_unavailable",
    "fixture daemon is stopped",
    "doctor",
    true,
  );
}

function startupBoundary(connect: RuntimeStartupDependencies<unknown>["connect"]) {
  let currentTime = 0;
  const runner = {
    run: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })),
  };
  const wait = vi.fn(async (ms: number) => { currentTime += ms; });
  return {
    dependencies: {
      platform: "darwin" as const,
      connect,
      access: vi.fn(async () => undefined),
      runner,
      wait,
      now: () => currentTime,
    },
    runner,
    wait,
  };
}

it("starts a verified macOS Runtime only after runtime_unavailable", async () => {
  const engine = { id: "started" };
  const connect = vi.fn()
    .mockRejectedValueOnce(runtimeUnavailable())
    .mockResolvedValueOnce(engine);
  const boundary = startupBoundary(connect);
  await expect(createRuntimeConnector(boundary.dependencies)(await loadEngineLock()))
    .resolves.toBe(engine);
  expect(boundary.runner.run).toHaveBeenCalledWith(
    "/usr/bin/open",
    ["-g", "/Applications/CuaDriver.app", "--args", "serve"],
    { timeoutMs: 30_000 },
  );
  expect(boundary.wait).not.toHaveBeenCalled();
});

it("never starts for a non-runtime error", async () => {
  const error = new ComputerUseError(
    "engine_version_mismatch", "fixture mismatch", "setup", false,
  );
  const boundary = startupBoundary(vi.fn(async () => { throw error; }));
  await expect(createRuntimeConnector(boundary.dependencies)(await loadEngineLock()))
    .rejects.toBe(error);
  expect(boundary.runner.run).not.toHaveBeenCalled();
});

it("never starts on Windows", async () => {
  const boundary = startupBoundary(vi.fn(async () => { throw runtimeUnavailable(); }));
  const dependencies = { ...boundary.dependencies, platform: "win32" as const };
  await expect(createRuntimeConnector(dependencies)(await loadEngineLock()))
    .rejects.toMatchObject({ code: "runtime_unavailable" });
  expect(boundary.runner.run).not.toHaveBeenCalled();
});

it("maps a missing installed app to runtime_missing", async () => {
  const boundary = startupBoundary(vi.fn(async () => { throw runtimeUnavailable(); }));
  boundary.dependencies.access.mockRejectedValueOnce(new Error("ENOENT"));
  await expect(createRuntimeConnector(boundary.dependencies)(await loadEngineLock()))
    .rejects.toMatchObject({ code: "runtime_missing", recovery: "setup", retryable: false });
});

it("exits readiness polling on the first successful connection", async () => {
  const engine = { id: "ready-after-one-poll" };
  const connect = vi.fn()
    .mockRejectedValueOnce(runtimeUnavailable())
    .mockRejectedValueOnce(runtimeUnavailable())
    .mockResolvedValueOnce(engine);
  const boundary = startupBoundary(connect);
  await expect(createRuntimeConnector(boundary.dependencies)(await loadEngineLock()))
    .resolves.toBe(engine);
  expect(boundary.wait).toHaveBeenCalledTimes(1);
  expect(boundary.wait).toHaveBeenCalledWith(50);
});

it("stops at the ten-second readiness deadline", async () => {
  const boundary = startupBoundary(vi.fn(async () => { throw runtimeUnavailable(); }));
  await expect(createRuntimeConnector(boundary.dependencies)(await loadEngineLock()))
    .rejects.toMatchObject({ code: "runtime_unavailable", recovery: "doctor" });
  expect(boundary.wait.mock.calls.reduce((sum, [ms]) => sum + ms, 0)).toBe(10_000);
});

it("shares one startup attempt across concurrent callers", async () => {
  const engine = { id: "single-flight" };
  const connect = vi.fn()
    .mockRejectedValueOnce(runtimeUnavailable())
    .mockResolvedValueOnce(engine);
  const boundary = startupBoundary(connect);
  const connector = createRuntimeConnector(boundary.dependencies);
  const lock = await loadEngineLock();
  await expect(Promise.all([connector(lock), connector(lock)])).resolves.toEqual([engine, engine]);
  const openCalls = boundary.runner.run.mock.calls.filter(([command]) => command === "/usr/bin/open");
  expect(openCalls).toHaveLength(1);
});
```

Use literal expected error objects at the public seam:

```ts
await expect(connector(lock)).rejects.toMatchObject({
  code: "runtime_missing",
  recovery: "setup",
  retryable: false,
});
```

- [ ] **Step 6: Implement the minimal startup state machine**

Use `/Applications/CuaDriver.app` by default. After the first `runtime_unavailable`, call `access`, verify the signature, start with separate argv, then connect immediately before any wait. Between subsequent failed connects use bounded delays no larger than 1 second and recompute the remaining deadline:

```ts
await runner.run("/usr/bin/open", ["-g", appPath, "--args", "serve"], {
  timeoutMs: 30_000,
});

const delays = [50, 100, 200, 400, 800, 1_000] as const;
for (let attempt = 0; ; attempt += 1) {
  try {
    return await connect(lock);
  } catch (error) {
    if (!isRuntimeUnavailable(error)) throw error;
  }
  const remaining = deadline - now();
  if (remaining <= 0) throw runtimeUnavailableAfterStartup();
  await wait(Math.min(delays[Math.min(attempt, delays.length - 1)]!, remaining));
}
```

Map an `open` failure and deadline expiry to `runtime_unavailable` with `recovery:"doctor"`. Never catch and replay a tool call because no runtime or snapshot exists yet.

- [ ] **Step 7: Add bounded polling to the fixed-delay allowlist**

Extend the AST scanner allowlist only for `src/engine/runtime-startup.ts` and only when the delay argument is the injected bounded `delayMs`/remaining-deadline value. Add a contract case proving literal `3_000` in this file is rejected.

- [ ] **Step 8: Run task verification and commit**

Run:

```bash
cd product
npx --yes pnpm@9.0.4 vitest run tests/unit/runtime-startup.test.ts tests/contract/no-fixed-action-delay.test.ts
npx --yes pnpm@9.0.4 typecheck
```

Expected: all focused tests and typecheck pass.

Commit:

```bash
git add product/src/engine/runtime-startup.ts product/tests/unit/runtime-startup.test.ts product/tests/helpers/fixed-delay-scan.ts product/tests/contract/no-fixed-action-delay.test.ts
git commit -m "feat: start verified mac runtime on demand"
```

---

### Task 2: Reuse one macOS signature verifier in setup and startup

**Files:**
- Modify: `product/src/engine/runtime-startup.ts`
- Modify: `product/src/cli/setup.ts`
- Modify: `product/tests/unit/runtime-startup.test.ts`
- Modify: `product/tests/unit/cli-setup.test.ts`

**Interfaces:**
- Consumes: the engine lock's Apple signer fields and `ProcessRunner.run(command, args, options)`.
- Produces: one `verifyMacRuntimeSignature` implementation used by both installation and cold startup.

- [ ] **Step 1: Add red signature behavior tests**

At the exported verifier seam, assert the exact `codesign --verify`, `spctl --assess`, identity inspection, and designated-requirement inspection argv. Add literal failure cases for codesign, Gatekeeper, TeamIdentifier, bundle ID, and designated-requirement hash. Every mismatch must be a `ComputerUseError`:

```ts
await expect(verifyMacRuntimeSignature(lock, runner, appPath)).rejects.toMatchObject({
  code: "engine_version_mismatch",
  recovery: "setup",
  retryable: false,
});
```

- [ ] **Step 2: Run the focused tests and confirm red**

Run:

```bash
cd product
npx --yes pnpm@9.0.4 vitest run tests/unit/runtime-startup.test.ts tests/unit/cli-setup.test.ts
```

Expected: the new stable error assertions fail while setup still owns its private verifier.

- [ ] **Step 3: Move the existing verifier without changing its security checks**

Move SHA-256 designated-requirement comparison and exact signer checks from `setup.ts` into `runtime-startup.ts`. Wrap process failures and signer mismatches as `engine_version_mismatch`; retain argv-safe runner calls. In `setup.ts`, replace the private function with:

```ts
import { verifyMacRuntimeSignature } from "../engine/runtime-startup.js";
```

Call it at the same point after installation and before daemon startup.

- [ ] **Step 4: Run regressions and commit**

Run:

```bash
cd product
npx --yes pnpm@9.0.4 vitest run tests/unit/runtime-startup.test.ts tests/unit/cli-setup.test.ts tests/contract/engine-lock.test.ts
npx --yes pnpm@9.0.4 typecheck
```

Expected: all pass and setup's exact download/start/permission sequence remains unchanged.

Commit:

```bash
git add product/src/engine/runtime-startup.ts product/src/cli/setup.ts product/tests/unit/runtime-startup.test.ts product/tests/unit/cli-setup.test.ts
git commit -m "refactor: share locked mac runtime verification"
```

---

### Task 3: Wire startup into both MCP entrypoints without changing doctor

**Files:**
- Modify: `product/src/mcp/main.ts`
- Modify: `product/src/cli/main.ts`
- Modify: `product/tests/unit/cli-mcp.test.ts`
- Create: `product/tests/unit/mcp-runtime-startup.test.ts`

**Interfaces:**
- Consumes: `createRuntimeConnector`, `nodeProcessRunner`, `CuaEngine.connect`, and `loadEngineLock`.
- Produces: `connectProductionEngine(lock)` used by `dist/mcp/main.js` and `computer-use mcp`; setup and doctor keep raw diagnostic connection behavior.

- [ ] **Step 1: Make the CLI MCP seam red**

Extend the dependency object accepted by `runCli` with an optional `connectMcpEngine`. In the test provide both raw and startup connectors and assert only startup is used by `computer-use mcp`:

```ts
const rawConnect = vi.fn(async () => { throw new Error("doctor connector used"); });
const startupConnect = vi.fn(async () => engine as unknown as CuaEngine);

await runCli(["mcp"], io, {
  ...dependencies,
  connectEngine: rawConnect,
  connectMcpEngine: startupConnect,
});

expect(startupConnect).toHaveBeenCalledOnce();
expect(rawConnect).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run the CLI test and confirm red**

Run:

```bash
cd product
npx --yes pnpm@9.0.4 vitest run tests/unit/cli-mcp.test.ts
```

Expected: FAIL because `connectMcpEngine` is not part of the dependency seam.

- [ ] **Step 3: Add the production connector and wire both entrypoints**

In `mcp/main.ts`, construct one module-scoped connector:

```ts
export const connectProductionEngine = createRuntimeConnector({
  platform: process.platform,
  connect: (lock) => CuaEngine.connect(lock),
  access,
  runner: nodeProcessRunner,
  wait: boundedWait,
  now: Date.now,
});
```

Use it in `runDefaultServer`. In `cli/main.ts`, add `connectMcpEngine` to default dependencies and use it only for the `mcp` command. Preserve raw `connectEngine` for setup and doctor so diagnostics report the state they observe rather than silently repairing it.

- [ ] **Step 4: Prove direct entrypoint behavior**

In `mcp-runtime-startup.test.ts`, call an exported dependency-injected `runDefaultServer` with fake lock loading, startup connection, runtime creation, and server runner. Assert order `load lock → connect → run server`, and assert the server is never created if connection fails.

- [ ] **Step 5: Run entrypoint regressions and commit**

Run:

```bash
cd product
npx --yes pnpm@9.0.4 vitest run tests/unit/cli-mcp.test.ts tests/unit/mcp-runtime-startup.test.ts tests/unit/cli-doctor.test.ts tests/unit/cli-setup.test.ts
npx --yes pnpm@9.0.4 typecheck
```

Expected: all pass; doctor still performs no startup side effect.

Commit:

```bash
git add product/src/mcp/main.ts product/src/cli/main.ts product/tests/unit/cli-mcp.test.ts product/tests/unit/mcp-runtime-startup.test.ts
git commit -m "feat: recover mac runtime before mcp startup"
```

---

### Task 4: Publish truthful `0.2.4` preview metadata and host instructions

**Files:**
- Modify: `product/package.json`
- Modify mechanically: `product/pnpm-lock.yaml`
- Modify: `product/src/version.ts`
- Modify: `README.md`
- Modify: `product/README.md`
- Modify: `docs/installation/macos.md`
- Modify: `docs/troubleshooting.md`
- Modify: `docs/host-compatibility.md`
- Modify: `product/tests/e2e/host/hanaagent.md`
- Modify: `product/tests/e2e/host/workbuddy.md`
- Modify: `product/tests/e2e/host/codex.md`
- Modify: version-sensitive tests under `product/tests/unit` and `product/tests/contract`

**Interfaces:**
- Consumes: the working startup path and existing development-host evidence schema.
- Produces: product `0.2.4`, unchanged protocol `1.2.0`, copyable preview setup instructions, and bridge-free direct-host acceptance instructions.

- [ ] **Step 1: Make version and documentation contracts red**

Update exact product-version expectations to `0.2.4`. Add contract assertions requiring:

```text
Runtime startup happens before the MCP session only.
No GUI action is replayed.
A host restart and a new conversation are required after registration.
A shell JSON-RPC bridge does not count as direct-host evidence.
CuaDriver remains visible in macOS Privacy & Security.
```

Require host runbooks to validate external `development-evidence.schema.json` and keep production compatibility rows unchanged.

- [ ] **Step 2: Run version-sensitive tests and confirm red**

Run:

```bash
cd product
npx --yes pnpm@9.0.4 vitest run tests/unit/cli-doctor.test.ts tests/unit/cli-setup.test.ts tests/contract/engine-lock.test.ts tests/contract/host-development-evidence.test.ts tests/contract/integrations.test.ts
```

Expected: FAIL on product `0.2.3` or missing preview language.

- [ ] **Step 3: Bump only the product patch and update docs**

Set:

```ts
export const PRODUCT_VERSION = "0.2.4" as const;
export const PROTOCOL_VERSION = "1.2.0" as const;
```

Run `npx --yes pnpm@9.0.4 install --lockfile-only --ignore-scripts` only if the lockfile carries the root package version. Do not change dependency or engine versions.

Document the preview sequence:

```bash
npm install --global <preview-tarball-or-prerelease>
computer-use setup --development
computer-use doctor --json
computer-use config --client generic
```

Explain that external publication remains a separate authorized action and that normal setup stays blocked.

- [ ] **Step 4: Tighten the three direct-host runbooks**

Require a newly started conversation, exactly two tools, Calculator and TextEdit tasks with the same host-reported model, two PNG deliveries, repeated calls, natural stop, no bridge, and redacted external evidence. Add the stopped-daemon startup check before the two GUI tasks.

- [ ] **Step 5: Run documentation and version contracts and commit**

Run:

```bash
cd product
npx --yes pnpm@9.0.4 vitest run tests/unit tests/contract
npx --yes pnpm@9.0.4 typecheck
```

Expected: all deterministic tests pass; release eligibility remains false.

Commit:

```bash
git add product/package.json product/pnpm-lock.yaml product/src/version.ts README.md product/README.md docs/installation/macos.md docs/troubleshooting.md docs/host-compatibility.md product/tests/e2e/host product/tests/unit product/tests/contract
git commit -m "docs: prepare macos host preview"
```

---

### Task 5: Verify the preview package and current Mac behavior

**Files:**
- Modify only if a deterministic failure proves a product defect: files implicated by that failure
- External output: temporary npm tarball manifest, doctor report, macOS development evidence, and host development evidence

**Interfaces:**
- Consumes: the complete `0.2.4` checkout.
- Produces: deterministic verification plus truthful external results; it does not publish or promote a release.

- [ ] **Step 1: Run the full deterministic gate**

Run:

```bash
cd product
npx --yes pnpm@9.0.4 test
npx --yes pnpm@9.0.4 typecheck
npx --yes pnpm@9.0.4 build
npm pack --dry-run --json
node dist/cli/main.js doctor --json
npm run release:verify -- --channel beta
```

Expected: tests, typecheck, build, pack inspection, and doctor pass. Beta verification exits nonzero only with `engine_not_release_eligible`.

- [ ] **Step 2: Prove stopped-daemon recovery without GUI actions**

On the current unlocked Mac, stop only the known CuaDriver daemon through its documented lifecycle, start `dist/mcp/main.js`, and confirm it becomes ready within the 10-second deadline. Confirm logs contain no screenshot or input data and no Agent tool call was replayed.

- [ ] **Step 3: Run the available macOS development lane**

Run:

```bash
cd product
CUA_E2E=1 CUA_E2E_MODE=development npm run acceptance:macos
```

Keep the emitted artifact outside version control. If the current account still contains ambiguous historical TextEdit windows, record that external blocker and do not close user-owned windows broadly or claim clean-account completion.

- [ ] **Step 4: Prepare direct-host testing**

Generate absolute configuration and provide the validated prompt/runbook for HanaAgent, WorkBuddy, and Codex. Direct evidence requires the user to restart each host and run its new conversation; record external results only after those runs actually occur.

- [ ] **Step 5: Review, commit any evidence-driven fixes, and push**

Run `git diff --check`, inspect every changed file, rerun the focused test for any fix, then rerun the full deterministic gate. Keep private evidence and tarballs untracked. Commit only source, tests, and documentation, then push `main` after the worktree is clean.

---

## Self-review result

- **Spec coverage:** Tasks 1–3 cover bounded verified startup; Task 4 covers preview/version/host guidance; Task 5 covers deterministic, real Mac, package, and external-host gates.
- **Deferred external work:** clean-account three-run evidence and direct named-host execution require the corresponding interactive user/host environment and cannot be manufactured by deterministic tests.
- **Type consistency:** `createRuntimeConnector`, `verifyMacRuntimeSignature`, and `connectProductionEngine` retain the same signatures across tasks.
- **Scope:** no Windows implementation, public protocol change, engine promotion, external publication, or proprietary native executor is included.
