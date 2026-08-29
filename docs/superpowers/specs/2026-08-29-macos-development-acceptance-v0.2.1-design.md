# Universal Computer Use v0.2.1：macOS Developer Preview 完整验收设计

日期：2026-08-29

状态：已完成技术调研，待用户复核后实施

目标版本：`0.2.1`

## 1. 结论

v0.2.1 把当前分散的 macOS 真机验证、宿主接入、性能测量、MCP 生命周期和开发证据合并为一个验收闭环，但不降低现有 Beta/Stable 发布门槛。

本批次交付一个长驻的开发验收运行器、一套脱敏开发证据、Codex/Kimi/HanaAgent/WorkBuddy 共用的宿主验收规则、MCP server instructions 和准确的项目进度矩阵。它证明当前开发版本是否真的好用，不把开发通过伪装成正式发布资格。

Windows DPI 真机证据、Windows 精确窗口模式、Browser/CDP、多显示器和富剪贴板不进入本批次。

## 2. 调研依据与设计修正

### 2.1 Codex 官方能力

OpenAI Codex 官方 MCP 文档确认：ChatGPT 桌面端、Codex CLI 和 IDE 扩展均支持本地 stdio MCP，并在同一 Codex host 上共享配置；Codex还会读取 MCP 初始化响应中的 `instructions`。因此 UCU 应把最短、最关键的 observe → act → fresh state → stop 规则放进 server instructions，Canonical Skill 保留更完整的恢复和安全策略。

参考：<https://developers.openai.com/codex/mcp/>

### 2.2 MCP Inspector 的边界

MCP Inspector 官方 CLI 适合 CI、`initialize`、`tools/list` 和单次 `tools/call`，但每次 CLI 调用都会连接、执行一个请求然后退出。UCU 的 `snapshot_id`、`window_ref` 和 `element_ref` 都是长驻 transport 进程内状态，所以 Inspector 不能承担完整循环验收。

参考：<https://modelcontextprotocol.io/docs/tools/inspector>、<https://modelcontextprotocol.io/docs/tools/inspector/cli>、<https://github.com/modelcontextprotocol/inspector>

设计决定：Inspector 仅作为可选协议烟测；完整状态循环继续使用仓库已依赖的 `@modelcontextprotocol/sdk`，通过一个长驻 `Client + StdioClientTransport` 完成。

### 2.3 三种实现方式

1. **统一长驻验收运行器（采用）**：共享真实 MCP 客户端、确定性桌面 Fixture、性能采集和证据输出；宿主只补最少人工证据。证明力强且复用现有 E2E。
2. **逐宿主 UI 自动化（不采用）**：让脚本操作 Codex/Hana/Kimi/WorkBuddy 自身界面。该方案会形成“用 computer use 测 computer use”的循环依赖，宿主版本变化也会使测试脆弱。
3. **只有手工检查表（不采用）**：成本低，但不能稳定证明 snapshot、PNG、后台动作、重启和延迟。

## 3. 产品边界

### 3.1 本批次包含

- 长驻 stdio MCP 初始化、工具清单和图片内容验证；
- 主桌面 observe/act 新 snapshot 验证；
- 应用/窗口发现和精确窗口 PNG；
- 一个低风险 `element_ref` 后台动作；
- 一个低风险窗口局部坐标快速动作；
- stale snapshot、进程关闭和 MCP 重连验证；
- 冷启动、桌面观察、发现、窗口观察、快速动作、语义动作的分段耗时；
- MCP server instructions；
- Codex、Kimi、HanaAgent、WorkBuddy 的开发验收手册和脱敏证据；
- 安装、重启、权限和宿主配置的真实进度矩阵。

### 3.2 本批次不包含

- npm 正式发布或 `release_eligible:true`；
- 修改或放宽 Beta/Stable 证据门槛；
- 自动编辑宿主的配置文件；
- 自动降低宿主审批策略；
- 自动重启共享 CuaDriver daemon；
- 保存截图、输入内容、用户名、主机名或本机绝对路径；
- Windows 精确窗口、Windows DPI 证据、CDP、多显示器、批动作和富剪贴板。

## 4. 架构

```text
pnpm acceptance:macos
        ↓
Development Acceptance Orchestrator
        ├─ preflight: OS / engine lock / doctor / browser / permissions
        ├─ deterministic fixture + isolated browser profile
        ├─ long-lived MCP SDK Client + StdioClientTransport
        ├─ stateful acceptance scenarios
        ├─ monotonic latency recorder
        └─ redacted development evidence JSON

Named host runbook
        ↓
Codex / Kimi / HanaAgent / WorkBuddy
        ├─ direct stdio registration
        ├─ exact two-tool inventory
        ├─ first and later PNG reach the host model
        ├─ repeated calls and natural stop
        └─ separate redacted host-development evidence JSON
```

