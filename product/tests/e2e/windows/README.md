# Windows real-desktop E2E lane

This lane produces Windows 10/11 x64 evidence for exactly one separately configured display scale: `100`, `125`, or `150` percent. It is not a simulator. With `CUA_E2E` unset, the real-desktop tests skip; the schema and controlled permission-classification tests still run on any development OS.

This pinned Cua 0.22.2 lane proves only the primary-desktop compatibility path. Its Windows `list_apps`, `list_windows`, and `get_window_state` tools are upstream stubs, so these runs must not be cited as window discovery, semantic targeting, or background-window evidence. Those capabilities require a later reviewed runtime lock and new real-DPI assertions.

`run.ps1` is the only supported evidence entrypoint. It fails before moving the mouse when the host is not Windows x64, the process is in Session 0, WTS reports a non-active session, the input desktop is locked or secure, the OS is older than build 18362, the actual system DPI differs from the selected lane, the browser/build/Runtime is missing, Cua differs from `engine.lock.json`, or the calibration is missing or stale. RDP must remain connected and the desktop unlocked for the whole run.

## Why content-origin calibration is required

Task 10 returns control centers in page CSS coordinates. Cua accepts full-screen screenshot pixels. Browser borders, Windows display scale and physical pixels cannot be inferred safely from a fixed offset, so the runner refuses guessed coordinates.

For each machine, browser build and DPI setting, make a real measurement no more than 24 hours before the run:

1. Build the product and start `tests/fixtures/desktop-harness/server.mjs`. It prints a loopback URL and binds only `127.0.0.1`.
2. Launch the exact Chrome/Edge executable selected for the test using the same geometry as Task 10: app mode, `--window-position=40,40`, `--window-size=1280,800`, zoom `100%`, and a fresh profile. Keep browser display zoom at 100%.
3. Call the built MCP's `computer_observe` against the unlocked primary display. Save that one PNG only in a private temporary directory outside this repository.
4. In a pixel inspector, locate the fixture's unique top-left origin marker: a 24×24 yellow square with red right and bottom edges. Record the screenshot-pixel coordinate of the marker's top-left pixel. That measured point—not `40,40`, `screenX`, a browser-title-bar guess, or CSS pixels—is `content_origin_x_px/content_origin_y_px`.
5. Record the PNG pixel dimensions and SHA-256, the selected browser executable SHA-256, Windows build and actual display-scale lane in a calibration JSON file outside the repository. Delete the PNG after the run; only its hash is copied into evidence.

The calibration file has exactly these fields (replace placeholders with measured values):

```json
{
  "schema_version": 1,
  "measurement_method": "visible-origin-marker-screenshot-pixel-measurement",
  "measured_at": "2026-08-27T12:00:00.0000000+00:00",
  "os_build": "26100",
  "dpi_percent": 125,
  "browser_executable_sha256": "<64 lowercase hex characters>",
  "screenshot_width_px": 2560,
  "screenshot_height_px": 1440,
  "source_screenshot_sha256": "<64 lowercase hex characters>",
  "content_origin_x_px": 96,
  "content_origin_y_px": 173,
  "zoom_percent": 100
}
```

The numeric values above are format examples, not accepted coordinates or evidence. The runner cross-checks build, DPI, browser hash and screenshot dimensions against the current machine, then injects only the measured origin into Task 10's real MCP tests.

## Development run

From `product` in PowerShell:

```powershell
npx --yes pnpm@9.0.4 build
$env:CUA_E2E = '1'
$env:CUA_E2E_MODE = 'development'
$env:CUA_REPEAT = '1'
$env:CUA_E2E_DPI = '125'
$env:CUA_E2E_BROWSER = 'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
$env:CUA_RUNTIME_EXE = '<absolute path to the installed locked Cua Runtime executable>'
$env:CUA_E2E_CALIBRATION = '<absolute path to private calibration.json>'
$env:CUA_E2E_EVIDENCE_OUT = '<absolute path outside the repository to a new evidence.json>'
& .\tests\e2e\windows\run.ps1
```

Development evidence is always `promotable:false`, even if every test passes.
`CUA_REPEAT` must be between 1 and 100 in both modes.

## Candidate run

First use the reviewed `select-engine-release.mjs stage VERSION` workflow. Candidate mode accepts only a clean worktree, an exact formal SemVer tag, a staged non-release-eligible lock, a valid Authenticode signer, and a local Cua git checkout proving that the release tag resolves to the locked source commit and contains every `required_fix_commits` entry.

```powershell
$env:CUA_E2E = '1'
$env:CUA_E2E_MODE = 'candidate'
$env:CUA_REPEAT = '20'
$env:CUA_E2E_DPI = '125'
$env:CUA_UPSTREAM_REPO = '<absolute path to a Cua checkout containing the tag and required commits>'
$env:CUA_E2E_BROWSER = '<absolute path to chrome.exe or msedge.exe>'
$env:CUA_RUNTIME_EXE = '<absolute path to the staged Cua Runtime executable>'
$env:CUA_E2E_CALIBRATION = '<absolute path to private calibration.json>'
$env:CUA_E2E_EVIDENCE_OUT = '<absolute path outside the repository to a new evidence.json>'
& .\tests\e2e\windows\run.ps1
```

Run that command independently on actual 100%, 125% and 150% machine/settings. A single run proves only its selected lane. Candidate evidence is written only after all requested iterations pass the Task 10 loopback `/state` oracle, all nine action variants, stale-snapshot rejection and new-snapshot assertions. The script never changes `release_eligible`; Task 15 owns evidence validation and promotion.

## Evidence and permission boundaries

Evidence conforms to `evidence.schema.json` and contains only allowlisted machine/runtime metadata: OS build/architecture, DPI, browser build hash, engine lock/fingerprint, Runtime executable hash, Authenticode status plus certificate subject/thumbprint, a hash and stable allowlisted fields from `computer-use doctor --json`, fixture assertion counts and the content-origin measurement metadata.

The runner executes the exact `CUA_RUNTIME_EXE --version` command and requires the complete output `cua-driver <locked-version>` before accepting its signature or hash. The contract fingerprint is computed from the built package as `sha256(JSON.stringify(PUBLIC_TOOL_SCHEMAS))`, matching the macOS lane. Evidence creation uses `FileMode.CreateNew`, so another process cannot replace or overwrite the selected output between the preflight check and the write.

It does not contain screenshots, screenshot bytes, typed strings, key values, model prompts, environment dumps, paths, Cua `rawJson`, or free-form diagnostic text. Real evidence and calibration files must stay outside the repository and must not be committed.

The normal foreground fixture must succeed. `permission-reporting.spec.ts` uses controlled Cua boundary results to prove that denials become `action_refused` or `action_failed` and never `executed`. Protocol 1.1 does not expose raw Cua diagnostics; the evidence records only stable classifications and a hash of the allowlisted doctor report. The plugin does not detect `target_privilege_mismatch`, inspect target process tokens, automate UAC, or support the UAC secure desktop.
