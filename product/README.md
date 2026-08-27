# Universal Computer Use Plugin

A lightweight local MCP bridge that lets a compatible multimodal agent observe and operate the current desktop. The host agent supplies the vision model and decision loop; this package supplies the protocol, validation, lifecycle, and execution bridge.

Cua Driver is a separate MIT-licensed runtime dependency. Its Rust and native platform code are not bundled as product source, modified, or re-signed by this project. The exact reviewed runtime and installer artifacts are pinned in `engine.lock.json`.

The MCP surface contains exactly two tools:

- `computer_observe` captures the main display and returns a PNG plus a one-use `snapshot_id`.
- `computer_act` validates one action against that snapshot, executes it serially, consumes the snapshot even on failure, and returns a fresh observation.

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

`setup --development` downloads only the checksummed Cua Runtime artifacts pinned in `engine.lock.json`, verifies the installed identity, starts the runtime, and opens the operating-system permission flow. On macOS, grant Screen Recording and Accessibility to the stable `CuaDriver.app` identity. The final command prints the stdio MCP configuration to add to the Agent host.

Use `config --client codex` or `config --client kimi` for the documented host-specific status and configuration. WorkBuddy and DeepSeek Harness adapters are included as experimental declarations; they are not represented as verified integrations.

## Development checks

```bash
npx --yes pnpm@9.0.4 test
npx --yes pnpm@9.0.4 typecheck
npm pack --dry-run --json
```

The initial `0.1.0` lock is development-eligible but not release-eligible. Ordinary `setup` and public Beta/Stable release verification deliberately remain blocked until the exact runtime has passed real macOS Retina, Windows 100%/125%/150% DPI, host-loop, and soak evidence gates. See `../docs/troubleshooting.md` for permissions, evidence, and release details.
