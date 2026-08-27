const adapter = Object.freeze({
  status: "experimental",
  skill: "../../skills/computer-use/SKILL.md",
  tools: Object.freeze(["computer_observe", "computer_act"]),
  mcpServers: Object.freeze({
    "computer-use": Object.freeze({
      command: "computer-use-mcp",
      args: Object.freeze([]),
    }),
  }),
});

export default adapter;
