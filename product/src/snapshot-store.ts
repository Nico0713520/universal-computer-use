import { randomBytes } from "node:crypto";

import { ComputerUseError } from "./errors.js";

export type ElementIdentityNode = Readonly<{ role: string; label: string }>;
export type ElementIdentity = Readonly<{
  role: string;
  label: string;
  parentChain: readonly ElementIdentityNode[];
}>;
export type SnapshotElement = Readonly<{
  elementRef: string;
  token: string;
  identity: ElementIdentity;
  capabilities: readonly string[];
}>;
export type SnapshotTarget =
  | Readonly<{ kind: "desktop"; displayId: "primary" }>
  | Readonly<{ kind: "window"; windowRef: string }>;
export type SnapshotVisualStatus =
  | "available"
  | "not_requested"
  | "capture_unavailable"
  | "pixel_frame_unproven";
export type SnapshotObserveOptions = Readonly<{
  includeScreenshot: boolean;
  query?: string;
  maxElements: number;
  maxDepth: number;
}>;
export type SnapshotWindowTarget = Readonly<{
  windowRef: string;
  appRef: string;
  nativeKey: string;
  ownerKey: string;
}>;

export type SnapshotRecord = Readonly<{
  id: string;
  sessionId: string;
  target: SnapshotTarget;
  visualStatus: SnapshotVisualStatus;
  coordinateSpace: "desktop_screenshot_pixels" | "window_screenshot_pixels";
  width?: number;
  height?: number;
  upstreamSnapshotId?: string;
  windowTarget?: SnapshotWindowTarget;
  observeOptions: SnapshotObserveOptions;
  createdAtMs: number;
}>;

export type SnapshotCreateInput = Readonly<{
  sessionId: string;
  target: Readonly<{ kind: "desktop" }> | Readonly<{ kind: "window"; windowRef: string }>;
  visual:
    | Readonly<{ status: "available"; width: number; height: number }>
    | Readonly<{ status: Exclude<SnapshotVisualStatus, "available"> }>;
  coordinateSpace: "desktop_screenshot_pixels" | "window_screenshot_pixels";
  upstreamSnapshotId?: string;
  windowTarget?: SnapshotWindowTarget;
  elements?: readonly SnapshotElement[];
  observeOptions: SnapshotObserveOptions;
}>;

function validDimension(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function freezeIdentity(identity: ElementIdentity): ElementIdentity {
  if (identity.role.trim() === "") throw new Error("Element identity role is required");
  return Object.freeze({
    role: identity.role,
    label: identity.label,
    parentChain: Object.freeze(identity.parentChain.map((node) => Object.freeze({ ...node }))),
  });
}

export class SnapshotStore {
  private current?: SnapshotRecord;
  private currentElements = new Map<string, SnapshotElement>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly token: () => string = () => randomBytes(18).toString("base64url"),
    private readonly idleMs = 30 * 60 * 1_000,
  ) {}

  create(sessionId: string, width: number, height: number): SnapshotRecord;
  create(input: SnapshotCreateInput): SnapshotRecord;
  create(
    inputOrSession: SnapshotCreateInput | string,
    legacyWidth?: number,
    legacyHeight?: number,
  ): SnapshotRecord {
    const input: SnapshotCreateInput = typeof inputOrSession === "string"
      ? {
          sessionId: inputOrSession,
          target: { kind: "desktop" },
          visual: {
            status: "available",
            width: legacyWidth as number,
            height: legacyHeight as number,
          },
          coordinateSpace: "desktop_screenshot_pixels",
          elements: [],
          observeOptions: { includeScreenshot: true, maxElements: 0, maxDepth: 0 },
        }
      : inputOrSession;

    if (input.visual.status === "available" &&
        (!validDimension(input.visual.width) || !validDimension(input.visual.height))) {
      throw new RangeError("Snapshot dimensions must be positive integers");
    }
    if (input.target.kind === "desktop" && input.coordinateSpace !== "desktop_screenshot_pixels") {
      throw new Error("Desktop snapshots require desktop screenshot coordinates");
    }
    if (input.target.kind === "window" && input.coordinateSpace !== "window_screenshot_pixels") {
      throw new Error("Window snapshots require window screenshot coordinates");
    }

    const elements = new Map<string, SnapshotElement>();
    for (const element of input.elements ?? []) {
      if (!/^el_[A-Za-z0-9_-]{16,}$/.test(element.elementRef)) {
        throw new Error("Invalid element_ref");
      }
      if (elements.has(element.elementRef)) throw new Error("Duplicate element_ref");
      elements.set(element.elementRef, Object.freeze({
        elementRef: element.elementRef,
        token: element.token,
        identity: freezeIdentity(element.identity),
        capabilities: Object.freeze([...element.capabilities]),
      }));
    }

    const target: SnapshotTarget = input.target.kind === "desktop"
      ? Object.freeze({ kind: "desktop", displayId: "primary" })
      : Object.freeze({ kind: "window", windowRef: input.target.windowRef });
    const visualFields = input.visual.status === "available"
      ? { width: input.visual.width, height: input.visual.height }
      : {};
    const record: SnapshotRecord = Object.freeze({
      id: `snap_${this.token()}`,
      sessionId: input.sessionId,
      target,
      visualStatus: input.visual.status,
      coordinateSpace: input.coordinateSpace,
      ...visualFields,
      ...(input.upstreamSnapshotId === undefined ? {} : { upstreamSnapshotId: input.upstreamSnapshotId }),
      ...(input.windowTarget === undefined
        ? {}
        : { windowTarget: Object.freeze({ ...input.windowTarget }) }),
      observeOptions: Object.freeze({ ...input.observeOptions }),
      createdAtMs: this.now(),
    });
    this.current = record;
    this.currentElements = elements;
    return record;
  }

  requireCurrent(id: string): SnapshotRecord {
    this.expireIdle();
    if (!this.current || this.current.id !== id) {
      throw new ComputerUseError("stale_snapshot", "stale_snapshot", "observe_again", true);
    }
    return this.current;
  }

  resolveElement(snapshotId: string, elementRef: string): SnapshotElement {
    this.requireCurrent(snapshotId);
    const element = this.currentElements.get(elementRef);
    if (element === undefined) {
      throw new ComputerUseError("stale_element_ref", "stale_element_ref", "observe_again", true);
    }
    return element;
  }

  consume(id: string): SnapshotRecord {
    const snapshot = this.requireCurrent(id);
    this.current = undefined;
    this.currentElements.clear();
    return snapshot;
  }

  clear(): void {
    this.current = undefined;
    this.currentElements.clear();
  }

  expireIdle(): void {
    if (this.current && this.now() - this.current.createdAtMs > this.idleMs) {
      this.clear();
    }
  }
}
