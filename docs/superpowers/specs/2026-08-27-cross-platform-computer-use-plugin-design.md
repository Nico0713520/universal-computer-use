# 轻量跨平台 Computer Use Plugin 架构设计

日期：2026-08-27
状态：最终方案（架构冻结，待实现）
目标平台：macOS、Windows

## 1. 第一性原理

项目以四个目标约束全部技术选择：

1. 模仿成熟 Computer Use Harness 的核心设计，形成我们自己的协议、插件、安装体验和产品边界。
2. macOS/Windows 权限、签名、截图、DPI 和原生输入等高成本能力直接复用 Cua Driver；无法低成本稳定复用的增强能力可以不进入 v1。
3. 最终用户把插件接入自己已有的多模态 Agent 后，即可让该 Agent 看见并操作当前电脑，不需要为插件单独配置视觉模型。
4. 实现前先对照 Cua、UI-TARS Desktop 和 OpenAI Agents SDK 的固定提交；依赖能解决的直接依赖，小而稳定且许可证允许的实现选择性复制并保留来源，不凭记忆重新发明。

稳定性的优先级高于功能数量。v1 先保证简单任务的完整闭环，复杂能力以可选增强形式后置。

## 2. 产品定义

本项目交付一个无聊天 GUI、无内置模型、无模型 API Key 的本地 MCP 插件。宿主 Agent 当前使用的多模态模型负责理解用户目标、查看截图、决定下一步动作、判断任务是否完成；插件负责观察主显示器、验证动作请求、调用 Cua Driver 执行动作，并返回新截图。

这里的“插件”不是某一家 Agent 的私有扩展格式。可移植核心是一个 npm 包中的 stdio MCP server、CLI 和 canonical Skill；Codex、Kimi、WorkBuddy、DeepSeek Harness 等只提供薄配置/manifest，全部启动同一个二进制、使用同一份 Skill 和同一套两工具 Interface。macOS 与 Windows 也不是两套代码库，而是同一产品协议下的两条安装、权限和实机验收路径。

插件自身不实现模型循环。循环由宿主 Agent 连续调用两个工具形成：

```text
computer_observe
  → 宿主模型查看截图并决定一个动作
computer_act
  → 插件执行一个动作并返回新截图
  → 宿主模型继续或结束
```

### 2.1 v1 必须做到

- macOS 14+ 与 Windows 10 1903+/Windows 11 x64 使用同一 MCP 工具协议。
- 兼容能运行本地 stdio MCP、接收 MCP 图片结果并调用工具的多模态 Agent。
- 使用宿主 Agent 当前模型，不要求用户提供第二套模型、端点或 API Key。
- 支持主显示器截图、点击、双击、右击、移动、拖拽、滚动、文本输入、单键、组合键和等待。
- 每次动作只执行一个操作；成功完成操作后重新捕获屏幕并返回新的 `snapshot_id`。桌面未变化时，新旧 PNG 字节允许相同。
- 每个动作必须绑定当前 `snapshot_id`；旧截图、已消费截图和越界坐标必须拒绝。
- 保留 Cua Driver 的动作 `effect`、`route`、`delivery` 和结构化错误，不把未知效果伪装为成功。
- 插件自身不弹出逐步审批；宿主 Agent 自身的审批策略仍由宿主管理。
- 提供 `setup`、`doctor`、MCP 配置生成、升级检查和卸载说明。

### 2.2 v1 明确不做

- 不内置模型、任务规划器、OCR、目标检测或 UI-TARS 模型。
- 不暴露 Accessibility/UIA 元素树或 `element_token`。
- 不提供独立 `computer_verify` 工具；操作后的新截图是模型侧验证依据。
- 不支持多动作批处理或插件内部自动重试。
- 不承诺后台无打扰、焦点保持或窗口级隐形操作。
- 不支持多显示器寻址；v1 只操作主显示器。
- 不支持锁屏、Session 0、断开的 RDP 会话或无人登录桌面。
- 不自行实现 Windows 目标进程完整性级别探测、提权或自动 UAC。能否控制高权限目标继承锁定版本 Cua Runtime 的实际权限和 Windows 行为，不作额外保证。
- 不制作自有原生 Runtime、TCC 权限宿主、DMG、PKG、MSI 或 GUI 安装器。
- 不修改或重新签名 Cua Driver 的 App、EXE、DLL 或原生库。
- 不承诺支持无法接收 MCP 图片结果的纯文本 Agent。

