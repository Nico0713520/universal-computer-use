# WorkBuddy integration

Status: experimental and not tested. This adapter is a manual local stdio registration guide, not a verified compatibility claim, installer, or settings editor.

WorkBuddy must use the [canonical Skill](../../skills/computer-use/SKILL.md). Do not copy or rewrite its control loop into a host-specific prompt. The MCP server exposes exactly `computer_observe` and `computer_act`, while decision-making stays in WorkBuddy's current multimodal capability.

## Build and diagnose

From a source checkout, enter the `product` directory and run:

```bash
pnpm install --frozen-lockfile
pnpm build
node dist/cli/main.js setup --development
node dist/cli/main.js doctor --json
node dist/cli/main.js config --client workbuddy
```

When the package binary is already installed, the equivalent named command is `computer-use config --client workbuddy`.

Stop if build, setup, or doctor fails. macOS Screen Recording and Accessibility authorization must be granted manually in System Settings when requested.

## Register manually

Copy only the JSON printed by the named config command into WorkBuddy's local stdio MCP configuration. The generated `command` is the absolute Node executable and its only argument is the absolute MCP script. Those paths deliberately avoid dependence on the shell's executable search path.

The committed `.mcp.json` is a fail-closed shape example: its `/replace/...` values are deliberately unusable. Do not copy it unchanged. The named config command is the source of the real absolute paths. Neither command nor example locates or edits WorkBuddy settings.

Use the configuration location documented by the installed WorkBuddy version. Then restart WorkBuddy and start a new conversation. Registration performed after a conversation starts may not update that conversation's frozen tool list.

In the new conversation, verify that the server is named `computer-use` and that the only public tools are `computer_observe` and `computer_act`. Also verify that PNG content returned by `computer_observe` reaches WorkBuddy's current multimodal capability. Configuration discovery alone is not proof of image delivery or a working control loop.
