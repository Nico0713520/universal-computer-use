import { ComputerUseError, type ComputerUseErrorCode } from "../../src/errors.js";
import { ComputerUseRuntime } from "../../src/core/runtime.js";
import type { ComputerAction } from "../../src/protocol.js";
import type {
  EngineExecution,
  EngineObservation,
  EnginePort,
} from "../../src/engine/port.js";

type ObservationStep = "success" | "capture_failed" | Error;

export type FakeEngineOptions = Readonly<{
  width?: number;
  height?: number;
  dataBase64?: string;
  platform?: "macos" | "windows";
  observationSequence?: readonly ObservationStep[];
  actionError?: ComputerUseErrorCode | Error;
  hangAction?: boolean;
}>;

function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(abortError()), { once: true });
  });
}

export class FakeEngine implements EnginePort {
  readonly name = "cua-driver" as const;
  readonly version = "0.22.2";
  readonly sessionId = "fixture-session";
  readonly executions: ComputerAction[] = [];
  readonly events: string[] = [];
  observations = 0;
  closes = 0;

  private readonly observationSequence: ObservationStep[];

  constructor(private readonly options: FakeEngineOptions = {}) {
    this.observationSequence = [...(options.observationSequence ?? [])];
  }

  async observe(signal: AbortSignal): Promise<EngineObservation> {
    if (signal.aborted) throw abortError();
    this.observations += 1;
    this.events.push("observe");
    const step = this.observationSequence.shift() ?? "success";
    if (step === "capture_failed") {
      throw new ComputerUseError(
        "capture_failed",
        "Fixture capture failed",
        "observe_again",
        true,
      );
    }
    if (step instanceof Error) throw step;

    return {
      image: {
        mimeType: "image/png",
        dataBase64: this.options.dataBase64 ?? "cG5n",
        width: this.options.width ?? 100,
        height: this.options.height ?? 80,
      },
      platform: this.options.platform ?? "macos",
      scaleFactor: 1,
    };
  }

  async execute(
    action: ComputerAction,
    signal: AbortSignal,
  ): Promise<EngineExecution> {
    this.executions.push(action);
    this.events.push(`execute:${action.type}`);
    if (this.options.hangAction) return waitForAbort(signal);
    if (this.options.actionError instanceof Error) throw this.options.actionError;
    if (this.options.actionError !== undefined) {
      throw new ComputerUseError(
        this.options.actionError,
        this.options.actionError,
        "observe_again",
        true,
      );
    }
    return {
      status: "executed",
      effect: "unverifiable",
      route: "unknown",
      delivery: "unknown",
    };
  }

  async close(): Promise<void> {
    this.closes += 1;
    this.events.push("close");
  }
}

export function fixtureRuntime(options: FakeEngineOptions = {}): {
  runtime: ComputerUseRuntime;
  engine: FakeEngine;
} {
  const engine = new FakeEngine(options);
  return { runtime: new ComputerUseRuntime(engine), engine };
}
