# HanaAgent integration

Status: Developer Preview candidate, not tested. This adapter only documents manual local stdio registration; it does not change HanaAgent settings.

HanaAgent must use the [canonical Skill](../../skills/computer-use/SKILL.md). Do not copy or rewrite its control loop into a host-specific prompt. The MCP server exposes exactly `computer_observe` and `computer_act`, while decision-making stays in HanaAgent's current multimodal capability.

## Build and diagnose

From a source checkout, enter the `product` directory and run:

```bash
pnpm install --frozen-lockfile
pnpm build
node dist/cli/main.js setup --development
node dist/cli/main.js doctor --json
node dist/cli/main.js config --client hanaagent
```

When the package binary is already installed, the equivalent named command is `computer-use config --client hanaagent`.

Stop if build, setup, or doctor fails. macOS Screen Recording and Accessibility authorization must be granted manually in System Settings when requested.

## Register manually

Copy only the JSON printed by the named config command into HanaAgent's local stdio MCP configuration. The generated `command` is the absolute Node executable and its only argument is the absolute MCP script. Those paths deliberately avoid dependence on the shell's executable search path.

The command only prints configuration; it does not locate or edit HanaAgent settings. Use the configuration location documented by the installed HanaAgent version. Then restart HanaAgent and start a new conversation. Registration performed after a conversation starts may not update that conversation's frozen tool list.

In the new conversation, verify that the server is named `computer-use` and that the only public tools are `computer_observe` and `computer_act`. Also verify that PNG content returned by `computer_observe` reaches HanaAgent's current multimodal capability. Configuration discovery alone is not proof of image delivery or a working control loop.
