# Universal Computer Use v0.2.6 Mac Agent Preview 设计规格

状态：待用户书面复核后进入实施计划

日期：2026-08-31

## 1. 决策摘要

v0.2.6 的唯一目标是把现有 v0.2.5 macOS 开发版推进为一个可以交给 Codex、HanaAgent 和 WorkBuddy 分别直接测试的 Mac Agent Preview。

本版本继续保持轻量边界：宿主 Agent 当前使用的多模态模型负责理解截图、决定动作和判断停止；UCU 只提供 `computer_observe` 与 `computer_act` 两个 MCP 工具、截图绑定状态机、Cua 适配、验证、诊断和宿主接入资料。插件不增加内置模型、模型端点、聊天 GUI 或第三个 MCP 工具。

多 Agent 同时控制一个物理桌面的协调、跨进程租约和 `desktop_busy` 不进入 v0.2.6。三个宿主必须串行验收；测试某一宿主时，其他宿主不得同时执行 UCU 动作。该并发能力只在 Mac 单宿主体验、公开 Beta 和 Windows 主路径稳定后重新评估。

## 2. 当前基线

v0.2.5 已具备：

- 两工具 MCP 协议与一次性 `snapshot_id`；
- desktop/window 双 Cua session；
- 桌面截图、窗口发现、独立窗口截图和有界 Accessibility 元素；
- 点击、双击、右键、移动、拖拽、滚动、文本输入、按键/快捷键、菜单、应用启动、`set_value` 与显式等待；
- `window_ref` / `element_ref`、窗口身份复核、后台语义投递、后台窗口像素投递和显式前台回退；
- 动作后视觉/语义自适应观察、视觉恢复和有界验证；
- 动作先消费 snapshot、禁止盲目重放、单进程 FIFO 和 exactly-once 测试接缝；
- Cua Runtime 精确版本锁、签名/哈希校验、开发安装、启动前有限恢复、诊断和卸载；
- desktop/window 两个 session 都关闭 Cua Agent Cursor 并回读确认；
- schema-v4 开发证据、动作路径聚合、单 profile 性能入口与 Cursor A/B 入口；
- 580 个确定性单元/契约测试、类型检查、构建和 npm 预打包通过。

当前仍缺：

- v0.2.5 Cursor 关闭后的真实同目标 A/B 和完整 Mac 证据；
- Codex、HanaAgent、WorkBuddy 在重启后无桥接直连的真实证据；
- 面向非项目开发者的权限、Runtime、宿主重启和图片转发诊断；
- 一个远端 commit 与测试提示词严格对应的 GitHub Preview 交付流程。

## 3. 目标与非目标

### 3.1 必须达到

1. 在约定的空闲 Mac 桌面上，Cursor A/B、四个单 profile 和完整 schema-v4 验收能够给出可复现结果。
2. 执行层未达到准确率或延迟门槛时，必须先定位并修复，不能把失败交给宿主模型掩盖。
3. Codex、HanaAgent、WorkBuddy 分别从同一个公开 GitHub commit 安装或更新 UCU，重启后直接发现两个工具。
4. 三个宿主使用自身当前多模态模型接收至少连续两轮真实截图并完成循环，不为 UCU 配第二个视觉模型。
5. 每个宿主都必须完成计算器、唯一文本输入、被遮挡窗口三个验收任务，并自然停止。
6. 宿主直连验收禁止使用 shell JSON-RPC 桥、宿主内置 Computer Use、AppleScript、浏览器 DOM 自动化或心算代替 UCU。
7. 安装和诊断输出必须使用大白话区分 Runtime 缺失、版本不符、屏幕录制未授权、辅助功能未授权、宿主需重启、工具未刷新和图片未转发。
8. 在发给外部 Agent 测试提示词前，GitHub 远端必须包含被测代码；提示词必须写明仓库 URL、目标 commit、更新/安装方法和 commit 校验命令。

### 3.2 明确不做

