# macOS development acceptance

This source-only lane proves the current developer preview through the two public MCP tools on one real Mac. It does not create release evidence and cannot unlock Beta or Stable.

## Requirements

- macOS 14 or newer with an unlocked interactive desktop.
- Node.js 22.19 or newer and Google Chrome.
- The exact Cua Driver version locked by `engine.lock.json`, installed as its stable signed application identity.
- Screen Recording and Accessibility granted to Cua Driver. Successful `computer-use doctor --json` capture is the preflight proof.
- No other agent or person competing for the same desktop while the deterministic fixture runs.

The command never restarts or stops a shared Cua daemon. It starts only an isolated browser profile, a loopback fixture, and its own stdio MCP process, then removes those resources.

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

The runner refuses relative paths and existing files. Evidence contains only versions, nine scenario booleans, seven bounded timings, cleanup state, architecture and UTC time. It contains no screenshot, title, typed text, path, user/host identity, environment dump, PID, window ID, snapshot, ref, or native token.

A timing over its target but within the hard limit produces `status:"degraded"`; exceeding a hard limit fails the run. A passed or degraded development record proves this checkout on this Mac only. Named-host image delivery and natural stopping still require the separate Codex/Kimi/HanaAgent/WorkBuddy runbooks, and public release remains blocked by the existing candidate, Windows DPI, host-loop and soak gates.
