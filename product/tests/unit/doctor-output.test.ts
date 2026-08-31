import { describe, expect, it } from "vitest";

import type { DoctorReport } from "../../src/cli/doctor.js";
import { renderDoctorHuman } from "../../src/cli/doctor-output.js";
import type {
  ComputerUseDiagnosticReason,
  ComputerUseErrorCode,
} from "../../src/errors.js";

const healthyReport: DoctorReport = {
  ok: true,
  product_version: "0.2.6",
  protocol_version: "1.2.0",
  platform: "macos",
  supported_platform: true,
  expected_engine_version: "0.22.2",
  reported_engine_version: "0.22.2",
  engine_connected: true,
  required_tools_present: true,
  desktop_unlocked: true,
  permissions: "granted",
  permission_details: {
    accessibility: "granted",
    screen_recording: "granted",
    source: "driver-daemon",
  },
  observation_succeeded: true,
  screenshot: { width: 2560, height: 1440 },
  cleanup: { status: "succeeded" },
};

function failedReport(
  code: ComputerUseErrorCode,
  diagnosticReason?: ComputerUseDiagnosticReason,
  recovery: NonNullable<DoctorReport["error"]>["recovery"] = "doctor",
): DoctorReport {
  return {
    ...healthyReport,
    ok: false,
    engine_connected: false,
    required_tools_present: false,
    desktop_unlocked: null,
    permissions: "unknown",
    permission_details: {
      accessibility: "unknown",
      screen_recording: "unknown",
      source: "unknown",
    },
    observation_succeeded: false,
    screenshot: null,
    cleanup: { status: "not_needed" },
    error: {
      code,
      message: "identical opaque diagnostic message",
      recovery,
      retryable: false,
      ...(diagnosticReason === undefined
        ? {}
        : { diagnostic_reason: diagnosticReason }),
    },
  };
}

describe("human doctor output", () => {
  it("explains a ready Mac without exposing implementation metadata", () => {
    const output = renderDoctorHuman(healthyReport);

    expect(output).toContain("Computer Use 检查：通过");
    expect(output).toContain("Cua Runtime：已连接（0.22.2）");
    expect(output).toContain("屏幕录制：已授权");
    expect(output).toContain("辅助功能：已授权");
    expect(output).toContain("截图：可用（2560 × 1440）");
    expect(output).toContain("desktop/window 会话与 Agent Cursor：初始化成功");
  });

  it("names the exact System Settings pages for each missing CuaDriver grant", () => {
    const output = renderDoctorHuman({
      ...healthyReport,
      ok: false,
      permissions: "required",
      permission_details: {
        accessibility: "required",
        screen_recording: "required",
        source: "driver-daemon",
      },
      observation_succeeded: false,
      screenshot: null,
      error: {
        code: "permission_required",
        message: "permissions required",
        recovery: "grant_permission",
        retryable: false,
      },
    });

    expect(output).toContain("屏幕录制：需要授权");
    expect(output).toContain("辅助功能：需要授权");
    expect(output).toContain(
      "系统设置 → 隐私与安全性 → 屏幕录制，打开 CuaDriver",
    );
    expect(output).toContain(
      "系统设置 → 隐私与安全性 → 辅助功能，打开 CuaDriver",
    );
  });

  it("does not describe an unconfirmed permission as granted", () => {
    const output = renderDoctorHuman(
      failedReport("capture_failed", "capture_failed"),
    );

    expect(output).toContain("屏幕录制：无法确认");
    expect(output).toContain("辅助功能：无法确认");
    expect(output).not.toContain("已授权");
  });

  it("marks an observable Mac with unconfirmed grants as partial, not passed", () => {
    const output = renderDoctorHuman({
      ...healthyReport,
      permissions: "unknown",
      permission_details: {
        accessibility: "unknown",
        screen_recording: "unknown",
        source: "unknown",
      },
    });

    expect(output).toContain("Computer Use 检查：部分通过（权限状态未确认）");
    expect(output).not.toContain("Computer Use 检查：通过");
  });

  it.each([
    [
      "runtime_missing",
      "runtime_missing",
      "CuaDriver 未安装",
      "运行 computer-use setup --development",
    ],
    [
      "engine_version_mismatch",
      "runtime_version_mismatch",
      "Cua Runtime 版本不匹配",
      "重新运行 computer-use setup --development，安装锁定版本",
    ],
    [
      "engine_version_mismatch",
      "runtime_integrity_mismatch",
      "Cua Runtime 文件哈希不匹配",
      "重新安装锁定的 Cua Runtime",
    ],
    [
      "engine_version_mismatch",
      "runtime_signature_mismatch",
      "CuaDriver 签名身份不匹配",
      "重新安装官方签名的 CuaDriver",
    ],
    [
      "runtime_unavailable",
      "runtime_startup_failed",
      "Cua daemon 未运行，或有限启动恢复失败",
      "确认 CuaDriver 已安装并可启动，然后重新运行 computer-use doctor",
    ],
    [
      "interactive_session_required",
      "interactive_session_locked",
      "macOS 桌面已锁定或当前不是可交互登录会话",
      "解锁 Mac 并进入可交互桌面，然后重新运行 computer-use doctor",
    ],
    [
      "engine_version_mismatch",
      "session_initialization_failed",
      "desktop/window 会话初始化失败",
      "重新运行 computer-use setup --development；仍失败时报告 Cua session 初始化问题",
    ],
    [
      "engine_contract_changed",
      "cursor_initialization_failed",
      "Agent Cursor 关闭或回读失败",
      "重新运行 computer-use setup --development；仍失败时报告 Agent Cursor 初始化问题",
    ],
  ] as const)("explains %s failures from typed reasons", (code, reason, expected, nextAction) => {
    const output = renderDoctorHuman(failedReport(code, reason));

    expect(output).toContain(expected);
    expect(output).toContain(nextAction);
    expect(output).not.toContain("identical opaque diagnostic message");
  });
});
