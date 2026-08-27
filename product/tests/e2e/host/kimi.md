# Kimi host acceptance runbook

This is a manual end-to-end acceptance run against a named Kimi version, its host-reported model, and an already release-eligible Cua Runtime. It creates no repository evidence. Keep the completed JSON and its referenced platform evidence together outside this repository.

## Preconditions

1. Use an unlocked, interactive macOS or Windows desktop that has already passed the applicable Task 11 or Task 12 candidate lane and whose exact engine lock is now `release_eligible:true`.
2. Build the package, run `computer-use doctor --json`, and stop if the installed engine version or permissions do not pass.
3. Install the canonical `skills/computer-use/SKILL.md`. Run `computer-use config --client kimi`, register the printed absolute Node and MCP script paths, then restart Kimi.
4. Record the exact Kimi version and the model identifier reported by Kimi. Do not infer or rename the model.
5. In Kimi's tool view, confirm the complete list is exactly `computer_observe` and `computer_act`.

## Identical host tasks

Generate a one-use sentence at run time. Give it to Kimi for this run only; do not paste the sentence into this runbook, logs, screenshots, or evidence.

1. Text task: ask Kimi to use visible keyboard interaction to open TextEdit on macOS or Notepad on Windows, type the one-use sentence, visually confirm it, and stop. Verify the first PNG and the PNG after a later action both reach the same host-reported model. Verify the application was opened through visible keyboard actions, not a shell or filesystem shortcut.
2. Calculator task: reset to a clean visible desktop, then ask Kimi to use visible keyboard interaction to open Calculator, calculate `37 × 19`, visually confirm `703`, report that result, and stop.

For both tasks, verify repeated tool calls continue after the second image and cease when the visible goal is satisfied. The plugin must display no confirmation of its own. Any host approval or block remains a Kimi policy decision and must be recorded as observed; never weaken the host setting to manufacture a pass.

## Record external evidence

Create one JSON file outside this repository using `evidence.schema.json`. Record only the allowlisted fields: exact host/version/model identifier, exact OS and engine version, the relative platform-evidence reference plus SHA-256, exact tool list, boolean delivery/loop results, structured automatic-mode observation, structured task results, natural stop, UTC timestamp, and reviewer ID.

Never record screenshot bytes or paths, prompts, the typed sentence, clipboard content, secrets, environment dumps, tool arguments, usernames, or hostnames. A `verified` record is valid only after the referenced platform evidence is release-eligible and both tasks pass completely. Otherwise use the truthful non-verified status and leave `docs/host-compatibility.md` unchanged.

To exercise the repository validator, keep the host JSON and referenced relative platform JSON in one private evidence bundle and run:

```bash
CUA_HOST_EVIDENCE_FILES=/absolute/private/evidence/kimi.json \
  npx --yes pnpm@9.0.4 exec vitest run tests/contract/host-evidence.test.ts
```

This validation does not itself promote the compatibility table; Task 15 must also validate the same external file during release verification.
