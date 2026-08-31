import type { DoctorReport } from "./doctor.js";

function permissionLabel(
  state: DoctorReport["permission_details"]["accessibility"],
): string {
  if (state === "granted") return "已授权";
  if (state === "required") return "需要授权";
  return "无法确认";
}

function diagnosticSummary(error: NonNullable<DoctorReport["error"]>): string {
  const message = error.message.toLowerCase();
  if (error.code === "runtime_missing") return "CuaDriver 未安装";
  if (/cursor/u.test(message)) return "Agent Cursor 关闭或回读失败";
  if (
    /signature|signer|codesign|gatekeeper|teamidentifier|bundle identifier|designated requirement/u.test(
      message,
    )
  ) {
    return "CuaDriver 签名身份不匹配";
  }
  if (/checksum|hash/u.test(message)) return "Cua Runtime 文件哈希不匹配";
  if (
    (error.code === "engine_version_mismatch" ||
      error.code === "engine_contract_changed") &&
    /desktop.+window.+scope|session scope|startsession/u.test(message)
  ) {
    return "desktop/window 会话初始化失败";
  }
  if (error.code === "engine_version_mismatch") {
    return "Cua Runtime 版本不匹配";
  }
  if (error.code === "runtime_unavailable") {
    if (/interactive session/u.test(message)) {
      return "macOS 可交互登录会话无法确认";
    }
    return "Cua daemon 未运行，或有限启动恢复失败";
  }
  if (error.code === "interactive_session_required") {
    return "macOS 桌面已锁定或当前不是可交互登录会话";
  }
  if (error.code === "permission_required") return "CuaDriver 权限不完整";
  if (error.code === "capture_failed") return "截图不可用";
  return `诊断代码 ${error.code}`;
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

  const lines = [
    `Computer Use 检查：${report.ok ? "通过" : "未通过"}`,
    `- Cua Runtime：${runtime}`,
    `- 屏幕录制：${permissionLabel(report.permission_details.screen_recording)}`,
    `- 辅助功能：${permissionLabel(report.permission_details.accessibility)}`,
    `- 截图：${screenshot}`,
    `- desktop/window 会话与 Agent Cursor：${sessions}`,
  ];
  if (report.error !== undefined) {
    lines.push(`- 诊断：${diagnosticSummary(report.error)}`);
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
  if (report.error?.code === "runtime_missing") {
    lines.push("- 下一步：运行 computer-use setup --development");
  }
  return lines.join("\n");
}
