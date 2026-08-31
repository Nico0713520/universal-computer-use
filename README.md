# Universal Computer Use

> Mac Agent Preview (Developer Preview), version 0.2.6. This is not a public Beta or Stable package release.

Universal Computer Use is a lightweight, model-free MCP plugin that gives an existing multimodal Agent the ability to observe and operate the current macOS or Windows desktop.

The host Agent remains the brain: it receives screenshots, decides the next action, and determines when the task is complete. This project provides the two-tool protocol, screenshot-bound state machine, validation, lifecycle management, and a locked adapter to the separately installed Cua Driver runtime.

## Why this exists

Many Agents can reason and see images but cannot interact with local applications or workflows that have no usable API. This project adds that missing execution layer without requiring a second vision model, model endpoint, or API key. It uses the host Agent's current multimodal capability and does not include an internal vision model.

## Architecture

```text
Natural-language task
        ↓
Host Agent + its current multimodal model
        ↓
Canonical Computer Use Skill
        ↓
direct stdio MCP: computer_observe / computer_act
        ↓
Snapshot guard + FIFO + validation + result normalization
        ↓
Cua Engine adapter
        ↓
Unmodified Cua Driver runtime
        ↓
macOS / Windows desktop
```

The adapter exposes one UCU session to the host but keeps Cua's mutually exclusive desktop- and window-capture scopes in separate internal sessions. Desktop calls stay on the desktop scope; exact window screenshots and background element actions stay on the window scope.

Product `0.2.6` uses protocol `1.2.0` and keeps the public MCP surface at exactly two tools:

- `computer_observe` returns a one-use `snapshot_id` for the desktop or an exact window, with a PNG when a visual frame is requested and bounded elements for window observations.
- `computer_act` validates and consumes that snapshot, executes exactly one action, and returns the fresh target state plus a new snapshot ID.

After a full exact-window frame grounds the task, a confirmed low-risk semantic action may request `next_observation: {"mode":"semantic"}` to avoid another PNG. Unsafe, foreground, failed, refused, unconfirmed, or coordinate-based paths return `observation_mode:"visual_recovery"` so the Agent inspects current pixels instead of blindly repeating the action. Semantic snapshots retain one-use snapshot protection and may address elements, never coordinates.

Supported actions are click, double-click, right-click, move, drag, scroll, set value, type, keypress/hotkey, menu invocation, application launch, and explicit wait. The plugin does not contain a model, planner, OCR system, GUI, per-action approval dialog, or native input implementation.

## Run from source

Requirements: Node.js 22.19 or newer, macOS 14+ or Windows 10 1903+/11 x64, an unlocked interactive desktop, and a host that supports local stdio MCP plus MCP image content.

```bash
cd product
npx --yes pnpm@9.0.4 install --frozen-lockfile --ignore-scripts
npx --yes pnpm@9.0.4 build
node dist/cli/main.js setup --development
node dist/cli/main.js doctor
node dist/cli/main.js doctor --json
node dist/cli/main.js config --client generic
```

Development setup installs only the exact checksummed scripts and Cua Runtime version pinned in [`product/engine.lock.json`](product/engine.lock.json). macOS still requires the user to grant Screen Recording and Accessibility to the signed CuaDriver application. The human `doctor` output explains readiness; `doctor --json` preserves the machine-readable report. Permission status is accepted only from the signed daemon identity or remains unknown. Host approval policy remains authoritative.

The npm package name is reserved in the project metadata but is not published yet. Ordinary `setup`, Beta verification, and Stable verification deliberately fail closed until the engine, platform, host-loop, and soak evidence gates are complete.

To share the explicit 0.2.6 Developer Preview without publishing it, build a local npm tarball from `product`, install that exact file on the test Mac, and keep the development flag visible:

```bash
cd product
npm pack
npm install --global ./universal-computer-use-plugin-0.2.6.tgz
computer-use setup --development
computer-use doctor
computer-use doctor --json
computer-use config --client generic
```

External npm or GitHub prerelease publication is a separate release action. There is no one-click installer, DMG, or notarized public package. The tarball does not include Cua native binaries and does not make the locked Runtime release-eligible. The separately installed app remains visibly attributed as CuaDriver; this project does not hide or rebrand the macOS permission identity.

## Connect and test a host

