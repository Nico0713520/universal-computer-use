/**
 * Action-then-observe ordering adapted from:
 * https://github.com/trycua/cua/blob/c60ef6ad2db8774fb342938843e2f17f26c68240/libs/cua-driver/examples/agent-sdks/native-tools.ts
 * Upstream SPDX-License-Identifier: MIT
 */
import type { EnginePort } from "../engine/port.js";
import type { ActEnvelope, ActInput, ObservationEnvelope } from "../protocol.js";
import { SnapshotStore } from "../snapshot-store.js";
import { assertCoordinates, failedExecution, toActEnvelope } from "./act.js";
import {
  observeWithOneTransientRetry,
  toObservationEnvelope,
  withTimeout,
} from "./observe.js";
import { SerialExecutor } from "./serial-executor.js";

export class ComputerUseRuntime {
  private readonly serial = new SerialExecutor();
  private readonly lifecycle = new AbortController();
  private closePromise?: Promise<void>;

  constructor(
    private readonly engine: EnginePort,
    private readonly snapshots = new SnapshotStore(),
  ) {}

  observe(): Promise<ObservationEnvelope> {
    return this.serial.run(() => this.observeUnlocked());
  }

  private async observeUnlocked(): Promise<ObservationEnvelope> {
    this.snapshots.clear();
    const observed = await withTimeout(
      (signal) => this.engine.observe(signal),
      20_000,
      "capture_failed",
      this.lifecycle.signal,
    );
    const snapshot = this.snapshots.create(
      this.engine.sessionId,
      observed.image.width,
      observed.image.height,
    );
    return toObservationEnvelope(this.engine, snapshot, observed);
  }

  act(input: ActInput): Promise<ActEnvelope> {
    return this.serial.run(() => this.actUnlocked(input));
  }

  private async actUnlocked(input: ActInput): Promise<ActEnvelope> {
    const snapshot = this.snapshots.requireCurrent(input.snapshot_id);
    assertCoordinates(input.action, snapshot);
    this.snapshots.consume(input.snapshot_id);

    let actionResult;
    try {
      actionResult = await withTimeout(
        (signal) => this.engine.execute(input.action, signal),
        20_000,
        "action_timeout",
        this.lifecycle.signal,
      );
    } catch (error) {
      actionResult = failedExecution(error);
    }

    const observed = await observeWithOneTransientRetry(
      this.engine,
      this.lifecycle.signal,
    );
    const next = this.snapshots.create(
      this.engine.sessionId,
      observed.image.width,
      observed.image.height,
    );
    return toActEnvelope(this.engine, snapshot.id, next, actionResult, observed);
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;

    this.lifecycle.abort();
    this.closePromise = this.serial.run(async () => {
      this.snapshots.clear();
      await this.engine.close();
    });
    return this.closePromise;
  }
}
