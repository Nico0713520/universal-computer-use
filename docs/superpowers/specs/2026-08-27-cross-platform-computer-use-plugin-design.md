# 跨平台 Computer Use Plugin 架构设计

日期：2026-08-27  
状态：待用户审阅  
目标平台：macOS、Windows  

## 1. 产品定义

本项目交付一个无独立聊天 GUI、无内置模型、无模型 API Key 的本地 Computer Use Plugin。用户把插件接入已有 Agent 后，Agent 当前使用的多模态模型负责观察截图、规划、决策和终止；插件负责获取界面状态、执行动作、验证动作效果，并把新截图返回给 Agent。

第一版默认全自动运行，不在每一步请求用户确认。macOS 首次使用仍必须完成系统要求的“屏幕录制”和“辅助功能”授权；Windows 操作管理员权限应用时，插件进程必须与目标应用保持同等权限。这些是操作系统限制，不属于运行时确认流程。

### 1.1 第一版必须做到

- 兼容支持本地 MCP 和图片工具结果的 Agent。
- 直接使用 Agent 当前的视觉模型，不要求额外模型配置。
- 在 macOS 和 Windows 暴露一致的模型侧动作协议。
- 支持截图、点击、双击、右击、移动、拖拽、滚动、文本输入、组合键、等待。
- 每批动作结束后返回最新截图和结构化执行结果。
- 拒绝基于过期截图执行坐标动作。
- 保存可关闭的本地执行轨迹，便于复盘和测试。
- 正常运行时不弹出动作审批。

### 1.2 第一版明确不做

- 不内置或调用任何视觉模型。
- 不提供 TokenHub、OpenAI、Kimi、Anthropic 等模型配置。
- 不实现独立 Agent、任务规划器或内部模型循环。
- 不开发聊天窗口或任务管理 GUI。
- 不解析 UI-TARS 的 `Thought/Action` 文本格式。
- 不承诺支持不接收 MCP 图片结果的纯文本 Agent。
- 不以支付、改密、删除重要数据、对外发布等高风险场景作为第一版验收任务。

## 2. 复用与 Fork 策略

### 2.1 主底座

