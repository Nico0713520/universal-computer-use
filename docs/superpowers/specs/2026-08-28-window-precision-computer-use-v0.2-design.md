# Universal Computer Use v0.2：窗口精准与后台控制设计

日期：2026-08-28

状态：已确认设计，书面规格待用户复核

目标平台：macOS、Windows

产品版本：`0.2.0`

协议版本：`1.1.0`

## 1. 结论

v0.2 继续保持无模型、无聊天 GUI、仅两个 MCP 工具的产品边界，但把执行目标从“主显示器截图坐标”扩展为“桌面或一个精确窗口”。标准控件优先通过 Cua Driver 的 Accessibility/UIA 元素能力在后台操作；无法可靠出现在元素树中的 Canvas、WebGL、视频和自绘控件，回退到窗口截图坐标。

项目不 fork Cua、不复制原生平台代码，也不直接暴露 Cua 的 56 个底层工具。UCU 拥有稳定的公开协议、窗口与元素引用、snapshot 生命周期、动作策略、结果验证和宿主 Skill；Cua 继续拥有应用发现、窗口捕获、Retina/DPI、AX/UIA、后台投递和原生输入。

v0.2 的目标是完成跨平台“原生应用控制核心”，不是完整复刻 Codex，也不在本版本接入 Browser/CDP、多显示器、格式化粘贴或轨迹回放。

## 2. 方案选择

### 2.1 采用：两工具窗口精准模式

公开工具仍然只有：

- `computer_observe`
- `computer_act`

窗口、元素、Cua session、PID、window ID 和上游 element token 全部封装在这两个工具背后。旧版 `computer_observe({})` 和桌面动作继续有效。

这一方案同时保留小型模型侧接口和 Cua 的成熟执行能力。插件是深模块：公开面小，内部可以按平台和应用能力选择可靠路径。

### 2.2 不采用：只优化桌面坐标

缩短等待或改提示词不能解决被遮挡窗口、焦点错误、输入到错误应用和 Retina 坐标问题，因此不足以构成 v0.2。

### 2.3 不采用：透传全部 Cua 工具

直接暴露 PID、window ID、session、delivery ladder 和 56 个工具会放大宿主模型的选择空间，泄漏平台差异，并使 UCU 退化为不稳定的 Cua 转发层。

### 2.4 不采用：任意动作批处理

OpenAI 当前 Computer Use 协议允许执行 `actions[]` 后再截图，吞吐量更高；但任意坐标批处理会让多个动作共同依赖一张旧截图。v0.2 保留“一次 snapshot 只执行一个语义动作”的默认安全约束，通过 `set_value`、整段 `type_text`、菜单调用等高阶动作减少往返。通用批处理必须在独立规格中设计，不能悄悄进入 v0.2。

## 3. 产品能力

### 3.1 应用和窗口发现

桌面观察可选择附带经过过滤的应用和窗口候选。每个候选包含：

- UCU 生成的 session-scoped `window_ref`；
- 应用显示名和 bundle ID 或 Windows 应用标识（可用时）；
- 窗口标题；
- 窗口边界；
- 是否位于当前 Space/桌面、是否在屏幕上、是否最小化；
- 可用能力提示：`elements`、`window_screenshot`、`background_actions`。

公开结果不得包含 PID、原生 window ID、Cua session ID 或上游 snapshot ID。窗口候选必须有上限，默认最多 30 个；过滤零尺寸、菜单栏碎片和已知系统噪声窗口。过滤不能把“不可见”误写成“不存在”。

`launch_app` 是 `computer_act` 的桌面语义动作。它按稳定应用标识后台启动应用，并在 Cua 返回唯一就绪窗口时直接产生该窗口的新 snapshot；返回零个或多个候选窗口时，输出明确状态并要求重新发现，不猜测目标。

### 3.2 精确窗口观察

窗口观察同时请求 Cua 的窗口截图和 AX/UIA 结构。UCU 把原始元素树投影成有界的 actionable 元素列表，默认最多 150 个元素、最大深度 12；宿主可用 `query` 缩小结果，但不能提高服务端硬上限。

每个公开元素只包含：

