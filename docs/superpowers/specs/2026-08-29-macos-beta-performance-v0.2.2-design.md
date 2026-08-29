# Universal Computer Use v0.2.2：macOS 性能与自适应观察设计

**状态：** 已确认方向，等待书面规格复核

**日期：** 2026-08-29

**目标版本：** product `0.2.2`，protocol `1.2.0`

**执行引擎：** 锁定 Cua Driver `0.22.2`，本版本不升级引擎

## 1. 背景与结论

v0.2.1 已经证明两工具 MCP、一次性 snapshot、窗口截图、语义元素、后台投递和坐标回退能够在真实 macOS 上工作。当前主要问题不再是“能不能动”，而是动作后的完整窗口截图与 Accessibility 树重复采集，使连续语义操作付出不必要的延迟。

v0.2.2 采用以下结论：

1. 保留 `computer_observe` 和 `computer_act` 两个工具，不增加规划器、模型或批量动作工具。
2. `computer_act` 增加可选的 `next_observation`，让宿主明确请求动作后的视觉状态或轻量语义状态。
3. `next_observation` 是向后兼容的可选输入；未传时以被消费 snapshot 的观察配置作为初始偏好，但不确定、失败或坐标路径仍可按新安全策略升级视觉回读。
4. 只有经 Accessibility 或系统 API 独立确认的语义动作，才允许真正返回无截图的轻量语义状态；不确定动作自动升级为完整视觉回读。
5. 不加入任何固定“模仿人思考”的等待。等待只能来自用户显式 `wait(ms)`、有上限的状态验证轮询，或 Cua 内部针对具体系统行为的稳定等待。
6. 先测量 UCU 可控制的阶段，再优化；不伪造 Cua 内部没有公开的耗时数据。

这不是通过减少安全检查换速度，而是减少已经被机器证据证明后仍重复进行的视觉采集。

## 2. 成功标准

### 2.1 功能

- 首次观察仍可同时返回精确窗口截图和 Accessibility 元素。
- Agent 可在一次已定位的语义动作中请求下一状态只返回元素树，不返回 PNG。
- 轻量状态仍生成新的单次消费 `snapshot_id`，仍只能执行一次动作。
- 轻量状态可继续执行 `element_ref`、菜单和无坐标键盘动作。
- 任何坐标动作都必须基于带可证明像素坐标系的 snapshot；否则在进引擎前拒绝。
- 语义动作不能被独立确认、窗口身份变化、目标丢失或验证未知时，最终状态必须包含新视觉帧，或明确返回视觉不可用，不得静默盲重试。
- `computer_act` 返回的新状态是下一步唯一有效状态；Canonical Skill 不得再额外调用一次重复观察。

### 2.2 性能

在同一台已通过 v0.2.1 验收的 Apple Silicon Mac、daemon 已启动、目标 fixture 已打开的 warm-run 条件下，30 次采样满足：

| 场景 | p50 | p95 |
| --- | ---: | ---: |
| 精确窗口完整观察（截图 + 有界元素） | ≤ 700 ms | ≤ 1,500 ms |
| 精确窗口语义观察（无截图 + 有界元素） | ≤ 400 ms | ≤ 1,000 ms |
| 已确认语义动作 + 语义下一状态 | ≤ 1,000 ms | ≤ 2,000 ms |
| 坐标动作 + 完整视觉下一状态 | ≤ 1,500 ms | ≤ 3,000 ms |

单次结果超过目标值不自动判定产品失败；验收以 p50/p95 为准。现有 20 秒 `action_timeout` 只约束一次 `EnginePort.execute`，不等于整个 MCP 调用 deadline；验证和后置观察仍各自使用现有有界 timeout。本版本不新增一套会与这些 timeout 竞争的总 deadline。

### 2.3 正确性与稳定性

- 无固定 3 秒、1 秒或其他人为动作后 sleep。
- 无动作自动重试；`suspected_noop` 和 `unverifiable` 交给新状态驱动下一次模型决策。
- 语义模式连续 30 次不出现 stale snapshot 复用、跨窗口投递或重复输入。
- 坐标模式连续 30 次独立命中 fixture 的像素 oracle，不用 Accessibility bounds 反推点击位置。
- 元数据日志不记录截图、文字、元素 label/value、窗口标题、路径、PID 或原始 ref。

