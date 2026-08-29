# Universal Computer Use

> Experimental developer preview. The core MCP implementation is complete, but the project is not yet eligible for a public Beta or Stable package release.

Universal Computer Use is a lightweight, model-free MCP plugin that gives an existing multimodal Agent the ability to observe and operate the current macOS or Windows desktop.

The host Agent remains the brain: it receives screenshots, decides the next action, and determines when the task is complete. This project provides the two-tool protocol, screenshot-bound state machine, validation, lifecycle management, and a locked adapter to the separately installed Cua Driver runtime.

## Why this exists

Many Agents can reason and see images but cannot interact with local applications or workflows that have no usable API. This project adds that missing execution layer without requiring a second vision model, model endpoint, or API key.

## Architecture

```text
Natural-language task
        ↓
Host Agent + its current multimodal model
        ↓
Canonical Computer Use Skill
        ↓
stdio MCP: computer_observe / computer_act
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

The public MCP surface contains exactly two tools:

- `computer_observe` captures the primary display and returns a PNG with a one-use `snapshot_id`.
- `computer_act` validates and consumes that snapshot, executes exactly one action, and returns a fresh screenshot and snapshot ID.

Supported v1 actions are click, double-click, right-click, move, drag, scroll, type, keypress/hotkey, and wait. The plugin does not contain a model, planner, OCR system, GUI, per-action approval dialog, or native input implementation.

## Run from source

Requirements: Node.js 22.19 or newer, macOS 14+ or Windows 10 1903+/11 x64, an unlocked interactive desktop, and a host that supports local stdio MCP plus MCP image content.

```bash
cd product
npx --yes pnpm@9.0.4 install --frozen-lockfile --ignore-scripts
npx --yes pnpm@9.0.4 build
node dist/cli/main.js setup --development
node dist/cli/main.js doctor --json
node dist/cli/main.js config --client generic
```

Development setup installs only the exact checksummed scripts and Cua Runtime version pinned in [`product/engine.lock.json`](product/engine.lock.json). macOS still requires the user to grant Screen Recording and Accessibility to the signed Cua Driver application. Host approval policy remains authoritative.

The npm package name is reserved in the project metadata but is not published yet. Ordinary `setup`, Beta verification, and Stable verification deliberately fail closed until the engine, platform, host-loop, and soak evidence gates are complete.

## Current status

The v0.2.1 developer preview has a real macOS acceptance command. On the current arm64 macOS 26.3 test machine it proved the two-tool inventory, desktop and exact-window PNGs, one-use snapshots, background semantic click, foreground pixel fallback, reconnect cleanup, and rejection of old snapshot/window/element refs. Repeated final runs passed with degraded timing because the foreground coordinate action took about 1.25 seconds against a 1-second target while remaining below its 3-second hard limit.

| Capability | Code | Contract | macOS real | Named host | Release |
|---|---|---|---|---|---|
| Desktop observe/act | complete | passed | development-passed | pending | blocked |
| macOS exact window | complete | passed | development-passed | pending | blocked |
| macOS background semantic action | complete | passed | development-passed | pending | blocked |
| Windows desktop | complete | passed | n/a in this lane | pending | blocked |
| Windows DPI | harness complete | passed | pending real hardware | pending | blocked |
| Windows exact window | blocked upstream | truthful refusal | unavailable | unavailable | blocked |

`development-passed` is local developer evidence, not a Beta/Stable claim. Codex, Kimi, HanaAgent and WorkBuddy still need direct named-host image/loop evidence. Windows still needs physical 100%/125%/150% DPI runs, and the pinned Cua 0.22.2 Windows window APIs remain upstream stubs.

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
- Bind every action to the latest visible screenshot.
- Execute one action at a time and never blindly retry input.
- Reuse mature native execution instead of copying platform code.
- Treat compatibility as evidence, not a README claim.

## License

The project is licensed under the MIT License. Cua Driver and other dependencies remain separately licensed; see [`product/THIRD_PARTY_NOTICES.md`](product/THIRD_PARTY_NOTICES.md).