- UCU 生成的 snapshot-scoped `element_ref`；
- `role`；
- `label`；
- 当前 `value`（存在时）；
- 归一化到窗口截图坐标的 `bounds`（可证明时）；
- `enabled`、`selected`、`focused` 等可信状态（存在时）；
- 允许的高层动作提示（Cua 能证明时）。

UCU 不返回 Cua 原始 Markdown 树，不返回上游 `element_index` 或 `element_token`。`visual_status` 只允许 `available`、`capture_unavailable`、`pixel_frame_unproven`；后两种状态省略截图和所有无法证明的像素坐标，但仍可返回可信元素。不得伪造截图或变换。

### 3.3 精准动作与输入

窗口 snapshot 支持以下语义动作：

- `click`、`double_click`、`right_click`：使用 `element_ref`，或使用窗口截图坐标；
- `drag`：窗口截图坐标；
- `scroll`：优先 `element_ref`，否则窗口截图坐标；
- `set_value`：直接替换标准可编辑控件的完整值；
- `type_text`：向指定元素或指定窗口输入完整 Unicode 文本；
- `keypress`：向指定窗口发送单键或组合键；
- `invoke_menu`：调用精确菜单路径；
- `wait`：显式、可取消、有上限的等待；
- `launch_app`：仅桌面 snapshot 可用。

桌面 snapshot 继续支持 v1 的坐标动作，并保留旧的 `{type:"type"}` 作为 `{type:"type_text"}` 的兼容别名。桌面文本输入仍被标记为焦点相关，不视为精准输入。

同一个动作中，元素引用和坐标必须二选一。元素引用必须属于被消费的 snapshot，窗口动作目标由 snapshot 隐式决定；客户端不能在 `computer_act` 中换一个 `window_ref`。

### 3.4 后台投递

窗口动作默认使用 `delivery:"background"`。UCU 不自动把后台失败升级为前台，也不使用 AppleScript、Shell 输入或宿主内置 Computer Use 作为隐式旁路。

当 Cua 明确建议前台路径时，结果返回 `escalation`。宿主模型可以基于新 snapshot 再发一个 `delivery:"foreground"` 的动作；这个决定不要求插件弹出确认，但宿主自身的审批策略仍然有效。

“后台”在 v0.2 中表示：目标窗口被其他窗口遮挡时，仍可单独观察，并尽量通过 AX/UIA 或受支持的窗口消息执行动作，而不移动用户光标、不改变前台 App。它不承诺锁屏、UAC 安全桌面、所有最小化/隐藏窗口或隐藏的自绘像素表面。

### 3.5 动作后观察与验证

每个动作继续在进入 Cua 前原子消费 snapshot。动作完成后，UCU 重新观察同一目标并生成新的 snapshot；窗口关闭、重建、owner 改变或坐标空间无法证明时，不允许静默退回桌面。`launch_app` 是唯一允许动作后从桌面目标迁移到新窗口目标的动作，且只有 Cua 返回唯一、已就绪的精确窗口时才迁移。

输入动作优先使用可读回的字段值验证；存在明确 `expect` 时，UCU 可委托 Cua `verify_state` 做最长 10 秒的有界条件验证。验证中的 `element_ref` 只能使用被消费 snapshot 内保存的角色、标签和值身份去重定位；重新观察后不能唯一匹配时返回 `verification_unknown`，不得选择第一个近似元素。没有可验证后置条件时，`unverifiable` 保持为 `unverifiable`，不能因为 Cua 返回非错误就改成成功。

等待策略遵守：

1. 不存在无条件 3 秒或其他固定延迟；
2. 动作后立即取第一次状态；
3. 只有调用方提供 `expect`，或引擎报告正在加载/过渡时，才做有上限的条件等待；
4. 超时返回真实最后状态，不自动重复原动作。

## 4. 公开协议

### 4.1 `computer_observe`

兼容输入：

```json
{}
```

扩展输入：

```json
{
  "target": { "kind": "desktop" },
  "discover_windows": true
}
```

```json
{
  "target": { "kind": "window", "window_ref": "win_..." },
  "elements": {
    "query": "display",
    "max_elements": 100,
    "max_depth": 10
  }
}
```

