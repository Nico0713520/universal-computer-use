# Universal Computer Use macOS Host Preview Design

**Status:** Written review requested  
**Target:** `0.2.4` developer preview  
**Platform:** macOS 14+ on Apple silicon or Intel x64

## 1. Goal

Turn the current macOS developer build into a repeatable host-preview package that a user can install, authorize once, register in a supported Agent, and test without a shell JSON-RPC bridge. Preserve protocol `1.2.0`, the two-tool MCP surface, the host Agent's current multimodal model, and Cua Driver as the unmodified native execution runtime.

This phase does not claim public Beta or Stable eligibility. It produces truthful development evidence and a low-friction preview path while the locked Cua Runtime remains `release_eligible:false`.

## 2. Approaches considered

### A. Evidence only

Rerun the existing macOS acceptance lane on a clean account and collect host evidence without changing product behavior. This is the smallest change, but it leaves daemon startup, permission recovery, host restart instructions, and preview packaging as manual failure points.

### B. Preview-readiness vertical slice — selected

Complete clean-account acceptance, add a bounded macOS Runtime startup coordinator, run direct HanaAgent, WorkBuddy, and Codex development checks, and package one explicit developer preview. This addresses the real onboarding and cold-start failures without widening the computer-use protocol or copying native Cua code.

### C. Immediate public Beta

Promote an engine, publish the ordinary setup path, include Windows, and require release-grade host and soak evidence in one phase. This is rejected because Windows exact-window support is still blocked in the locked Runtime and the current macOS evidence is not yet independent on a clean account.

## 3. Global constraints

- Public MCP tools remain exactly `computer_observe` and `computer_act`.
- Protocol remains `1.2.0`; existing request and response schemas remain compatible.
- The plugin contains no model, model endpoint, API key, OCR engine, planner, chat GUI, or private task loop.
- Cua Driver remains unmodified, separately licensed, visibly identified, and responsible for Screen Recording and Accessibility permissions.
- No fixed post-action delay, imitation-human pause, blind input retry, multi-action batch, or reuse of a consumed snapshot is permitted.
- Runtime startup recovery may happen only before an MCP session is created. It must never replay an `observe` or `act` call.
- macOS permissions, host approval policy, lock screen, FileVault, and login-window boundaries remain outside plugin control.
- Windows behavior and evidence are unchanged in this phase.
- Logs and committed evidence must not contain screenshots, prompts, typed text, clipboard contents, user paths, usernames, hostnames, environment dumps, native IDs, refs, or tokens.

## 4. Scope

### 4.1 Clean macOS acceptance

Run the complete schema-v3 development acceptance lane from a fresh macOS user account or an equivalent account with no pre-v0.2.3 TextEdit artifacts. Each run owns uniquely named Calculator, browser-fixture, and TextEdit state and cleans only state it created.

Three consecutive complete runs must each satisfy:

- all deterministic unit and contract tests pass;
- all real-app smoke cases pass;
- exact-window visual observe, semantic observe, background semantic action, and covered-window pixel action each record 30/30 correct measured samples after five warm-ups;
- the foreground sentinel proves the target was not brought forward by background delivery;
- old refs and snapshots fail after reconnect;
- no fatal diagnostic is emitted;
- cleanup reports no owned windows left behind.

The three redacted artifacts remain external development evidence. They do not alter `release_eligible` or satisfy Beta promotion.

### 4.2 Bounded Runtime startup coordinator

The MCP entrypoint currently fails immediately when the installed Cua daemon is not already serving. Add a macOS-only coordinator at the engine-connection seam:

1. Attempt the existing locked engine connection once.
2. If it succeeds, continue immediately without starting another app instance.
3. If and only if it returns `runtime_unavailable`, verify that `/Applications/CuaDriver.app` exists and passes the same locked signature checks used by setup.
4. Start the verified app with `/usr/bin/open -g` and its `serve` argument.
5. Poll connection readiness with bounded backoff and stop as soon as the first connection succeeds. Target readiness is at most 2 seconds; the hard deadline is 10 seconds.
6. If the app is missing, its signature does not match the promoted lock fields, permissions are missing, or the deadline expires, fail closed with the existing stable error vocabulary and recovery instruction.

This coordinator performs no GUI action and does not retry an Agent tool call. It only makes an already-installed verified Runtime available before the MCP server exposes tools. Windows continues to use the upstream autostart mechanism and is not changed here.

### 4.3 Direct named-host development checks

Test HanaAgent, WorkBuddy, and Codex in newly started host conversations after MCP registration. A server registered during an already-running conversation must not count because several hosts freeze their tool inventory at conversation start.

For every host:

- use the exact generated absolute Node and MCP script paths;
- load the canonical Computer Use Skill;
- confirm the visible tool inventory is exactly the two UCU tools;
- record the exact host version and host-reported model identifier;
- run Calculator `37 × 19 = 703` and a TextEdit one-use-sentence task with the same model;
- prove that an initial and later PNG reach that model, repeated tool calls continue, and the Agent stops naturally after visual confirmation;
- keep host approval behavior truthful and do not disable host safety policy to manufacture a pass;
- reject shell-driven JSON-RPC, AppleScript input, built-in computer tools, or a bridge process as direct-host evidence.

