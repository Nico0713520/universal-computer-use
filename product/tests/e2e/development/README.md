# macOS development acceptance

This source-only lane proves the current developer preview through the two public MCP tools on one real Mac. It does not create release evidence and cannot unlock Beta or Stable.

## Requirements

- macOS 14 or newer with an unlocked interactive desktop. The runner rejects the macOS login window before starting owned GUI resources.
- Node.js 22.21–22.x or 24.5+ and Google Chrome.
- The exact Cua Driver version locked by `engine.lock.json`, installed as its stable signed application identity.
- Screen Recording and Accessibility granted to Cua Driver. Successful `computer-use doctor --json` capture is the preflight proof.
- No other agent or person competing for the same desktop while the deterministic fixture runs.

The command never restarts or stops a shared Cua daemon. It starts only an isolated browser profile, a loopback fixture, one ad-hoc-signed AppKit focus sentinel with an owned native text field, and its own stdio MCP process. The native field—not an untrusted browser AX echo—provides the exact semantic `set_value`/one-write oracle. Calculator is re-observed on the exact operated window, its controlled `703` result is verified with the built-in macOS Vision framework, and AC cleanup proves that calibrated result disappeared from the same window. TextEdit setup creates a uniquely named empty file in a private temporary directory and asks LaunchServices to open only that file; discovery and unique-value mutation use the public MCP tools, then cleanup saves that owned temporary document through the exact native menu before closing it. Cua 0.22.2 omits empty AX values, so cleanup never fabricates an empty readback. Pre-existing user documents are never edited or closed, and bounded 50 ms polling exits immediately when the owned title disappears rather than imposing a fixed post-action delay. A real-app cleanup failure is reported separately as `real_app_smoke.cleanup_failed:true` without overwriting an earlier locale/application error code.

## Run

```bash
cd product
npx --yes pnpm@9.0.4 acceptance:macos -- --exclusive-desktop
```

The acknowledgement is mandatory because this development lane may activate its owned Chrome window, focus sentinel, Calculator and TextEdit. It does not mean ordinary MCP background delivery always takes focus. Without the flag the launcher refuses before doctor, build, or GUI setup.

By default the command creates a new private temporary directory and prints the absolute evidence path in its one-line JSON summary. To select a new external path explicitly:

```bash
npx --yes pnpm@9.0.4 acceptance:macos -- \
  --exclusive-desktop \
  --evidence /absolute/private/path/macos-development.json
```

The runner refuses relative paths and existing evidence or diagnostic files. Schema-version-4 evidence contains only versions, nine legacy correctness booleans, six explicit adaptive-correctness booleans, seven bounded legacy timings, four fixed correctness-aware performance aggregates, three real-application smoke booleans, cleanup state, architecture and UTC time. Each profile records exact correct/failed counts, a closed failure classification, latency and correctness status, redacted per-stage aggregates, and closed aggregate action-route counts; it never records raw samples. Observe profiles must record no action routes, while a passing action profile must account for all 30 measured calls. The adaptive block records the production-and-Canonical-Skill fixed-delay scan, semantic sequence, exactly-once pixel/input effects, visual recovery and native focus preservation as separate proofs. It contains no screenshot, title, typed text, raw samples, path, user/host identity, environment dump, PID, window ID, snapshot, ref, or native token.

For a fast diagnosis of one profile without reconnect, Calculator, TextEdit, or the independent correctness phases:

```bash
npx --yes pnpm@9.0.4 acceptance:macos:profile -- \
  --profile pixel_action_next_state \
  --exclusive-desktop
```

The accepted profile names are `window_visual_observe`, `window_semantic_observe`, `semantic_action_next_state`, and `pixel_action_next_state`. The focused lane still performs five warm-ups plus 30 measured calls and writes a separate `computer-use-macos-development-profile` artifact, so it cannot be confused with complete acceptance evidence. Observe and pixel profiles start only the isolated loopback fixture and Chrome; semantic action starts only the owned native focus sentinel. It never opens Calculator or TextEdit.

To isolate the cost of Cua's visible Agent Cursor on the same pixel fallback, use the guarded A/B lane during an agreed idle window:

```bash
npx --yes pnpm@9.0.4 acceptance:macos:cursor-ab -- \
  --exclusive-desktop \
  --evidence /absolute/private/new/cursor-ab.json
```

This test connects once to the locked daemon, creates one private window session, locks one owned canvas point with no accessibility control at the hit location, and runs 5 warm-ups plus 30 measured `synthetic_events` clicks in each mode. It reads back Cursor state before each block and rejects the artifact unless all 60 actions affect the canvas exactly once while daemon PID, session and target remain unchanged. The evidence reports enabled/disabled p50, p95, max and arithmetic differences; it deliberately has no required percentage-improvement threshold. The lane never restarts Cua and never changes another session.

On the current locked Cua 0.22.2 macOS runtime, the required single background left click can be reported as `accessibility` instead of `synthetic_events`, so this A/B remains blocked and fails closed with `route_mismatch` on the tested machine. A double click is not an equivalent sample, and the background right-click implementation emits an extra primer down/up pair; neither may be used to manufacture passing evidence. This limitation does not change the ordinary four profile or real-app acceptance results, but it prevents a Cursor-specific latency claim.

After dependencies are installed, the acceptance launcher uses only the checkout-local build and Vitest binaries; it does not contact the package registry during the measured run. A fatal Cursor A/B failure that prevents complete evidence writes `<evidence-path>.diagnostic.json` only after owned-resource cleanup. That strict sibling contains only its schema/type/status, a closed phase, a closed error code, cleanup result, UTC time and—only for `route_mismatch`—one closed observed route—never raw child output, stack traces, paths, application text or identifiers. The launcher validates and preserves that sibling, emits only `cursor_ab_failed:<closed_error_code>`, and never treats the diagnostic as acceptance evidence or reruns the failed sample.

Each performance profile performs five unrecorded warm-ups followed by exactly 30 measured calls. Reset, discovery, initial snapshot creation and external-oracle polling stay outside the timed interval. Durations use the external MCP wall clock and nearest-rank p50/p95; existing redacted runtime metadata also separates queue, engine execution, post-action observation, projection and transport overhead where applicable:

| Profile | Correctness gate | p50 gate | p95 gate |
|---|---:|---:|---:|
| exact-window visual observe | 30/30 | 700 ms | 1,500 ms |
| exact-window semantic observe | 30/30 | 400 ms | 1,000 ms |
| background `set_value` + semantic next state | 30/30 | 1,500 ms | 2,000 ms |
| background pixel action + visual next state | 30/30 | 1,500 ms | 3,000 ms |

The background pixel profile deliberately does not activate the fixture app during preparation. It proves PID/window-routed input while another app may remain frontmost. Any missed action, tool error, contract mismatch, target loss, fixture failure or telemetry gap fails the profile; the harness never retries a measured action.

There is no universal post-action sleep. The evidence includes the result of a static scan over `product/src/**` and the Canonical Skill; fixture synchronization uses only bounded external-oracle polling, and failures are never deleted or rerun as replacement samples.

A legacy timing over its target but within the hard limit produces `status:"degraded"`. Any false correctness result, failed performance profile, failed Calculator/TextEdit smoke, or hard legacy timing produces a schema-valid `status:"failed"` artifact and a nonzero launcher exit. The launcher retains and prints the failed evidence path. A passed or degraded development record proves this checkout on this Mac only. Named-host image delivery and natural stopping still require the separate Codex/Kimi/HanaAgent/WorkBuddy runbooks, and public release remains blocked by the Windows DPI, named-host, installer and soak gates.