## 3. 方案选择

### 3.1 未选择：Fork 并裁剪 Cua 原生源码

复制原生代码会把 Rust、平台 API、签名、上游同步和原生测试负担带入项目。源码行数可能减少，维护面不会变小，因此不符合轻量和稳定目标。

### 3.2 未选择：直接暴露完整 Cua/UI-TARS Harness

直接暴露 Cua 的全部工具会把 session、窗口、元素树、验证、后台投递和版本差异泄漏给每个宿主；直接采用 UI-TARS 完整 Harness 又会把模型客户端、动作解析器和内部 Agent 循环带进插件。两者都偏离“宿主模型负责决策、插件只负责观察和执行”的产品边界。

### 3.3 最终选择：源码先行的两工具门面 + 原版 Cua Runtime

我们拥有稳定、简洁的模型侧协议；Cua Driver 保持未修改状态，作为固定版本的外部执行引擎。我们的代码只做协议验证、snapshot 生命周期、单动作映射、错误归一和 MCP 图片返回。

实现不是闭门手写。仓库维护 `docs/upstream-sources.md`，逐项记录固定 commit、文件路径、许可证、采用方式和对应测试。允许直接移植的仅限小型协议适配、测试结构和无平台特权的通用逻辑；任何 Cua Rust/原生平台代码、UI-TARS 模型层或桌面 GUI 都不得进入产品源码。

## 4. 总体架构

```text
用户
  │ 自然语言任务
  ▼
宿主 Agent（Codex / Kimi / WorkBuddy / DeepSeek Harness / 通用 MCP Agent）
  │ 当前多模态模型：观察、规划、决定动作、判断完成
  ▼
Computer Use Skill
  │ 规定 observe → one act → inspect → continue/stop
  ▼
Lightweight Computer Use MCP
  ├── computer_observe
  └── computer_act
  ▼
Core Guard
  ├── 当前 snapshot 管理
  ├── 坐标边界检查
  ├── 单动作策略
  ├── 超时和错误归一
  └── 操作后重新观察
  ▼
Cua Engine Adapter
  │ 只调用公开 SDK/Runtime Interface
  ▼
未修改、已签名的 Cua Driver Runtime
  ├── macOS：TCC、ScreenCapture、Accessibility、输入、Retina
  └── Windows：截图、UIA/输入、DPI、交互式桌面
```

### 4.1 用户安装流程

```text
安装 npm 包
  → computer-use setup
  → 校验 OS/架构、engine.lock、安装脚本哈希
  → 调用锁定的 Cua 官方安装器
  → 校验版本、系统签名和锁定签名者
  → macOS 完成 Screen Recording / Accessibility 授权
  → computer-use doctor --json
  → computer-use config --client <host>
  → 将 canonical Skill 和两个 MCP 工具交给宿主 Agent
```

正式用户只能使用 `release_eligible:true` 的锁；开发者可显式使用 `setup --development`，但该状态不能生成公开发布物。

### 4.2 单次任务运行流程

```text
用户给宿主 Agent 自然语言目标
  → Agent 调 computer_observe
  → 插件串行捕获主屏，生成唯一 snapshot_id
  → 宿主当前视觉模型查看 PNG，决定一个动作或停止
  → Agent 调 computer_act(snapshot_id, one action)
  → 插件先校验动作和坐标，再原子消费 snapshot
  → Cua 执行动作
  → 插件重新捕获主屏，生成新 snapshot_id
  → 新 PNG 返回宿主模型
  → 目标未完成则继续；可见目标完成则自然停止
```

