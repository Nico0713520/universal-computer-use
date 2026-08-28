# Universal Computer Use v0.2：窗口精准与后台控制设计

日期：2026-08-28

状态：修订后规格，待用户最终复核

产品版本：`0.2.0`

协议版本：`1.1.0`

目标平台：

- macOS 14+，Apple silicon 或 Intel；
- Windows 10 1903+ / Windows 11，x64；
- Windows arm64 不在 v0.2 发布范围。

## 1. 结论

v0.2 继续保持无模型、无聊天 GUI、仅两个 MCP 工具的产品边界，但把执行目标从“主显示器截图坐标”扩展为“桌面或一个精确窗口”。标准控件优先通过 Cua Driver 的 Accessibility/UIA 元素能力操作；Canvas、WebGL、视频和自绘控件回退到窗口截图坐标。

项目不 fork Cua、不复制原生平台代码，也不直接暴露 Cua 的底层工具。UCU 拥有稳定的公开 Interface、app/window/element 引用、snapshot 生命周期、动作策略、结果验证和宿主 Skill；Cua 继续拥有应用发现、窗口捕获、Retina/DPI、AX/UIA、后台投递和原生输入。

本规格明确取代 v0.1 设计第 13 节中“只有 v1 指标稳定后才评估窗口、元素和后台操作”的增强顺序。取代原因是 v0.1 真实验收已经证明：只优化全桌面坐标不能满足精准、后台和焦点隔离的产品目标。

这不是删除 v0.1 路径：

- `computer_observe({})` 仍走主显示器兼容路径；
- 旧桌面动作输入继续有效；
- 只有显式发现/选择窗口时才进入 v0.2 路径；
- 窗口路径失败不得改变桌面路径行为；
- Browser/CDP、多显示器、富文本粘贴和轨迹回放继续后置。

## 2. 设计原则

### 2.1 两工具深模块

公开工具仍然只有：

- `computer_observe`
- `computer_act`

窗口、元素、Cua session、PID、window ID、路径、AUMID、上游 snapshot 和 element token 全部隐藏在实现内部。调用方只学习一套跨平台 Interface。

### 2.2 语义优先、像素回退

动作选路顺序：

1. `element_ref` → Accessibility/UIA；
2. 窗口截图坐标 → 精确窗口像素路径；
3. 桌面截图坐标 → 主显示器全局输入；
4. 只有显式请求 foreground 的动作才能临时进入前台路径。

任何路径都不得隐式使用 AppleScript、Shell 输入或宿主内置 Computer Use。

### 2.3 观察后行动，行动后重新观察

每个 snapshot 只能消费一次。动作进入 Cua 前原子消费 snapshot；动作结束后重新观察同一个精确目标并生成新 snapshot。目标丢失时不静默回退桌面。

### 2.4 不把“调用成功”伪装成“效果成功”

动作响应、Accessibility 值、像素变化和目标状态属于不同证据。只有独立后置条件满足时才能返回 `effect:"confirmed"`。未知和不可验证结果保持不可验证。

### 2.5 无固定等待、无盲重试

不存在无条件三秒或其他固定延迟。动作后立即观察；只有显式 `expect` 或可信的加载/过渡信号才能触发有上限的条件等待。插件不自动重复有副作用动作。

## 3. 引用和生命周期

公开引用格式：

- `app_ref`：`^app_[A-Za-z0-9_-]{16,}$`；
- `window_ref`：`^win_[A-Za-z0-9_-]{16,}$`；
- `element_ref`：`^el_[A-Za-z0-9_-]{16,}$`；
- `snapshot_id`：延续 v0.1 的 `^snap_[A-Za-z0-9_-]{8,}$`。

所有引用均使用加密安全随机值，不编码原生标识。

生命周期：

- `app_ref` 和 `window_ref` 属于一个 MCP transport session；
- `element_ref` 只属于产生它的 snapshot；
- 新 snapshot 立即废弃旧 snapshot 及全部 element refs；
- app/window refs 在目标消失、身份复核失败、30 分钟空闲或 transport 关闭时失效；
- Registry 对 app 和 window 各最多保存 256 个引用；到达上限时停止新增并标记截断，不驱逐仍可用引用。

`window_ref` 精确绑定原 owner、原生 window ID 和应用身份。owner 改变时引用失效并返回 `window_owner_changed`；v0.2 不做 owner migration。系统文件选择器等跨进程窗口必须作为独立窗口重新发现。

