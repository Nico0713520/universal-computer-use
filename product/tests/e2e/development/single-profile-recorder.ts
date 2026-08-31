import {
  PerformanceRecorder,
  type CorrectnessAwarePerformanceProfile,
  type PerformanceSample,
  type PerformanceScenarioName,
} from "./performance-recorder.js";

export type SingleProfileMetadata = Readonly<{
  product_version: string;
  protocol_version: "1.2.0";
  engine_version: string;
  macos_version: string;
  architecture: "arm64" | "x86_64";
}>;

export type SingleProfileEvidence = Readonly<{
  schema_version: 1;
  evidence_type: "computer-use-macos-development-profile";
  status: "passed" | "failed";
  metadata: SingleProfileMetadata;
  profile_name: PerformanceScenarioName;
  performance: CorrectnessAwarePerformanceProfile;
  cleanup_passed: true;
  timestamp: string;
}>;

export class SingleProfileRecorder {
  readonly #name: PerformanceScenarioName;
  readonly #performance = new PerformanceRecorder();

  constructor(name: PerformanceScenarioName) {
    this.#name = name;
  }

  recordWarmup(sample: PerformanceSample): void {
    this.#performance.recordWarmup(this.#name, sample);
  }

  recordMeasured(sample: PerformanceSample): void {
    this.#performance.recordMeasured(this.#name, sample);
  }

  evidence(
    metadata: SingleProfileMetadata,
    cleanupPassed: boolean,
    timestamp = new Date().toISOString(),
  ): SingleProfileEvidence {
    if (!cleanupPassed) throw new Error("profile_cleanup_failed");
    const performance = this.#performance.profile(this.#name);
    return {
      schema_version: 1,
      evidence_type: "computer-use-macos-development-profile",
      status: performance.status,
      metadata: {
        product_version: metadata.product_version,
        protocol_version: metadata.protocol_version,
        engine_version: metadata.engine_version,
        macos_version: metadata.macos_version,
        architecture: metadata.architecture,
      },
      profile_name: this.#name,
      performance,
      cleanup_passed: true,
      timestamp,
    };
  }
}
