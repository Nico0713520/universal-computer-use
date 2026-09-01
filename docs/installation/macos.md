# macOS installation

Version 0.2.8 is a Mac Agent Preview (Developer Preview), not a public Beta. There is no one-click installer, DMG, notarized public package, or automatic host configuration in this milestone.

## Prerequisites

- macOS 14 or newer on Apple silicon or Intel x64.
- Node.js 22.21–22.x or 24.5+ and an npm-compatible package manager.
- An unlocked, foreground login session. The v0.2 plugin does not operate the login window, FileVault unlock screen, screen saver lock screen, or a disconnected background session.
- A host Agent that supports local stdio MCP, forwards MCP image content to its current multimodal model, and can continue tool calls until the visible task is complete.

Model rule: this plugin uses the host Agent's current multimodal model. It does not include a model, model API key, planner, or private vision service.

## Install and set up the Preview

The npm package is not published. Build the current Preview from source, then explicitly select the development-only Runtime lane:

```bash
cd product
npx --yes pnpm@9.0.4 install --frozen-lockfile --ignore-scripts
npx --yes pnpm@9.0.4 build
npm install --global .
computer-use setup --development
```

Development setup always prints a machine-readable `development_only:true` warning. It is not a public-release qualification and cannot be hidden with a quiet flag.

The global `computer-use setup` path is reserved for a future promoted package and currently fails closed with `engine_not_release_eligible`. Do not present the source build or a local tarball as a signed public installer.

Setup downloads `install.sh` from the exact locked GitHub release and its helper scripts from the exact locked Cua source commit into one temporary directory. It verifies every script SHA-256 before executing the local entry point, pins `CUA_DRIVER_RS_VERSION`, and never follows `latest` or `main`. The unmodified upstream installer downloads the release archive; the asset hash in the lock is promotion evidence rather than a claim that this wrapper re-hashes that internal archive transfer.

If `HTTP_PROXY`, `HTTPS_PROXY`, `http_proxy`, or `https_proxy` is configured, invoke `computer-use setup` normally. The direct CLI re-executes only that command once with Node's environment-proxy support unless `NODE_USE_ENV_PROXY=1` or `--use-env-proxy` is already active. It inherits the terminal and child exit status and does not print the proxy value. TLS verification stays enabled, and every UCU-downloaded installer script still has to match its locked SHA-256 digest.

The Cua installer has a 20-minute safety deadline. A successful install returns immediately; the longer ceiling allows Cua's own 600-second dead-lock recovery to complete on a retry. Set `COMPUTER_USE_INSTALL_TIMEOUT_MS` to a decimal value from `60000` through `3600000` to select a different installer-only deadline. Invalid values fail before the installer runs. On macOS, a timed-out installer receives `SIGTERM` as one UCU-owned process group and has five seconds to run its cleanup traps before that group is force-killed. The 30-second daemon launch and 120-second permission flow keep their separate deadlines.

UCU never deletes Cua's private `~/.cua-driver/packages/.install.lock.d`. Do not blindly remove that directory: it may belong to a live installer. Let the locked upstream installer inspect its recorded owner PID and reclaim a dead lock, or first verify the owner through Cua's documented recovery procedure.

After installation, setup verifies `/Applications/CuaDriver.app` with `codesign --verify --deep --strict` and Gatekeeper. A promoted release must also match the TeamIdentifier, bundle ID, and designated-requirement fingerprint in the lock. Locked Cua 0.22.2's macOS installer does not implement the Windows-only `autostart kick` command, so setup starts the verified app directly with `open -n -g /Applications/CuaDriver.app --args serve`, then delegates permission prompting to:

```bash
/Applications/CuaDriver.app/Contents/MacOS/cua-driver permissions grant
```

The plugin does not modify Codex, HanaAgent, WorkBuddy, Kimi, or another host's configuration automatically. The permission dialogs and System Settings entries keep the visible CuaDriver attribution; UCU does not hide or rebrand the signed Runtime identity.

After installation, product 0.2.8 can recover an installed but stopped CuaDriver through either the independent diagnostic connector or the MCP pre-session connector. If the initial connection returns `runtime_unavailable`, that connector may make one bounded startup attempt before any diagnostic session or MCP request: it requires the fixed app path and locked signature, opens `serve`, and polls until the first successful connection or a 10-second hard deadline. Doctor also completes its trusted interactive-session, Runtime-identity, and daemon-permission prechecks before connecting. Recovery does not install or upgrade Cua, never replays an observation or GUI action, and never restarts Cua after an MCP session starts. During session initialization, UCU configures and verifies the Adaptive Cursor on both internal sessions. Default `auto` hides it during background actions and every observation, while foreground pointer actions remain visible. Use `--cursor visible` for debugging/recording or `--cursor hidden` for a fully quiet presentation layer. Both doctor modes remain input-free diagnostics even when their connector starts the already-installed verified daemon.