- 不做多 Agent 并发控制、跨进程桌面锁或共享任务调度。
- 不做 DMG、PKG、正式 Apple 公证、自动更新器或 Mac App GUI。
- 不宣称公开 Beta、Stable 或 `release_eligible:true`。
- 不升级或 fork Cua，除非当前精确锁定版本出现经证据证明且无法在适配层解决的阻断。
- 不做 Browser/CDP、区域/增量截图、多显示器、剪贴板、文件上传下载或富文本专用通道。
- 不自动修改未知宿主的配置文件，不绕过宿主审批策略，不绕过 macOS TCC 权限。
- 不在用户使用桌面时自动运行任何会移动鼠标、激活应用或输入文字的真机测试。

## 4. Preview 使用流程

```text
用户或测试 Agent 获取 GitHub 指定 commit
  → 构建或安装 v0.2.6 Developer Preview
  → setup --development 安装/核验锁定 Cua Runtime
  → 用户手动授予 Screen Recording 与 Accessibility
  → doctor 检查 Runtime、权限、截图、Cursor session 初始化
  → config --client <host> 输出已验证的宿主配置与重启提示
  → 重启宿主并新建会话
  → 宿主当前多模态模型调用 computer_observe
  → 模型依据截图调用一次 computer_act
  → 使用动作返回的新状态继续，直至自然停止
```

注册发生在宿主会话启动之后、工具表被冻结、或宿主不转发 MCP `ImageContent` 时，插件不得伪装成功。文档和诊断必须明确指出“重启宿主并新建会话”或“当前宿主版本无法证明图片转发”。

## 5. 工作流一：Mac 执行层证据门

### 5.1 运行边界

所有真实 GUI 测试继续要求 `--exclusive-desktop`。缺少该参数时，测试必须在 doctor、构建、启动 Chrome、启动原生 Fixture 或任何 GUI 动作之前拒绝。真实测试只在用户明确表示桌面空闲后运行。

测试不得重启、停止或升级共享 Cua daemon，不得重放失败动作，不得用固定睡眠掩盖界面同步问题。Fixture 同步只允许有条件、有上限并尽快退出的轮询。

### 5.2 Cursor 同目标 A/B

使用现有 `acceptance:macos:cursor-ab`：

- 一个 Cua 连接；
- 一个私有 window session；
- 同一个无 Accessibility 控件的 canvas 目标；
- Cursor 开启和关闭各 5 次预热、30 次测量；
- 两组都必须 30/30 exactly-once 命中；
- 两组动作路径都必须为 `synthetic_events`；
- daemon PID、session 和目标保持不变；
- 记录 p50、p95、max 和算术差值，不预设虚假的提升比例。

A/B 只回答“Cursor 动画是否造成像素回退延迟”，不代表宿主模型端到端速度。

### 5.3 四个聚焦 profile

依次运行：

| Profile | 正确率 | p50 | p95 |
|---|---:|---:|---:|
| exact-window visual observe | 30/30 | ≤ 700 ms | ≤ 1,500 ms |
| exact-window semantic observe | 30/30 | ≤ 400 ms | ≤ 1,000 ms |
| background `set_value` + semantic next state | 30/30 | ≤ 1,500 ms | ≤ 2,000 ms |
| background pixel action + visual next state | 30/30 | ≤ 1,500 ms | ≤ 3,000 ms |

动作 profile 必须完整统计 `accessibility` / `synthetic_events` 等封闭动作路径；任何漏记、误点、重复输入、目标丢失或不满足外部 oracle 都失败。模型推理时间不进入这些插件执行层指标。

### 5.4 完整 Mac 验收

聚焦 profile 通过后才运行完整 `acceptance:macos`。必须通过：

- snapshot 新鲜度与旧 snapshot 拒绝；
- 语义序列；
- 像素和输入 exactly-once；
- 视觉恢复；
- 原生焦点保持；
- Calculator `37×19=703` 并清理回 `0`；
- 唯一 TextEdit 文本只写一次并清理自有临时文档；
- MCP 重连；
- 所有自有资源清理；
- schema-v4 证据无截图、文本、路径、标题、PID、window ID、snapshot/ref/token。

### 5.5 失败处置

只有证据表明失败属于我方适配时才修改产品代码。按以下顺序定位：

1. 外部 oracle 是否收到正确效果；
2. `action_result.route`；
3. Cua engine execution；
4. post-action observation；
5. MCP projection/transport；
6. 宿主模型回合时间。

不得因为某个指标失败而放宽正确率、删除样本或增加通用等待。若问题属于 Cua 或 macOS 限制，保留精确锁、写明限制并决定是否阻断 Preview。