验收运行器不依赖模型，也不冒充宿主 Agent。它只证明 MCP 和真实桌面执行层。模型是否收到图片、是否继续循环和是否自然停止只能由命名宿主的真实会话证明。

## 5. 核心模块

### 5.1 `DevelopmentAcceptanceClient`

职责：拥有一个长驻 `@modelcontextprotocol/sdk` client，初始化正式 `dist/mcp/main.js`，只通过公开 `computer_observe` 和 `computer_act` 测试产品。

公开接口：

```ts
type AcceptanceTimingName =
  | "mcp_start"
  | "desktop_observe"
  | "window_discover"
  | "window_observe"
  | "coordinate_action"
  | "element_action"
  | "mcp_reconnect";

type AcceptanceTiming = Readonly<{
  name: AcceptanceTimingName;
  duration_ms: number;
  target_ms: number;
  hard_limit_ms: number;
  status: "target_met" | "degraded" | "failed";
}>;
```

它验证 PNG magic bytes、结构化结果、工具清单、snapshot 更新、旧 snapshot 拒绝、窗口引用和动作后新状态。它不读取内部 PID、window ID、Cua token 或私有 registry。

### 5.2 `DevelopmentAcceptanceFixture`

复用现有 loopback HTML Fixture 和隔离浏览器 profile。Fixture 提供固定标题、标准按钮、文本字段、计数状态和自绘区域：

- 标准按钮验证 `element_ref`；
- 另一个低风险矩形按钮验证窗口局部坐标；
- 文本字段只输入运行期随机、验收结束即丢弃的短句，证据中只记录布尔结果；
- Fixture HTTP 状态是独立真值，用于证明动作确实生效，不从插件返回反推成功。

测试结束必须关闭浏览器、Fixture、MCP transport，并删除临时 profile。

### 5.3 `AcceptanceRecorder`

使用单调时钟包围每个公开调用。目标与硬上限分离：

| 阶段 | 目标 | 硬上限 |
|---|---:|---:|
| MCP 冷启动 | 2,000 ms | 10,000 ms |
| 桌面观察 | 1,000 ms | 3,000 ms |
| 窗口发现 | 1,000 ms | 3,000 ms |
| 精确窗口观察 | 1,000 ms | 3,000 ms |
| 窗口局部坐标动作及新观察 | 1,000 ms | 3,000 ms |
| `element_ref` 动作及新观察 | 3,000 ms | 8,000 ms |
| MCP 重连 | 2,000 ms | 10,000 ms |

超过目标但未超过硬上限标记 `degraded`，不会伪装成性能通过；超过硬上限则整个场景失败。目标是产品 SLO，硬上限用于吸收普通机器抖动。

### 5.4 MCP server instructions

初始化指令前 512 字符内必须自包含以下规则：

1. 首次动作前 observe；
2. 发现并锁定精确窗口；
3. 一次只执行一个最小动作；
4. 只使用最新 snapshot；
5. 直接检查 `computer_act` 返回的新状态，不重复 observe；
6. 不盲重试不可验证输入；
7. 目标已证明后自然停止。

指令不包含授权绕过、不要求第二个模型，也不替代宿主自己的安全策略。

## 6. 验收流程

### 6.1 自动开发验收

1. 校验 macOS、Node 版本、构建产物和 engine lock；
2. 运行 doctor，失败立即停止；
3. 启动确定性 Fixture 和隔离浏览器；
4. 启动长驻 MCP client，确认工具恰好为两个；
5. `computer_observe` 获取首张 PNG；
6. `wait(0)` 验证动作后直接返回新 PNG 和新 snapshot；
7. 使用旧 snapshot，验证稳定返回 stale；
8. 发现 Fixture 窗口并获得 `window_ref`；
9. 精确观察窗口，获得 PNG 和标准按钮 `element_ref`；
10. 用 `element_ref` 后台点击并以 Fixture 状态证明效果；
11. 用最新窗口 PNG 的低风险矩形中心执行坐标动作并证明效果；
12. 关闭 MCP，重新连接；验证旧引用不能跨 transport 复用；
13. 输出脱敏 JSON，并完成资源清理。

### 6.2 命名宿主验收

Codex、Kimi、HanaAgent 和 WorkBuddy 共用相同最小任务：

- 任务 A：发现并锁定 Calculator，使用窗口精准模式完成 `37 × 19 = 703`；
- 任务 B：打开 TextEdit，输入一次性短句并视觉确认；
- 第一张和至少一张后续 PNG 必须到达同一个宿主报告的模型；
- 必须出现重复工具调用；
- 目标满足后不得继续调用工具；
- 插件确认次数必须为零；宿主自己的审批行为如实记录。

