export type CuaErrorClassification =
  | Readonly<{
      kind: "permission";
      permission: "accessibility" | "screen_recording" | "unknown";
    }>
  | Readonly<{ kind: "interactive_session" }>
  | Readonly<{ kind: "explicit_refusal" }>
  | Readonly<{ kind: "unclassified" }>;

export function classifyCuaErrorCode(
  errorCode: string | undefined,
): CuaErrorClassification {
  if (errorCode === "screen_recording_permission_required") {
    return { kind: "permission", permission: "screen_recording" };
  }
  if (errorCode === "accessibility_permission_required") {
    return { kind: "permission", permission: "accessibility" };
  }
  if (errorCode === "permission_required") {
    return { kind: "permission", permission: "unknown" };
  }
  if (errorCode === "desktop_locked" || errorCode === "session_0") {
    return { kind: "interactive_session" };
  }
  if (
    errorCode === "background_uipi_blocked" ||
    errorCode === "foreground_required" ||
    errorCode === "permission_denied"
  ) {
    return { kind: "explicit_refusal" };
  }
  return { kind: "unclassified" };
}
