# Universal Computer Use Plugin

A lightweight local MCP bridge that lets a compatible multimodal agent observe and operate the current desktop. The host agent supplies the vision model and decision loop; this package supplies the protocol, validation, lifecycle, and execution bridge.

Cua Driver is a separate MIT-licensed runtime dependency. Its Rust and native platform code are not bundled as product source, modified, or re-signed by this project. The exact reviewed runtime and installer artifacts are pinned in `engine.lock.json`.

The MCP surface contains exactly two tools:

- `computer_observe` captures the main display, can discover opaque app/window targets, and on macOS can return an exact window PNG plus bounded Accessibility elements.
- `computer_act` validates one action against that one-use snapshot, prefers precise element handles, supports explicit background/foreground window delivery, verifies bounded postconditions, and returns the next state without a redundant observe call.

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

## Development checks

```bash
npx --yes pnpm@9.0.4 test
npx --yes pnpm@9.0.4 typecheck
npx --yes pnpm@9.0.4 acceptance:macos
npm pack --dry-run --json
```

`acceptance:macos` is a source-only real-machine lane. It opens an isolated deterministic Chrome fixture, uses one long-lived stdio MCP client, proves exact-window semantic and pixel actions, reconnect behavior and cleanup, then writes a redacted development record outside the repository. See [`tests/e2e/development/README.md`](tests/e2e/development/README.md). It does not create release evidence.

## Current platform scope

- macOS with Cua 0.22.2: desktop compatibility, window discovery/capture, opaque element targeting, background semantic delivery, foreground pixel fallback, bounded verification, safe app launch and the complete development acceptance loop are implemented. The current real run passed all scenarios with one degraded coordinate-action timing; named-host and release-candidate evidence is still required before Beta.
- Windows with Cua 0.22.2: primary-desktop screenshot/input compatibility remains implemented. The pinned upstream `list_apps`, `list_windows`, and `get_window_state` entries are stubs, so window precision/background mode is intentionally not advertised as available. Windows 100%/125%/150% DPI evidence remains a release blocker.

The `0.2.1` product still locks Cua `0.22.2`; both platforms are development-eligible but not release-eligible. Ordinary `setup` and public Beta/Stable release verification deliberately remain blocked until the exact runtime has passed the applicable real-platform, host-loop, and soak evidence gates. See `../docs/troubleshooting.md` for permissions, evidence, and release details.
