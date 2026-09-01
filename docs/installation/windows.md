# Windows installation

Version 0.2.8 does not promote Windows as part of the Mac Agent Preview. Windows remains a development-only desktop compatibility path: there is no public Beta, signed one-click MSI, or SmartScreen-ready installer yet, and UAC secure desktop remains unsupported.

## Prerequisites

- Windows 10 or Windows 11 on x64. Windows ARM64 and 32-bit Windows are outside the v0.2 release matrix.
- Node.js 22.21–22.x or 24.5+ and an npm-compatible package manager.
- Windows PowerShell and an unlocked, interactive user desktop. Session 0, a disconnected RDP desktop, the lock screen, and the UAC secure desktop are not supported.
- A host Agent that supports local stdio MCP, forwards MCP image content to its current multimodal model, and can continue tool calls until the visible task is complete.

Model rule: this plugin uses the host Agent's current multimodal model. It does not include a model, model API key, planner, or private vision service.

## Install and set up the development path

The npm registry package is not published. Start from the reviewed public repository and an explicitly selected 40-character lowercase commit. In PowerShell:

```powershell
$ErrorActionPreference = "Stop"

function Invoke-NativeChecked {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$ArgumentList
    )
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "Native command failed: $FilePath (exit $LASTEXITCODE)"
    }
}

$repository = "https://github.com/Nico0713520/universal-computer-use"
$commit = "<40-lowercase-hex-commit>"
if ($commit -cnotmatch "^[0-9a-f]{40}$") { throw "Commit must be 40 lowercase hex characters" }

$checkout = Join-Path (Get-Location) "universal-computer-use"
if (Test-Path -LiteralPath $checkout) { throw "Fresh clone target already exists: $checkout" }
Invoke-NativeChecked -FilePath "git" -ArgumentList @("clone", "--no-checkout", $repository, $checkout)
Set-Location -LiteralPath $checkout
Invoke-NativeChecked -FilePath "git" -ArgumentList @("fetch", "origin", $commit)
Invoke-NativeChecked -FilePath "git" -ArgumentList @("checkout", "--detach", $commit)

$actualCommit = (Invoke-NativeChecked -FilePath "git" -ArgumentList @("rev-parse", "HEAD") | Out-String).Trim()
if ($actualCommit -cne $commit) { throw "Detached HEAD does not match the reviewed commit" }
$workingTree = (Invoke-NativeChecked -FilePath "git" -ArgumentList @("status", "--porcelain") | Out-String).Trim()
if ($workingTree.Length -ne 0) { throw "Reviewed checkout is not clean" }

Set-Location -LiteralPath (Join-Path $checkout "product")
Invoke-NativeChecked -FilePath "npx" -ArgumentList @("--yes", "pnpm@9.0.4", "install", "--frozen-lockfile", "--ignore-scripts")
Invoke-NativeChecked -FilePath "npx" -ArgumentList @("--yes", "pnpm@9.0.4", "build")
$packJson = Invoke-NativeChecked -FilePath "npm" -ArgumentList @("pack", "--json")
$packJsonText = $packJson -join [Environment]::NewLine
$packResult = @($packJsonText | ConvertFrom-Json)
if ($packResult.Count -ne 1 -or [string]::IsNullOrWhiteSpace($packResult[0].filename)) { throw "npm pack returned no unique package" }
$packagePath = Join-Path (Get-Location) $packResult[0].filename
if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) { throw "Packed artifact is missing" }
$packagePath = (Resolve-Path -LiteralPath $packagePath).Path

Invoke-NativeChecked -FilePath "npm" -ArgumentList @("install", "--global", $packagePath)
Invoke-NativeChecked -FilePath "computer-use" -ArgumentList @("setup", "--development")
Invoke-NativeChecked -FilePath "computer-use" -ArgumentList @("doctor")
Invoke-NativeChecked -FilePath "computer-use" -ArgumentList @("doctor", "--json")
```

The checkout must be clean and detached at the reviewed commit before build. Normal `computer-use setup` remains reserved for a future promoted package and currently fails closed with `engine_not_release_eligible`; it is not an installation step for this development path.

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

Cua Driver 0.22.2 does not expose a portable target-integrity or complete permission-state probe through the public plugin seam. Unknown values remain `unknown`; observed refusals and locked-session failures remain failures.

## Configure the host Agent

```powershell
computer-use config --client generic
computer-use config --client codex
computer-use config --client kimi
```

Generic output is stdout-only JSON whose `command` is the absolute path to the current `node.exe` and whose first argument is the absolute `dist\mcp\main.js` path; it does not depend on `PATH`, an npm shim, or direct execution of a JavaScript file. Explanations are written to stderr. Codex and Kimi output deterministic registration commands with those paths as two independently quoted arguments. The host must send PNG content to its own current multimodal model and permit repeated `computer_observe` / one-action `computer_act` calls. Host approval settings remain the host's responsibility.

## Upgrade a development checkout

Select and verify a new reviewed source commit, repeat the build and local `npm pack` flow above, install that exact local tarball, then run `computer-use setup --development` and both doctor modes. Do not update from the unpublished registry package or install an arbitrary Cua build. A candidate release must be an explicit stable SemVer tag, contain all required fix commits, match its release checksums and scripts, pass Windows 10/11 x64 tests at 100%, 125%, and 150% scaling, and record its Authenticode identity before release promotion.

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