## 6. 工作流二：宿主接入与直连证据

### 6.1 统一要求

Codex、HanaAgent 和 WorkBuddy 必须串行测试。同一时刻只允许测试者让一个宿主执行 UCU；并发争抢不属于本版本承诺。

每条宿主证据必须记录：

- 宿主名称与精确版本；
- macOS 版本与架构；
- 宿主报告的当前模型名称；
- UCU 产品、协议、Cua 版本和 Git commit；
- MCP Server 名称与实际两个工具名称；
- 第一轮与第二轮图片均到达同一个宿主模型；
- 三个任务的结果与自然停止；
- 宿主自动模式/审批设置的实际表现；
- 任何限制。

证据保持严格脱敏，不保存截图、输入正文、用户路径、账号信息或会话内容。

### 6.2 三个统一任务

#### 任务 A：计算器循环

打开或找到 macOS 计算器，完成 `37×19`，从 UCU 返回的新状态确认 `703`，随后自然停止。不得用心算结果代替 GUI 证据。

#### 任务 B：唯一文本输入

在 UCU 自有原生文本 Fixture 中写入由测试流程给出的单次 nonce，独立 oracle 必须确认只写一次且最终值完全一致。该任务验证元素定位、输入、动作后语义状态和 exactly-once。

#### 任务 C：被遮挡窗口

让 Fixture 窗口被另一应用遮挡，对标准语义控件执行一次后台动作，再对无 Accessibility 控件的 canvas 执行窗口像素动作。验证不必要时不激活目标窗口；必须前台回退时要明确报告，不宣称所有界面都能后台操作。

### 6.3 宿主判定

- `verified-development`：无桥接直连、两轮图片、三个任务和自然停止全部通过。
- `experimental`：配置能加载但图片、循环、自动模式或任务证据不完整。
- `not-compatible`：指定版本明确不转发 MCP 图片或无法重复调用工具。
- `not-tested`：没有真实运行。

一个宿主失败不允许由另一个宿主的结果推断通过。

## 7. 工作流三：安装、配置与大白话诊断

### 7.1 保留的命令面

继续使用：

```bash
computer-use setup --development
computer-use doctor --json
computer-use config --client <generic|codex|kimi|hanaagent|workbuddy>
computer-use uninstall
```

不新增 MCP 工具。CLI 是否增加人类可读的 `doctor` 视图或 `--client` 参数，在实施计划中以最小改动为准；不得为了一个 Preview 新建 GUI 或常驻管理服务。

### 7.2 诊断分类

诊断必须可区分并给出下一步：

- CuaDriver 未安装；
- 安装版本、哈希或签名身份不匹配；
- daemon 未运行且启动前有限恢复失败；
- Screen Recording 未授权；
- Accessibility 未授权；
- 桌面锁定或非交互会话；
- desktop/window session 创建失败；
- Agent Cursor 关闭或回读失败；
- 配置已生成但宿主需重启并新建会话；
- 工具已加载但宿主没有证明图片转发。

doctor 保持诊断语义，不在已经开始的 MCP 会话中重启 daemon，不执行鼠标键盘动作。

### 7.3 宿主配置

每个已验证宿主的生成配置必须使用绝对 Node 路径和绝对 MCP entrypoint，不能依赖测试者当前 shell 的 PATH。对于无法稳定自动写入的宿主，只输出准确配置和放置位置，不静默修改用户文件。

Canonical Skill 仍为唯一循环规则来源；宿主适配只处理配置形状和安装位置，不能复制出三套行为不同的提示词。

## 8. GitHub 与外部测试交付门

### 8.1 推送顺序

1. 每个独立实现任务先在本地通过确定性测试并提交。
2. 完成全套单元/契约测试、typecheck、build、pack dry-run 和代码自审。
3. 真实 Mac 执行层证据通过，或若受用户桌面占用阻断，明确把远端版本标记为“等待真实 GUI 证据”。
4. 推送用户指定的 GitHub 仓库。
5. 读取远端 branch/commit，确认远端 HEAD 等于被测 commit。
6. 再向用户提供 HanaAgent、WorkBuddy、Codex 测试提示词。

不得先发送测试提示词，再让测试 Agent 自行猜哪个 commit 是最新版。

