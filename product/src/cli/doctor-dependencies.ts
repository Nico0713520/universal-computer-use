import type { EngineLock } from "../engine/lock.js";
import type { CursorMode } from "../engine/cursor-mode.js";
import type { EnginePort } from "../engine/port.js";
import { verifyMacRuntimeSignature } from "../engine/runtime-startup.js";
import { ComputerUseError } from "../errors.js";
import type { DoctorDependencies } from "./doctor.js";
import { probeMacInteractiveSession } from "./interactive-session.js";
import { probeMacPermissions } from "./macos-permissions.js";
import type { ProcessRunner } from "./process-runner.js";

export type DoctorDependencyAdapterInput = Readonly<{
  connectEngine(
    lock: EngineLock,
    options: Readonly<{ cursorMode: CursorMode }>,
  ): Promise<EnginePort>;
  accessRuntimePath(path: string): Promise<void>;
  runner: ProcessRunner;
}>;

const DEFAULT_CUA_APP = "/Applications/CuaDriver.app";

export function createDoctorDependencyAdapter(
  input: DoctorDependencyAdapterInput,
): (lock: EngineLock) => DoctorDependencies {
  return (lock) => ({
    lock,
    connectEngine: input.connectEngine,
    probeInteractiveSession: () => probeMacInteractiveSession(input.runner),
    async verifyRuntimeIdentity() {
      try {
        await input.accessRuntimePath(DEFAULT_CUA_APP);
      } catch {
        throw new ComputerUseError(
          "runtime_missing",
          "CuaDriver is not installed at the locked macOS application path",
          "setup",
          false,
          { diagnosticReason: "runtime_missing" },
        );
      }
      await verifyMacRuntimeSignature(lock, input.runner, DEFAULT_CUA_APP);
    },
    probeMacPermissions: () => probeMacPermissions(input.runner),
  });
}