## 4. `computer_observe` Interface

### 4.1 输入判别联合

兼容桌面观察：

~~~json
{}
~~~

桌面发现：

~~~json
{
  "target": { "kind": "desktop" },
  "discover": {
    "apps": true,
    "windows": true,
    "query": "Calculator",
    "window_app_ref": "app_..."
  }
}
~~~

约束：

- `target` 省略时等价于 `{kind:"desktop"}`；
- `discover` 只允许桌面目标；
- `apps`、`windows` 至少一个为 true；
- `query` 可选，1–200 个 Unicode 字符，对应用显示名、应用标识和窗口标题做不区分大小写的子串过滤；
- `window_app_ref` 可选，只过滤窗口，必须属于当前 transport；
- 应用最多返回 50 个，窗口最多返回 30 个；
- v0.2 不做分页；截断时调用方必须用 `query` 或 `window_app_ref` 缩小范围。

窗口观察：

~~~json
{
  "target": {
    "kind": "window",
    "window_ref": "win_..."
  },
  "include_screenshot": true,
  "elements": {
    "query": "display",
    "max_elements": 100,
    "max_depth": 10
  }
}
~~~

约束：

- `include_screenshot` 默认 true；
- `elements` 省略时仍返回默认元素投影；
- `elements.query` 可选，1–200 个 Unicode 字符；
- `max_elements` 为 1–150，默认 150；
- `max_depth` 为 1–12，默认 12；
- 客户端不能提高服务端硬上限。

### 4.2 桌面观察输出

保留 v0.1 字段，并增加：

~~~json
{
  "protocol_version": "1.1.0",
  "session_id": "ucu_...",
  "snapshot_id": "snap_...",
  "platform": "macos",
  "display_id": "primary",
  "target": {
    "kind": "desktop",
    "display_id": "primary"
  },
  "coordinate_space": "desktop_screenshot_pixels",
  "screenshot": {
    "mime_type": "image/png",
    "width": 1920,
    "height": 1080
  },
  "engine": {
    "name": "cua-driver",
    "version": "0.22.2"
  }
}
~~~

请求 `discover` 时增加：

~~~json
{
  "apps": [
    {
      "app_ref": "app_...",
      "display_name": "Calculator",
      "running": true,
      "capabilities": ["launch", "windows"]
    }
  ],
  "apps_truncated": false,
  "windows": [
    {
      "window_ref": "win_...",
      "app_ref": "app_...",
      "app_name": "Calculator",
      "title": "Calculator",
      "bounds": {
        "x": 100,
        "y": 100,
        "width": 460,
        "height": 816,
        "coordinate_space": "desktop_logical"
      },
      "is_on_screen": true,
      "on_current_space": true,
      "minimized": false,
      "capabilities": {
        "elements": "available",
        "window_screenshot": "available",
        "background_actions": "unknown"
      }
    }
  ],
  "windows_truncated": false
}
~~~

规则：

- `app_ref` 隐藏 bundle path、Windows executable path、launch path 和 AUMID；
- 窗口 `bounds` 只用于发现和说明，不能直接用于动作；
- capability 值只允许 `available`、`unavailable`、`unknown`；
- `background_actions:"available"` 只表示存在已证明的后台路线，不保证每种动作都支持；
- 应用排序：running 优先，再按归一化显示名和内部稳定标识；
- 窗口排序：当前桌面/可见优先，可证明时按 z-order，再按应用名、标题和内部稳定标识；
- 不能依赖 Cua 返回数组的原始顺序。

### 4.3 窗口观察输出

~~~json
{
  "protocol_version": "1.1.0",
  "session_id": "ucu_...",
  "snapshot_id": "snap_...",
  "platform": "macos",
  "target": {
    "kind": "window",
    "window_ref": "win_...",
    "app_ref": "app_...",
    "app_name": "Calculator",
    "title": "Calculator"
  },
  "coordinate_space": "window_screenshot_pixels",
  "visual_status": "available",
  "screenshot": {
    "mime_type": "image/png",
    "width": 460,
    "height": 816
  },
  "elements": [
    {
      "element_ref": "el_...",
      "role": "button",
      "label": "7",
      "bounds": {
        "x": 10,
        "y": 510,
        "width": 100,
        "height": 80
      },
      "enabled": true,
      "focused": false,
      "actions": ["click"]
    }
  ],
  "elements_truncated": false,
  "engine": {
    "name": "cua-driver",
    "version": "0.22.2"
  }
}
~~~

