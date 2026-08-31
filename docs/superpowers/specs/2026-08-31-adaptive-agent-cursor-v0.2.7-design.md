# Universal Computer Use v0.2.7 Adaptive Cursor 设计规格

状态：用户已于 2026-08-31 确认简洁方案 A，可进入实现

日期：2026-08-31

## 1. 决策摘要

v0.2.7 把 v0.2.6“两个 Cua session 一律关闭 Agent Cursor”的临时性能策略升级为 Mac 优先的自适应观察层。默认 `auto`：后台操作保持安静，前台鼠标类动作显示简洁、快速、点击穿透的 Cua Cursor。用户可以显式选择 `visible` 或 `hidden`。

Cursor 只说明 Agent 正在进行鼠标类操作的位置。它不是授权提示、成功证明、动作重放依据，也不参与模型决策。动作成功继续由 Cua 结构化结果、`expect`、最新截图和 snapshot 状态机判断。

本版本保持现有产品边界：宿主 Agent 自己的多模态模型负责理解和决策；UCU 继续只暴露 `computer_observe` 与 `computer_act` 两个 MCP 工具；不增加内置模型、GUI、第三个 MCP 工具或多 Agent 调度。

## 2. 研究依据

- Codex 的公开产品行为是 macOS 后台运行与画中画观察、Windows 前台指针与键盘接管，并优先使用结构化集成和 Accessibility 元素。其公开接口没有 Cursor 显隐或动画配置。
- Claude Code Computer Use 采用精确工具优先、通用屏幕控制兜底，并提供前台独占、应用隔离、通知和紧急停止；其公开文档同样没有 Cursor 模式接口。
- 锁定的 Cua `0.22.2` 已提供 `set_agent_cursor_enabled`、`set_agent_cursor_motion`、`set_agent_cursor_theme`、`get_agent_cursor_state`。原生覆盖层点击穿透，能显示 session、delivery 和 target 上下文；空间动作会等待视觉 Cursor 到达目标后投递，因此默认速度型长距离移动会进入动作延迟。

UCU 不冒充复刻未公开的 Codex/Claude 内部实现。产品规则由 UCU 定义，原生渲染和 session Cursor 生命周期复用锁定 Cua。

## 3. 用户体验

### 3.1 模式

- `auto`：默认。只在会影响用户当前桌面的鼠标类动作上显示。
- `visible`：调试、演示和录屏模式。所有鼠标类动作均显示，包括显式后台动作。
- `hidden`：始终关闭。

模式在 MCP 进程启动时确定，运行中不能由模型通过工具修改。优先级为命令行 `--cursor <mode>`、环境变量 `UCU_CURSOR_MODE`、默认 `auto`。未知值、重复参数和缺失参数必须在创建 Cua session 前失败。

`computer-use config --client <host> [--cursor <mode>]` 必须把选定模式作为 MCP 子进程参数写入生成配置。默认配置也显式写出 `auto`，使不同宿主的行为一致且可审计。

### 3.2 `auto` 行为矩阵

| 场景 | 是否显示 |
|---|---|
| desktop `click` / `double_click` / `right_click` / `move` / `drag` / `scroll` | 是 |
| window 上述鼠标类动作且 `delivery: foreground` | 是 |
| window 上述鼠标类动作且 `delivery: background` 或省略 | 否 |
| `computer_observe`、窗口发现、健康检查 | 否 |
| `type_text`、`keypress`、`set_value`、`invoke_menu`、`launch_app`、`wait` | 否 |

`visible` 只扩大鼠标类动作的可见范围，不让非空间输入伪装成鼠标动作。所有 observation 都先隐藏 Cursor，保证返回给模型的截图不包含 UCU 自己的观察层。

### 3.3 简洁视觉

第一版使用 Cua 内置 `cua.default`，不开发自定义主题。两个公开 session 标签改成短而唯一的 `UCU-D-xxxx` 与 `UCU-W-xxxx`，不再把完整 UUID 暴露在桌面徽标中。Cua 的小型 delivery/target chip 保留，因为它能解释前台坐标动作；不增加自定义调试面板、长文本或成功/失败颜色。

## 4. 速度与动态参数

初始化为：

- `theme_id: cua.default`
- `reduced_motion: auto`
- `glide_duration_ms: 80`
- `dwell_after_click_ms: 40`
- `idle_hide_ms: 700`

`80 ms` 是首个候选生产值，必须与 `50 ms`、`120 ms` 在同一真机、同一目标、同一 Cua 进程中比较。最终值只能在 `[50, 120] ms` 内选择，并同时满足“肉眼可辨”和前台 Cursor 附加延迟 p95 不超过 `150 ms`。

禁止加入通用动作后 sleep、模拟人类思考或为了让动画播完而阻塞 post-action observation。空间动作内部唯一允许的展示成本是 Cua 的有界 glide；观察前立即关闭 Cursor，动画不能污染截图。

## 5. 架构

```text
MCP 启动参数 / 环境变量
        ↓
CursorMode 解析
        ↓
CuaEngine 初始化两个 session
        ↓
AgentCursorController 配置 theme / motion / disabled 并回读
        ↓
execute(action)
  → CursorPolicy(action, mode) 计算 desired visibility
  → Controller 只在状态变化时切换
  → Cua 投递动作
        ↓
observe(...)
  → Controller 确保对应 session hidden
  → Cua 截图 / AX 状态
```