`target` 省略时等价于主桌面。只有桌面观察可以请求 `discover_windows`；只有窗口观察可以提供 `elements`。

桌面输出保留 v1 字段，并增加：

```json
{
  "target": { "kind": "desktop", "display_id": "primary" },
  "coordinate_space": "desktop_screenshot_pixels",
  "windows": []
}
```

窗口输出核心字段：

```json
{
  "protocol_version": "1.1.0",
  "session_id": "ucu_...",
  "snapshot_id": "snap_...",
  "platform": "macos",
  "target": {
    "kind": "window",
    "window_ref": "win_...",
    "app_name": "计算器",
    "title": "计算器"
  },
  "coordinate_space": "window_screenshot_pixels",
  "visual_status": "available",
  "screenshot": {
    "mime_type": "image/png",
    "width": 460,
    "height": 816
  },
  "elements": [],
  "elements_truncated": false,
  "engine": {
    "name": "cua-driver",
    "version": "0.22.2"
  }
}
```

当 `visual_status` 不是 `available` 时不返回伪造的 `ImageContent`，并返回稳定原因和仍可用的元素信息。

### 4.2 `computer_act`

旧输入保持兼容：

```json
{
  "snapshot_id": "snap_...",
  "action": { "type": "click", "x": 640, "y": 420 }
}
```

元素精准输入示例：

```json
{
  "snapshot_id": "snap_...",
  "action": {
    "type": "set_value",
    "element_ref": "el_...",
    "text": "example"
  },
  "delivery": "background",
  "expect": {
    "element": {
      "element_ref": "el_...",
      "value_equals": "example"
    }
  }
}
```

约束：

- `snapshot_id` 仍是必填且只能消费一次；
- `delivery` 只允许 `background` 或 `foreground`，窗口动作默认 `background`，桌面动作只允许 `foreground`；
- `expect` 最多一个窗口断言和一个元素断言；
- `expect` 只能引用本 snapshot 已公开的元素；
- 坐标必须位于本 snapshot 的截图边界；
- `actions[]` 被明确拒绝。

动作结果增加安全归一字段。`verification.status` 只允许 `not_requested`、`satisfied`、`unsatisfied`、`unknown`；`evidence` 是去敏后的有界证据类型数组，不直接透传上游自由文本：

```json
{
  "action_result": {
    "status": "executed",
    "effect": "confirmed",
    "route": "accessibility",
    "delivery": "background",
    "evidence": ["value_readback"],
    "escalation": null,
    "delivered_count": 7,
    "error_code": null
  },
  "verification": {
    "status": "satisfied"
  }
}
```

`computer_act` 输出是两个明确分支的判别联合：

- `next_state:"available"`：包含新 `snapshot_id`、目标状态以及可用时的截图；
- `next_state:"unavailable"`：包含已消费的 snapshot、动作真实结果和 `next_observation_error`，不包含新 `snapshot_id` 或截图。

动作已执行但同一窗口无法重新观察时必须进入第二分支。下一步只能重新调用桌面观察和窗口发现。

## 5. 内部模块

### 5.1 Target Registry

维护 `window_ref → {pid, window_id, identity}` 的 session 内映射。`window_ref` 使用加密安全随机值，不由 PID 或标题编码。Registry 负责候选过滤、身份复核、owner 迁移和失效。

### 5.2 Snapshot Store

SnapshotRecord 从桌面尺寸记录扩展为：

- UCU snapshot ID；
- Cua session ID；
- 目标种类；
- 截图尺寸和坐标空间；
- 内部精确窗口目标；
- 上游窗口 snapshot ID；
- `element_ref → element_token` 映射；
- 创建时间和目标身份。

store 仍最多保存一个当前 snapshot。创建新 snapshot 会立即废弃旧 snapshot 及全部元素引用。

### 5.3 Cua Adapter

Adapter 只调用锁定版本 SDK 的公开工具。v0.2 必需工具集合增加：

- `list_apps`
- `list_windows`
- `get_window_state`
- `verify_state`
- `launch_app`
- `bring_to_front`
- `invoke_menu`
- `set_value`
- v1 已使用的桌面、点击、拖拽、输入、按键、滚动和 session 工具