`visual_status` 只允许：

- `available`；
- `not_requested`；
- `capture_unavailable`；
- `pixel_frame_unproven`。

当 `visual_status` 不是 `available` 时：

- 不返回 ImageContent；
- 省略 `screenshot`；
- 省略所有无法证明的元素 `bounds`；
- 仍返回可信的元素语义；
- snapshot 仍可用于 element-ref 动作；
- 任何坐标动作均拒绝为 `pixel_frame_unproven`。

元素投影规则：

- 最多 150 个元素、深度最多 12；
- 只公开 role、label、value、可信 bounds、可信状态和已证明动作；
- value、bounds、enabled、selected、focused 没有可信值时省略，不使用 null 占位；
- actions 只允许 click、double_click、right_click、scroll、set_value、type_text、keypress；
- 不返回 Cua 原始 Markdown、PID、window ID、element index/token 或上游 snapshot；
- `value` 可以为空，但空值不是元素不存在；
- `elements_truncated` 必须反映上游截断或 UCU 投影截断。

## 5. `computer_act` Interface

### 5.1 顶层输入

~~~json
{
  "snapshot_id": "snap_...",
  "action": {},
  "delivery": "background",
  "expect": {}
}
~~~

公共约束：

- `snapshot_id` 必填且只能消费一次；
- `delivery` 和 `expect` 只在动作能力表允许时出现；
- 坐标必须是有限非负数，并位于本 snapshot 截图边界；
- element ref 必须属于本 snapshot；
- 同一动作中 element ref 和坐标互斥；
- `actions[]` 明确拒绝；
- 未知字段全部拒绝。

`expect` 只允许 window snapshot，并可用于除 `launch_app` 之外的窗口动作，包括 `wait`。desktop snapshot 没有 element refs，因此不接受 expect。

### 5.2 完整动作判别联合

| `action.type` | 目标 | 地址字段 | 其他字段和限制 |
|---|---|---|---|
| `click` | desktop/window | desktop 必须 `x,y`；window 使用 `element_ref` 或 `x,y` | 二选一 |
| `double_click` | desktop/window | 同 click | 二选一 |
| `right_click` | desktop/window | 同 click | 二选一 |
| `move` | desktop | `x,y` | 保留 v0.1；窗口模式不支持 |
| `drag` | desktop/window | `from_x,from_y,to_x,to_y` | `duration_ms` 0–10000 |
| `scroll` | desktop/window | desktop 必须 `x,y`；window 使用 `element_ref` 或 `x,y` | `direction` 为 up/down/left/right；`amount` 1–50；`by` 可选 line/page |
| `set_value` | window | `element_ref` | `value` 最多 20000 个 Unicode 字符 |
| `type_text` | desktop/window | desktop 无地址；window 使用 `element_ref`、`x,y` 或无地址 | `text` 最多 20000 个 Unicode 字符 |
| `type` | desktop/window | 与 `type_text` 相同 | v0.1 兼容别名，内部归一为 `type_text` |
| `keypress` | desktop/window | window 可用 `element_ref`、`x,y` 或无地址 | `keys` 1–8 个；每项 1–24 字符且匹配 `^[A-Za-z0-9_+-]+$` |
| `invoke_menu` | window | 无 element/坐标 | `path` 1–16 段，每段 1–200 字符 |
| `launch_app` | desktop | `app_ref` | 不接受路径、参数、URL 或 new-instance 选项 |
| `wait` | desktop/window | 无 | `ms` 0–15000，可取消 |

窗口 `type_text` / `keypress` 地址语义：

- `element_ref`：精准元素路径；
- `x,y`：在窗口截图内点击建立焦点后输入，属于像素回退；
- 无地址：只写入目标进程当前 focused element；除非独立后置条件证明效果，否则不得返回 `effect:"confirmed"`；
- 对标准可编辑控件优先使用 `set_value`；
- 对追加式输入不能因为 Cua 没报错就标记 confirmed。

### 5.3 动作投递能力表

| 动作 | 客户端 `delivery` | 默认/实际语义 |
|---|---|---|
| 窗口 click/double/right/drag/scroll/type_text/keypress | 可选 background/foreground | 默认 background；foreground 直接传给该 Cua 动作工具 |
| `set_value`、`invoke_menu` | 禁止 | Accessibility/UIA 语义路径；结果按上游证据归一 |
| `launch_app` | 禁止 | Cua 后台启动；不调用 bring_to_front |
| `wait` | 禁止 | not_applicable |
| 所有桌面兼容动作 | 禁止 | 保持 v0.1 全局桌面行为 |

