# macOS development acceptance

This source-only lane proves the current developer preview through the two public MCP tools on one real Mac. It does not create release evidence and cannot unlock Beta or Stable.

## Requirements

- macOS 14 or newer with an unlocked interactive desktop. The runner rejects the macOS login window before starting owned GUI resources.
- Node.js 22.19 or newer and Google Chrome.
- The exact Cua Driver version locked by `engine.lock.json`, installed as its stable signed application identity.
- Screen Recording and Accessibility granted to Cua Driver. Successful `computer-use doctor --json` capture is the preflight proof.
- No other agent or person competing for the same desktop while the deterministic fixture runs.

The command never restarts or stops a shared Cua daemon. It starts only an isolated browser profile, a loopback fixture, one ad-hoc-signed AppKit focus sentinel with an owned native text field, and its own stdio MCP process. The native field—not an untrusted browser AX echo—provides the exact semantic `set_value`/one-write oracle. Calculator is re-observed on the exact operated window, restored with AC, and verified at zero. TextEdit is modified and closed only after a one-new-window ref-set proof; cleanup always re-observes that exact owned ref, closes it, handles only its own save sheet, and proves the ref disappeared. Cua 0.22.2 omits empty AX values, so cleanup never fabricates an empty readback. Pre-existing user documents are never edited or closed. A real-app cleanup failure is reported separately as `real_app_smoke.cleanup_failed:true` without overwriting an earlier locale/application error code.

## Run

```bash
cd product
npx --yes pnpm@9.0.4 acceptance:macos
```

By default the command creates a new private temporary directory and prints the absolute evidence path in its one-line JSON summary. To select a new external path explicitly:

```bash
npx --yes pnpm@9.0.4 acceptance:macos -- \
  --evidence /absolute/private/path/macos-development.json
```

The runner refuses relative paths and existing evidence or diagnostic files. Schema-version-3 evidence contains only versions, nine legacy correctness booleans, six explicit adaptive-correctness booleans, seven bounded legacy timings, four fixed correctness-aware performance aggregates, three real-application smoke booleans, cleanup state, architecture and UTC time. Each profile records exact correct/failed counts, a closed failure classification, latency and correctness status, and redacted per-stage aggregates; it never records raw samples. The adaptive block records the production-and-Canonical-Skill fixed-delay scan, semantic sequence, exactly-once pixel/input effects, visual recovery and native focus preservation as separate proofs. It contains no screenshot, title, typed text, raw samples, path, user/host identity, environment dump, PID, window ID, snapshot, ref, or native token.

After dependencies are installed, the acceptance launcher uses only the checkout-local build and Vitest binaries; it does not contact the package registry during the measured run. A fatal failure that prevents complete evidence writes `<evidence-path>.diagnostic.json` only after owned-resource cleanup. That sibling file contains a closed phase, scenario/sample position, stable error code, owned-process booleans and UTC time—never raw child output, stack traces, paths, application text or identifiers. The launcher prints its path and exits nonzero; it never treats the diagnostic as acceptance evidence or reruns the failed sample.

Each performance profile performs five unrecorded warm-ups followed by exactly 30 measured calls. Reset, discovery, initial snapshot creation and external-oracle polling stay outside the timed interval. Durations use the external MCP wall clock and nearest-rank p50/p95; existing redacted runtime metadata also separates queue, engine execution, post-action observation, projection and transport overhead where applicable:

| Profile | p50 gate | p95 gate |
|---|---:|---:|
| exact-window visual observe | 700 ms | 1,500 ms |
| exact-window semantic observe | 400 ms | 1,000 ms |
| background `set_value` + semantic next state | 1,500 ms | 2,000 ms |
| foreground pixel action + visual next state | 1,500 ms | 3,000 ms |

There is no universal post-action sleep. The evidence includes the result of a static scan over `product/src/**` and the Canonical Skill; fixture synchronization uses only bounded external-oracle polling, and failures are never deleted or rerun as replacement samples.

A legacy timing over its target but within the hard limit produces `status:"degraded"`. Any false correctness result, failed performance profile, failed Calculator/TextEdit smoke, or hard legacy timing produces a schema-valid `status:"failed"` artifact and a nonzero launcher exit. The launcher retains and prints the failed evidence path. A passed or degraded development record proves this checkout on this Mac only. Named-host image delivery and natural stopping still require the separate Codex/Kimi/HanaAgent/WorkBuddy runbooks, and public release remains blocked by the Windows DPI, named-host, installer and soak gates.