`bring_to_front` 仅用于显式 foreground 动作，不是后台失败后的自动补救。

### 5.4 Observation Projector

该模块负责：

- 验证 Cua 结构化输出和图片数量；
- 把窗口树投影为有界 actionable 元素；
- 生成 UCU element refs；
- 归一化可信坐标；
- 删除 PID、window ID、上游 token、原始树和非必要属性；
- 对截断、降级和坐标不可证明给出明确标记。

### 5.5 Action Policy

根据 snapshot 目标和动作地址选择 Cua rung：

1. `element_ref` → Accessibility/UIA；
2. 窗口坐标 → 窗口像素路径；
3. 桌面坐标 → 主显示器全局输入；
4. 只有显式 foreground 请求才能进入前台路径。

策略层不自动重试有副作用的动作。

### 5.6 Result Normalizer

保留并限制 Cua 的 `effect`、`route`、`delivery`、`evidence`、`escalation`、`delivered_count` 和错误码。未知字段不会直接穿透公共协议；新的上游枚举值先映射为 `unknown` 并记录不含敏感数据的诊断。

## 6. Cua 版本策略

v0.2 的候选底座从 `0.22.1` 升到正式 SemVer `0.22.2`，release tag 为 `cua-driver-rs-v0.22.2`，source commit 为 `d114f35fec05ecd37bf529e5587be86852205b64`。该版本包含 macOS Retina backing scale 修复。

升级必须遵循 stage → development E2E → promote：

1. 更新 npm SDK、release assets、哈希和工具契约；
2. 保持 macOS/Windows `release_eligible:false`；
3. 运行全部 v1 回归和新的窗口 adapter contract；
4. 在 macOS、Windows 生成候选实机证据；
5. 只有签名者和平台证据均通过才晋级。

不使用 `latest`、main 或 0.22.3 nightly。

## 7. 错误和恢复

v0.2 新增稳定错误：

- `window_not_found`：window_ref 不存在或已失效；
- `window_target_ambiguous`：启动或发现得到多个同等候选；
- `window_owner_changed`：原生窗口转移到另一个进程；
- `target_lost`：动作后精确目标不再存在；
- `stale_element_ref`：元素不属于当前 snapshot；
- `element_target_conflict`：元素引用与坐标或目标冲突；
- `element_unavailable`：元素存在但目标动作不可用；
- `pixel_frame_unproven`：无法证明截图和点击坐标变换；
- `background_unavailable`：目标不能保持后台执行；
- `foreground_required`：引擎建议显式前台升级；
- `verification_unsatisfied`：有界后置条件明确不满足；
- `verification_unknown`：无法证明后置条件；
- `engine_unhealthy`：底层调用超时或 daemon 进入不可继续状态。

所有 Cua 调用都有独立 deadline。一次超时后，当前 snapshot 和元素引用全部失效；Runtime 只有通过健康检查后才能继续。UCU 不在动作超时后自动重复输入或点击。

## 8. 性能设计

v0.2 性能目标不是让原生 AX 遍历本身比全屏截图更快，而是减少模型侧负担和无意义等待：

- 窗口 PNG 替代主屏 PNG；
- raw Cua 树投影成有上限的 actionable 列表；
- 支持 query；
- 整段文本作为一个语义动作；
- act 直接返回下一状态；
- 无条件固定等待为零；
- 记录 capture、projection、engine action、verification 四段耗时；
- 日志不记录截图、文本、标签值或窗口内容。

macOS 基线验收记录窗口截图字节数、桌面截图字节数和各阶段 p50/p95，但不使用跨机器不稳定的绝对毫秒值作为发布硬门槛。发布硬门槛是：无固定等待、窗口图确实小于对应主屏图、投影结果受硬上限约束、任何超时均有上限且不盲重试。

## 9. 安全和隐私

- window_ref、element_ref 和 snapshot_id 只在一个 MCP transport session 内有效；
- 日志不得包含输入文本、字段值、截图、剪贴板、PID、原生 window ID、模型提示或环境变量；
- 插件不内置风险确认弹窗，也不能绕过宿主 Agent 的审批策略；
- 后台模式不允许偷偷升级前台；
- 屏幕录制和辅助功能权限继续由未修改、已签名的 Cua Runtime 持有；
- UCU 不复制、修改、重签或伪装 CuaDriver 原生程序。

