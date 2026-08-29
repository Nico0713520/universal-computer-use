# Computer Use Plugin Troubleshooting

This plugin uses the host Agent's current multimodal model. It does not contain a model, provider endpoint, API key, GUI, or native input implementation. The separately installed, version-locked Cua Runtime owns capture, permissions, signing and input delivery.

## Start with doctor

Run `computer-use doctor --json`. A healthy report has `ok:true`, the exact engine version from `product/engine.lock.json`, every required tool, an unlocked interactive desktop and one successful primary-display PNG observation.

`engine_version_mismatch` means the installed Runtime and lock differ. Do not follow `latest`, use a nightly, or edit the lock by hand. Either reinstall the exact lock with `computer-use setup --development` for local development, or stage and prove a formal release before public use. Ordinary `computer-use setup` deliberately rejects the current development-only lock.

## macOS 14+

- Grant both Screen Recording and Accessibility to the signed `CuaDriver.app` through System Settings. If capture or input remains denied, remove the stale permission entry, reopen the unchanged signed app, grant both permissions again, then rerun doctor.
- `codesign --verify --deep --strict /Applications/CuaDriver.app` and `spctl --assess --type execute /Applications/CuaDriver.app` must succeed for release evidence. A changed bundle, TeamIdentifier or designated requirement is a different identity and must not reuse old evidence.
- Retina is correct only when the Runtime reports a backing scale greater than `1` and Task 10's visible marker measurement proves screenshot-pixel clicks and drags. Do not compensate by multiplying coordinates in the plugin or by guessing a browser title-bar offset.
- The current console user must own an unlocked Aqua session. Lock screen, loginwindow and disconnected remote sessions are outside v0.2.
- v0.2 window mode converts trusted Accessibility frames from desktop logical points into the exact window PNG pixel frame. If Cua cannot prove that frame, the plugin omits screenshot/bounds and keeps semantic elements; do not reconstruct coordinates yourself.

## Windows 10 1903+ / Windows 11 x64

- Evidence is collected separately at 100%, 125% and 150% display scale, with browser zoom fixed at 100%. Remeasure the visible fixture origin after changing DPI, browser build, display, resolution or OS build. A wrong lane or stale calibration must fail before input.
- Session 0, a locked or disconnected desktop and the UAC secure desktop are unsupported. Keep a logged-in interactive session attached for the whole run.
- The plugin does not inspect target process integrity, elevate itself, bypass UAC or promise control of an administrator application from a lower-integrity process. Cua refusals remain `action_refused` or `action_failed`; they are never rewritten as success.
- A release candidate requires one valid Authenticode subject/thumbprint that is identical in the 100%, 125% and 150% evidence files.
- The pinned Cua 0.22.2 Windows discovery/window-state implementations are upstream stubs. Use the desktop compatibility path only; Windows window precision and background targeting remain unavailable until a later reviewed lock supplies real implementations and all DPI lanes pass.

## Host Agent behavior

The MCP server exposes only `computer_observe` and `computer_act`. The plugin never displays a per-action approval, but Codex, Kimi or another host may still require its own approval. Configure automatic tool use in the host's documented policy; the plugin cannot and must not bypass it. A host is not `verified` merely because its model can see images: evidence must prove first- and second-turn PNG delivery, continued calls and natural stop.

If a host sees text but not the screenshot, it does not support MCP `ImageContent` on this route. Keep it `experimental` or `not-compatible`; do not add a second vision model inside the plugin.

## Slow or inaccurate loops

- Measure a native host connection, not a temporary shell bridge. The MCP server must remain one long-running stdio process because snapshot state is process-local. Do not add a fixed post-action sleep: `computer_act` already captures and returns the next screenshot as soon as the engine call completes.
- Use the screenshot and `snapshot_id` returned by `computer_act` for the next decision, even when the reported effect is uncertain. Calling `computer_observe` again performs a redundant capture and replaces that valid snapshot.
- Prefer one `type` action for complete text and a confirmed-focus shortcut when they are equivalent to several visual clicks. This reduces model round trips without batching input or weakening the one-use snapshot rule.
- Discover an app/window and prefer `element_ref` for standard controls. This avoids guessing a button center and can act on hidden or off-Space macOS windows. For repeated, low-risk rectangular controls in a currently visible exact window, the interior center from the current window PNG is the faster path because locked Cua may spend a bounded confirmation interval on an Accessibility press. Keep semantic targeting for destructive, ambiguous, obscured, minimized, or off-Space controls. Discovery bounds are desktop-logical metadata, never action coordinates.
- Select the interior center of a custom control in the exact returned PNG. Avoid borders and gaps. A point that works after the model adjusts its aim is not evidence of a DPI transform bug; a transform defect requires a repeatable offset measured at several known points.
- `visual_status:"capture_unavailable"` or `"pixel_frame_unproven"` is a semantic-only snapshot: element actions remain possible, but coordinates are intentionally refused.
- Background `effect:"unverifiable"` is not permission to resend. Inspect the fresh window state, and use explicit foreground delivery only when non-delivery is proved and retrying is safe. Never repeat append-style text on uncertainty.

## Logs and privacy

Runtime metadata logs are JSONL on the MCP process's standard error. They contain only timestamp, per-process hashes, tool/action type, duration, route/effect/delivery and stable error code. They must not contain screenshot bytes, typed text, key contents, clipboard data, model prompts or environment values. Standard output is reserved for MCP frames.

The real platform, host and soak evidence files belong outside the repository. They are strict, redacted JSON without screenshots or traces. CI uploads JSON evidence only.

## Development setup and uninstall

`computer-use setup --development` installs only the exact development-eligible lock and prints `development_only:true`; that state cannot satisfy Beta or Stable verification. Re-run `computer-use doctor --json` after Runtime or OS changes.

`computer-use uninstall` removes product-owned integration links and leaves the shared Cua Runtime installed. Only the explicit `computer-use uninstall --engine` path downloads, hashes and runs the lock's exact upstream uninstaller. It never runs a moving uninstall URL.

## Release evidence and promotion

Run candidate E2E from the platform runbooks. `select-engine-release.mjs promote VERSION --mac-evidence PATH --windows-evidence PATH` treats the Windows path as a directory containing exactly three candidate JSON files: one each for 100%, 125% and 150% DPI. It validates every input before atomically updating the lock, returns a source-to-content-addressed rename map for the private evidence bundle, and never copies evidence into the repository.

Set `CUA_RELEASE_PLATFORM_EVIDENCE_ROOT` to that external bundle root and `CUA_HOST_EVIDENCE_FILES` to the platform-delimited absolute Codex/Kimi evidence list for Beta verification. Stable additionally reads two absolute files from `CUA_SOAK_EVIDENCE_FILES`, one for each platform. Each soak must have zero seam failures, RSS growth no greater than 150 MiB, and satisfy both 1800 seconds and 200 completed actions. The runner recreates its loopback fixture, browser process and profile after every complete cycle so DOM input and scroll state cannot leak into the next cycle.

The manual E2E workflow takes all machine-specific paths and calibration values from explicit GitHub repository/environment variables. Configure the documented `CUA_MACOS_*` values and the `CUA_WINDOWS_*` browser, Runtime, upstream checkout, per-DPI calibration and per-DPI origin values on the matching protected runner environment; steps do not inherit exported variables from a previous process.
