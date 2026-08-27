# Windows installation

## Prerequisites

- Windows 10 or Windows 11 on x64. Windows ARM64 and 32-bit Windows are outside the v1 release matrix.
- Node.js 22.19.0 or newer and an npm-compatible package manager.
- Windows PowerShell and an unlocked, interactive user desktop. Session 0, a disconnected RDP desktop, the lock screen, and the UAC secure desktop are not supported.
- A host Agent that supports local stdio MCP, forwards MCP image content to its current multimodal model, and can continue tool calls until the visible task is complete.

Model rule: this plugin uses the host Agent's current multimodal model. It does not include a model, model API key, planner, or private vision service.

## Install and set up

From PowerShell or another terminal:

```powershell
npm install --global @universal-computer-use/plugin
computer-use setup
```

Normal setup fails closed with `engine_not_release_eligible` unless the exact Windows engine in `engine.lock.json` has completed signer and E2E promotion. For candidate development only:

```powershell
computer-use setup --development
```

Development setup always emits a machine-readable `development_only:true` warning and cannot qualify a public release.

Setup downloads `install.ps1` from the exact locked GitHub release and `_install-common.psm1` from the exact locked source commit into one temporary directory. It verifies both SHA-256 values before running:

```text
powershell.exe -NoProfile -ExecutionPolicy Bypass -File <verified-local-path> -Release <exact-version> -AutoStart
```

The path is passed as a process argument, not interpolated into a shell command. Setup never follows `latest`, never downloads executable installer code through `cua.ai`, and never silently edits a host Agent configuration. The upstream installer downloads the release archive; its asset checksum in the lock is release-promotion evidence rather than a second archive verification performed by this wrapper.

After installation, setup requires `Get-AuthenticodeSignature` to return `Valid` for `%LOCALAPPDATA%\Programs\Cua\cua-driver\bin\cua-driver.exe`. A promoted release must exactly match the certificate subject and thumbprint recorded in the lock. Setup then kicks the official Cua autostart task and runs doctor.

## UAC and privilege limitations

Cua operates only in the current interactive desktop. The plugin does not install UIAccess, elevate itself, dismiss UAC, inspect a target process's integrity level, or control the secure desktop. A normal desktop action may work while an elevated target refuses the same input. That refusal is reported as returned by Cua; it is never converted into success or into an unsupported claim that the plugin identified a privilege mismatch.

If Windows asks whether to allow an installer operation, the user and operating-system policy decide. Fully unattended UAC bypass is intentionally not part of this project.

Windows display scaling at 100%, 125%, and 150% is handled by Cua's screenshot/action coordinate contract. The plugin validates coordinates against the returned screenshot but does not apply a second DPI conversion.

## Diagnose

```powershell
computer-use doctor --json
```

Doctor validates the locked Runtime version and required tools, performs exactly one screenshot observation, performs no mouse or keyboard action, and closes its diagnostic session. It returns plugin/protocol/engine versions, platform support, Runtime connectivity, required tool status, interactive desktop status, permission status when exposed, observation status, screenshot dimensions, and overall `ok`. Any required failure exits 1.

Cua Driver 0.22.1 does not expose a portable target-integrity or complete permission-state probe through the public plugin seam. Unknown values remain `unknown`; observed refusals and locked-session failures remain failures.

## Configure the host Agent

```powershell
computer-use config --client generic
computer-use config --client codex
computer-use config --client kimi
```

Generic output is stdout-only JSON whose `command` is the absolute path to the current `node.exe` and whose first argument is the absolute `dist\mcp\main.js` path; it does not depend on `PATH`, an npm shim, or direct execution of a JavaScript file. Explanations are written to stderr. Codex and Kimi output deterministic registration commands with those paths as two independently quoted arguments. The host must send PNG content to its own current multimodal model and permit repeated `computer_observe` / one-action `computer_act` calls. Host approval settings remain the host's responsibility.

## Upgrade

```powershell
npm update --global @universal-computer-use/plugin
computer-use setup
computer-use doctor --json
```

Do not install an arbitrary Cua build. A candidate release must be an explicit stable SemVer tag, contain all required fix commits, match its release checksums and scripts, pass Windows 10/11 x64 tests at 100%, 125%, and 150% scaling, and record its Authenticode identity before release promotion.

## Uninstall

Safe default:

```powershell
computer-use uninstall
```

This removes only product-owned entries and leaves the potentially shared Cua Runtime. It never invokes the upstream uninstaller.

Explicitly remove the engine too:

```powershell
computer-use uninstall --engine
```

Only the lock's tag-pinned `uninstall.ps1` is downloaded, SHA-256 verified, and passed to PowerShell as a separate `-File` argument. A checksum mismatch prevents execution and the exact temporary directory is removed.

## Troubleshooting

- `engine_not_release_eligible`: the Windows candidate is not promoted. Use `--development` only for candidate testing.
- `runtime_missing`: run setup from the installed package version.
- `runtime_unavailable`: unlock the interactive session and run `cua-driver autostart kick`, then doctor.
- `engine_version_mismatch`: rerun this package's setup; do not repair it with `latest`.
- `interactive_session_required`: sign in to an unlocked local or connected interactive desktop. Session 0 cannot capture or receive input.
- An elevated app refuses input: run the Agent and Cua under an appropriate user-approved context or stop the task. The plugin will not auto-elevate or bypass UAC.
- Clicks offset at 125% or 150%: stop using the candidate and report the engine version, DPI lane, screenshot dimensions, Windows build, and architecture. Do not add a second coordinate scale in host prompts.
