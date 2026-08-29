# Host compatibility

Compatibility is evidence-based. The only status values are `verified`, `experimental`, `not-compatible`, and `not-tested`. A host is not `verified` until Task 13 records a dated end-to-end run against an eligible Runtime on each claimed operating system.

| Host | Status | Evidence date | OS | Host version | Image delivery | Continuous loop | Automatic mode | Limitation |
|---|---|---|---|---|---|---|---|---|
| Generic MCP | experimental | — | macOS / Windows | — | not-tested | not-tested | not-tested | Portable model-free configuration is contract-tested; no named host has supplied image/loop evidence. |
| Codex | not-tested | — | macOS / Windows | — | not-tested | not-tested | not-tested | Registration guide exists; eligible-Runtime host evidence is pending. |
| Kimi | not-tested | — | macOS / Windows | — | not-tested | not-tested | not-tested | Registration guide exists; eligible-Runtime host evidence is pending. |
| WorkBuddy | experimental | — | macOS / Windows | — | not-tested | not-tested | not-tested | Declaration-only adapter; host loading format and end-to-end behavior need validation against a named WorkBuddy version. |
| DeepSeek Harness | experimental | — | macOS / Windows | — | not-tested | not-tested | not-tested | Declaration-only Cordis adapter; host loading format and end-to-end behavior need validation against a named Harness version. |

## Evidence rules

- Evidence date is the UTC date of the run, not the documentation edit date.
- OS records the exact platform version tested; Host version records the exact application or harness version.
- Image delivery proves that MCP image content reached the host's current multimodal capability.
- Continuous loop proves that the host can call tools repeatedly and naturally stop after the visible goal is met.
- Automatic mode records observed host behavior and any user-controlled approval setting. The plugin does not override host authorization.
- Limitations state missing platforms, blocked permissions, secure-desktop exclusions, or other boundaries observed in the run.

Codex and Kimi evidence is accepted only through the strict `product/tests/e2e/host/evidence.schema.json` contract. A `verified` record must reference and hash platform E2E evidence already represented by a release-eligible engine lock, prove both PNG turns reached the same host-reported model, complete both fixed tasks, and stop naturally. Real evidence stays outside the repository; the checked-in `codex.md` and `kimi.md` files are runbooks, not pass records. With no eligible Runtime evidence available, Codex and Kimi remain explicitly `not-tested`.

Developer-preview runs use the separate `product/tests/e2e/host/development-evidence.schema.json` contract and the Codex, Kimi, HanaAgent or WorkBuddy development sections. `development-passed` proves a named version on one development machine but is deliberately invisible to release verification: it has no eligible-platform link or promotion authority and never changes the production table above.

The generic `integrations/generic/mcp.json` file is a portable experimental sample that launches `computer-use-mcp` from the executable search path. Its static shape and the generated absolute-path configuration are contract-tested, and neither contains a model or credential. That is not proof that an unnamed host forwards images or continues a tool loop. Production installations should run `computer-use config --client generic` and use its absolute Node executable plus absolute MCP script configuration. Codex and Kimi installations should likewise use their generated host command and install or link the same canonical Skill shipped in `product/skills/computer-use`.

Product `0.2.2` and protocol `1.2.0` keep the same two-tool host surface. macOS hosts may use opaque app/window discovery, semantic elements, exact window PNGs and explicit background delivery. After a visual exact-window state grounds the task, a confirmed low-risk action may request a semantic next state with `next_observation`; coordinate, foreground, failed, refused, unconfirmed, or otherwise unsafe paths use `visual_recovery` and require the host to inspect the returned visual state instead of blindly replaying the action. With the pinned Cua 0.22.2 runtime, Windows hosts must remain on the primary-desktop path because the upstream Windows discovery/window-state tools are stubs. Host compatibility and platform execution capability are separate claims: a host forwarding MCP images on Windows does not prove Windows window precision.

The WorkBuddy and DeepSeek Harness directories are non-blocking experimental declarations. Both point at that same canonical Skill and launch the same `computer-use-mcp` executable; neither adds a host-specific control loop or changes the public tool protocol. Their manifest shapes are not compatibility evidence. Keep them experimental until a named host version proves loading, image delivery, repeated tool calls, automatic-mode behavior and natural stop using the evidence rules above.