动作失败、超时或结果不确定时，插件不会自动重复动作。只要重新截图成功，就把真实当前画面和失败分类交回模型；截图也失败则清空 snapshot，下一步只能重新 observe。Transport 关闭或进程收到退出信号时，插件取消当前操作、结束 Cua session 并清理内存状态。

## 5. 模型侧工具协议

协议版本从 `1.0.0` 开始。macOS 和 Windows 使用字节一致的 JSON Schema。

### 5.1 `computer_observe`

用途：获取主显示器当前截图，建立唯一可执行的观察。

输入：

```json
{}
```

v1 不接受显示器选择、窗口选择或树查询参数。未知字段必须拒绝。

结构化输出：

```json
{
  "protocol_version": "1.0.0",
  "session_id": "ses_...",
  "snapshot_id": "snap_...",
  "platform": "macos",
  "display_id": "primary",
  "screenshot": {
    "mime_type": "image/png",
    "width": 2560,
    "height": 1440
  },
  "engine": {
    "name": "cua-driver",
    "version": "<locked-version>"
  }
}
```

MCP 内容同时包含一块 `ImageContent`。截图的像素尺寸就是后续动作的唯一坐标空间。

调用成功后，新 snapshot 成为会话中唯一有效 snapshot；此前 snapshot 立即过期。

### 5.2 `computer_act`

用途：基于当前截图执行一个动作，然后返回新截图。

公共输入：

```json
{
  "snapshot_id": "snap_...",
  "action": {
    "type": "click",
    "x": 640,
    "y": 420
  }
}
```

v1 动作联合类型：

```ts
type ComputerAction =
  | { type: "click"; x: number; y: number }
  | { type: "double_click"; x: number; y: number }
  | { type: "right_click"; x: number; y: number }
  | { type: "move"; x: number; y: number }
  | { type: "drag"; from_x: number; from_y: number; to_x: number; to_y: number; duration_ms?: number }
  | { type: "scroll"; x: number; y: number; direction: "up" | "down" | "left" | "right"; amount: number; by?: "line" | "page" }
  | { type: "type"; text: string }
  | { type: "keypress"; keys: string[] }
  | { type: "wait"; ms: number };
```

约束：

- 坐标是截图像素，左上角为 `(0, 0)`。
- `x` 必须满足 `0 <= x < screenshot.width`，`y` 同理。
- `drag.duration_ms` 范围 `0..10000`。
- `scroll.amount` 范围 `1..50`，滚动发生在当前截图中的 `(x, y)`。
- `wait.ms` 范围 `0..15000`，给统一的 20 秒动作超时保留调度余量。
- `type.text` 最大 20,000 个 Unicode 字符。
- `keypress.keys` 包含 1–8 个标准化键名。
- 每次调用只允许一个动作，不接受 `actions[]`。

动作请求在进入引擎前就消费 snapshot。即使引擎报错，也不能用同一个 snapshot 重试，因为桌面状态可能已经发生未知变化。

结构化输出：

```json
{
  "protocol_version": "1.0.0",
  "session_id": "ses_...",
  "consumed_snapshot_id": "snap_old",
  "snapshot_id": "snap_new",
  "action_result": {
    "status": "executed",
    "effect": "unverifiable",
    "route": "global_input",
    "delivery": "foreground"
  },
  "screenshot": {
    "mime_type": "image/png",
    "width": 2560,
    "height": 1440
  }
}
```

当动作未到达 Cua 的具体执行路径时，`route` 和 `delivery` 使用产品级哨兵值 `unknown`；插件不得虚构一个实际未使用的 Cua 路径。

MCP 内容包含动作摘要和新 `ImageContent`。若动作失败但重新截图成功，仍返回新 snapshot，供模型看清当前状态。若重新截图也失败，会话中没有有效 snapshot，模型必须重新调用 `computer_observe`。

## 6. Snapshot 与会话不变量