UCU 不调用 `bring_to_front` 实现普通 foreground 动作。Cua 动作自己的 `delivery_mode:"foreground"` 负责临时置前、执行和恢复；持续置前不在 v0.2 公开能力中。

后台动作返回 escalation 不代表可以安全重发。宿主必须先检查新状态。

### 5.4 `expect`

v0.2 只支持一个元素后置条件，不提供 `expect.window`：

~~~json
{
  "expect": {
    "element": {
      "element_ref": "el_...",
      "value_equals": "example",
      "enabled": true,
      "selected": false
    },
    "timeout_ms": 5000
  }
}
~~~

约束：

- `element_ref` 必须属于被消费 snapshot；
- `value_equals`、`enabled`、`selected` 至少提供一个；
- `timeout_ms` 为 0–10000，默认 5000；
- 最多一个元素断言；
- `launch_app` 不接受 expect。

验证身份与状态严格分离：

- 内部 `ElementIdentity` 由 role、归一化 label 和可信的父级角色/标签链构成；
- `value`、enabled、selected、focused 和 bounds 不属于身份；
- 重新观察后必须唯一匹配同一身份；
- 零个或多个匹配均返回 `verification_unknown`；
- 不允许选择第一个近似元素。

`set_value` 即使调用方没有提供 expect，也自动生成对同一元素的 `value_equals:new_value` 验证。其他动作只有调用方明确提供 expect 或上游给出独立可信 readback 时才确认。

`set_value` 的显式 expect 必须引用被设置的同一 element ref；如果显式 `value_equals` 与新 value 不同，请求在动作前拒绝为 `element_target_conflict`。enabled/selected 可以与自动 value 验证合并。

Verifier 只有在 role/label selector 能在原 snapshot 中唯一代表 ElementIdentity 时才把条件委托给 Cua `verify_state`；否则使用有界的 `get_window_state` 轮询和 UCU 身份匹配。两条路线都不能用旧 value 或数组顺序消歧。

验证先立即读取一次；仍未满足时采用 50、100、200、400、500 毫秒封顶的有界退避，并在目标状态改变时立即结束，不先睡固定时长。`launch_app` 同样立即检查进程和窗口就绪状态，最多条件等待 5 秒；它等待的是可观察条件，不是无条件 settle sleep。

`verification` 表示期望状态是否成立，`action_result.effect` 表示动作效果是否被证明，两者不得混为一谈：

- predicate 从未满足变为满足时，可添加 `predicate_satisfied` 并把可证明动作归一为 confirmed；
- predicate 在动作前已经满足、动作后仍满足时，verification 可以 satisfied，但该事实不能单独升级 action effect；
- verification 为 unsatisfied 或 unknown 时，不能依靠该 predicate 返回 confirmed；
- `set_value` 对同一元素的新值读回可独立产生 `value_readback`；
- 上游 refusal/failure 不因目标状态碰巧已经满足而改写成 executed。

### 5.5 动作后状态

普通动作：

1. 验证请求和当前 snapshot；
2. 原子消费 snapshot；
3. 执行一次动作；
4. 有 expect 时进行最长 10 秒的条件验证；
5. 重新观察同一精确目标；
6. 返回新 snapshot 或明确 target lost。

动作后的窗口观察继承被消费 snapshot 的 `include_screenshot`、元素 query、max_elements 和 max_depth。内部验证采样不得泄漏成额外公共 snapshot；最终只发布一个新 snapshot。

`launch_app`：

1. 只能消费 desktop snapshot；
2. `app_ref` 解析为内部平台标识；
3. 调用 Cua launch_app；
4. 恰有一个已就绪、身份明确的窗口时，下一状态迁移为该 window；
5. 零个窗口时返回 fresh desktop 状态、`effect:"partial"` 和 `window_not_ready`；
6. 多个同等候选时返回 fresh desktop 状态、候选窗口、`effect:"partial"` 和 `window_target_ambiguous`；
7. 不猜测第一个窗口。

结果归一固定为：

