# Universal Computer Use v0.2.8 Startup and Install Reliability Design

Status: approved for implementation by the user's 2026-09-01 instruction to diagnose and solve the failed WorkBuddy and HanaAgent runs.

## Goal

Make the existing two-tool MCP reliably reach host tool discovery on macOS by fixing three observed blockers without changing the Computer Use protocol or adding per-action delay:

1. Adaptive Cursor configuration is verified only after Cua's asynchronous overlay state converges.
2. A timed-out Cua installer cannot leave its process tree or fixture-equivalent install lock behind.
3. Setup can use an explicitly configured HTTP(S) proxy on every supported Node version.

## Evidence behind the scope

- WorkBuddy observed `engine_contract_changed` when the first session immediately read Cua's default Cursor motion after a successful set call. Cua 0.22.2 sends motion/theme to the AppKit overlay through a non-blocking queue.
- HanaAgent observed a real Cua install lasting about 4 minutes 28 seconds, while UCU hard-stopped the installer after 120 seconds.
- Cua 0.22.2 waits 600 seconds before reclaiming a dead install lock. A 120-second UCU retry can never reach that recovery point.
- The current process runner kills only the direct child and gives a shell 250ms to clean up. A deterministic slow-cleanup shell fixture reproduced `process timeout`, a surviving descendant, and a present lock.
- The current downloader uses Node global `fetch`. Environment-proxy support first appears in Node 22.21 and 24.5 and must be enabled at process startup; Node 23 and Node 24.0–24.4 do not provide the required flag.

## Non-goals

- No change to `computer_observe` or `computer_act` schemas.
- No retry or replay of GUI actions.
- No fixed delay in the action loop.
- No automatic deletion of Cua's private install lock.
- No `serve --embedded` change.
- No concurrent multi-Agent desktop arbitration.
- No host-specific HanaAgent or WorkBuddy behavior in production code.

## Design

### 1. Adaptive Cursor convergence

`AgentCursorController.initialize` keeps the existing order: set theme for both sessions, set motion for both sessions, disable both cursors.

Verification changes from one immediate read to bounded convergence reads:

- Read both session states immediately.
- A malformed result, tool error, wrong session, or `enabled:true` fails immediately.
- A well-formed state whose theme or motion still reflects the render default is considered not yet converged.
- Re-read only state; never repeat configuration calls.
- Wait on the exact bounded schedule `10, 20, 40, 80, 100, 150` milliseconds and stop at the first matching read. The maximum added startup budget is 400ms.
- The waiter is injectable in tests. Normal success generally adds zero or one UI frame, not a human-visible fixed pause.

### 2. Installer timeout and process ownership

`ProcessRunner.run` gains optional timeout-termination settings:

- `terminateTree:true` creates an independent POSIX process group.
- On timeout, send `SIGTERM` to that exact group.
- Give the group 5 seconds to execute shell traps and close descendants.
- If still alive, send `SIGKILL` to the same group and reject with the existing timeout error.
- Windows keeps direct-child termination until the Windows installer lane designs its own tree semantics.

Only the long macOS installer enables tree termination. Read-only signature checks, `open`, doctor probes, and ordinary short commands keep their existing process shape.

Setup uses phase-specific deadlines:

- Cua installer: 20 minutes by default.
- Permission flow: remains 120 seconds.
- Daemon launch: remains 30 seconds.

`COMPUTER_USE_INSTALL_TIMEOUT_MS` may override the installer deadline with a decimal integer from 60,000 through 3,600,000 milliseconds. Invalid values fail before executing the installer. The long deadline is a safety ceiling and never delays a successful installation.

UCU never removes `~/.cua-driver/packages/.install.lock.d`. Safe lock ownership remains with Cua. Preventing orphan processes and allowing Cua's 600-second recovery window removes the observed UCU-created livelock.

### 3. Proxy-aware setup

Support Node 22.21–22.x or 24.5+, the release lines that provide built-in environment-proxy support. Exclude Node 23 and Node 24.0–24.4 rather than accepting an apparently newer but incompatible runtime.

At the direct CLI entrypoint, only `setup` is eligible for proxy re-execution:

- If `HTTP_PROXY`, `HTTPS_PROXY`, `http_proxy`, or `https_proxy` is present, and neither `NODE_USE_ENV_PROXY=1` nor `--use-env-proxy` is already active, re-execute the exact CLI once as `node --use-env-proxy <entrypoint> setup ...`.
- Preserve stdin/stdout/stderr and exit status.
- Use a private boolean marker to prevent recursion.
- Never print proxy values.
- Continue verifying all downloaded installer files against `engine.lock.json` SHA-256 values.

The downloader also receives an explicit 60-second `AbortSignal.timeout` per small locked script. Timeout and proxy failures remain setup failures; TLS verification is never disabled.

### 4. Diagnostics and host evidence

This version does not promote either host automatically. HanaAgent and WorkBuddy remain `not-tested`/`experimental` until a new exact-build run completes their existing direct-stdio host contracts.

The setup tests must prove the exact installer deadline and tree-termination options. The Cursor tests must simulate delayed render convergence. The CLI tests must prove proxy re-execution without making a network request or exposing a proxy URL.

## Test seams

The approved public seams are:

1. `AgentCursorController.initialize` for asynchronous state convergence.
2. `ProcessRunner.run` for timeout ownership and descendant cleanup.
3. `runSetup` for phase-specific installer policy.
4. The direct CLI entrypoint runner for environment-proxy re-execution.

Each slice follows red, green, then focused regression. Full unit, contract, typecheck, build, and pack verification run after all slices.

## Acceptance criteria

- A delayed-but-correct Cursor state initializes successfully within the bounded schedule.
- A never-converging or unsafe Cursor state still fails closed.
- A timed-out shell with a child process leaves neither child nor fixture lock.
- The macOS installer receives a default 1,200,000ms timeout and tree termination with a 5,000ms grace period.
- A valid override changes only the installer timeout; an invalid override performs no installer action.
- Proxy-configured `setup` re-executes once with `--use-env-proxy`; ordinary commands never do.
- Downloader timeout is finite and checksums remain mandatory.
- No production path contains a fixed three-second wait or GUI-action retry.
- Existing two-tool MCP protocol snapshots remain unchanged.