以 [`trycua/cua`](https://github.com/trycua/cua) 中的 Cua Driver 为唯一执行底座。Cua Driver 提供跨平台 Rust Runtime、MCP/SDK、macOS Accessibility、Windows UI Automation、截图、窗口定位、前后台输入、动作结果、验证和轨迹测试。

推荐采用完整 Git 历史 Fork，而不是复制零散源文件：

1. 在产品组织下 Fork `trycua/cua`，保留 `upstream` 远程。
2. 固定首个可工作的上游 tag/commit，保证构建可复现。
3. 我方功能尽量新增在独立目录，通过 Cua Driver 的公开 Interface 调用它。
4. 只有公开 Interface 无法满足已复现需求时，才修改 Cua Driver 内部代码。
5. 每个底层修改保持独立提交并记录原因，方便后续同步上游。
6. 保留 MIT License、版权声明和第三方依赖清单。

### 2.2 只参考、不 Fork

- OpenAI CUA：参考结构化 `actions[]`、批量执行和操作后截图协议，不依赖 Responses API，也不复制模型调用代码。
- Anthropic Computer Use Best Practices：参考批量失败即停、截图坐标一致性、错误分类和轨迹回放；模型缓存、上下文压缩、图片历史裁剪属于宿主 Agent，不进入插件。
- UI-TARS Desktop：只参考 Observe–Decide–Act 思路和基础动作集合，不 Fork 其模型层、动作文本解析器或 Electron GUI。

### 2.3 Fork 的退出条件

如果验证发现上游 Cua Driver 已经能直接以足够小、足够稳定的 MCP Interface 满足全部目标，则第一版可以只固定依赖并贡献 Skill/插件包装，不产生长期底层 Fork。只有出现以下情况才保留我方 Fork：

- 必须修改 macOS/Windows 原生执行行为；
- 必须增加上游没有的稳定动作结果；
- 必须修改签名、嵌入式宿主或分发流程；
- 上游拒绝或长期未合并对产品成立的补丁。

## 3. 总体架构

```text
用户
  │ 自然语言任务
  ▼
宿主 Agent（WorkBuddy / Kimi / Codex / DeepSeek Harness / 其他 MCP Agent）
  │ 当前多模态模型负责观察、决策、重试和停止
  │
  ├── Computer Use Skill
  │     规定 observe → decide → act → verify 循环
  │
  └── MCP Client
        │
        ▼
Universal Computer Use MCP Module
  ├── computer_observe
  ├── computer_act
  └── computer_verify
        │
        ▼
Cua Runtime Adapter
  ├── 会话与 snapshot 映射
  ├── OpenAI 风格动作 → Cua 工具映射
  ├── 批量执行与失败即停
  ├── 统一错误和效果结果
  └── 操作后新观察
        │
        ▼
Cua Driver Runtime
  ├── macOS Adapter：ScreenCapture + Accessibility + 原生输入
  └── Windows Adapter：截图 + UI Automation + 原生输入
```

MCP 是外部 Seam。宿主 Agent 和测试只依赖三个工具的 Interface，不需要了解 Cua Driver 内部工具数量、平台实现和进程结构。Cua Runtime Adapter 是内部 Seam：第一版只有 Cua Adapter，只有当未来真实接入第二个执行底座时才抽象为可插拔 Adapter Interface。

## 4. 模块与职责

### 4.1 Computer Use Skill

Skill 不执行系统操作，只规定 Agent 的使用方法：

1. 第一次操作前必须 `computer_observe`。
2. 只使用当前观察返回的 `snapshot_id`、像素坐标或 `element_token`。
3. 对界面变化有依赖的动作不要放进同一批次。
4. 每批动作后检查返回的新截图和结构化结果。
5. `suspected_noop`、`unverifiable`、过期截图或目标消失时重新观察，不盲目重复。
6. 可用语义元素时优先 `element_token`，否则使用截图像素。
7. 达到用户目标后直接结束回复，不调用插件内部的 `finished` 动作。

Skill 可以针对不同宿主提供薄包装，但循环规则保持单一来源。

### 4.2 Universal Computer Use MCP Module

这是给模型使用的深模块。第一版公开三个工具。

#### `computer_observe`

用途：发现当前桌面或窗口，并生成可操作观察。

输入要点：

- `scope`: `desktop | window | auto`，默认 `auto`；
- 可选 `pid`、`window_id`；
- `include_tree`: 是否返回可访问性元素，默认 `true`；
- 可选 `query`：缩小大型可访问性树。

输出要点：

- MCP `ImageContent` 截图；
- `session_id`、`snapshot_id`；
- 当前目标应用、进程、窗口；
- 截图宽高、坐标原点、缩放信息；
- 可选 `element_token` 列表和精简语义树；
- 降级原因，例如无法获取 Accessibility 但截图可用。

不变量：截图像素坐标与后续像素动作使用同一坐标空间。

#### `computer_act`

用途：基于一个观察执行一批有序动作。

输入要点：

- 必填 `snapshot_id`；
- `actions[]`，第一版最多 8 个；
- 可选 `delivery`: `auto | background | foreground`，默认 `auto`；
- `after`: `screenshot | state | none`，默认 `screenshot`。

第一版动作集合：

- `click`、`double_click`、`right_click`；
- `move`、`drag`；
- `scroll`；
- `type`；
- `keypress`；
- `wait`；
- `screenshot`。

点击类动作允许两种目标：截图像素 `{x, y}`，或观察返回的 `{element_token}`。坐标动作必须携带生成它的 `snapshot_id`。

批量语义：

- 严格按数组顺序执行；
- 首个失败、拒绝或过期目标出现后停止剩余动作；
- 未执行动作标记为 `skipped`；
- 默认返回操作后新截图及其新 `snapshot_id`；
- 新截图是下一轮动作的唯一有效坐标来源。

#### `computer_verify`

用途：在可访问性或应用状态允许时验证结构化后置条件，不替代模型查看截图。

第一版支持：

- 指定元素存在或不存在；
- 元素值或标签包含预期文本；
- 指定窗口存在、消失或标题匹配；
- 当前活动应用/窗口匹配。

返回 `satisfied | unsatisfied | unknown`。只有 `satisfied` 能作为结构化验证成功；截图仍作为视觉证据交给 Agent 判断。

### 4.3 Cua Runtime Adapter

内部负责：

- 建立并复用 Cua 会话；
- 把 `snapshot_id` 映射到 Cua 的 session、窗口和元素 Token；
- 把 OpenAI 风格动作翻译为 Cua Driver 调用；
- 统一 Retina/DPI、窗口坐标和桌面坐标；
- 把 Cua 的动作结果和错误映射到稳定的产品结果；
- 批量失败即停；
- 触发操作后观察；
- 启停本地轨迹记录。

Adapter 不做模型推理，不猜测用户目标，不把 `unverifiable` 自动改成成功。

### 4.4 平台运行与分发

#### macOS

- 优先复用 Cua Driver 的签名 App/嵌入式宿主模式，以获得稳定 TCC 身份；
- 首次引导用户授予 Screen Recording 和 Accessibility；
- 首发支持 Apple Silicon；构建链稳定后增加 Universal Binary；
- 正常窗口操作优先后台投递，必要时由动作结果提示 Agent 选择前台重试；
- 不开发聊天 GUI，权限宿主只承担系统授权和 Runtime 生命周期。

#### Windows

- 首发支持 Windows 10 1903+、Windows 11、x64、交互式桌面会话；
- 使用 Cua Driver 的 UIA/原生输入路径；
- 遇到目标应用权限等级更高时返回明确错误，不静默失败；
- Windows 不能保证所有输入后台完成，动作结果必须报告实际 delivery 模式。

#### 发布物

- `computer-use-macos-arm64`，后续增加 `macos-universal`；
- `computer-use-windows-x64`；
- 通用 Skill；
- Kimi、WorkBuddy/CodeBuddy、DeepSeek Harness 的薄插件清单；
- 通用 MCP 配置示例，供其他 Agent 手动接入。

各发布物共享同一协议版本。不同宿主清单不得复制一份独立循环逻辑。

## 5. 决策循环

宿主 Agent 执行以下循环：

```text
Observe
  ↓
读取截图、目标窗口、可访问性元素和上一批动作结果
  ↓
Decide
  ↓
选择最小动作或无状态依赖的小批量动作
  ↓
Act
  ↓
插件顺序执行，失败即停，返回结果和新截图
  ↓
Verify
  ├── 目标已满足：Agent 停止调用工具并总结
  ├── 状态清晰但未完成：使用新 snapshot 继续
  ├── 结果未知：重新 observe 或改用另一动作路径
  └── 权限/环境阻断：报告阻断并结束
```

插件不实现 `while` 模型循环；循环由宿主 Agent 的工具调用机制和 Skill 共同形成。这样用户切换模型时，插件自动使用新模型的视觉和推理能力。

## 6. 结果与错误契约

每个动作返回：

```json
{
  "index": 0,
  "status": "executed",
  "effect": "confirmed",
  "route": "accessibility",
  "delivery": "background",
  "evidence": ["value_readback"]
}
```

`effect` 采用：

- `confirmed`；
- `partial`；
- `unverifiable`；
- `suspected_noop`；
- `refused`。

稳定错误至少包括：

- `permission_required`；
- `stale_snapshot`；
- `window_not_found`；
- `ambiguous_window`；
- `element_not_found`；
- `coordinate_out_of_bounds`；
- `target_privilege_mismatch`；
- `capture_failed`；
- `action_timeout`；
- `runtime_unavailable`；
- `unsupported_action`。

错误同时返回 `retryable` 和 `recovery`：`observe_again | choose_target | use_pixel | use_foreground | grant_permission | restart_runtime | stop`。插件只提供恢复建议，最终选择仍由 Agent 做出。

## 7. 自动化策略

产品默认：

```yaml
approval_policy: never
max_actions_per_batch: 8
action_timeout_seconds: 20
session_idle_timeout_minutes: 30
recording: metadata
```

运行时不弹动作确认。为了避免失控循环，保留确定性的资源限制和紧急停止能力：

- 单次动作超时；
- 批量动作上限；
- 会话空闲清理；
- MCP 进程终止即停止；
- 可配置全局停止快捷键或宿主 Agent 的停止按钮；
- 日志不记录密码字段、完整剪贴板和无必要的截图副本。

这些限制不负责判断任务风险，也不改变用户选择的全自动模式。

## 8. 仓库结构建议

在 Cua Fork 中新增独立产品目录，尽量不侵入上游实现：

```text
apps/
  universal-computer-use-mcp/     # 三工具 MCP Module
packages/
  computer-use-protocol/          # 输入输出 Schema、错误码、版本
  cua-runtime-adapter/             # 动作翻译、会话、snapshot、结果映射
skills/
  computer-use/                    # 单一来源 Skill
plugins/
  kimi/
  workbuddy/
  deepseek-harness/
  generic-mcp/
packaging/
  macos/
  windows/
tests/
  contract/
  fixtures/
  host-compat/
```

如果第一阶段仅依赖上游发布包而不 Fork，则以上产品目录留在独立仓库，Cua Driver 作为固定版本依赖。不要通过复制 Cua 源文件制造第二份 Runtime。

## 9. 测试与验收

### 9.1 协议与模块测试

- 三个 MCP 工具的输入输出 Schema 测试；
- `actions[]` 顺序、失败即停、`skipped` 测试；
- 过期 `snapshot_id` 必须拒绝；
- 像素越界和坐标变换测试；
- Cua 结果到统一结果的完整映射测试；
- 模拟 Runtime 的超时、权限缺失、窗口消失和部分成功；
- 插件清单和 Skill 加载测试。

### 9.2 macOS E2E

- Retina 主屏截图与点击一致；
- TextEdit 输入、保存对话框导航；
- Calculator 点击与结果读取；
- Chrome/原生应用切换；
- 后台操作不抢占前台的可验证路径；
- 缺少 Screen Recording/Accessibility 时返回准确错误；
- Runtime 重启后旧 snapshot 失效。

### 9.3 Windows E2E

- Notepad 输入与保存对话框；
- Calculator 点击与结果读取；
- Chrome/原生窗口切换；
- DPI 缩放下的截图与点击一致；
- 管理员权限不匹配返回准确错误；
- Runtime 重启和窗口关闭后的状态清理。

### 9.4 宿主兼容测试

每个宿主至少验证：

1. 能发现三个 MCP 工具；
2. `computer_observe` 返回的 MCP 图片确实进入当前视觉模型；
3. 模型能基于图片调用 `computer_act`；
4. 操作后截图能触发下一轮决策；
5. Agent 完成后能自然停止；
6. 全自动配置下不会逐步弹审批。

优先宿主顺序：Codex → Kimi Code/Kimi Work → WorkBuddy/CodeBuddy → DeepSeek Harness → 其他通用 MCP Agent。

### 9.5 第一版完成标准

- macOS 和 Windows 各有一个可安装发布物；
- 用户无需提供模型 API Key；
- 首次系统授权完成后，确定性任务不再弹操作确认；
- 参考视觉 Agent 能完成“打开应用、输入文本、点击按钮、读取结果”的端到端任务；
- 两个平台的 MCP 工具 Schema 完全一致；
- 协议、错误映射和确定性 Runtime Fixture 测试全部通过；
- 选定参考模型在每个平台 20 次基础 Agent 任务中成功率不低于 80%，失败均有轨迹可复盘；
- 安装、卸载、升级和权限排查文档齐全。

## 10. 实施阶段总览

### 阶段 0：上游验证与 Fork 决策

- 固定 Cua Driver 版本；
- 在当前 macOS 验证截图、Accessibility、后台点击、键盘输入和 MCP 图片返回；
- 在 Windows 测试机验证同一最小动作集合；
- 记录公开 Interface 缺口；
- 决定“固定依赖”还是“保留底层 Fork”。

退出条件：两个平台都能通过原生 Cua Driver 完成最小确定性 Fixture。

### 阶段 1：协议与 Adapter

- 定义三个 MCP 工具 Schema；
- 实现 snapshot 生命周期；
- 实现 OpenAI 风格动作到 Cua 的映射；
- 实现批量失败即停和统一结果；
- 使用 Fake Runtime 完成协议测试。

退出条件：不依赖真实桌面的 Contract 测试全部通过。

### 阶段 2：macOS MVP

- 接入 Cua Driver macOS Runtime；
- 完成权限宿主、签名和安装；
- 完成 macOS E2E Fixture；
- 先接 Codex 与一个支持本地 MCP 图片的第二宿主。

退出条件：macOS 安装包和端到端 Agent 任务达到第一版标准。

### 阶段 3：Windows MVP

- 接入 Cua Driver Windows Runtime；
- 完成 Windows 安装、进程和权限等级处理；
- 完成 Windows E2E Fixture；
- 保证工具 Schema 与 macOS 无差异。

退出条件：Windows 安装包和端到端 Agent 任务达到第一版标准。

### 阶段 4：插件包装与宿主矩阵

- 发布通用 Skill；
- 制作 Kimi、WorkBuddy/CodeBuddy、DeepSeek Harness 薄清单；
- 为其他 MCP Agent 提供一条配置命令或 JSON；
- 验证图片转发、循环和无审批配置。

退出条件：至少四类宿主通过兼容测试，未兼容宿主有明确原因。

### 阶段 5：发布加固

- 自动构建、签名、校验和、SBOM、许可证清单；
- 安装、升级、卸载和回滚；
- 轨迹查看和诊断命令；
- 发布候选版回归和兼容矩阵。

退出条件：macOS、Windows 发布物可复现构建并完成发布验收。

## 11. 关键设计决定

1. 插件没有内置模型，模型属于宿主 Agent。
2. 循环属于宿主 Agent；插件只提供观察、动作和验证。
3. Cua Driver 是唯一执行底座，避免自行重写 macOS/Windows 原生控制。
4. 模型侧 Interface 采用 OpenAI 风格结构化批量动作，但通过 MCP 暴露。
5. Accessibility 是截图驱动的增强信息，不替代视觉截图。
6. 操作必须绑定 snapshot，不能使用无法证明坐标来源的旧截图。
7. 第一版无逐步审批，但保留系统授权、资源上限和紧急停止。
8. 优先固定依赖；只有验证过的能力缺口才保留底层 Fork。