- 每个 MCP transport 只有一个活动桌面会话。
- 会话内最多保存一个当前 snapshot 的元数据，不持久保存图片字节。
- `computer_observe` 替换当前 snapshot。
- `computer_act` 在调用引擎之前原子消费当前 snapshot。
- 每次成功捕获都会生成新的 snapshot ID；新旧图片内容或 PNG 字节相同不影响其新鲜性。
- snapshot ID 使用加密安全随机值，不从坐标、时间戳或图片内容推导。
- Runtime 重连、进程重启、会话结束或空闲 30 分钟后，所有 snapshot 失效。
- 插件不允许客户端指定 Cua session 标识，避免跨 Agent 会话混用。

这些规则防止模型基于已经变化的截图继续点击，同时保持实现足够小。

## 7. Cua 能力复用边界

| 能力 | v1 做法 | 我方不做 |
|---|---|---|
| macOS 权限 | 调用 Cua 权限状态和授权流程 | 不写 TCC 探针和权限 App |
| Windows 权限 | 使用 Cua 交互式桌面输入并如实透传拒绝/失败 | 不自行判断目标完整性级别，不实现 UIAccess 提权或自动 UAC |
| 签名 | 原样安装上游发布物；发布晋级时固定实际签名者身份 | 不修改、重打包或重新签名 Cua 原生文件 |
| DPI/Retina | 使用 Cua 的主屏截图坐标契约 | 不实现平台级 DPI API；仅做截图边界校验 |
| 原生输入 | 将九种公共动作映射到 Cua 公开工具 | 不写 CGEvent、AX、SendInput 或 UIA |
| 安装 | `setup` 委托官方安装流程并固定已验证版本；引擎卸载只调用锁定并校验的上游卸载器 | 不维护 Cua 安装器分支 |
| 原生兼容测试 | 上游测试证明引擎行为 | 不复制完整 Cua Harness；只测产品接缝 |

Cua Driver 是运行时依赖，不是我方源码子树。仓库不包含 Cua Rust 代码，也不建立默认 Fork。

允许复用的源码和测试必须满足三项：固定来源 commit；许可证允许且保留 copyright/SPDX/NOTICE；复制后通过我方 Interface 测试。若只是调用上游包即可完成，则禁止复制同等实现。

### 7.1 引擎版本锁

仓库包含 `engine.lock.json`，记录：

- 精确 Cua 版本；
- 对应 release tag 和 source commit；
- macOS/Windows 资产名称和 SHA-256，作为版本晋级与发布审计证据；
- tag/source commit 固定的入口安装器、可执行辅助脚本及各自 SHA-256；
- tag 固定的卸载器及 SHA-256；
- 发布资产实际签名者身份及对应验证方式；
- 支持的协议工具清单；
- `development_eligible` 与 `release_eligible` 状态。

初始锁中两个平台都设为 `release_eligible:false`，只有签名身份、工具契约和对应平台 E2E 证据齐全后才能晋级。开发基线可使用 Cua `0.22.1` 验证公开 Interface，但公开 macOS 发布必须使用包含 Retina 修复提交 `90295148d34dac8e5a1307bac917e08171af5839` 的正式版本。不存在满足条件的正式版本时，`setup --development` 可以安装精确锁定的开发引擎并明确警告，普通 `setup` 与发布流程必须以 `engine_not_release_eligible` 失败。

版本晋级分两步，避免发布资格与 E2E 证据循环依赖：先把明确的正式 SemVer release `stage` 到锁文件并保持 `release_eligible:false`，通过 `setup --development` 在 Mac/Windows 上生成 candidate 证据；再用这些证据执行 `promote`，固定签名者并把通过的平台设为可发布。

插件启动时检查实际引擎版本。版本或工具契约不匹配时拒绝动作，不自动切换到 `latest`。

## 8. 动作映射