- 上游明确拒绝或启动调用失败：`status:"refused"/"failed"`，不伪造进程或窗口证据；
- 已证明进程运行、尚无就绪窗口：`status:"executed"`、`effect:"partial"`、`evidence:["process_running"]`、`error_code:"window_not_ready"`；
- 恰有一个就绪窗口：`status:"executed"`、`effect:"confirmed"`、`evidence` 至少包含 `window_ready`，下一状态迁移到该窗口；
- 多个同等窗口候选：`status:"executed"`、`effect:"partial"`、`error_code:"window_target_ambiguous"`，返回 fresh desktop 状态和有界候选列表。

如果上游只声称启动请求已受理，但无法独立证明进程运行，则结果保持 `effect:"unverifiable"`，不得添加 `process_running`。

### 5.6 结果 Schema

`action_result`：

~~~json
{
  "status": "executed",
  "effect": "confirmed",
  "route": "accessibility",
  "delivery": "background",
  "evidence": ["value_readback"],
  "delivered_count": 7
}
~~~

稳定枚举：

- `status`：executed / refused / failed；
- `effect`：confirmed / partial / unverifiable / suspected_noop / refused；
- `route`：accessibility / synthetic_events / global_input / system_api / dom / trusted_input / unknown；
- `delivery`：background / foreground / not_applicable / unknown；
- `evidence`：必填数组，允许为空，最多 8 项，只允许 value_readback / selection_readback / predicate_satisfied / process_running / window_ready / focus_preserved；
- `delivered_count`：可选非负整数；
- `error_code`：可选稳定错误码；
- `escalation`：可选对象，`reason` 只允许 background_unavailable / foreground_required / effect_unconfirmed / window_not_ready / window_target_ambiguous，并可带 `suggested_delivery:"foreground"`。

不使用 `null` 表示可选字段；没有值时省略字段。

字段组合不允许自相矛盾：

- `status:"executed"` 只允许 confirmed / partial / unverifiable / suspected_noop；
- `status:"refused"` 必须搭配 `effect:"refused"` 和稳定 `error_code`；
- `status:"failed"` 必须搭配 `effect:"unverifiable"` 和稳定 `error_code`；
- refused / failed 不得携带声称动作已发生的 evidence；
- `verification.status` 为 not_requested / satisfied 时省略 reason，为 unsatisfied / unknown 时必须提供稳定 reason。

未知上游值的安全映射：

- 未知 status → post-consumption MCP error `engine_contract_changed`，清空 snapshot store；
- 未知 effect → unverifiable；
- 未知 route/delivery → unknown；
- 未知 evidence → 丢弃该 evidence 并记录无内容诊断；
- 未知错误文本不直接进入公开协议。

`verification`：

~~~json
{
  "status": "satisfied"
}
~~~

状态只允许：

- not_requested；
- satisfied；
- unsatisfied；
- unknown。

unsatisfied/unknown 可带稳定 `reason`，但不返回上游自由文本。

`verification.reason` 只允许 predicate_unsatisfied / element_not_unique / element_missing / observation_unavailable / timeout / untrusted_source。

`computer_act` 输出为判别联合。

下一状态可用：

~~~json
{
  "next_state": "available",
  "protocol_version": "1.1.0",
  "session_id": "ucu_...",
  "consumed_snapshot_id": "snap_old",
  "snapshot_id": "snap_new",
  "action_result": {},
  "verification": {},
  "target": {},
  "coordinate_space": "window_screenshot_pixels",
  "visual_status": "available",
  "screenshot": {},
  "elements": []
}
~~~

桌面兼容动作继续包含 v0.1 所需的 `screenshot` 字段。窗口视觉不可用时按观察输出规则省略截图，但只要元素状态可用，仍可产生新 snapshot。

下一状态不可用：

~~~json
{
  "next_state": "unavailable",
  "protocol_version": "1.1.0",
  "session_id": "ucu_...",
  "consumed_snapshot_id": "snap_old",
  "action_result": {},
  "verification": {},
  "next_observation_error": {
    "code": "target_lost",
    "recovery": "observe_desktop"
  }
}
~~~

该分支不包含新 snapshot、截图或元素。下一步只能重新桌面观察和发现。

### 5.7 不可验证动作的重试规则

- background action 返回 unverifiable 后，先检查同一目标的新状态；
- fresh state 明确证明期望未发生时，宿主才可以选择 foreground；
- fresh state 已证明动作发生时停止，不得重发；
- fresh state 无法证明时，`type_text`、keypress、click、launch_app 等潜在非幂等动作不得重复；
- `set_value` 可以在重新观察并重新获得 element ref 后设置同一个完整值，但插件仍不自动重试；
- escalation 是能力提示，不是重试授权。

