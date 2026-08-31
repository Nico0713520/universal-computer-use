import type { EngineLock } from "../engine/lock.js";
import type { EnginePort } from "../engine/port.js";
import type { DoctorDependencies } from "./doctor.js";
import { probeMacInteractiveSession } from "./interactive-session.js";
import { probeMacPermissions } from "./macos-permissions.js";
import type { ProcessRunner } from "./process-runner.js";

export type DoctorDependencyAdapterInput = Readonly<{
  connectEngine(lock: EngineLock): Promise<EnginePort>;
  runner: ProcessRunner;
}>;

export function createDoctorDependencyAdapter(
  input: DoctorDependencyAdapterInput,
): (lock: EngineLock) => DoctorDependencies {
  return (lock) => ({
    lock,
    connectEngine: input.connectEngine,
    probeInteractiveSession: () => probeMacInteractiveSession(input.runner),
    probeMacPermissions: () => probeMacPermissions(input.runner),
  });
}
