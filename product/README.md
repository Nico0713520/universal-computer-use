# Universal Computer Use Plugin

A lightweight local MCP bridge that lets a compatible multimodal agent observe and operate the current desktop. The host agent supplies the vision model and decision loop; product `0.2.5` and protocol `1.2.0` supply the validation, lifecycle, and execution bridge.

Cua Driver is a separate MIT-licensed runtime dependency. Its Rust and native platform code are not bundled as product source, modified, or re-signed by this project. The exact reviewed runtime and installer artifacts are pinned in `engine.lock.json`.

The MCP surface contains exactly two tools:

- `computer_observe` captures the main display, can discover opaque app/window targets, and on macOS can return an exact window PNG plus bounded Accessibility elements.
- `computer_act` validates one action against that one-use snapshot, prefers precise element handles, supports explicit background/foreground window delivery, verifies bounded postconditions, and returns the fresh target state without a redundant observe call.

After one full exact-window screenshot, a confirmed low-risk semantic action can request `next_observation: {"mode":"semantic"}` and continue from bounded elements without another PNG. Coordinate, foreground, failed, refused, unconfirmed, and otherwise unsafe paths instead return `observation_mode:"visual_recovery"`; the Agent must inspect that visual state and must not replay the action automatically. A semantic snapshot cannot authorize coordinates.

The plugin has no model, provider endpoint, API key, internal planner, OCR service, per-action dialog, or GUI. Host approval and safety policy still apply.

## Run from source

Requirements: macOS 14+ or Windows 10 1903+/11 x64, Node.js 22.19 or newer, an unlocked interactive desktop, and a host Agent that forwards MCP image content to its multimodal model.

```bash
cd product
npx --yes pnpm@9.0.4 install --frozen-lockfile --ignore-scripts
npx --yes pnpm@9.0.4 build
node dist/cli/main.js setup --development
node dist/cli/main.js doctor --json
node dist/cli/main.js config --client generic
```

`setup --development` downloads the exact verified upstream installer siblings pinned in `engine.lock.json`, runs the locked install path, verifies the installed identity, starts the runtime, and opens the operating-system permission flow. On macOS, grant Screen Recording and Accessibility to the stable `CuaDriver.app` identity. The final command prints the stdio MCP configuration to add to the Agent host.

Use `config --client codex` or `config --client kimi` for the documented host-specific status and configuration. WorkBuddy and DeepSeek Harness adapters are included as experimental declarations; they are not represented as verified integrations.

## Local developer-preview package

The npm name is reserved but not published. Create and install an exact local preview without changing the release gate:

```bash
npm pack
npm install --global ./universal-computer-use-plugin-0.2.5.tgz
computer-use setup --development
computer-use doctor --json
computer-use config --client generic
```

Publishing that artifact externally requires a separate explicit release action. Normal `computer-use setup` remains blocked while the locked engine is development-only.

## Development checks

```bash
npx --yes pnpm@9.0.4 test
npx --yes pnpm@9.0.4 typecheck
npx --yes pnpm@9.0.4 acceptance:macos -- --exclusive-desktop
npx --yes pnpm@9.0.4 acceptance:macos:profile -- --profile pixel_action_next_state --exclusive-desktop
npx --yes pnpm@9.0.4 acceptance:macos:cursor-ab -- --exclusive-desktop
npm pack --dry-run --json
```

These source-only real-machine lanes deliberately refuse to run without `--exclusive-desktop`, because the full lane activates owned applications and foreground delivery can change focus. The full lane performs four 5-warm-up/30-sample profiles plus semantic-sequence, exactly-once, visual-recovery, native-focus, Calculator/TextEdit smoke, and reconnect proofs. The focused lane runs one named profile without opening Calculator or TextEdit. The Cursor A/B lane toggles only a single owned Window session and measures the same deterministic target without restarting Cua. Schema-v4 evidence contains only redacted correctness/timing aggregates and aggregate action-route counts; it does not create release evidence. See [`tests/e2e/development/README.md`](tests/e2e/development/README.md).

## Current platform scope

- macOS with Cua 0.22.2: desktop compatibility, window discovery/capture, opaque element targeting, background semantic delivery, background window-pixel routing with explicit foreground escalation, bounded verification, and safe app launch are implemented. Product 0.2.5 disables Cua's session-owned Agent Cursor on both internal sessions and verifies both readbacks before serving MCP calls, so ordinary UCU automation does not inherit visible cursor animation. The harness has no fixed post-action sleep. Schema-v4 development evidence separates aggregate `accessibility` and `synthetic_events` action routes. Foreground delivery can still change application focus, and the real same-target Cursor A/B must be run deliberately on an idle Mac before making any new latency claim.
- Windows with Cua 0.22.2: primary-desktop screenshot/input compatibility remains implemented. The pinned upstream `list_apps`, `list_windows`, and `get_window_state` entries are stubs, so window precision/background mode is intentionally not advertised as available. Windows 100%/125%/150% DPI evidence remains a release blocker.

The `0.2.5` product still locks Cua `0.22.2`; both platforms are development-eligible but not release-eligible. Startup recovery may start an already-installed stopped runtime before a session exists, but UCU never restarts it after the MCP session starts and never replays a GUI action. Ordinary `setup` and public Beta/Stable release verification deliberately remain blocked until the exact runtime has passed the applicable real-platform, host-loop, and soak evidence gates. See `../docs/troubleshooting.md` for permissions, evidence, and release details.
