# WorkBuddy Mac Agent Preview acceptance runbook

This is a manual, privacy-safe development check, not release evidence. WorkBuddy remains experimental and not tested until one exact-build report passes this contract.

## Exact build and manual registration

Run this host alone. Testing is serial: no other Agent may execute UCU actions on the same desktop until this run ends.

Set `UCU_TEST_COMMIT` to the 40-character lowercase commit supplied by the external test prompt. A branch, tag, short SHA, uppercase SHA, or moving `main` reference is invalid. Use a fresh checkout:

```bash
git clone https://github.com/Nico0713520/universal-computer-use ucu-workbuddy-preview
cd ucu-workbuddy-preview
git checkout --detach "$UCU_TEST_COMMIT"
test "$(git rev-parse HEAD)" = "$UCU_TEST_COMMIT"
cd product
npx --yes pnpm@9.0.4 install --frozen-lockfile
npx --yes pnpm@9.0.4 build
node dist/cli/main.js setup --development
node dist/cli/main.js doctor --json
node dist/cli/main.js config --client workbuddy
```

Stop on any failure. macOS Screen Recording and Accessibility authorization must be granted manually. Copy the generated absolute Node and MCP entrypoint into WorkBuddy's local direct stdio configuration; the command does not edit host settings. Do not install `integrations/workbuddy/mcp.example.json` as a live config. Restart WorkBuddy and start a new conversation. Confirm the server name is `computer-use` and the complete public tool inventory is exactly `computer_observe` and `computer_act`.

Record the exact WorkBuddy version and exact host-reported model identifier. Record the observed host approval/automatic-mode behavior without changing host policy. The plugin confirmation count must be zero for a passing result.

## Direct loop and three tasks

The same host-reported model must receive the first PNG and second PNG in one direct stdio loop and continue repeated tool calls from fresh state.

1. `calculator`: use only UCU to operate Calculator, visibly prove `37 × 19` and `703`, then make a natural stop.
2. `unique_input`: write the test-flow value once in the UCU-owned native text Fixture. The independent oracle must prove the complete value and `write_count: 1`. Do not retain the nonce; report only `exact_value_confirmed:true` and `nonce_recorded:false`, then make a natural stop.
3. `covered_window`: while another application covers the UCU Fixture, prove one semantic background effect and one pixel-window effect against its canvas. A passing record requires the target to remain background and `foreground_fallback:not-needed`, then a natural stop. If foreground fallback is required, record it as `reported` in a truthful failed or blocked record.

Using any shell bridge, shell-driven JSON-RPC, AppleScript, DOM automation, mental arithmetic instead of the Calculator GUI, or host built-in Computer Use invalidates the result. Diagnostic use of any of these cannot be converted into evidence.

## Privacy-safe v2 report

Write one external JSON file conforming to `development-evidence.schema.json`. It must say `schema_version: 2`, identify the exact repository/commit and versions `0.2.8` / `1.2.0` / `0.22.2`, and record `direct_stdio:true`, `shell_bridge:false`, and `builtin_computer_use:false`. Use `verified-development` only when both PNG turns, the same model/direct loop, all three tasks, exactly-once input, background proof, and natural stop pass. Otherwise use `failed`, `blocked`, or `not-run`.

Return only the privacy-safe v2 JSON report. Do not return or store screenshots, prompts, nonces, tool arguments, clipboard contents, raw image payloads, typed content, paths, environment data, identities, native IDs, refs, or tokens. Limitations must use only the schema's allowlisted categories.

For field structure only, see `tests/fixtures/host-development-evidence-v2.synthetic.json`. That file is synthetic and inert and cannot be submitted as external evidence. A real host report must set `evidence_origin: external-run`, remain outside this repository, and use `non_pass_signal: none` only for `verified-development`; a failed, blocked, or not-run report must select its truthful allowlisted non-pass signal. The structured allowlist reduces accidental disclosure, but the schema is not a DLP system: the external reporter must still never put user content into an identity field or any other field.

Validate the external file from the exact checkout:

```bash
CUA_HOST_DEVELOPMENT_EVIDENCE_FILES=/absolute/private/evidence/workbuddy-v2.json \
  npx --yes pnpm@9.0.4 exec vitest run tests/contract/host-development-evidence.test.ts
```

This record cannot satisfy release verification or change the production compatibility table.