这条规则专门防止“文本已经写入，但 Cua 返回 unverifiable”后重复输入。

### 5.8 错误阶段与 snapshot 消费

错误必须区分发生阶段：

| 阶段 | 典型错误 | snapshot 结果 | 返回形式 |
|---|---|---|---|
| 请求解析和策略校验 | 未知字段、unsupported_action、坐标越界、引用类型冲突 | 当前 snapshot 不消费 | MCP error |
| 当前性和身份校验 | stale_snapshot、stale_element_ref、window_owner_changed | 不执行动作；已失效引用不可复活 | MCP error |
| 动作已受理、尚未调用 Cua | 最后一致性检查失败 | 当前 snapshot 不消费 | MCP error |
| 原子消费后 | Cua refused/failed/效果不明，但 adapter 仍可响应 | snapshot 已消费 | 返回 action output，并尽力提供 fresh next state |
| 原子消费后 | Cua timeout、contract changed、session unhealthy | snapshot 已消费并清空 store | MCP error，`snapshot_consumed:true` |
| 动作后重新观察 | target lost/capture unavailable | snapshot 已消费 | `next_state:"unavailable"` 或有元素状态的降级 next state |

所有 MCP error 的稳定结构为 `code`、`recovery`、`retryable`，只在动作已经原子消费时额外返回 `snapshot_consumed:true`；未消费时该字段省略。调用方不得通过重发同一个 snapshot 探测消费状态。

## 6. 内部模块

### 6.1 Target Registry

维护：

- `app_ref → InternalAppTarget`；
- `window_ref → InternalWindowTarget`。

它负责候选过滤、稳定排序、身份复核、引用上限、空闲失效和敏感原生标识隐藏。窗口 owner 改变只允许失效，不允许迁移。

### 6.2 Snapshot Store

SnapshotRecord 扩展为：

- UCU snapshot ID；
- Cua session ID；
- desktop/window 目标；
- 截图尺寸、visual status 和坐标空间；
- 内部精确窗口目标；
- 上游窗口 snapshot ID；
- `element_ref → {element_token, ElementIdentity, capabilities}`；
- 创建时间和目标身份。

store 仍最多保存一个当前 snapshot。创建新 snapshot 会立即废弃旧 snapshot 及其全部元素引用。

### 6.3 Cua Adapter

Adapter 只调用锁定版本 SDK 的公开工具，负责参数转换、deadline 和 typed result 解析，不承担产品策略。

### 6.4 Observation Projector

负责：

- 验证 Cua 结构化结果和图片数量；
- 投影有界 actionable 元素；
- 生成 UCU refs；
- 证明或拒绝坐标转换；
- 删除 PID、window ID、路径、AUMID、上游 token 和原始树；
- 明确截断和降级。

### 6.5 Action Policy

根据 snapshot 目标、动作类型、地址方式和 delivery 选择 Cua 路径。它不自动重试，不自动 foreground，不解释自由文本错误。

### 6.6 Verifier

负责：

- ElementIdentity 唯一重定位；
- set_value 自动 value readback；
- expect 到 Cua verify_state 的安全投影；
- satisfied / unsatisfied / unknown 归一；
- 超时后保留真实最后状态。

### 6.7 Result Normalizer

负责稳定枚举、evidence allowlist、launch_app 特殊结果和未知上游值的安全降级。新的 Cua 字段不会直接穿透公共 Interface。

## 7. Cua 0.22.2 策略

v0.2 使用 npm 精确版本 `@trycua/cua-driver@0.22.2`，release tag 为 `cua-driver-rs-v0.22.2`，source commit 为 `d114f35fec05ecd37bf529e5587be86852205b64`。

该版本已经发布到 npm，但 GitHub Release 标记为 pre-release。因此它是固定的 development candidate，不是 UCU release-eligible Runtime。它包含 macOS Retina backing scale 修复，但仍必须通过本项目实机证据。

v0.2 required tools 增加：

- `list_apps`；
- `list_windows`；
- `get_window_state`；
- `verify_state`；
- `launch_app`；
- `invoke_menu`；
- `set_value`；
- `health_report`；
- v0.1 已锁定的桌面观察、输入、按键、滚动、拖拽和 session 工具。

