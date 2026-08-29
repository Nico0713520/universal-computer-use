---
name: computer-use
description: Control local macOS or Windows applications through snapshot-bound MCP observations, precise window elements, and screenshot fallback actions.
---

# Computer Use

Use this Skill only when a task must read or manipulate the user's local GUI. The public tools are exactly `computer_observe` and `computer_act`; the plugin observes and executes while the host Agent decides, verifies, and stops.

Use the host's current vision model for returned PNG images. Never request a plugin model key. Follow the host's authorization and safety policy; this Skill grants no additional authority.

## Control loop

1. Before the first action, call `computer_observe`. When the target app is not already exact, discover apps and windows before guessing coordinates: `{"target":{"kind":"desktop"},"discover":{"apps":true,"windows":true,"query":"name"}}`.
2. Prefer an exact window observation with its newest `window_ref`. Prefer `element_ref` for standard, destructive, ambiguous, obscured, minimized, or off-Space controls. For repeated low-risk rectangular controls in a visible exact window, the interior center from the current window PNG is an allowed fast path. Use window coordinates for canvas, video, WebGL, and custom-drawn content.
3. Send exactly one smallest useful action in each `computer_act`, using only the newest `snapshot_id`. The snapshot is consumed immediately before mutation and cannot be reused.
4. Inspect the fresh state returned by `computer_act` before every next action. Its new snapshot is already the next observation, so do not call `computer_observe` again when that state is available.
5. When the visible goal or semantic goal is satisfied and proved, stop. Never blindly repeat a failed, uncertain, or unverifiable action. In particular, do not repeat unverifiable text input; inspect the fresh value or screenshot first.

Report permission, runtime, target-loss, or unsupported-platform blockers honestly. Do not replace plugin calls with shell input, AppleScript, or another computer tool when validating this plugin.

## Targeting and speed

Window coordinates use the returned window PNG, not desktop coordinates or a resized preview. Desktop coordinates use the primary desktop PNG. Aim at the interior center of a custom control, away from every edge or gap. Never invent an offset or blindly retry a nearby point.

Window discovery bounds are descriptive `desktop_logical` geometry and are never action coordinates. A window snapshot either proves `window_screenshot_pixels` or omits pixel bounds entirely. When `visual_status` is not `available`, use semantic elements only.

The speed/precision tradeoff is explicit: `element_ref` keeps semantic identity and works without a visible pixel anchor, while a current exact-window coordinate avoids the Runtime's bounded Accessibility confirmation interval. Never use the coordinate fast path for destructive actions, overlapping controls, a hidden/minimized/off-Space target, or an unproven pixel frame.

Prefer background delivery for window click, scroll, drag, typing, and keypress. Use foreground only after a fresh state proves background delivery did not land and the action is safe to attempt again. Never treat an escalation hint as retry permission. The plugin does not persistently bring a target to the front.

Never insert a fixed post-action wait. Verification observes immediately and conditionally backs off. Use `wait` only when fresh evidence shows loading or animation is still in progress. Send complete text once rather than one character per action.

With the pinned Cua 0.22.2 runtime, precise window discovery, element targeting, and background window actions are implemented on macOS. Windows keeps the desktop screenshot path while upstream window tools remain unavailable; do not claim Windows background precision until a later locked runtime and real DPI evidence prove it.

## Actions

All calls have `snapshot_id` and exactly one `action`. Optional `delivery` is `background|foreground` only where window actions allow it. Optional `expect.element` can verify one existing window element with `value_equals`, `enabled`, or `selected`.

| Action | Address and fields |
|---|---|
| `click`, `double_click`, `right_click` | desktop: `x,y`; window: `element_ref` or `x,y` |
| `move` | desktop only: `x,y` |
| `drag` | `from_x,from_y,to_x,to_y`; optional `duration_ms` 0–10000 |
| `scroll` | `element_ref` or `x,y`; `direction`, `amount` 1–50; optional `by` |
| `set_value` | window `element_ref`, complete `value`; automatic readback verification |
| `type`, `type_text` | complete `text`; window may use `element_ref`, `x,y`, or current focused element |
| `keypress` | 1–8 `keys`; window may use `element_ref`, `x,y`, or current focused element |
| `invoke_menu` | window `path` with 1–16 exact menu segments |
| `launch_app` | desktop snapshot plus discovered opaque `app_ref`; never a path or bundle identifier |
| `wait` | `ms` 0–15000; local and cancellable |

For append-style typing or shortcuts, `effect:"unverifiable"` means delivery was attempted but not independently proved. Read the fresh state; never repeat automatically. `set_value` is preferred for a standard editable control because it verifies the complete value.

## Recovery

| Error or result | Required response |
|---|---|
| `stale_snapshot`, `stale_element_ref` | Observe again; never reuse the rejected reference. |
| `window_not_found`, `window_owner_changed`, `target_lost` | Observe the desktop and discover the target again. |
| `pixel_frame_unproven`, `coordinate_out_of_bounds` | Use an element or obtain a fresh proven screenshot. |
| `background_unavailable`, `foreground_required` | Inspect fresh state; foreground is an explicit safe escalation, not an automatic retry. |
| `verification_unsatisfied`, `verification_unknown` | Do not claim success or repeat non-idempotent input. |
| `action_timeout` | Snapshot was consumed; observe again and treat the effect as unknown. |
| `permission_required` | Stop and report the required OS permission. |
| `runtime_missing`, `runtime_unavailable`, `engine_version_mismatch`, `engine_unhealthy` | Stop and suggest setup or `computer-use doctor --json`. |
| `unsupported_platform`, `interactive_session_required` | Stop and report the platform/session boundary. |
| `action_refused`, `action_failed`, `capture_failed`, `unsupported_action` | Follow the returned recovery; never convert it to success. |

`next_state:"unavailable"` contains no reusable snapshot. `action_result.evidence` is the only independent effect evidence; `verification` describes the requested predicate and does not by itself prove that an already-satisfied condition was caused by the action.
