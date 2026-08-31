# Host compatibility

Compatibility is evidence-based. The only status values are `verified`, `experimental`, `not-compatible`, and `not-tested`. The v0.2.6 Mac Agent Preview is not a public Beta, and a host is not promoted by configuration generation or a local shell test.

| Host | Status | Evidence date | OS | Host version | Image delivery | Continuous loop | Automatic mode | Limitation |
|---|---|---|---|---|---|---|---|---|
| Generic MCP | experimental | — | macOS / Windows | — | not-tested | not-tested | not-tested | Portable model-free configuration is contract-tested; no named host has supplied image/loop evidence. |
| Codex | not-tested | — | macOS / Windows | — | not-tested | not-tested | not-tested | Named registration exists; an exact-commit external Preview report and separate release evidence are pending. |
| HanaAgent | not-tested | — | macOS | — | not-tested | not-tested | not-tested | Named absolute direct-stdio configuration exists; an exact-commit external report is pending. |
| Kimi | not-tested | — | macOS / Windows | — | not-tested | not-tested | not-tested | Registration guide exists; eligible-Runtime host evidence is pending. |
| WorkBuddy | experimental | — | macOS | — | not-tested | not-tested | not-tested | Named manual configuration exists; an exact-commit external report against a named WorkBuddy version is pending. |
| DeepSeek Harness | experimental | — | macOS / Windows | — | not-tested | not-tested | not-tested | Declaration-only Cordis adapter; host loading format and end-to-end behavior need validation against a named Harness version. |

## Evidence rules

- Evidence date is the UTC date of the run, not the documentation edit date.
- OS records the exact platform version tested; Host version records the exact application or harness version.
- Image delivery proves that MCP image content reached the host's current multimodal capability.
- Continuous loop proves that the host can call tools repeatedly and naturally stop after the visible goal is met.
- Automatic mode records observed host behavior and any user-controlled approval setting. The plugin does not override host authorization.
- Limitations state missing platforms, blocked permissions, secure-desktop exclusions, or other boundaries observed in the run.

Codex and Kimi evidence is accepted only through the strict `product/tests/e2e/host/evidence.schema.json` contract. A `verified` record must reference and hash platform E2E evidence already represented by a release-eligible engine lock, prove both PNG turns reached the same host-reported model, complete both fixed tasks, and stop naturally. Real evidence stays outside the repository; the checked-in `codex.md` and `kimi.md` files are runbooks, not pass records. With no eligible Runtime evidence available, Codex and Kimi remain explicitly `not-tested`.

Mac Agent Preview runs use the separate strict v2 `product/tests/e2e/host/development-evidence.schema.json` contract for Codex, HanaAgent, and WorkBuddy. A valid `external-run` report is bound to the exact public repository and commit, direct stdio transport, exactly two tools, two PNG turns reaching the same host model in one loop, all three tasks, and natural stop. It is deliberately invisible to release verification: it has no eligible-platform link or promotion authority and never changes Beta/Stable eligibility. Kimi is not part of this v0.2.6 Preview set; its older development lane is retired without claiming incompatibility.

The generic `integrations/generic/mcp.json` file is a portable experimental sample that launches `computer-use-mcp` from the executable search path. Its static shape and the generated absolute-path configuration are contract-tested, and neither contains a model or credential. That is not proof that an unnamed host forwards images or continues a tool loop. Installations should run `computer-use config --client generic`, `codex`, `kimi`, `hanaagent`, or `workbuddy` and use the generated absolute direct stdio configuration. Every host follows the same Canonical Computer Use Skill shipped in `product/skills/computer-use`; the plugin does not include an internal vision model or another host-specific loop.

Product `0.2.6` and protocol `1.2.0` keep exactly two tools on the host surface. macOS pre-session recovery can start an installed but stopped, signature-verified CuaDriver before any MCP request exists; it does not replay a tool call. UCU disables Cua's session-owned Agent Cursor on both internal sessions and verifies both readbacks before serving host calls, avoiding visible presentation motion without adding a fixed post-action delay. Foreground delivery can still activate another application. macOS hosts may use opaque app/window discovery, semantic elements, exact window PNGs and explicit background delivery. After a visual exact-window state grounds the task, a confirmed low-risk action may request a semantic next state with `next_observation`; coordinate, foreground, failed, refused, unconfirmed, or otherwise unsafe paths use `visual_recovery` and require the host to inspect the returned visual state instead of blindly replaying the action. With the pinned Cua 0.22.2 runtime, Windows hosts must remain on the primary-desktop path because the upstream Windows discovery/window-state tools are stubs. Host compatibility and platform execution capability are separate claims: a host forwarding MCP images on Windows does not prove Windows window precision.

External Preview testing is serial: run one host at a time. Multi-Agent concurrent control is deferred until the single-host path is stable, so no compatibility row currently claims simultaneous shared-desktop control.

The packaged WorkBuddy manifest is an inert experimental declaration and `mcp.example.json` is structure-only; the actual absolute paths come from `computer-use config --client workbuddy`. DeepSeek Harness remains a declaration-only adapter. Neither adds a host-specific control loop or changes the public tool protocol, and neither manifest shape is compatibility evidence. Keep them experimental until a named host version proves loading, image delivery, repeated tool calls, automatic-mode behavior and natural stop using the evidence rules above.