`bring_to_front` 不进入 required tools。

升级流程：

1. 更新 npm SDK、release assets、哈希和 required tools；
2. 保持 macOS/Windows `release_eligible:false`；
3. 跑全部 v0.1 回归和 v0.2 adapter contract；
4. 执行 macOS/Windows development E2E；
5. 平台证据和签名身份通过后再 promote；
6. 不使用 latest、main 或 nightly。

已知上游风险必须进入回归：

- Electron/macOS type_text 已落地但可能 unverifiable；
- Windows background synthetic click 可能未投递却无明确拒绝；
- Chrome 背景控制不属于 v0.2 原生窗口承诺。

## 8. 错误和恢复

新增稳定错误：

- `stale_app_ref`；
- `app_not_found`；
- `window_not_found`；
- `window_not_ready`；
- `window_target_ambiguous`；
- `window_owner_changed`；
- `target_lost`；
- `stale_element_ref`；
- `element_target_conflict`；
- `element_unavailable`；
- `pixel_frame_unproven`；
- `background_unavailable`；
- `foreground_required`；
- `verification_unsatisfied`；
- `verification_unknown`；
- `engine_unhealthy`；
- `engine_contract_changed`。

MCP error 的 `recovery` 只允许：

- `setup`；
- `doctor`；
- `observe_again`；
- `discover_again`；
- `grant_permission`；
- `use_element`；
- `use_foreground`；
- `stop`。

恢复分类固定为：引用或目标失效用 discover_again/observe_again；像素框架不可信优先 use_element；后台能力明确不可用可提示 use_foreground，但仍受第 5.7 节重复保护；权限问题用 grant_permission；Runtime 健康或契约问题用 doctor/setup；不可恢复或不应自动重试的请求用 stop。

`action_result.error_code` 只允许 `action_refused`、`action_failed`、`permission_required`、`interactive_session_required`、`background_unavailable`、`foreground_required`、`window_not_ready`、`window_target_ambiguous`、`verification_unsatisfied`、`verification_unknown`。Adapter 不能把任意 Cua 字符串放入该字段。

恢复规则：

- 每个 Cua 调用有独立 deadline；
- 一次引擎超时后当前 snapshot 和 elements 全部失效；
- Runtime 进入 unhealthy 状态；
- 只有 `health_report` 通过后才能解除 unhealthy；
- 健康检查不重复原动作；
- 目标或应用引用失效时重新 desktop discover；
- 错误响应不得包含路径、PID、窗口内容、输入文本或自由文本诊断。

## 9. 性能设计

优化目标是减少模型侧负担和无意义等待，而不是宣称每次窗口抓取都比桌面抓取耗时更短。

措施：

- 精确窗口 PNG 替代无关的全屏 PNG；
- 可用时 `include_screenshot:false` 做低成本元素重索引；
- raw Cua 树投影为最多 150 个 actionable 元素；
- 支持 query；
- 整段文本和 set_value 作为一个语义动作；
- act 直接返回下一状态；
- 无条件固定等待为零；
- 记录 capture、projection、engine action、verification 四段 p50/p95；
- 日志不记录截图、文本、标签值或窗口内容。

发布硬门槛：

- 没有隐藏固定 sleep；
- 所有等待和原生调用都有 deadline；
- 元素和图片输出有硬上限；
- 坐标空间无法证明时拒绝像素动作；
- 固定 Calculator 小窗口 Fixture 的截图像素面积不超过同一次运行主显示器截图的 50%；
- PNG 字节数只记录分布，不要求任意窗口 PNG 必然小于桌面 PNG。

## 10. 安全和隐私

- 插件不内置模型、API key、OCR 或规划器；
- app/window/element/snapshot refs 仅在本 transport 有效；
- 原生路径、AUMID、PID、window ID 和 Cua token 不进入公开结果；
- 日志不得包含输入文本、字段值、截图、剪贴板、模型提示或环境变量；
- 插件不内置风险确认弹窗，也不能绕过宿主审批；
- 后台模式不允许偷偷升级前台；
- 屏幕录制和辅助功能权限继续由未修改、已签名的 Cua Runtime 持有；
- UCU 不复制、修改、重签或伪装 CuaDriver。

## 11. TDD 公共测试接缝