### 5.1 `CursorMode`

`src/engine/cursor-mode.ts` 负责稳定解析 `auto | visible | hidden`。它不读取宿主配置文件、不修改环境变量，也不接触 Cua。

### 5.2 `CursorPolicy`

`src/engine/cursor-policy.ts` 是纯函数，只消费 `CursorMode` 与 `EngineAction`，返回 `show | hide`。策略以动作类型和显式 delivery 为依据，不能根据 desktop/window session 名称猜测。

### 5.3 `AgentCursorController`

`src/engine/agent-cursor.ts` 从一次性“全部关闭”函数升级为 session-scoped 控制器：

- 初始化两个 session 的 theme、motion、disabled；
- 回读并验证 session、enabled、theme、reduced motion 和三个时间参数；
- 缓存每个 session 已确认的 enabled 状态；
- 状态未变化时不调用 Cua；
- observation 前确保 hidden；
- foreground enable 失败时允许动作以 hidden 降级；
- background/observation disable 失败时在动作或截图前失败关闭；
- 永不重试、重放或补发 GUI 动作。

初始化任一步失败时，`CuaEngine` 必须逆序清理两个 session，不提供半初始化 MCP 服务。

### 5.4 `CuaEngine`

`CuaEngine` 持有 `CursorMode` 和 `AgentCursorController`。`execute` 在动作映射和真实投递前应用策略；两个 `observe` 重载在调用截图工具前隐藏对应 session。现有 `ComputerUseRuntime` 已串行化 observe/act，因此本版本不增加第二套锁。

## 6. 锁定依赖与协议

`engine.lock.json` 继续锁定 Cua `0.22.2` 和当前 source commit，并把以下能力全部列为必需工具：

- `set_agent_cursor_enabled`
- `set_agent_cursor_motion`
- `set_agent_cursor_theme`
- `get_agent_cursor_state`

产品版本升级为 `0.2.7`；协议继续为 `1.2.0`。Cursor 是本地展示配置，不改变 `computer_observe`、`computer_act` 输入输出 schema，不改变 snapshot 单次消费与 exactly-once 语义。

## 7. 错误与诊断

- 模式参数错误：`command_failed`，且不连接 Cua。
- 初始化配置或回读失败：`engine_contract_changed` / `cursor_initialization_failed`，清理全部 session。
- 显示前 enable 失败：动作继续以 hidden 执行；只记录脱敏 `cursor_visual_degraded`。
- 隐藏前 disable 或回读失败：在截图或后台动作前失败，不能返回被 Cursor 污染的观察。
- Cursor 状态不能改变动作 `effect`、`route`、`delivery` 或验证结论。

doctor 的人类输出改为“Adaptive Cursor 初始化成功（默认 auto）”或精确失败原因，不再写成“Agent Cursor 关闭成功”。JSON 只增加非敏感的 `cursor_mode` 与 `cursor_ready`，不记录坐标、标题、截图或 session 名。

## 8. 测试接缝

用户已确认以下接缝：

1. 配置接缝：`renderConfig` 与 CLI 输出必须携带正确 Cursor 模式，且无模型、API key 或隐私内容。
2. Engine 接缝：通过 fake Cua SDK 观察初始化、状态切换、失败清理和真实 action 调用结果；不测试私有字段。
3. MCP/Runtime 接缝：现有两工具、snapshot 消费、动作后观察和串行语义全部保持。
4. 真机接缝：外部 oracle 验证点击 exactly-once、焦点保持、Cursor 是否可见与延迟聚合。

### 8.1 确定性门槛

- 策略矩阵逐项覆盖 `auto`、`visible`、`hidden`。
- 初始化调用与 readback 严格匹配。
- 缓存避免重复 set 调用。
- observation 必须先隐藏 Cursor。
- foreground enable 失败不阻断动作；disable 失败阻断后台动作和截图。
- required-tools、类型检查、构建、单元/契约测试和 pack dry-run 全部通过。

### 8.2 Mac 真机门槛

- 后台语义、后台像素、前台鼠标各 `30/30` exactly-once。
- 后台焦点保持 `30/30`。
- 自动模式后台操作不得出现 Cursor。
- 前台操作 Cursor 可见且覆盖层不接收点击。
- 自动模式后台动作相对 hidden 的 p95 退化不超过 `5%`。
- 前台 Cursor 相对 hidden 的附加延迟 p95 不超过 `150 ms`。
- post-action 截图不包含 Cursor 覆盖层。

真实 GUI 测试仍要求 `--exclusive-desktop` 和用户明确桌面空闲；本版本实现过程中不得偷跑会切换用户窗口的验收。

## 9. 非目标

- 不做画中画、ghost cursor 或录屏时间线。
- 不做自定义主题、Cursor 设置 GUI 或本地化 Cua chip。
- 不做全局紧急停止、应用授权分级或窗口隔离；这些属于后续安全体验版本。
- 不做多 Agent 并发 Cursor、跨进程锁或 daemon 共享协调。
- 不晋级 Windows window precision，不声明 Beta/Stable。
- 不 fork 或修改 Cua 原生代码。

## 10. 完成定义

代码、文档和包版本统一为 `0.2.7`；确定性测试与非侵入构建门通过；需要用户空闲桌面的真机项目若尚未运行，必须明确列为外部验收待办，不能伪造通过。完成后才生成并推送用于 Codex、HanaAgent、WorkBuddy 外部测试的精确 commit。