### 8.2 测试提示词必须包含

- 仓库 URL；
- 精确 commit SHA；
- 新克隆命令或对干净工作树使用的 fast-forward 更新方法；
- `git rev-parse HEAD` 校验；
- 安装、build、setup、doctor 和宿主配置步骤；
- 必须重启宿主并新建会话；
- 只允许使用 `computer_observe` 与 `computer_act`；
- 三个标准任务；
- 禁止桥接和内置 Computer Use；
- 标准化 PASS/FAIL 报告字段；
- 遇到 macOS 权限时必须请用户手动授权，不能绕过。

### 8.3 Preview 标识

GitHub 与包说明必须写明 Developer Preview。Cua `0.22.2` 的 `release_eligible` 继续为 `false`；普通 `setup`、Beta 和 Stable 发布验证继续失败关闭。v0.2.6 不发布正式 npm 包，不声称非技术用户一键安装。

## 9. 测试策略

### 9.1 确定性测试

所有实现使用 TDD。新增或修改代码必须有对应的单元/契约测试，至少覆盖：

- 新宿主配置的绝对路径、无模型、无凭证和 Canonical Skill 一致性；
- doctor/配置的人类可读诊断与稳定错误码；
- 宿主证据 schema 和三任务要求；
- GitHub 测试提示词/运行手册包含 commit 校验、重启、无桥接和工具限制；
- 包清单不含 Cua 原生二进制、截图、真实证据、凭证或模型 SDK；
- 生产代码和 Canonical Skill 继续没有通用固定动作后等待。

### 9.2 真实测试

真实 GUI 测试不能在 CI 或用户活跃桌面偷跑。需要真实桌面时必须暂停并向用户明确说明：

- 哪些应用会被打开；
- 是否可能切换焦点；
- 预计运行的 profile/任务；
- 用户应关闭其他 Agent 的 UCU 操作；
- 完成后会清理哪些自有资源。

### 9.3 版本晋级条件

产品从 `0.2.5` 晋级 `0.2.6` 只在以下条件全部满足后发生：

- 全部确定性测试通过；
- typecheck/build/pack 通过；
- 无固定等待契约通过；
- 新增宿主配置和证据契约通过；
- README、安装、宿主兼容和故障排查文档与真实能力一致；
- 版本仍明确是 Developer Preview。

真实宿主若因用户尚未测试而缺失，可以先形成 `0.2.6-preview` 候选 commit，但不得把宿主状态写成 `verified-development`。

## 10. 里程碑与到达状态

### M1：执行层重新证明

完成 Cursor A/B、四 profile 和完整 Mac 验收。到达“v0.2.5 优化在真实 Mac 上有证据”。

### M2：宿主接入产品化

完成 Codex、HanaAgent、WorkBuddy 配置生成、重启说明、诊断和证据 schema。到达“代码已经准备好让三个宿主直接测试”。

### M3：GitHub 测试候选

确定性检查、自审和打包通过，推送远端并确认 commit。到达“用户拿到的测试提示词和 GitHub 代码完全一致”。

### M4：三个宿主真实验收

用户分别把提示词交给三个宿主，收回标准证据；失败回到对应层修复。到达“不是清单支持，而是真实无桥直连支持”。

### M5：Mac Agent Preview 完成

三个宿主的真实状态、安装说明、限制、真实性能和卸载路径全部公开且一致。到达本规格终点。

完成 M5 后预计：Mac Preview 达到 100%，距离公开 Mac Beta 约 75%，Mac+Windows 最终产品约 65%。这些百分比是产品阶段估算，不代替验收证据。

## 11. 风险与诚实边界

1. macOS Screen Recording 与 Accessibility 必须由用户授权，不能消除。
2. 标准 Accessibility 控件最适合后台操作；Canvas、视频、WebGL、游戏和其他自绘控件可能需要前台回退。
3. 插件执行层延迟与宿主模型推理延迟分开记录；更换模型会影响完整任务速度。
4. 宿主若不转发 MCP 图片，UCU 不内置第二视觉模型补救，只能标记实验或不兼容。
5. Cua 是独立 Runtime 依赖；UCU 复用而不复制其 macOS 原生代码。
6. 本版本不解决多个宿主同时控制桌面；文档要求串行使用，长期版本再考虑协调机制。