1. **MCP Interface 接缝**：通过两工具 JSON Schema 和返回 envelope 验证向后兼容、完整判别联合、动作能力表和错误语义。
2. **EnginePort 接缝**：通过 fake Cua SDK 验证工具调用、target 映射、deadline、结果归一和 health recovery，不 mock Adapter 私有函数。
3. **Snapshot/Target 行为接缝**：通过 core observe/act 验证 app/window/element refs、单次 snapshot、截断、目标丢失、验证和重复输入保护。
4. **CLI/Engine Lock 接缝**：验证 0.22.2 candidate、required tools、资产哈希、签名和 fail-closed promotion。
5. **真实桌面 E2E 接缝**：使用可丢弃 Fixture、Calculator、TextEdit/Notepad 和前台哨兵验证真实投递，不把命令返回值当作唯一成功证据。

每个功能采用一个失败测试和一个最小纵向实现。所有测试通过后再单独重构，不为尚未进入本规格的能力增加内部 seam。

## 12. 验收场景

### 12.1 macOS Beta

在用户持续使用另一个前台 App 时：

1. 发现或后台启动 Calculator；
2. 精确绑定唯一 Calculator 窗口；
3. 使用 element refs 完成 `37 × 19`；
4. 读取窗口状态确认 `703`；
5. 前台 App、用户鼠标和键盘焦点保持不变；
6. 全程没有固定三秒等待、旧 snapshot 或盲重试。

还必须通过：

- TextEdit element-ref set_value/type_text 与读回；
- Electron type_text“实际落地但 unverifiable”不重复输入回归；
- Retina 窗口坐标；
- 窗口关闭后的 target_lost；
- Canvas 可见窗口坐标回退；
- visual_status 不可用时拒绝坐标但保留元素动作。

### 12.2 Windows Experimental/Beta

Windows x64 在 100%、125%、150% 缩放下分别验证：

- Calculator 元素和窗口坐标；
- Notepad 定向输入和读回；
- WinUI/WPF Fixture 后台操作；
- 自绘 Win32 Fixture 的 background synthetic click 必须真实投递或明确拒绝；
- UIA provider 超时有界；
- 普通权限进程遇到高权限目标时诚实拒绝；
- UAC、锁屏、Session 0 不被宣传为支持。

没有 Windows 实机证据时只能标 Experimental；三个 DPI 档、焦点哨兵和标准应用矩阵通过后才能标 Beta。

### 12.3 宿主兼容

Codex、HanaAgent、Kimi、WorkBuddy 按宿主版本和 OS 分别记录 verified / experimental / not-compatible / not-tested。

`0.2.0` 发布前至少要求：

- macOS 有一个 named host 完成真实连续循环；
- Windows 有一个 named host 完成真实连续循环；
- 截图或元素状态确实到达该宿主当前模型；
- 全程只调用 UCU 两个 MCP 工具；
- 任务自然停止；
- 未通过的宿主继续如实标记，不阻止已验证平台发布 Experimental。

## 13. 明确不在 v0.2

- Browser/CDP 页面、标签页、上传、下载和浏览器弹窗；
- 多显示器寻址；
- 格式化 HTML/Markdown 粘贴和精确文本选区；
- 任意动作批处理；
- 录制、轨迹回放和训练数据导出；
- 锁屏、UAC 安全桌面、Session 0 和无人登录桌面；
- Windows arm64；
- 自有原生 Runtime、重新签名或隐藏 CuaDriver 身份；
- 插件内模型、OCR、规划器或独立任务循环；
- 持续置前和通用窗口管理。

## 14. 实施顺序

1. 用户最终确认本规格；
2. 生成逐文件实施计划；
3. Stage Cua 0.22.2 和 health-report 契约；
4. 交付 app/window refs 与有界发现；
5. 交付窗口观察、visual status 和元素投影；
6. 交付 element-ref 点击和窗口坐标回退；
7. 交付 set_value/type_text/keypress/invoke_menu；
8. 交付逐动作 delivery、显式 foreground 和重复输入保护；
9. 交付 ElementIdentity 验证、target lost 和 engine health；
10. 更新 canonical Skill、README 和排障文档；
11. 完成 macOS Beta、Windows Experimental/Beta 和宿主证据；
12. 满足平台门槛后发布 `0.2.0`。

每一步都必须保持：

- 旧 `computer_observe({})`；
- v0.1 桌面动作；
- 两工具门面；
- snapshot 单次消费；
- 无模型、无隐藏控制旁路；
- release gate 默认关闭。
