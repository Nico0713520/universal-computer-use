# Upstream Source Map

日期：2026-08-27
用途：约束 Universal Computer Use Plugin 的源码参考、直接依赖、选择性移植和许可证义务。

## 采用规则

每段产品实现开始前，先查本表固定的上游文件，再选择以下一种方式：

1. `dependency`：直接调用上游发布包或签名 Runtime，不复制实现。
2. `adapt`：按我方 Interface 改写小型、无平台特权的通用逻辑；保留来源注释和对应许可证声明。
3. `test-pattern`：只复用测试思想、用例矩阵或断言，不复制生产实现。
4. `reference-only`：只用于验证设计思路，不进入产品代码。
5. `forbidden`：不得复制进仓库或 npm 包。

复制或改写上游代码时，文件头必须记录仓库、完整 commit、原文件路径和 SPDX 标识；随 npm 包发布的 `product/THIRD_PARTY_NOTICES.md` 同步记录。能通过依赖完成的能力不得复制同等实现。

## Cua Driver

- 仓库：<https://github.com/trycua/cua>
- 许可证 SPDX：`MIT`
- 开发基线 release：`cua-driver-rs-v0.22.2`
- 开发基线 commit：`d114f35fec05ecd37bf529e5587be86852205b64`
- macOS 必需修复：`90295148d34dac8e5a1307bac917e08171af5839`

The monorepo release is labeled Pre-release to control GitHub's Latest pointer; the plain SemVer driver channel is still a stable upstream release channel. UCU keeps `release_eligible:false` because its own named-host, installer, soak, and Windows evidence gates are incomplete—not because of that GitHub label alone.

| 上游文件 | 采用方式 | 我方用途 |
|---|---|---|
| `libs/cua-driver/typescript/src/index.ts` | dependency | 使用正式 `CuaDriver.connect(undefined)` 连接外部 Runtime；不复制生成绑定。 |
| `libs/cua-driver/rust/crates/cua-driver-contract/src/inputs.rs` | reference-only + contract fixture | 固定动作字段、枚举、边界和桌面 target 结构。 |
| `libs/cua-driver/rust/crates/cua-driver-contract/src/outputs.rs` | reference-only + contract fixture | 固定截图元数据、动作结果和拒绝 envelope 的解释规则。 |
| `docs/content/docs/concepts/capture-and-delivery-modalities.mdx` | reference-only | 校对 background/foreground、AX/pixel 两条独立轴；窗口像素默认后台路由，只有明确升级才短暂前台。 |
| `libs/cua-driver/rust/crates/platform-macos/src/tools/click.rs`、`src/input/mouse.rs` | dependency + reference-only | 由锁定 Runtime 执行 PID/window 路由、Retina 反算和背景像素投递；我方只透传精确 target/delivery，不复制原生实现。 |
| `libs/cua-driver/rust/crates/platform-macos/src/tools/invoke_menu.rs` | dependency + reference-only | TextEdit 测试资源清理使用精确 pid/window 原生菜单；Runtime 临时聚焦目标并恢复先前前台，我方不复制 AX 菜单遍历。 |
| release `cua-driver-rs-v0.22.2` 的 `list_apps`、`list_windows`、`get_window_state`、`health_report` 输出契约 | reference-only + contract fixture | 以 `product/tests/fixtures/cua/0.22.2/` 中已净化的固定响应验证字段拼写；窗口 bounds 使用 `width`/`height`，AX frame 使用 `w`/`h`。 |
| `libs/cua-driver/examples/agent-sdks/native-tools.ts` | adapt | 采用“动作后必观察、动作结果未知时不盲重试、超时后重新观察”的小型编排模式。 |
| `libs/cua-driver/rust/Skills/cua-driver/SKILL.md` | reference-only | 校对平台限制、session 生命周期和 Agent 操作说明。 |
| release `install.sh`、`install.ps1`、`_install-rust.sh` 与 tag source `_install-common.*` | dependency | 下载固定 release/tag、逐文件校验哈希后本地执行；0.22.2 的 release `_install-rust.sh` 修正了 tag source 中仍为 0.22.1 的 baked version。 |
| release 中的 `uninstall.sh`、`uninstall.ps1` | dependency | 只有显式 `uninstall --engine` 才下载固定 release 文件、校验哈希并执行。 |
| `libs/cua-driver/scripts/tests/*install*`、`*uninstall*` | test-pattern | 覆盖安装回滚、autostart、历史版本和卸载回归。 |
| `libs/cua-driver/rust/crates/platform-*`、生成的 native bindings 和签名脚本 | forbidden | 不复制平台输入、TCC、UIA、DPI、签名或生成绑定实现。 |

## UI-TARS Desktop

- 仓库：<https://github.com/bytedance/UI-TARS-desktop>
- 许可证 SPDX：`Apache-2.0`
- 固定 commit：`c2ad42e3eb9b27830db41a3e6f51ca7179d9b168`

| 上游文件 | 采用方式 | 我方用途 |
|---|---|---|
| `multimodal/gui-agent/agent-sdk/src/GUIAgent.ts` | reference-only | 采用每次工具动作结束后重新截图并将新图送入下一轮的 Harness 思路。 |
| `multimodal/gui-agent/agent-sdk/src/ToolCallEngine.ts` | reference-only | 校对自然停止和失败动作解析方式；模型解析器不进入插件。 |
| `multimodal/gui-agent/action-parser/test/coordinates.test.ts` | test-pattern | 扩充坐标输入、非法值和边界测试，但我方只接受严格 JSON Schema，不接受宽松文本坐标。 |
| `apps/ui-tars/src/main/agent/operator.ts` | reference-only | 用其物理/逻辑尺寸处理历史验证 Retina/DPI 风险；不复制 Electron/NutJS 执行层。 |
| UI、Electron 主进程、模型客户端、prompt parser、NutJS operator | forbidden | 插件无聊天 GUI、无模型、无内部 Agent 循环，也不维护第二套原生执行器。 |

## OpenAI Agents SDK

- 仓库：<https://github.com/openai/openai-agents-python>
- 许可证 SPDX：`MIT`
- 固定 commit：`10cdae4a3c30a29c6e96c8ec14e6bf1c5f02940e`

| 上游文件 | 采用方式 | 我方用途 |
|---|---|---|
| `src/agents/computer.py` | reference-only | 校对最小 Computer Interface：截图、点击、双击、滚动、输入、等待、移动、按键、拖拽。 |
| `tests/test_computer_action.py` | test-pattern | 每个动作映射后必须截图；用 fake computer 记录调用顺序。 |
| `tests/test_computer_tool_lifecycle.py` | test-pattern | session/transport 生命周期、并发隔离和退出时清理。 |

OpenAI 的模型专用 `ComputerTool`、批量动作和 safety-check 协议不直接复制；本项目保持通用 MCP 两工具 Interface，并服从宿主自身审批策略。

## 上游晋级流程

1. 只接受明确 SemVer release，不跟随 `main`、nightly 或浮动 URL。
2. 更新 `engine.lock.json` 前比较上述 Cua 契约文件、SDK 入口、安装器和 release notes。
3. 自动 contract diff 只能生成报告，不能自动放宽我方 Schema 或错误语义。
4. 重新运行单元、契约、macOS Retina、Windows DPI 和宿主验收。
5. 固定资产哈希、安装/卸载脚本哈希、实际签名者身份和证据路径后，才能把对应平台设为 `release_eligible:true`。
6. 上游出现更高级能力时默认不暴露；只有独立设计、测试和版本升级后才能进入公共 Interface。