## 3. 范围

### 3.1 本版本包含

- `next_observation` 公共输入契约。
- 自适应安全升级策略。
- 观察配置的显式状态建模。
- UCU 边界级分阶段耗时记录。
- Canonical Skill 的视觉/语义/回退决策规则。
- 真实 macOS fixture 的性能、文本输入、语义连续操作和像素回退验收。
- 修正文档中对 Cua `0.22.2` GitHub Pre-release 标签的错误解释。

### 3.2 本版本不包含

- 多动作批处理或同一 snapshot 连续执行多个动作。
- 帧差、局部 PNG、视频流或专有图像传输格式。
- Cua main/nightly 的 Interactive Input Session。
- Browser/CDP/DOM 专用工具。
- Windows 精确窗口与 DPI 发布资格。
- 自研原生输入/截图 runtime。
- 安装器、签名、自动启动和权限引导重做。
- 多显示器、锁屏、RDP、UAC 提权或安全桌面。

这些项目分别进入 v0.2.3、v0.2.4、v0.3 之后的独立规格，不能借性能优化混入本版本。

## 4. 公共协议

### 4.1 工具数量不变

MCP Server 继续只发布：

- `computer_observe`
- `computer_act`

产品版本升级为 `0.2.2`。由于 `computer_act` 新增公共可选字段，protocol 升级为 `1.2.0`。

### 4.2 `next_observation`

`computer_act` 新增可选对象：

```json
{
  "snapshot_id": "snap_...",
  "action": {
    "type": "click",
    "element_ref": "el_..."
  },
  "next_observation": {
    "mode": "semantic"
  }
}
```

契约如下：

- `mode` 必填，只允许 `visual` 或 `semantic`。
- `next_observation` 只允许用于被消费 snapshot 的 target 为 `window`。JSON Schema 只能验证对象形状，无法从 opaque `snapshot_id` 推断 target；runtime 必须在消费 snapshot 前校验。冲突时返回新错误 `next_observation_target_conflict`、`recovery:"observe_again"`、`retryable:true`，且不消费 snapshot。
- `visual` 表示动作后请求截图与元素；`semantic` 表示动作后优先只请求元素。
- 未传 `next_observation` 时，继承被消费 snapshot 的 `include_screenshot`、`query`、`max_elements` 和 `max_depth` 作为初始偏好；§5.2 的安全恢复条件仍有权把无图偏好升级为视觉回读。
- 传入 `next_observation` 时只改变动作后是否请求截图；元素 query、max_elements 和 max_depth 始终继承被消费 snapshot。若要改变元素范围，宿主必须显式调用一次新的 `computer_observe`，避免把观察过滤和动作效果验证耦合在一个请求里。
- `mode:"visual"` 固定 `includeScreenshot:true`。
- `mode:"semantic"` 表达宿主偏好，而不是关闭安全恢复的强制命令。

### 4.3 下一状态透明度

窗口观察和窗口动作输出新增：

```json
{
  "observation_mode": "semantic"
}
```

`observation_mode` 只允许：

- `visual`：本状态由直接视觉观察产生。
- `semantic`：宿主请求或继承语义模式，截图未请求。
- `visual_recovery`：宿主请求或从被消费 snapshot 继承语义模式，但安全策略升级为视觉回读。

它与现有 `visual_status` 同时存在：

- `observation_mode` 说明控制循环选择了哪条路径。
- `visual_status` 说明最终是否真的有可用像素证据。

完整判别表如下：

