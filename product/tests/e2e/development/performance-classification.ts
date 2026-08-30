import { ZodError } from "zod";

import type { PerformanceFailureKind } from "./performance-recorder.js";

export type ToolCallClassificationInput =
  | Readonly<{ kind: "thrown"; error: unknown }>
  | Readonly<{
      kind: "result";
      resultIsError: boolean;
      errorCodes: readonly unknown[];
    }>;

export function classifyToolCallFailure(
  input: ToolCallClassificationInput,
): PerformanceFailureKind | undefined {
  if (input.kind === "thrown") {
    return input.error instanceof ZodError ? "contract_mismatch" : "tool_error";
  }
  if (input.errorCodes.some(
    (code) => code === "target_lost" || code === "window_not_found",
  )) {
    return "target_lost";
  }
  return input.resultIsError ? "tool_error" : undefined;
}