| 公共动作 | Cua 工具 |
|---|---|
| `click` | `click`，`button:left`、`count:1` |
| `double_click` | `click`，`button:left`、`count:2` |
| `right_click` | `click`，`button:right`、`count:1` |
| `move` | `move_cursor` |
| `drag` | `drag` |
| `scroll` | `scroll`，原样传递坐标、方向、行/页和数量 |
| `type` | `type_text` |
| 单键 `keypress` | `press_key` |
| 组合键 `keypress` | `hotkey` |
| `wait` | 插件内可取消计时器，不调用 Cua |

所有接受 action target 的 Cua 输入动作固定 `target:{kind:"desktop",display_id:"primary"}` 和插件内部 session；观察与会话生命周期调用只传其正式契约支持的字段。v1 不把 Cua 的其他工具暴露给模型。

## 9. 错误与恢复

稳定错误码：

- `runtime_missing`：未安装 Cua；运行 `setup`。
- `runtime_unavailable`：Runtime 未运行或连接中断；运行 `doctor` 或重启 Runtime。
- `engine_version_mismatch`：实际版本与锁文件不符；安装锁定版本。
- `engine_not_development_eligible`：所选平台锁不允许开发安装；升级锁文件。
- `engine_not_release_eligible`：当前平台的锁定引擎尚未通过公开发布门槛；等待或晋级正式版本。
- `permission_required`：macOS 权限缺失；运行 Cua 授权流程。
- `unsupported_platform`：当前 OS/架构不在 v1 范围。
- `interactive_session_required`：桌面锁定、无人登录或 Session 0。
- `stale_snapshot`：snapshot 不是当前值或已消费；重新观察。
- `coordinate_out_of_bounds`：坐标不在截图内；使用当前截图重新选择。
- `action_timeout`：单动作超过 20 秒；重新观察，不自动重复。
- `action_refused`：Cua 明确拒绝；根据结构化原因停止或改变动作。
- `action_failed`：动作调用失败；检查返回的新截图。
- `capture_failed`：无法获得操作后截图；重新调用 observe。
- `unsupported_action`：动作不在 v1 联合类型中。

插件不进行盲重试。只有 `computer_act` 末尾的操作后截图允许在捕获 API 返回明确瞬时错误时重试一次；重试仍失败则返回 `capture_failed`，且不产生新 snapshot。

日志默认只记录时间、工具名、动作类型、耗时、结果分类和错误码，不记录输入文本、按键内容、截图、剪贴板或模型提示。

## 10. 安装与宿主接入

发布一个 Node.js CLI/MCP 包，提供：

```text
computer-use setup
computer-use setup --development
computer-use doctor --json
computer-use mcp
computer-use config --client generic|codex|kimi|workbuddy|deepseek-harness
computer-use uninstall
```

### 10.1 `setup`

- 检查 Node.js、OS 和架构；
- 读取 `engine.lock.json`；
- 下载同一 release tag/source commit 的官方 Cua 安装脚本组并逐文件校验哈希；
- 要求官方安装器安装精确版本，安装后再次校验 Runtime 版本和系统代码签名；
- 启动 Cua Runtime；
- macOS 引导一次性 Screen Recording 和 Accessibility 授权；
- 输出宿主配置命令，不静默修改未知宿主配置。

普通 `setup` 只接受 `release_eligible:true` 的平台锁；`setup --development` 只接受 `development_eligible:true`，打印不可发布警告且不能被发布脚本调用。`uninstall --engine` 必须下载并校验锁文件中的上游卸载器；默认卸载只删除我方文件并保留可能被其他产品共享的 Cua Runtime。

### 10.2 `doctor`

机器可读地检查：插件版本、协议版本、Cua 版本、Runtime 连通性、必需工具、交互式桌面、权限、主屏截图尺寸和一次无副作用观察。任一核心项失败时退出非零。

### 10.3 宿主要求

宿主必须：

1. 支持本地 stdio MCP；
2. 把 MCP `ImageContent` 发送给当前多模态模型；
3. 允许模型连续调用工具；
4. 能配置 `computer_act` 自动批准，或本身支持用户选择的全自动模式。

插件自身没有动作审批，但不能绕过宿主强制策略。