| 调用结果 | `next_state` | `observation_mode` | `visual_status` | screenshot | elements | 新 `snapshot_id` | `next_observation_error` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `computer_observe` 窗口视觉成功 | 不适用 | `visual` | `available` | 必有 | 必有 | 必有 | 无 |
| `computer_observe` 窗口视觉帧不可证明、元素仍可用 | 不适用 | `visual` | `capture_unavailable` 或 `pixel_frame_unproven` | 无 | 必有 | 必有 | 无 |
| `computer_observe` 窗口语义成功 | 不适用 | `semantic` | `not_requested` | 无 | 必有 | 必有 | 无 |
| `computer_act` 视觉回读成功 | `available` | `visual` 或 `visual_recovery` | `available` | 必有 | 必有 | 必有 | 无 |
| `computer_act` 视觉帧不可证明、元素仍可用 | `available` | `visual` 或 `visual_recovery` | `capture_unavailable` 或 `pixel_frame_unproven` | 无 | 必有 | 必有 | 无 |
| `computer_act` 语义回读成功 | `available` | `semantic` | `not_requested` | 无 | 必有 | 必有 | 无 |
| 目标丢失、owner 改变或观察抛出 capture failure | `unavailable` | 字段不存在 | 字段不存在 | 无 | 无 | 无 | 必有，沿用现有 code/recovery |

因此 `observation_mode` 描述选择的观察路径，`visual_status` 描述该路径最终获得的像素证据。请求视觉但上游只返回可用元素时仍可发布受限 snapshot；该 snapshot 只能用于语义动作。若观察整体失败，则必须使用现有 unavailable envelope，不能伪造 snapshot。

## 5. 自适应观察策略

### 5.1 可保持语义模式的条件

只有宿主显式传入 `next_observation.mode:"semantic"`，或被消费 snapshot 本身继承为无图语义配置，且同时满足以下条件，它才能成为语义候选并以 `includeScreenshot:false` 开始回读：

1. 被消费的是精确窗口 snapshot。
2. 动作通过 `element_ref`、`invoke_menu`，或不依赖坐标的窗口内键盘地址执行。
3. 布尔条件严格为 `status === "executed" && (effect === "confirmed" || hasResolvedExpectation)`；`hasResolvedExpectation` 不能让 refused/failed 动作进入语义候选。
4. `route` 为 `accessibility` 或 `system_api`。
5. `delivery` 为 `background` 或 `not_applicable`。
6. 没有 `escalation`，没有目标丢失、owner 变化、capture/contract/health 错误。
7. 若存在 resolved expectation，最终 verification 必须为 `satisfied`，且应用 verification 后的最终 effect 必须为 `confirmed`；否则该候选不得成为最终语义状态。

`hasResolvedExpectation` 定义为 runtime 的 `resolvedVerificationExpectation !== undefined`。它既包括请求中的显式 `expect`，也包括 `set_value` 自动生成的 value readback expectation，不能只检查输入字段是否存在。

### 5.2 必须视觉恢复的条件

出现以下任一情况必须优先于 §5.1 的允许条件，动作后使用 `includeScreenshot:true`：

- 坐标 click、double click、right click、drag、坐标 scroll、坐标 type/type_text 或坐标 keypress。window snapshot 上的 `move` 继续按现有规则直接拒绝，不在本版本增加 window move。
- `route` 为 `synthetic_events`、`global_input`、`trusted_input`、`dom` 或 `unknown`。
- `delivery` 为 `foreground` 或 `unknown`。
- 不存在 resolved expectation 时，`effect` 为 `partial`、`unverifiable` 或 `suspected_noop`。
- expectation 为 `unsatisfied` 或 `unknown`。
- 存在 expectation，但应用 verification 后的最终 `effect` 仍不是 `confirmed`。
- 上游要求 foreground escalation。
- 动作是显式 `wait`；等待结束后的真实屏幕变化无法仅由动作回执证明。
- `status` 为 `refused` 或 `failed`。即使动作回执失败，也可能已经产生副作用，必须尝试视觉恢复以降低重复输入风险。

引擎抛出会被 runtime 归一为 failed execution 的普通异常，同样尝试视觉恢复。只有现有 fail-closed 异常（如 `action_timeout`、`engine_contract_changed`、`engine_unhealthy`）继续直接返回安全错误并标记 `snapshot_consumed:true`，因为此时不能信任后续引擎观察。

### 5.3 两阶段决策与验证

为避免“必须先观察才能知道 verification、却又要先决定观察模式”的循环依赖，后置观察采用两阶段策略：

