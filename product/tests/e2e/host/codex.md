# Codex host acceptance runbook

This is a manual end-to-end acceptance run against a named Codex version, its host-reported model, and an already release-eligible Cua Runtime. It creates no repository evidence. Keep the completed JSON and its referenced platform evidence together outside this repository.

## Preconditions

1. Use an unlocked, interactive macOS or Windows desktop that has already passed the applicable Task 11 or Task 12 candidate lane and whose exact engine lock is now `release_eligible:true`.
2. Build the package, run `computer-use doctor --json`, and stop if the installed engine version or permissions do not pass.
3. Install the canonical `skills/computer-use/SKILL.md`. Run `computer-use config --client codex`, register the printed absolute Node and MCP script paths, then restart Codex.
4. Record the exact Codex version and the model identifier reported by Codex. Do not infer or rename the model.
5. In Codex's tool view, confirm the complete list is exactly `computer_observe` and `computer_act`.

## Identical host tasks

Generate a one-use sentence at run time. Give it to Codex for this run only; do not paste the sentence into this runbook, logs, screenshots, or evidence.

1. Text task: ask Codex to use visible keyboard interaction to open TextEdit on macOS or Notepad on Windows, type the one-use sentence, visually confirm it, and stop. Verify the first PNG and the PNG after a later action both reach the same host-reported model. Verify the application was opened through visible keyboard actions, not a shell or filesystem shortcut.
2. Calculator task: reset to a clean visible desktop, then ask Codex to use visible keyboard interaction to open Calculator, calculate `37 × 19`, visually confirm `703`, report that result, and stop.

For both tasks, verify repeated tool calls continue after the second image and cease when the visible goal is satisfied. The plugin must display no confirmation of its own. Any host approval or block remains a Codex policy decision and must be recorded as observed; never weaken the host setting to manufacture a pass.

## Record external evidence

Create one JSON file outside this repository using `evidence.schema.json`. Record only the allowlisted fields: exact host/version/model identifier, exact OS and engine version, the relative platform-evidence reference plus SHA-256, exact tool list, boolean delivery/loop results, structured automatic-mode observation, structured task results, natural stop, UTC timestamp, and reviewer ID.

Never record screenshot bytes or paths, prompts, the typed sentence, clipboard content, secrets, environment dumps, tool arguments, usernames, or hostnames. A `verified` record is valid only after the referenced platform evidence is release-eligible and both tasks pass completely. Otherwise use the truthful non-verified status and leave `docs/host-compatibility.md` unchanged.

To exercise the repository validator, keep the host JSON and referenced relative platform JSON in one private evidence bundle and run:

```bash
CUA_HOST_EVIDENCE_FILES=/absolute/private/evidence/codex.json \
  npx --yes pnpm@9.0.4 exec vitest run tests/contract/host-evidence.test.ts
```

This validation does not itself promote the compatibility table; Task 15 must also validate the same external file during release verification.

## v0.2.8 Mac Agent Preview acceptance (macOS only)

This development lane is separate from the release lane above. It is privacy-safe external evidence and cannot establish release eligibility.

Run this host alone. Testing is serial: no other Agent may execute UCU actions on the same desktop until this run ends.

Set `UCU_TEST_COMMIT` to the 40-character lowercase commit supplied by the external test prompt. A branch, tag, short SHA, uppercase SHA, or moving `main` reference is invalid. Use a fresh checkout:

```bash
git clone https://github.com/Nico0713520/universal-computer-use ucu-codex-preview
cd ucu-codex-preview
git checkout --detach "$UCU_TEST_COMMIT"
test "$(git rev-parse HEAD)" = "$UCU_TEST_COMMIT"
cd product
npx --yes pnpm@9.0.4 install --frozen-lockfile
npx --yes pnpm@9.0.4 build
node dist/cli/main.js setup --development
node dist/cli/main.js doctor --json
node dist/cli/main.js config --client codex
```

Stop on any failure. macOS Screen Recording and Accessibility authorization must be granted manually. Execute the generated Codex registration command, which pins the absolute Node and MCP entrypoint for direct stdio. Restart Codex and start a new conversation. Confirm the server name is `computer-use` and the complete public tool inventory is exactly `computer_observe` and `computer_act`.

Record the exact Codex version and exact host-reported model identifier. Record the observed host approval/automatic-mode behavior without changing host policy. The plugin confirmation count must be zero for a passing result.

The same host-reported model must receive the first PNG and second PNG in one direct stdio loop and continue repeated tool calls from fresh state.

1. `calculator`: use only UCU to operate Calculator, visibly prove `37 × 19` and `703`, then make a natural stop.
2. `unique_input`: write the test-flow value once in the UCU-owned native text Fixture. The independent oracle must prove the complete value and `write_count: 1`. Do not retain the nonce; report only `exact_value_confirmed:true` and `nonce_recorded:false`, then make a natural stop.
3. `covered_window`: while another application covers the UCU Fixture, prove one semantic background effect and one pixel-window effect against its canvas. A passing record requires the target to remain background and `foreground_fallback:not-needed`, then a natural stop. If foreground fallback is required, record it as `reported` in a truthful failed or blocked record.

Using any shell bridge, shell-driven JSON-RPC, AppleScript, DOM automation, mental arithmetic instead of the Calculator GUI, or host built-in Computer Use invalidates the result. Diagnostic use of any of these cannot be converted into evidence.

Write one external JSON file conforming to `development-evidence.schema.json`. It must say `schema_version: 2`, identify the exact repository/commit and versions `0.2.8` / `1.2.0` / `0.22.2`, and record `direct_stdio:true`, `shell_bridge:false`, and `builtin_computer_use:false`. Use `verified-development` only when both PNG turns, the same model/direct loop, all three tasks, exactly-once input, background proof, and natural stop pass. Otherwise use `failed`, `blocked`, or `not-run`.

Return only the privacy-safe v2 JSON report. Do not return or store screenshots, prompts, nonces, tool arguments, clipboard contents, raw image payloads, typed content, paths, environment data, identities, native IDs, refs, or tokens. Limitations must use only the schema's allowlisted categories.

For field structure only, see `tests/fixtures/host-development-evidence-v2.synthetic.json`. That file is synthetic and inert and cannot be submitted as external evidence. A real host report must set `evidence_origin: external-run`, remain outside this repository, and use `non_pass_signal: none` only for `verified-development`; a failed, blocked, or not-run report must select its truthful allowlisted non-pass signal. The structured allowlist reduces accidental disclosure, but the schema is not a DLP system: the external reporter must still never put user content into an identity field or any other field.

Validate the external file from the exact checkout:

```bash
CUA_HOST_DEVELOPMENT_EVIDENCE_FILES=/absolute/private/evidence/codex-v2.json \
  npx --yes pnpm@9.0.4 exec vitest run tests/contract/host-development-evidence.test.ts
```

This development record cannot satisfy release verification or change the production compatibility table.
