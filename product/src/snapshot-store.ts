import { randomBytes } from "node:crypto";

import { ComputerUseError } from "./errors.js";

export type SnapshotRecord = Readonly<{
  id: string;
  sessionId: string;
  width: number;
  height: number;
  createdAtMs: number;
}>;

export class SnapshotStore {
  private current?: SnapshotRecord;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly token: () => string = () => randomBytes(18).toString("base64url"),
    private readonly idleMs = 30 * 60 * 1_000,
  ) {}

  create(sessionId: string, width: number, height: number): SnapshotRecord {
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new RangeError("Snapshot dimensions must be positive integers");
    }
    this.current = Object.freeze({
      id: `snap_${this.token()}`,
      sessionId,
      width,
      height,
      createdAtMs: this.now(),
    });
    return this.current;
  }

  requireCurrent(id: string): SnapshotRecord {
    this.expireIdle();
    if (!this.current || this.current.id !== id) {
      throw new ComputerUseError("stale_snapshot", "stale_snapshot", "observe_again", true);
    }
    return this.current;
  }

  consume(id: string): SnapshotRecord {
    const snapshot = this.requireCurrent(id);
    this.current = undefined;
    return snapshot;
  }

  clear(): void {
    this.current = undefined;
  }

  expireIdle(): void {
    if (this.current && this.now() - this.current.createdAtMs > this.idleMs) {
      this.current = undefined;
    }
  }
}