1. 引擎动作返回后，根据 action address、route、delivery、effect 和 `next_observation` 计算初始候选模式；视觉恢复拒绝条件先求值，语义允许条件后求值。
2. 不是语义候选时，直接执行一次完整视觉观察。
3. 是语义候选且没有 resolved expectation 时，执行一次轻量语义观察并发布。
4. 是语义候选且有 resolved expectation 时，使用继承自被消费 snapshot 的 query/max_elements/max_depth 做轻量验证轮询；这包含 `set_value` 的隐式 value readback。
5. verification 为 `satisfied` 且应用 verification 后最终 effect 为 `confirmed` 时，发布最后一次轻量观察；verification 为 `unsatisfied`/`unknown` 或最终 effect 未确认时，再执行一次完整视觉观察，并以 `visual_recovery` 发布。

内部验证轮询沿用现有总超时和有界 polling，不增加固定动作后 sleep。所有中间观察仍为内部证据，只有最后一次状态生成公共 snapshot。

### 5.4 坐标安全

- `observation_mode:"semantic"` 的 snapshot 没有像素 frame，任何坐标动作在调用 `EnginePort.execute` 前返回现有 `pixel_frame_unproven` 拒绝。统一 pre-engine 坐标守卫必须覆盖 drag 的两个点，以及所有带 `x/y` 的 click/double_click/right_click/scroll/type/type_text/keypress；测试同时断言引擎调用数为零。
- Agent 必须调用 `computer_observe` 获取 `include_screenshot:true` 的同一窗口新状态，然后才能坐标操作。
- 不能把元素 bounds 当成截图像素 frame 的替代品。
- 不能在 UCU 内部把语义状态偷偷补图后继续执行原坐标动作，因为这会让模型动作依据和实际像素依据不一致。

## 6. 控制循环

推荐循环为：

1. 用 desktop discovery 找到目标 `window_ref`。
2. 对目标窗口执行一次 `include_screenshot:true` 的完整观察，完成视觉 grounding。
3. 标准控件优先选择 `element_ref`。
4. 若动作具有可独立验证的语义效果，在同一个 `computer_act` 中请求 `next_observation.mode:"semantic"`。
5. 直接使用 `computer_act` 返回的新 snapshot 继续下一步，不追加重复 `computer_observe`。
6. 当元素不足、结果不确定、目标窗口变化或必须使用坐标时，使用视觉状态；若当前是语义状态，先重新观察。
7. 每个 snapshot 始终只消费一次，直到任务完成或返回稳定错误。

计算器这类标准控件任务应表现为“一次完整视觉 grounding + 连续语义动作”；Canvas、视频、WebGL 等应保持“一动作 + 一视觉回读”。

## 7. 性能测量

### 7.1 只记录 UCU 能证明的边界

每次工具调用可记录下列非敏感阶段：

- `queue_wait_ms`：进入 FIFO 到获得执行权。
- `engine_execute_ms`：调用 `EnginePort.execute` 的墙钟耗时。
- `post_action_observe_ms`：动作完成后观察/验证的墙钟耗时。
- `projection_ms`：把引擎元素投影为公共 refs 与输出的耗时。
- `tool_total_ms`：工具处理总耗时。

`computer_observe` 没有动作阶段，只记录适用的 `queue_wait_ms`、`post_action_observe_ms`、`projection_ms` 和 `tool_total_ms`。

这些名称不得被描述成 Cua 的 AX walk、截图或编码内部耗时，因为 UCU 当前没有该层公开证据。

### 7.2 日志安全

元数据日志采用固定 allowlist：

- 可以记录：工具名、动作类型、effect、route、delivery、错误码、观察模式、上述非负有限毫秒数、哈希后的 session/snapshot ID。
- 不可以记录：输入对象、截图、文本、按键内容、元素属性、window/app 名称、原始 ID、路径、PID、异常堆栈。
- 未知字段在任何嵌套层级全部丢弃。
- 默认继续写 stderr JSONL，不写磁盘文件。

性能证据文件只保存聚合统计和场景通过结果，不保存单次截图或用户内容。

## 8. 代码边界

### 8.1 Protocol

`product/src/protocol.ts` 负责：

- 校验 `next_observation`。
- 发布 protocol `1.2.0` JSON Schema。
- 校验新的 `observation_mode` 输出。
- 发布 `next_observation_target_conflict` 安全错误码；target 冲突本身由 runtime 判断。

