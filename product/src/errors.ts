export const ERROR_CODES = [
  "runtime_missing",
  "runtime_unavailable",
  "engine_version_mismatch",
  "engine_not_development_eligible",
  "engine_not_release_eligible",
  "permission_required",
  "unsupported_platform",
  "interactive_session_required",
  "stale_snapshot",
  "next_observation_target_conflict",
  "coordinate_out_of_bounds",
  "action_timeout",
  "action_refused",
  "action_failed",
  "capture_failed",
  "unsupported_action",
  "stale_app_ref",
  "app_not_found",
  "window_not_found",
  "window_not_ready",
  "window_target_ambiguous",
  "window_owner_changed",
  "target_lost",
  "stale_element_ref",
  "element_target_conflict",
  "element_unavailable",
  "pixel_frame_unproven",
  "background_unavailable",
  "foreground_required",
  "verification_unsatisfied",
  "verification_unknown",
  "engine_unhealthy",
  "engine_contract_changed",
] as const;

export type ComputerUseErrorCode = typeof ERROR_CODES[number];

export type ComputerUseDiagnosticReason =
  | "runtime_missing"
  | "runtime_version_mismatch"
  | "runtime_integrity_mismatch"
  | "runtime_signature_mismatch"
  | "runtime_startup_failed"
  | "interactive_session_locked"
  | "interactive_session_unknown"
  | "session_initialization_failed"
  | "cursor_initialization_failed"
  | "cursor_transition_failed"
  | "desktop_permission_required"
  | "screen_recording_permission_required"
  | "accessibility_permission_required"
  | "capture_failed"
  | "session_cleanup_failed";

export type ComputerUseErrorOptions = Readonly<{
  snapshotConsumed?: boolean;
  diagnosticReason?: ComputerUseDiagnosticReason;
}>;

export class ComputerUseError extends Error {
  readonly snapshotConsumed: boolean;
  readonly diagnosticReason?: ComputerUseDiagnosticReason;

  constructor(
    public readonly code: ComputerUseErrorCode,
    message: string,
    public readonly recovery:
      | "setup"
      | "doctor"
      | "observe_again"
      | "discover_again"
      | "grant_permission"
      | "use_element"
      | "use_foreground"
      | "stop",
    public readonly retryable: boolean,
    options: ComputerUseErrorOptions = {},
  ) {
    super(message);
    this.snapshotConsumed = options.snapshotConsumed ?? false;
    this.diagnosticReason = options.diagnosticReason;
  }
}