Each result is written outside the repository using `development-evidence.schema.json` and validated by the existing contract test. A development result may be `development-passed`, `failed`, `blocked`, or `not-run`; it never changes the production compatibility table.

At least two of the three hosts must produce `development-passed` before creating the preview artifact. All three must be attempted or have a concrete external blocker recorded.

### 4.4 Installation and recovery guidance

Keep host configuration explicit. Do not silently edit host settings until a named version and configuration format have been directly verified.

The preview flow is:

```bash
npm install --global <preview-tarball-or-prerelease>
computer-use setup --development
computer-use doctor --json
computer-use config --client <verified-client-or-generic>
```

Improve CLI and documentation so the user receives one next action for each failure:

- `runtime_missing`: run development setup;
- `runtime_unavailable`: restart the host after the coordinator or run doctor;
- `permission_required`: open the correct macOS Privacy & Security pages, grant CuaDriver, then restart CuaDriver and the host;
- `engine_version_mismatch`: reinstall the exact locked version;
- `interactive_session_required`: unlock the foreground login session;
- host tool inventory missing: restart the host and start a new conversation;
- host image forwarding missing: mark the host blocked or incompatible instead of adding a plugin-side vision model.

The documentation must say plainly that CuaDriver remains visible in macOS permission settings and that the plugin cannot remove the password or authorization step.

### 4.5 Preview artifact

Create a `0.2.4` preview artifact only after Sections 4.1–4.4 pass. The artifact may be a locally shareable npm tarball or an explicitly labeled npm/GitHub prerelease. Ordinary release setup remains blocked; preview users must invoke `setup --development`.

The package inspection gate must continue to reject native Cua binaries, Rust source, `.env` files, screenshots, private evidence, trace files, model SDKs, and credentials. Release notes must include the exact locked Cua version, macOS requirements, two permission requirements, supported hosts with development status, and known limitations.

Publishing an external prerelease is a separate explicit release action. Passing this design's tests prepares the artifact but does not authorize publication by itself.

## 5. Architecture and data flow

```text
Host starts local stdio MCP
        ↓
load exact engine lock
        ↓
connect to installed Cua Runtime once
        ↓ runtime_unavailable on macOS only
verify installed CuaDriver signature → start serve → bounded readiness poll
        ↓
create the existing UCU Runtime and expose exactly two MCP tools
        ↓
Host model performs observe → one action → returned fresh state → stop
```

The coordinator lives outside `ComputerUseRuntime`. Snapshot state is created only after connection succeeds, so a startup attempt cannot consume, replay, or mutate a snapshot. Existing runtime health behavior after session creation remains unchanged.

## 6. Error handling

- Only `runtime_unavailable` can trigger a startup attempt.
- `runtime_missing`, signature mismatch, engine mismatch, permission failure, and interactive-session failure return immediately with no fallback executable or moving download URL.
- Startup polling is readiness polling, not an arbitrary sleep. Every poll first checks whether the Runtime is ready and exits immediately on success.
- Only one startup attempt is allowed per MCP process. Concurrent requests cannot spawn multiple CuaDriver instances because tools are exposed only after startup completes.
- If Cua becomes unhealthy after tools are exposed, preserve the current `engine_unhealthy` behavior. Do not restart the engine during an action or replay the action.
- Host registration or image-forwarding failures remain host compatibility results, not engine failures.

## 7. Testing strategy

### Deterministic tests

- startup coordinator does nothing when the first connection succeeds;
- only `runtime_unavailable` enters the start path;
- missing app and signature mismatch fail closed;
- readiness succeeds on the first available poll and does not wait for the deadline;
- deadline expiry maps to `runtime_unavailable` with a stable recovery instruction;
- concurrent entry is single-flight;
- no observe or act payload is stored or replayed by the coordinator;
- Windows never invokes the macOS coordinator;
- package contents and the public two-tool schema are unchanged.

### Real macOS tests

- daemon already running cold host start;
- installed daemon stopped, then automatic verified start;
- missing Screen Recording or Accessibility returns an actionable error;
- three consecutive clean-account development acceptance runs;
- direct HanaAgent, WorkBuddy, and Codex development runs;
- package install, setup, doctor, configuration generation, host restart, both fixed tasks, and uninstall.

## 8. Success criteria

The phase is complete only when:

1. `pnpm test`, `pnpm typecheck`, build, and `npm pack --dry-run --json` pass.
2. Three clean-account macOS acceptance artifacts pass completely.
3. A stopped but installed CuaDriver becomes ready through the coordinator within the 10-second hard deadline without a fixed sleep.
4. At least two named hosts pass both fixed tasks directly, without a bridge.
5. The preview package installs and uninstalls without including or modifying native Cua code.
6. No public MCP schema, snapshot invariant, privacy boundary, or release gate is weakened.
7. Normal `computer-use setup` and Beta verification still fail with `engine_not_release_eligible` until formal promotion evidence exists.

## 9. Explicitly deferred

- Cua engine release promotion and public Beta publication;
- Kimi direct-host evidence;
- Windows real hardware, DPI, exact-window, and UIA work;
- multi-display addressing;
- Browser/CDP routing;
- clipboard, rich-text, upload, and download workflows;
- screenshot deltas or new image codecs;
- arbitrary action batching;
- a proprietary native Runtime, CuaDriver rebranding, or permission-identity replacement.