## Screen Recording and Accessibility

macOS requires both permissions for the signed `CuaDriver.app` identity:

1. Open System Settings → Privacy & Security.
2. Enable Screen Recording for CuaDriver so the Runtime can capture the main display.
3. Enable Accessibility for CuaDriver so the Runtime can deliver mouse and keyboard input.
4. If macOS requests it, quit and restart CuaDriver and the host Agent.

These prompts are operating-system security boundaries and cannot be bypassed by the plugin. A stable upstream signing identity is important because replacing the identity may require granting permission again.

## Diagnose

```bash
computer-use doctor
computer-use doctor --json
```

Bare `computer-use doctor` prints a concise human-readable readiness summary. `computer-use doctor --json` prints the stable machine-readable report. Both connect to the exact locked Runtime, validate its version and required tool contract, perform exactly one screenshot observation, perform no input action, and close the diagnostic session. The JSON includes plugin/protocol/engine versions, connection and tool status, interactive desktop status, normalized permission status, and screenshot dimensions. Any required failure sets `ok:false` and exits 1.

On macOS, doctor first checks the trusted system interactive-session state, then requires the fixed `/Applications/CuaDriver.app` path and verifies that local app with strict codesign, Gatekeeper, and the locked bundle identity before any Cua connection, session, tool, cursor operation, or daemon permission query. A missing fixed app reports typed `runtime_missing`; only an app that exists but fails identity checks reports `engine_version_mismatch` with `runtime_signature_mismatch`. Only after local app verification succeeds does doctor run `/Applications/CuaDriver.app/Contents/MacOS/cua-driver permissions status --json`; a reported missing grant also fails closed before connecting. It accepts the permission JSON only when the response also attributes itself to the driver daemon and bundle ID `com.trycua.driver`; malformed or untrusted permission responses stay `unknown`. Either identity failure prevents the permission command, Runtime connection, and screenshot observation. A recognized capture/input permission failure may report the specific missing permission, but doctor never infers the calling Node process's privileges as CuaDriver privileges.

## Configure the host Agent

Generate one of the supported configurations:

```bash
computer-use config --client generic
computer-use config --client codex
computer-use config --client kimi
computer-use config --client hanaagent
computer-use config --client workbuddy
```

Generic, HanaAgent, and WorkBuddy print JSON only to stdout. Each JSON object's `command` is the absolute path to the current Node executable and `args[0]` is the absolute path to `dist/mcp/main.js`, so the host never relies on an executable bit, `PATH`, or an npm shim. Codex and Kimi print a copyable registration command with those same two paths as independently quoted arguments. All named output is for manual direct stdio registration; no command edits the host's settings. Explanatory text goes to stderr.

Install or link the packaged Canonical Computer Use Skill at `product/skills/computer-use/SKILL.md`. The host must pass returned PNG images to its own current multimodal model and alternate `computer_observe` with one `computer_act`; the plugin does not include an internal vision model. Restart the selected host and start a new conversation before checking for the two tools, because an existing conversation may have frozen its tool inventory. Any approval dialogs belong to the host's policy, not this plugin. Run one host at a time; Multi-Agent concurrent control is deferred.

## Upgrade a source Preview

Fetch an explicitly selected source revision, review its pinned `engine.lock.json`, rebuild it, and run setup again:

```bash
npx --yes pnpm@9.0.4 install --frozen-lockfile --ignore-scripts
npx --yes pnpm@9.0.4 build
npm install --global .
computer-use setup --development
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
- `runtime_unavailable`: ensure the login session is unlocked, then run `open -n -g /Applications/CuaDriver.app --args serve` and doctor again.
- `engine_version_mismatch`: do not use `latest`; rerun this package's setup to install the exact lock.
- `permission_required`: rerun `cua-driver permissions grant`, check both Privacy & Security panels, and restart the signed app.
- `interactive_session_required`: unlock the foreground desktop. Background and login-window automation are out of scope.
- Clicks offset on Retina: stop using the candidate and report the engine version, screenshot dimensions, display scale, macOS version, and architecture. The plugin deliberately does not add a second coordinate conversion over Cua.
