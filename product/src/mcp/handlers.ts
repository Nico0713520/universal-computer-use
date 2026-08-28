import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { ComputerUseRuntime } from "../core/runtime.js";
import { ComputerUseError } from "../errors.js";
import {
  ActInputSchema,
  ObserveInputSchema,
  type ActEnvelope,
  type ObservationEnvelope,
} from "../protocol.js";

type SuccessEnvelope = ObservationEnvelope | ActEnvelope;

function successToMcp(value: SuccessEnvelope): CallToolResult {
  const imageContent = value.image === undefined
    ? []
    : [{
        type: "image" as const,
        mimeType: value.image.mimeType,
        data: value.image.dataBase64,
      }];
  return {
    content: [
      { type: "text", text: JSON.stringify(value.structured) },
      ...imageContent,
    ],
    structuredContent: value.structured,
  };
}

function errorToMcp(error: unknown): CallToolResult {
  const safe =
    error instanceof ComputerUseError
      ? {
          code: error.code,
          recovery: error.recovery,
          retryable: error.retryable,
          ...(error.snapshotConsumed ? { snapshot_consumed: true } : {}),
        }
      : {
          code: "runtime_unavailable",
          recovery: "doctor",
          retryable: true,
        };

  return {
    content: [{ type: "text", text: JSON.stringify(safe) }],
    structuredContent: safe,
    isError: true,
  };
}

export async function handleObserve(
  runtime: ComputerUseRuntime,
  input: unknown,
): Promise<CallToolResult> {
  try {
    ObserveInputSchema.parse(input);
    return successToMcp(await runtime.observe());
  } catch (error) {
    return errorToMcp(error);
  }
}

export async function handleAct(
  runtime: ComputerUseRuntime,
  input: unknown,
): Promise<CallToolResult> {
  try {
    const parsed = ActInputSchema.parse(input);
    return successToMcp(await runtime.act(parsed));
  } catch (error) {
    return errorToMcp(error);
  }
}
