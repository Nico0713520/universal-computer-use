# Host compatibility

Compatibility is evidence-based. The only status values are `verified`, `experimental`, `not-compatible`, and `not-tested`. A host is not `verified` until Task 13 records a dated end-to-end run against an eligible Runtime on each claimed operating system.

| Host | Status | Evidence date | OS | Host version | Image delivery | Continuous loop | Automatic mode | Limitation |
|---|---|---|---|---|---|---|---|---|
| Generic MCP | not-tested | — | macOS / Windows | — | not-tested | not-tested | not-tested | Static configuration contract exists; host-specific end-to-end evidence is pending. |
| Codex | not-tested | — | macOS / Windows | — | not-tested | not-tested | not-tested | Registration guide exists; eligible-Runtime host evidence is pending. |
| Kimi | not-tested | — | macOS / Windows | — | not-tested | not-tested | not-tested | Registration guide exists; eligible-Runtime host evidence is pending. |

## Evidence rules

- Evidence date is the UTC date of the run, not the documentation edit date.
- OS records the exact platform version tested; Host version records the exact application or harness version.
- Image delivery proves that MCP image content reached the host's current multimodal capability.
- Continuous loop proves that the host can call tools repeatedly and naturally stop after the visible goal is met.
- Automatic mode records observed host behavior and any user-controlled approval setting. The plugin does not override host authorization.
- Limitations state missing platforms, blocked permissions, secure-desktop exclusions, or other boundaries observed in the run.

The generic `integrations/generic/mcp.json` file is a portable development sample that launches `computer-use-mcp` from the executable search path. Production installations should run `computer-use config --client generic` and use its absolute Node executable plus absolute MCP script configuration. Codex and Kimi installations should likewise use their generated host command and install or link the same canonical Skill shipped in `product/skills/computer-use`.
