export const MCP_SERVER_INSTRUCTIONS = [
  "Observe before the first action. Discover and lock the exact window when possible. Execute one action at a time using only the latest snapshot. computer_act returns the fresh next state; inspect it instead of observing again. Never blindly retry unverifiable input. Stop as soon as the visible goal is proved.",
  "Prefer element_ref inside an exact window; use screenshot coordinates only when semantic elements are unavailable. Re-discover after a stale or lost target.",
].join(" ");