它不决定何时安全升级视觉回读。

### 8.2 Observation policy

新增独立纯模块 `product/src/core/observation-policy.ts`，提供两个纯函数。

初始决策输入：

- 被消费 snapshot 的观察配置。
- `next_observation` 偏好。
- 已解析的 engine action。
- engine execution result。
- 是否存在 verification expectation。

输出：

- 初始 `SnapshotObserveOptions`。
- 候选 `observationMode`。

最终决策输入初始候选和 verification result，输出最终 `observationMode` 以及是否必须补一次视觉恢复观察。

该模块不访问引擎、不创建 snapshot、不写日志，因此可完整单元测试。

### 8.3 Runtime

`product/src/core/runtime.ts` 继续负责 FIFO、snapshot 原子消费、引擎 deadline、后置观察和唯一新 snapshot 发布。它调用 observation policy 决定后置观察参数，不把策略散落在动作分支里。

验证轮询继续只发布最终一次 observation；中间采样不得成为公共 snapshot。

### 8.4 Telemetry

新增 `product/src/logging/timing.ts` 提供单调时钟和阶段累加器。`redaction.ts` 只负责固定白名单投影。业务逻辑不得直接序列化任意 timing 对象。

### 8.5 EnginePort

`EnginePort` 接口保持可替换；Cua adapter 继续只接受 `includeScreenshot`、query 和元素上限。自适应策略属于 UCU harness，不进入 Cua adapter。

## 9. 错误与恢复

- `engine_contract_changed`、`engine_unhealthy`：fail closed，标记 engine unhealthy，要求 doctor/recovery；不回退桌面输入。
- `target_lost`、`window_owner_changed`：使窗口 ref 失效；不向相同坐标盲投。
- `capture_failed`：若引擎仍返回元素和明确的 `visual_status`，可发布表中受限的 available snapshot；若观察整体抛错，则返回现有 unavailable envelope，不降级为无图并声称视觉成功。
- `action_timeout`：被消费 snapshot 仍失效；禁止宿主原样重放。
- `suspected_noop`、`unverifiable`：返回视觉回读供模型重新判断；UCU 不重复动作。
- 语义 snapshot 上请求坐标：稳定拒绝 `pixel_frame_unproven`，不调用引擎。
- query 或元素上限让所需 element 消失：Agent 重新观察并放宽过滤；UCU 不猜测旧 ref。

## 10. 测试与真实验收

### 10.1 单元与契约测试

- protocol schema 接受合法形状并拒绝未知 mode、空/混合对象；desktop target 冲突由 runtime 在 snapshot 消费前返回 `next_observation_target_conflict`。
- 未传新字段时继承 v0.2.1 的初始观察配置；不确定或失败结果按 §5.2 做安全升级。新增 `observation_mode` 是 protocol 1.2.0 的显式输出字段，宿主必须刷新 schema。
- observation policy 对全部 action/address/route/effect/delivery/verification 组合做表驱动测试，并证明两阶段决策不会形成循环依赖。
- 语义状态的坐标动作在引擎调用计数为零时被拒绝。
- visual recovery 只发布一个新 snapshot。
- timing 只接受非负有限数值；redaction 丢弃所有敏感和未知嵌套字段。
- MCP 工具数量保持 2，发布的 JSON Schema 能区分合法/非法输入。

### 10.2 确定性 fixture

fixture 必须提供互相独立的 oracle：

- AX 元素按钮序列，用于验证连续 background element 操作。
- 固定视觉几何区域，用于验证 window screenshot pixel 坐标。
- 文本输入框和提交结果，用于证明 `set_value`/`type_text` 恰好写入一次。
- 可切换的覆盖层或 Canvas，用于证明从语义模式恢复视觉后再坐标操作。
- 前台 sentinel，用于证明 background 语义动作不抢前台。

### 10.3 真实应用 smoke

- Calculator：一次视觉 grounding 后，以元素模式完成 `37 × 19 = 703`，不依赖猜坐标。
- TextEdit：以 `set_value` 或明确地址的 `type_text` 输入唯一 nonce，只出现一次。
- Chrome 或 Electron fixture：覆盖易回显/疑似 no-op 路径，结果不确定时必须视觉恢复。