优先兼容顺序：通用 MCP → Codex → Kimi → WorkBuddy/CodeBuddy → DeepSeek Harness。不同宿主只保留清单和配置差异，循环规则来自同一份 Skill。

## 11. 测试策略

### 11.1 无桌面确定性测试

- 两工具 JSON Schema 和协议快照；
- 九种动作到 Cua 工具的精确映射；
- 当前/过期/已消费 snapshot；
- 坐标边界、键名、文本长度和超时；
- Cua effect/error 到稳定产品结果的映射；
- 操作失败但操作后截图成功；
- 操作和截图都失败时不生成 snapshot；
- 锁定版本、资产哈希和工具契约漂移；
- 日志敏感信息排除。

### 11.2 macOS E2E

- Cua 已签名 Runtime 安装和权限状态；
- 主屏原生截图尺寸；
- Retina 模式下截图坐标点击一致；
- TextEdit 输入唯一文本；
- Calculator 点击并从截图确认结果；
- 权限缺失返回 `permission_required`；
- Runtime 重启使旧 snapshot 失效。

### 11.3 Windows E2E

- Windows 10/11 x64 交互式桌面；
- 100%、125%、150% DPI；
- Notepad 输入唯一文本；
- Calculator 点击并从截图确认结果；
- 记录 Cua Runtime 实际报告的权限/完整性信息；普通桌面操作必须成功，高权限目标和 UAC secure desktop 只验证结果被如实分类，不承诺插件自行识别或拦截；
- 锁屏或 Session 0 返回 `interactive_session_required`。

### 11.4 宿主兼容测试

每个宿主验证：

1. 发现且只发现两个公开工具；
2. observe 图片进入当前模型；
3. 模型能从截图生成一次 act；
4. act 的新截图进入下一轮；
5. 达成目标后自然停止；
6. 插件层没有确认弹窗；
7. 宿主若有审批，文档给出可验证的全自动配置或明确标记不兼容。

## 12. v1 验收标准

- macOS 与 Windows x64 使用相同两工具 Schema。
- 用户不配置插件模型或模型 API Key。
- setup 后 `doctor --json` 全绿，macOS 首次系统授权除外。
- 两个平台都能通过同一 Agent 循环完成打开应用、输入文本、点击按钮和读取可见结果。
- 旧 snapshot、越界坐标、缺失权限和错误版本均明确失败；Windows 权限相关失败不得伪装为成功。
- 每个平台连续运行 20 次确定性 Runtime Fixture，插件接缝成功率 100%；失败不得被记录为成功。
- Stable 发布还要求每个平台累计 100 次确定性 Fixture 无插件接缝失败，并完成至少 30 分钟或 200 个动作的连续运行测试；截图内容不变时仍必须产生新的 snapshot ID。
- Codex 与 Kimi 完成端到端视觉循环；通用 MCP 配置可复制使用。
- WorkBuddy 和 DeepSeek Harness 在发布矩阵中标记为已验证、实验性或不兼容，不做未经验证的承诺。
- 安装、诊断、升级、卸载、第三方许可和故障排查文档齐全。

## 13. 后续增强顺序

只有 v1 指标稳定后，按独立能力逐项评估：

1. 操作窗口选择；
2. 多显示器；
3. 可选 Accessibility/UIA 元素提示；
4. `computer_verify`；
5. 无状态依赖的短批量动作；
6. 后台投递与明确的前台升级；
7. Windows arm64；
8. 自有签名安装器。

每个增强必须保持坐标截图不变量，具备跨平台测试，并可在不改变 v1 基础路径的情况下关闭。

## 14. 规模判断

预计我方生产 TypeScript、配置和脚本约 1,500–3,000 行，测试和文档约 2,000–4,000 行。核心难度从原生系统控制转移到协议正确性、Cua 版本锁、安装诊断和真实宿主验证。

如果实现过程中开始复制 Cua Rust 平台代码、创建自有权限宿主、实现后台输入或维护原生签名流水线，应立即停止并重新审查范围；这些动作意味着项目偏离轻量 v1。
