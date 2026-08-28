---
name: computer-use
description: Control the user's visible macOS or Windows desktop through screenshot-bound MCP actions when a task requires interacting with local GUI applications.
---

# Computer Use

Use this Skill only for work that must read or manipulate the visible local desktop. The two public tools are `computer_observe` and `computer_act`. The plugin observes and executes; you remain responsible for deciding the next step and recognizing completion.

Use the host's current vision model to inspect returned PNG images. Never request a plugin model key. Obey the host's approval, safety, and authorization rules; this Skill grants no additional authority.

## Control loop

1. Before your first action call, call `computer_observe` and inspect its screenshot.
2. Decide one smallest useful action from the current visible state. Use only the newest `snapshot_id` and send exactly one action in each `computer_act` call.
3. Inspect the newest screenshot returned by that call before choosing every next action. Do not infer success only from `action_result`.
4. If the visible goal is satisfied, stop tool use and report completion. Otherwise continue from step 2 with the new snapshot.

Never blindly repeat a failed or uncertain action. First inspect the returned screenshot; if none is available, observe again. Change the action, report a blocker, or stop according to the evidence. Report permission or runtime blockers instead of pretending the task succeeded.

## Speed and targeting

The screenshot returned by `computer_act` is already the next observation. Whenever its response includes a new screenshot and `snapshot_id`, do not call `computer_observe` again before the next action; doing so adds a capture and invalidates the usable snapshot that was just returned.

Never insert a fixed wait after a routine click, keypress, scroll, or type action. Use `wait` only when the newest screenshot contains visible evidence that loading, animation, or another UI transition is still in progress, and choose the shortest reasonable duration. Prefer a shortcut or one complete text entry when it is equivalent and focus is visually confirmed; send complete text in a single `type` action instead of one action per character.

For pixel actions, use the exact returned image rather than coordinates from a resized preview. Aim at the interior center of a clearly identified control and avoid its edge, border, or the gap between adjacent controls. If the result is wrong, inspect the new screenshot and choose a corrected point; never add a hidden coordinate offset or blind tolerance retry.

Desktop v1 observes and controls only the primary display's currently visible surface; it cannot address a background window. If another app or window becomes visible in front, geometry from the previous surface is no longer a valid target. Continue only from the newest screenshot.

## Action schema

Coordinates use the returned screenshot's pixel space, with `(0, 0)` at top left.

| `action.type` | Required fields | Optional fields / limits |
|---|---|---|
| `click` | `x`, `y` | — |
| `double_click` | `x`, `y` | — |
| `right_click` | `x`, `y` | — |
| `move` | `x`, `y` | — |
| `drag` | `from_x`, `from_y`, `to_x`, `to_y` | `duration_ms`: 0–10000 |
| `scroll` | `x`, `y`, `direction`, `amount` | direction: `up|down|left|right`; amount: 1–50; `by`: `line|page` |
| `type` | `text` | at most 20,000 Unicode characters |
| `keypress` | `keys` | 1–8 normalized key names |
| `wait` | `ms` | 0–15000 |

Call shape:

```json
{
  "snapshot_id": "snap_current",
  "action": { "type": "click", "x": 640, "y": 420 }
}
```

Click, move, drag, and scroll coordinates must be inside the current screenshot. Typing goes to the current focus, so establish and visually confirm focus first.

## Error recovery

| Error code | Response |
|---|---|
| `runtime_missing` | Stop and tell the user to run `computer-use setup`. |
| `runtime_unavailable` | Stop and report that the Runtime is unavailable; suggest `computer-use doctor --json`. |
| `engine_version_mismatch` | Stop and report the locked-version mismatch. |
| `engine_not_development_eligible` / `engine_not_release_eligible` | Stop and report that the selected Runtime is not eligible. |
| `permission_required` | Stop and report the named Screen Recording or Accessibility permission. |
| `unsupported_platform` / `interactive_session_required` | Stop and report the unsupported or non-interactive environment. |
| `stale_snapshot` | Call `computer_observe`; never reuse the rejected ID. |
| `coordinate_out_of_bounds` | Inspect a fresh screenshot and choose an in-bounds coordinate. |
| `action_timeout` | Observe again and inspect state; do not assume the action failed or succeeded. |
| `action_refused` | Stop or choose a different permitted action based on the diagnostic. |
| `action_failed` | Inspect the returned screenshot before deciding whether another action is safe. |
| `capture_failed` | Call `computer_observe`; if capture still fails, report the blocker. |
| `unsupported_action` | Choose one of the nine documented actions. |

The current snapshot is consumed before execution, including when execution fails. A successful action response carries a new screenshot and new `snapshot_id`; identical image bytes do not make an older ID valid again.
