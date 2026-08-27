# macOS installation

## Prerequisites

- macOS 13 or newer on Apple silicon or Intel x64.
- Node.js 22.19.0 or newer and an npm-compatible package manager.
- An unlocked, foreground login session. The v1 plugin does not operate the login window, FileVault unlock screen, screen saver lock screen, or a background session.
- A host Agent that supports local stdio MCP, forwards MCP image content to its current multimodal model, and can continue tool calls until the visible task is complete.

Model rule: this plugin uses the host Agent's current multimodal model. It does not include a model, model API key, planner, or private vision service.

## Install and set up

Install the package globally, then run setup:

```bash
npm install --global @universal-computer-use/plugin
computer-use setup
```

Normal setup fails closed with `engine_not_release_eligible` unless the exact macOS engine in `engine.lock.json` has completed its signer and E2E promotion gates. A developer may explicitly install the locked development baseline:

```bash
computer-use setup --development
```

Development setup always prints a machine-readable `development_only:true` warning. It is not a public-release qualification and cannot be hidden with a quiet flag.

Setup downloads `install.sh` from the exact locked GitHub release and its helper scripts from the exact locked Cua source commit into one temporary directory. It verifies every script SHA-256 before executing the local entry point, pins `CUA_DRIVER_RS_VERSION`, and never follows `latest` or `main`. The unmodified upstream installer downloads the release archive; the asset hash in the lock is promotion evidence rather than a claim that this wrapper re-hashes that internal archive transfer.

After installation, setup verifies `/Applications/CuaDriver.app` with `codesign --verify --deep --strict` and Gatekeeper. A promoted release must also match the TeamIdentifier, bundle ID, and designated-requirement fingerprint in the lock. It then kicks Cua's official autostart service and delegates permission prompting to:

```bash
/Applications/CuaDriver.app/Contents/MacOS/cua-driver permissions grant
```

The plugin does not modify Codex, Kimi, or another host's configuration automatically.

## Screen Recording and Accessibility

macOS requires both permissions for the signed `CuaDriver.app` identity:

1. Open System Settings → Privacy & Security.
2. Enable Screen Recording for CuaDriver so the Runtime can capture the main display.
3. Enable Accessibility for CuaDriver so the Runtime can deliver mouse and keyboard input.
4. If macOS requests it, quit and restart CuaDriver and the host Agent.

These prompts are operating-system security boundaries and cannot be bypassed by the plugin. A stable upstream signing identity is important because replacing the identity may require granting permission again.

## Diagnose

```bash
computer-use doctor --json
```

Doctor connects to the exact locked Runtime, validates its version and required tool contract, performs exactly one screenshot observation, performs no input action, and closes the diagnostic session. The JSON includes plugin/protocol/engine versions, connection and tool status, interactive desktop status, permission status when the Runtime reports it, and screenshot dimensions. Any required failure sets `ok:false` and exits 1.

Cua Driver 0.22.1 does not expose a complete portable permission-state object through the public SDK. Doctor therefore reports `permissions:"unknown"` after a successful capture, or `permissions:"required"` only when the Runtime explicitly returns `permission_required`; it does not invent a grant state.

## Configure the host Agent

Generate one of the supported configurations:

```bash
computer-use config --client generic
computer-use config --client codex
computer-use config --client kimi
```

The generic command prints JSON only to stdout, using an absolute `computer-use-mcp` path. Explanatory text goes to stderr. The other commands print a copyable MCP registration command. The host must pass returned PNG images to its own current multimodal model and allow the model to alternate `computer_observe` and one `computer_act` call. Any approval dialogs belong to the host's policy, not this plugin.

## Upgrade

Upgrade the npm package, review its pinned `engine.lock.json`, and run setup again:

```bash
npm update --global @universal-computer-use/plugin
computer-use setup
computer-use doctor --json
```

Do not substitute an arbitrary Cua version or moving download URL. A new engine is first staged as development-only, tested on real Retina hardware, then separately promoted with recorded signer and E2E evidence.

## Uninstall

Safe default:

```bash
computer-use uninstall
```

The default removes only entries recorded as product-owned and leaves Cua Driver installed because another product may share it. It never invokes Cua's uninstaller.

To explicitly remove the shared engine too:

```bash
computer-use uninstall --engine
```

The explicit form downloads `uninstall.sh` from the exact locked release, verifies its SHA-256, executes that local file, and removes the temporary directory. It never executes a moving `cua.ai` or `latest` script. The upstream macOS uninstaller may revoke Cua's TCC grants, so a later reinstall can require permission again.

## Troubleshooting

- `engine_not_release_eligible`: no public macOS candidate has passed all gates. Use `--development` only for development or wait for a promoted release.
- `runtime_missing`: run setup for the package version currently installed.
- `runtime_unavailable`: ensure the login session is unlocked, then run `cua-driver autostart kick` and doctor again.
- `engine_version_mismatch`: do not use `latest`; rerun this package's setup to install the exact lock.
- `permission_required`: rerun `cua-driver permissions grant`, check both Privacy & Security panels, and restart the signed app.
- `interactive_session_required`: unlock the foreground desktop. Background and login-window automation are out of scope.
- Clicks offset on Retina: stop using the candidate and report the engine version, screenshot dimensions, display scale, macOS version, and architecture. The plugin deliberately does not add a second coordinate conversion over Cua.