HanaAgent/WorkBuddy 不会因为一次桥接测试就升级为“verified”。只有宿主直接注册正式 MCP、重启后工具仍存在并跑完整任务，才可记录 `development-passed`。

## 7. 证据与隐私

开发证据和发布证据严格分开。

### 7.1 自动验收证据

允许字段：schema/version、插件/协议/引擎版本、macOS 版本和架构、场景布尔结果、分段耗时、资源清理结果、UTC 时间。

禁止字段：截图/base64/哈希、窗口标题、输入文本、路径、用户名、主机名、环境变量、PID、window ID、snapshot/ref/token 原文。

### 7.2 宿主开发证据

宿主名称允许 `codex | kimi | hanaagent | workbuddy`；状态允许 `development-passed | failed | blocked | not-run`。`development-passed` 不等于 `verified`，不得被 release 验证器当作 Beta/Stable 证据。

真实证据继续存放在仓库外；仓库只保存 schema、生成器、验证器和空白模板。

## 8. CLI 与开发者体验

本批次采用仓库脚本而不是立即增加公开生产 CLI：

```bash
cd product
pnpm acceptance:macos
```

理由：当前 Runtime 仍是 development-only，把验收命令塞进发布包会增加尚未证明的生产表面。等候选 Runtime 晋级后，再评估是否把稳定运行器包装成 `computer-use acceptance`。

脚本默认只运行当前开发验收；需要受控 daemon restart 的正式候选 lane 继续由现有 `tests/e2e/macos/run.sh` 承担，不自动停止其他产品可能共享的 CuaDriver。

## 9. 错误处理

- preflight 失败：输出一个稳定错误码并且不启动 Fixture；
- MCP 初始化/工具清单错误：终止，不继续操作桌面；
- PNG/结构化响应错误：终止并清理所有子进程；
- stale snapshot 未拒绝：协议安全失败；
- 动作效果没有被 Fixture 独立证明：动作失败，不看 `effect` 猜成功；
- 超过性能目标：`degraded`；超过硬上限：失败；
- MCP 重连失败或旧引用仍可用：生命周期失败；
- 任一清理失败：证据记录 `cleanup_passed:false`，进程以非零状态退出；
- 宿主无法转发 MCP ImageContent：该宿主记录 `blocked` 或 `failed`，不内置第二视觉模型。

## 10. 测试接缝与 TDD

本批次只在以下已确认公共接缝写测试：

1. `MCP public seam`：真实 stdio `initialize/tools/list/tools/call`；
2. `Acceptance recorder seam`：固定单调时钟输入到脱敏证据输出；
3. `Acceptance CLI seam`：进程退出码、stdout JSON、stderr 诊断和清理；
4. `Host evidence seam`：JSON schema 和仓库外证据验证；
5. `Real macOS seam`：现有 loopback Fixture + 真实 CuaDriver + 隔离浏览器。

不测试私有字段、不 mock 内部 registry、不通过文件或 Cua 原生工具旁路公开 MCP 判断结果。

## 11. 进度矩阵

README 增加以下独立状态，禁止用一个“完成百分比”掩盖不同证据：

| 能力 | 代码 | 自动契约 | macOS 真机 | 命名宿主 | 发布资格 |
|---|---|---|---|---|---|
| 桌面 observe/act | complete | passed | development-passed | pending | blocked |
| macOS 窗口精准 | complete | passed | 当前批次验收 | pending | blocked |
| macOS 后台语义动作 | complete | passed | 当前批次验收 | pending | blocked |
| Windows 桌面 | complete | passed | 不适用 | pending | blocked |
| Windows DPI | harness complete | passed | pending real hardware | pending | blocked |
| Windows 窗口精准 | blocked upstream | truthful refusal | unavailable | unavailable | blocked |

## 12. 完成标准

v0.2.1 只有在以下条件全部满足时才算完成：

- 自动验收运行器只调用两个公开 MCP 工具；
- 自动场景完整通过或如实报告 degraded/failed；
- 所有证据通过 schema 且不包含隐私字段；
- server instructions 在初始化契约测试中可见；
- MCP 关闭和重连无 session 泄漏；
- 全量单元/契约测试、类型检查、构建和 npm dry-run 通过；
- 一台真实 macOS 机器跑出 development evidence；
- Codex/HanaAgent/WorkBuddy 的手册可执行，但没有实际宿主证据时仍保持 pending；
- Windows 和 Beta/Stable 边界继续诚实显示 blocked/pending。
