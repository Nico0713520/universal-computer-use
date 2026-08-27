# Kimi integration

This adapter registers the packaged Computer Use MCP and the [canonical Skill](../../skills/computer-use/SKILL.md). The server exposes exactly `computer_observe` and `computer_act`; decision-making stays in Kimi.

1. Install the package and run `computer-use setup` (or the explicitly non-release `computer-use setup --development` workflow).
2. Link or install the `../../skills/computer-use` directory into Kimi's configured Skill directory. Keep `SKILL.md` canonical; do not maintain a host-specific copy.
3. Run `computer-use config --client kimi`, then execute the registration command printed to standard output.
4. Restart or reload Kimi's MCP configuration and confirm both tools are present.

For production, use the generated registration command. It pins the absolute Node executable and absolute MCP script paths, so it launches the same packaged MCP entry point as `computer-use-mcp` without depending on the shell's executable search path.

Kimi must support local stdio MCP, forward MCP image content to its current multimodal capability, continue tool calls, and expose the user's selected automatic-action setting. Host authorization rules remain authoritative.
