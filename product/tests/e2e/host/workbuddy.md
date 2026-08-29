# WorkBuddy development-preview acceptance runbook

This is a manual macOS development check, not release evidence. WorkBuddy has no audited UCU-specific config generator, so this runbook uses the generic local stdio configuration and does not claim that UCU installs or modifies WorkBuddy.

## Build, runtime, and registration

From the `product` directory, install dependencies as documented, then run:

```bash
npx --yes pnpm@9.0.4 build
node dist/cli/main.js setup --development
node dist/cli/main.js doctor --json
node dist/cli/main.js config --client generic
```

Stop if build, setup, or doctor fails. Copy the generated generic MCP object into WorkBuddy's local stdio MCP configuration using the printed absolute Node executable and `dist/mcp/main.js` paths. Do not replace either with a relative path. Restart WorkBuddy after registration; an MCP server added during the current conversation may not appear in that conversation's frozen tool list.

After restart, record the exact WorkBuddy version and host-reported model ID. In its tool view, confirm that the complete server inventory is exactly `computer_observe` and `computer_act`. A bridge script or shell-driven JSON-RPC session is useful for diagnosis but does not count as direct named-host evidence.

## Two direct-host tasks

Run both tasks with the same host-reported model:

1. Ask the Agent to discover and lock the Calculator exact window, use exact-window mode, calculate `37 × 19`, visibly confirm `703`, and stop.
2. Generate a one-use sentence at run time. Ask the Agent to open TextEdit and enter it through visible GUI interaction, visually confirm it, and stop. Never store the sentence in evidence.

For the two tasks, confirm the first PNG and a later PNG reached the same host-reported model, repeated tool calls occurred, and the Agent made a natural stop with no tool calls after the visible goal. The plugin confirmation count is zero. Record any WorkBuddy host approval, prompt, or policy block truthfully; do not weaken host policy to force a pass.

## External development evidence

Write one redacted JSON file outside this repository using `development-evidence.schema.json`. Do not record screenshots, the one-use sentence, prompts, paths, environment data, identities, native IDs, refs, or tokens. Validate the external file with:

```bash
CUA_HOST_DEVELOPMENT_EVIDENCE_FILES=/absolute/private/evidence/workbuddy-development.json \
  npx --yes pnpm@9.0.4 exec vitest run tests/contract/host-development-evidence.test.ts
```

`development-passed is not verified` and cannot satisfy release verification. It must not update release evidence, engine eligibility, or the production compatibility table.
