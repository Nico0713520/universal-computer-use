import { describe, expect, it } from "vitest";

import type { DoctorReport } from "../../src/cli/doctor.js";
import { renderDoctorHuman } from "../../src/cli/doctor-output.js";
import type { ComputerUseErrorCode } from "../../src/errors.js";

const healthyReport: DoctorReport = {
  ok: true,
  product_version: "0.2.5",
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
};

function failedReport(
  code: ComputerUseErrorCode,
  message: string,
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
    error: { code, message, recovery, retryable: false },
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
      failedReport("capture_failed", "capture unavailable"),
    );

    expect(output).toContain("屏幕录制：无法确认");
    expect(output).toContain("辅助功能：无法确认");
    expect(output).not.toContain("已授权");
  });

  it.each([
    [
      "runtime_missing",
      "CuaDriver is not installed at /private/path",
      "CuaDriver 未安装",
    ],
    [
      "engine_version_mismatch",
      "Installed Cua version differs from engine.lock.json",
      "Cua Runtime 版本不匹配",
    ],
    [
      "engine_version_mismatch",
      "Runtime checksum mismatch at /private/path",
      "Cua Runtime 文件哈希不匹配",
    ],
    [
      "engine_version_mismatch",
      "Cua signature signer identity mismatch at /private/path",
      "CuaDriver 签名身份不匹配",
    ],
    [
      "runtime_unavailable",
      "daemon startup recovery failed at /private/path",
      "Cua daemon 未运行，或有限启动恢复失败",
    ],
    [
      "interactive_session_required",
      "The macOS login window is active",
      "macOS 桌面已锁定或当前不是可交互登录会话",
    ],
    [
      "engine_version_mismatch",
      "Cua did not establish the required desktop and window scopes",
      "desktop/window 会话初始化失败",
    ],
    [
      "engine_contract_changed",
      "Agent Cursor readback did not confirm disabled state",
      "Agent Cursor 关闭或回读失败",
    ],
  ] as const)("explains %s failures without echoing sensitive details", (code, message, expected) => {
    const output = renderDoctorHuman(failedReport(code, message));

    expect(output).toContain(expected);
    expect(output).not.toContain("/private/path");
  });
});
