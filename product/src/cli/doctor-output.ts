import type { DoctorReport } from "./doctor.js";

function permissionLabel(
  state: DoctorReport["permission_details"]["accessibility"],
): string {
  if (state === "granted") return "已授权";
  if (state === "required") return "需要授权";
  return "无法确认";
}

function diagnosticSummary(error: NonNullable<DoctorReport["error"]>): string {
  switch (error.diagnostic_reason) {
    case "runtime_missing": return "CuaDriver 未安装";
    case "runtime_version_mismatch": return "Cua Runtime 版本不匹配";
    case "runtime_integrity_mismatch": return "Cua Runtime 文件哈希不匹配";
    case "runtime_signature_mismatch": return "CuaDriver 签名身份不匹配";
    case "runtime_startup_failed": return "Cua daemon 未运行，或有限启动恢复失败";
    case "interactive_session_locked": return "macOS 桌面已锁定或当前不是可交互登录会话";
    case "interactive_session_unknown": return "macOS 可交互登录会话无法确认";
    case "session_initialization_failed": return "desktop/window 会话初始化失败";
    case "cursor_initialization_failed": return "Agent Cursor 关闭或回读失败";
    case "cursor_transition_failed": return "Adaptive Cursor 状态切换失败";
    case "desktop_permission_required":
    case "screen_recording_permission_required":
    case "accessibility_permission_required": return "CuaDriver 权限不完整";
    case "capture_failed": return "截图不可用";
    case "session_cleanup_failed": return "诊断会话清理失败";
    default:
      if (error.code === "runtime_missing") return "CuaDriver 未安装";
      if (error.code === "engine_version_mismatch") return "Cua Runtime 版本不匹配";
      if (error.code === "runtime_unavailable") return "Cua Runtime 不可用";
      if (error.code === "interactive_session_required") {
        return "macOS 桌面不可交互";
      }
      if (error.code === "permission_required") return "CuaDriver 权限不完整";
      if (error.code === "capture_failed") return "截图不可用";
      return `诊断代码 ${error.code}`;
  }
}

function diagnosticNextAction(
  error: NonNullable<DoctorReport["error"]>,
): string | undefined {
  switch (error.diagnostic_reason) {
    case "runtime_missing": return "运行 computer-use setup --development";
    case "runtime_version_mismatch":
      return "重新运行 computer-use setup --development，安装锁定版本";
    case "runtime_integrity_mismatch": return "重新安装锁定的 Cua Runtime";
    case "runtime_signature_mismatch": return "重新安装官方签名的 CuaDriver";
    case "runtime_startup_failed":
      return "确认 CuaDriver 已安装并可启动，然后重新运行 computer-use doctor";
    case "interactive_session_locked":
      return "解锁 Mac 并进入可交互桌面，然后重新运行 computer-use doctor";
    case "interactive_session_unknown":
      return "登录 Mac 图形桌面，然后重新运行 computer-use doctor";
    case "session_initialization_failed":
      return "重新运行 computer-use setup --development；仍失败时报告 Cua session 初始化问题";
    case "cursor_initialization_failed":
      return "重新运行 computer-use setup --development；仍失败时报告 Agent Cursor 初始化问题";
    case "cursor_transition_failed":
      return "重新运行 computer-use doctor；仍失败时报告 Adaptive Cursor 状态切换问题";
    case "session_cleanup_failed":
      return "重新运行 computer-use doctor；仍失败时重启 CuaDriver 后再检查";
    default:
      if (error.code === "runtime_missing") {
        return "运行 computer-use setup --development";
      }
      return undefined;
  }
}

export function renderDoctorHuman(report: DoctorReport): string {
  const runtime = report.engine_connected
    ? `已连接（${report.reported_engine_version ?? "版本未知"}）`
    : "不可用";
  const screenshot = report.observation_succeeded && report.screenshot !== null
    ? `可用（${report.screenshot.width} × ${report.screenshot.height}）`
    : "不可用";
  const sessions = report.engine_connected && report.required_tools_present
    ? "初始化成功"
    : "未完成";

  const title = !report.ok
    ? "未通过"
    : report.permissions === "unknown"
      ? "部分通过（权限状态未确认）"
      : "通过";
  const cleanup = report.cleanup.status === "succeeded"
    ? "成功"
    : report.cleanup.status === "failed"
      ? "失败"
      : "无需执行";
  const lines = [
    `Computer Use 检查：${title}`,
    `- Cua Runtime：${runtime}`,
    `- 屏幕录制：${permissionLabel(report.permission_details.screen_recording)}`,
    `- 辅助功能：${permissionLabel(report.permission_details.accessibility)}`,
    `- 截图：${screenshot}`,
    `- desktop/window 会话与 Adaptive Cursor：${sessions}（${report.cursor_mode}）`,
    `- 诊断会话清理：${cleanup}`,
  ];
  if (report.error !== undefined) {
    lines.push(`- 诊断：${diagnosticSummary(report.error)}`);
    const nextAction = diagnosticNextAction(report.error);
    if (nextAction !== undefined) lines.push(`- 下一步：${nextAction}`);
  }
  if (report.permission_details.screen_recording === "required") {
    lines.push(
      "- 下一步：系统设置 → 隐私与安全性 → 屏幕录制，打开 CuaDriver",
    );
  }
  if (report.permission_details.accessibility === "required") {
    lines.push(
      "- 下一步：系统设置 → 隐私与安全性 → 辅助功能，打开 CuaDriver",
    );
  }
  if (
    report.error?.code === "permission_required" &&
    report.permission_details.accessibility !== "required" &&
    report.permission_details.screen_recording !== "required"
  ) {
    lines.push(
      "- 下一步：在系统设置 → 隐私与安全性中检查 CuaDriver 的屏幕录制与辅助功能",
    );
  }
  if (
    report.cleanup.status === "failed" &&
    report.cleanup.error !== undefined &&
    report.cleanup.error !== report.error
  ) {
    lines.push(`- 清理异常：${diagnosticSummary(report.cleanup.error)}`);
    const cleanupAction = diagnosticNextAction(report.cleanup.error);
    if (cleanupAction !== undefined) lines.push(`- 清理下一步：${cleanupAction}`);
  }
  return lines.join("\n");
}
