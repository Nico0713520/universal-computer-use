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
  "coordinate_out_of_bounds",
  "action_timeout",
  "action_refused",
  "action_failed",
  "capture_failed",
  "unsupported_action",
] as const;

export type ComputerUseErrorCode = typeof ERROR_CODES[number];

export class ComputerUseError extends Error {
  constructor(
    public readonly code: ComputerUseErrorCode,
    message: string,
    public readonly recovery: "setup" | "doctor" | "observe_again" | "grant_permission" | "stop",
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}