真实应用 smoke 不替代确定性 fixture 的正确性 oracle；它用于发现真实 Accessibility、焦点和进程生命周期差异。

### 10.4 性能证据

新增开发验收输出：

- 环境、product/protocol/engine 版本。
- 四个性能场景的样本数、p50、p95、最大值。
- 是否存在固定 sleep 的静态扫描结果。
- 语义序列、像素序列、唯一输入、前台保持的通过结果。

计时使用验收 MCP 客户端的单调时钟：在写出完整 JSON-RPC `tools/call` 请求前开始，在收到并解析完整响应后停止，因此包含 stdio、FIFO、序列化和工具执行时间。内部 `tool_total_ms` 只用于诊断，不作为 SLO 判定值。

每个场景先执行 5 次不计入统计的 warm-up，再执行 30 次计时运行。每次运行前在计时区间外把 fixture 恢复到已知状态，并由独立 oracle 确认 reset 成功；reset 失败立即判场景失败。30 个耗时全部排序并使用 nearest-rank：`p50 = 第 ceil(0.50 × 30) 个值`，`p95 = 第 ceil(0.95 × 30) 个值`。失败调用的墙钟耗时仍进入数组，同时任何一次正确性失败都会让整个场景失败，不能删除或重跑替换样本。

“不存在固定 sleep”的静态扫描只覆盖生产代码 `product/src/**` 和 Canonical Skill，不扫描验收代码中的有界 polling。扫描允许显式 `wait(ms)` 的动作实现、verification 的 50/100/200/400/500 ms 有界退避以及 Cua 上游内部等待；这些必须在代码中具备可追溯用途，不能成为每个动作都执行的通用延迟。

## 11. Cua 依赖策略

- v0.2.2 继续锁定并校验 Cua `0.22.2` 的版本、哈希和签名者。
- Cua GitHub 将 monorepo 的多个组件发布标为 Pre-release，以控制 Latest 指针；普通 SemVer driver 版本仍可作为稳定发布通道。UCU 不再把该 GitHub 标签本身写成 release blocker。
- UCU 仍为 Developer Preview，原因是自身尚未完成命名宿主矩阵、安装恢复、长时 soak 和 Windows 实机证据。
- 不直接跟随 Cua main 或 nightly。出现下一个普通 SemVer release 时，先做 SDK/JSON contract diff、锁定制品、全套单元/契约/实机验收，再单独升级。
- 上游内部的 Interactive Input Session 在形成公开、稳定、可锁定契约前，只作为研究对象，不进入本版本生产架构。

## 12. 发布与回滚

实现分为五个可独立提交的切片：

1. protocol 与兼容性契约。
2. observation policy 与 runtime 集成。
3. timing/redaction。
4. Canonical Skill 与文档纠错。
5. macOS fixture、性能证据与真实 smoke。

每个切片先写失败测试，再实现，再运行相关测试。最终必须通过 typecheck、完整测试、build、pack 和真实 macOS 开发验收。

`next_observation` 是可选的向后兼容输入；不传时不启用主动的视觉→语义加速，但 §5.2 的安全恢复仍会改变旧版少数不确定/失败输出。protocol 1.2.0 还增加 `observation_mode` 和新错误码，因此不宣称旧输出 schema 原封不动。若主动语义模式出现回归，宿主可停止传入 `mode:"semantic"`，恢复完整视觉成功路径，而不切换引擎或破坏 MCP 配置；不提供环境变量暗开关。

## 13. 后续里程碑

- **v0.2.3：** Codex、HanaAgent、WorkBuddy 等命名宿主直接接入与会话重启体验。
- **v0.2.4：** macOS 安装、权限检查、daemon 自动恢复和卸载体验。
- **v0.3：** macOS Beta，完成 soak、稳定性矩阵、签名与公开发布门槛。
- **其后：** Windows DPI/窗口实机证据，以及保持 `EnginePort` 契约的自研 runtime 原型。

v0.2.2 的完成只意味着“现有 macOS 控制循环更快且证据不退化”，不提前宣称 Beta 或跨平台等价。