Generate an absolute direct-stdio configuration with `config --client generic`, `codex`, `kimi`, `hanaagent`, or `workbuddy`. HanaAgent and WorkBuddy are named manual configuration paths, not auto-installers. Follow the single [Canonical Computer Use Skill](product/skills/computer-use/SKILL.md), register the generated configuration manually, then restart the selected host and start a new conversation so its tool inventory can discover exactly two tools.

After one exact public commit has been pushed, generate a privacy-safe external test handoff with the silent renderer:

```bash
cd product
pnpm --silent host:test-prompt --host hanaagent \
  --repo https://github.com/Nico0713520/universal-computer-use \
  --commit <40-lowercase-hex-commit>
```

Run one host at a time. Multi-Agent concurrent control is deferred until after the single-host Preview is stable; concurrent Agents can otherwise compete for the same foreground desktop and snapshot state.

## Current status

The v0.2.6 Mac Agent Preview completes signed-daemon permission diagnostics, human-readable doctor output, named HanaAgent/WorkBuddy configuration, and exact-commit host-test handoffs on top of the macOS session-owned Agent Cursor integration. Both internal Cua sessions disable visible cursor motion during initialization and read the state back before the MCP server becomes available; partial initialization fails closed and cleans up both sessions. This removes Cua's presentation animation from ordinary UCU automation without adding an artificial post-action delay. It does not make foreground input invisible: an explicitly foreground action can still activate or move focus between applications.

Development evidence now uses schema v4 and records only aggregate action-route counts such as `accessibility` and `synthetic_events`, never screenshots, entered text, raw samples, or window titles. The full macOS lane and the focused performance/A-B lanes refuse to start unless the operator supplies `--exclusive-desktop`. The Cursor A/B tool compares the same target in the same Cua process and session, but no new speed claim is made until that real-machine lane is deliberately run on an idle desktop. Runtime recovery remains bounded to startup before the MCP session exists; UCU never restarts Cua after a session starts and never replays an observation or action.

| Capability | Code | Contract | macOS real | Named host | Release |
|---|---|---|---|---|---|
| Desktop observe/act | complete | passed | current local profiles passed | pending | blocked |
| macOS exact window | complete | passed | current local profiles passed | pending | blocked |
| macOS background semantic action | complete | passed | 3 × 30/30 local | pending | blocked |
| macOS covered-window pixel action | complete | passed | 3 × 30/30 local | pending | blocked |
| Windows desktop | complete | passed | n/a in this lane | pending | blocked |
| Windows DPI | harness complete | passed | pending real hardware | pending | blocked |
| Windows exact window | blocked upstream | truthful refusal | unavailable | unavailable | blocked |

No local profile is a Beta/Stable claim. Codex and HanaAgent remain `not-tested`, while WorkBuddy remains `experimental`, until exact-commit external reports prove direct stdio image delivery and the complete control loop. Kimi is outside the v0.2.6 Mac Agent Preview host set and retains its separate unevidenced release lane. The complete macOS lane must still be rerun on a clean account. Windows still needs physical 100%/125%/150% DPI runs, and the pinned Cua 0.22.2 Windows window APIs remain upstream stubs. Lock screen, disconnected sessions, and Windows UAC secure desktop remain unsupported.

## Documentation

- [Architecture specification](docs/superpowers/specs/2026-08-27-cross-platform-computer-use-plugin-design.md)
- [Implementation plan](docs/superpowers/plans/2026-08-27-cross-platform-computer-use-plugin-implementation.md)
- [macOS installation](docs/installation/macos.md)
- [Windows installation](docs/installation/windows.md)
- [Host compatibility](docs/host-compatibility.md)
- [macOS development acceptance](product/tests/e2e/development/README.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Reviewed upstream sources](docs/upstream-sources.md)
- [Canonical Computer Use Skill](product/skills/computer-use/SKILL.md)

## Design principles

- Use the host Agent's current multimodal model.
- Keep the public interface small and portable.
- Bind every action to the latest visual or semantic snapshot.
- Execute one action at a time and never blindly retry input.
- Reuse mature native execution instead of copying platform code.
- Treat compatibility as evidence, not a README claim.

## License

The project is licensed under the MIT License. Cua Driver and other dependencies remain separately licensed; see [`product/THIRD_PARTY_NOTICES.md`](product/THIRD_PARTY_NOTICES.md).