## 10. TDD 公共测试接缝

以下接缝是 v0.2 唯一允许直接建立行为测试的边界，用户批准本规格即批准这些测试接缝：

1. **MCP 协议接缝**：通过 `computer_observe`、`computer_act` 的公开 JSON Schema 和返回 envelope 验证向后兼容、两工具数量和错误语义。
2. **EnginePort 接缝**：通过 fake Cua SDK 驱动公开 EnginePort，验证 Cua 工具调用、目标映射、结果归一和 deadline；不 mock adapter 私有函数。
3. **Snapshot/Target 行为接缝**：通过 core observe/act 用例验证一次性 snapshot、window_ref、element_ref、目标丢失和坐标边界；不断言内部 Map 或随机 token 格式之外的实现细节。
4. **CLI/Engine Lock 接缝**：通过 CLI 输出和 lock loader 验证 0.22.2 stage、工具契约、签名/证据门槛和 fail-closed 行为。
5. **真实桌面 E2E 接缝**：通过专用可丢弃 Fixture、Calculator 和 TextEdit/Notepad 的可见后置条件验证后台、输入、Retina/DPI 和焦点哨兵；不依赖人工目测作为唯一证据。

每个功能采用一个失败测试、一个最小实现的纵向切片，不先批量编写所有 imagined tests。重构只在一组行为测试通过后的独立 review 阶段进行。

## 11. 验收场景

### 11.1 macOS Beta

在用户持续使用另一个前台 App 时：

1. 后台启动或找到 Calculator；
2. 精确绑定 Calculator 窗口；
3. 使用元素或定向文本完成 `37 × 19`；
4. 读取窗口状态确认结果 `703`；
5. 前台 App、用户鼠标位置和键盘焦点保持不变；
6. 全流程没有固定三秒等待和旧 snapshot 重用。

另需通过 TextEdit 定向输入并读回、Retina 窗口坐标、窗口关闭后的 target_lost、Canvas 可见窗口坐标回退。

### 11.2 Windows Experimental/Beta

在 100%、125%、150% 缩放下分别验证：

- Calculator 元素和窗口坐标；
- Notepad 定向输入和读回；
- WinUI/WPF Fixture 后台操作；
- UIA provider 超时有界；
- 普通权限进程遇到高权限目标时诚实拒绝；
- UAC、锁屏、Session 0 不被宣传为支持。

没有 Windows 实机证据时只能发布为 Experimental；三个 DPI 档、焦点哨兵和标准应用矩阵通过后才能标 Beta。

### 11.3 宿主兼容

Codex、HanaAgent、WorkBuddy 至少各完成一次真实 stdio MCP 验收。验收记录必须证明调用的是 UCU 的两个 MCP 工具，不能使用 Shell、AppleScript、宿主内置 Computer Use 或心算替代 GUI 行为。

## 12. 明确不在 v0.2

- Browser/CDP 页面和标签页发现、上传、下载、浏览器弹窗；
- 多显示器寻址；
- 格式化 HTML/Markdown 粘贴和精确文本选区；
- 任意动作批处理；
- 录制、轨迹回放和训练数据导出；
- 锁屏、UAC 安全桌面、Session 0 和无人登录桌面；
- 自有原生 Runtime、重新签名或隐藏 CuaDriver 身份；
- 插件内模型、OCR、规划器或独立任务循环。

## 13. 发布顺序

1. Stage 并验证 Cua 0.22.2；
2. 交付桌面兼容的窗口发现；
3. 交付窗口观察和有界元素投影；
4. 交付 element_ref 精准点击；
5. 交付 set_value/type_text/keypress 和读回验证；
6. 交付后台投递、显式前台升级和 target_lost；
7. 更新 canonical Skill、README 和排障文档；
8. 完成 macOS Beta 证据；
9. 完成 Windows Experimental，再以实机矩阵晋级 Beta；
10. 完成三宿主兼容证据后发布 `0.2.0`。

每个阶段必须保持旧桌面模式、两工具门面和 snapshot 单次消费测试通过。
