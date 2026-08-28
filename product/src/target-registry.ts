import { randomBytes } from "node:crypto";

import { ComputerUseError } from "./errors.js";

export type TargetCapability =
  | "observe"
  | "click"
  | "double_click"
  | "right_click"
  | "scroll"
  | "set_value"
  | "type_text"
  | "keypress"
  | "invoke_menu"
  | "launch";

export type TargetBounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type NativeAppTarget = Readonly<{
  nativeKey: string;
  displayName: string;
  running: boolean;
  capabilities: readonly TargetCapability[];
  native: Readonly<Record<string, unknown>>;
}>;

export type NativeWindowTarget = Readonly<{
  nativeKey: string;
  ownerKey: string;
  app: NativeAppTarget;
  title: string;
  bounds: TargetBounds;
  focused: boolean;
  minimized: boolean;
  capabilities: readonly TargetCapability[];
  native: Readonly<Record<string, unknown>>;
}>;

export type InternalAppTarget = NativeAppTarget & Readonly<{ appRef: string }>;
export type InternalWindowTarget = Omit<NativeWindowTarget, "app"> & Readonly<{
  windowRef: string;
  appRef: string;
}>;

type Entry<T> = { target: T; lastUsedAtMs: number };

export type TargetRegistryOptions = Readonly<{
  now?: () => number;
  token?: () => string;
  idleMs?: number;
  maxApps?: number;
  maxWindows?: number;
}>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function frozenApp(candidate: NativeAppTarget, appRef: string): InternalAppTarget {
  return Object.freeze({
    appRef,
    nativeKey: candidate.nativeKey,
    displayName: candidate.displayName,
    running: candidate.running,
    capabilities: Object.freeze([...candidate.capabilities]),
    native: Object.freeze({ ...candidate.native }),
  });
}

function frozenWindow(
  candidate: NativeWindowTarget,
  appRef: string,
  windowRef: string,
): InternalWindowTarget {
  return Object.freeze({
    windowRef,
    appRef,
    nativeKey: candidate.nativeKey,
    ownerKey: candidate.ownerKey,
    title: candidate.title,
    bounds: Object.freeze({ ...candidate.bounds }),
    focused: candidate.focused,
    minimized: candidate.minimized,
    capabilities: Object.freeze([...candidate.capabilities]),
    native: Object.freeze({ ...candidate.native }),
  });
}

export class TargetRegistry {
  private readonly now: () => number;
  private readonly token: () => string;
  private readonly idleMs: number;
  private readonly maxApps: number;
  private readonly maxWindows: number;
  private readonly appsByRef = new Map<string, Entry<InternalAppTarget>>();
  private readonly appsByNative = new Map<string, Entry<InternalAppTarget>>();
  private readonly windowsByRef = new Map<string, Entry<InternalWindowTarget>>();
  private readonly windowsByNative = new Map<string, Entry<InternalWindowTarget>>();
  private readonly invalidWindowReasons = new Map<string, "window_owner_changed">();

  constructor(options: TargetRegistryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.token = options.token ?? (() => randomBytes(18).toString("base64url"));
    this.idleMs = options.idleMs ?? 30 * 60 * 1_000;
    this.maxApps = options.maxApps ?? 200;
    this.maxWindows = options.maxWindows ?? 200;
    if (!Number.isInteger(this.maxApps) || this.maxApps < 1) throw new RangeError("maxApps must be a positive integer");
    if (!Number.isInteger(this.maxWindows) || this.maxWindows < 1) throw new RangeError("maxWindows must be a positive integer");
  }

  registerApps(candidates: readonly NativeAppTarget[]): readonly InternalAppTarget[] {
    this.expireIdle();
    const unique = new Map<string, NativeAppTarget>();
    for (const candidate of candidates) unique.set(candidate.nativeKey, candidate);
    const sorted = [...unique.values()].sort((left, right) =>
      compareText(left.displayName, right.displayName) || compareText(left.nativeKey, right.nativeKey));
    const registered: InternalAppTarget[] = [];
    for (const candidate of sorted) {
      const target = this.registerApp(candidate);
      if (target !== undefined) registered.push(target);
    }
    return Object.freeze(registered);
  }

  registerWindows(candidates: readonly NativeWindowTarget[]): readonly InternalWindowTarget[] {
    this.expireIdle();
    const unique = new Map<string, NativeWindowTarget>();
    for (const candidate of candidates) unique.set(candidate.nativeKey, candidate);
    const sorted = [...unique.values()].sort((left, right) =>
      compareText(left.app.displayName, right.app.displayName) ||
      compareText(left.title, right.title) ||
      compareText(left.nativeKey, right.nativeKey));
    const registered: InternalWindowTarget[] = [];

    for (const candidate of sorted) {
      const prior = this.windowsByNative.get(candidate.nativeKey);
      if (prior !== undefined && prior.target.ownerKey !== candidate.ownerKey) {
        this.invalidateWindowEntry(prior, "window_owner_changed");
      }

      const current = this.windowsByNative.get(candidate.nativeKey);
      const app = this.registerApp(candidate.app);
      if (app === undefined) continue;
      if (current !== undefined) {
        const target = frozenWindow(candidate, app.appRef, current.target.windowRef);
        this.replaceWindowEntry(current, target);
        registered.push(target);
        continue;
      }
      if (this.windowsByRef.size >= this.maxWindows) continue;
      const target = frozenWindow(candidate, app.appRef, this.mint("win", this.windowsByRef));
      const entry = { target, lastUsedAtMs: this.now() };
      this.windowsByRef.set(target.windowRef, entry);
      this.windowsByNative.set(target.nativeKey, entry);
      registered.push(target);
    }
    return Object.freeze(registered);
  }

  resolveApp(appRef: string): InternalAppTarget {
    this.expireIdle();
    const entry = this.appsByRef.get(appRef);
    if (entry === undefined) {
      throw new ComputerUseError("stale_app_ref", "stale_app_ref", "discover_again", true);
    }
    entry.lastUsedAtMs = this.now();
    return entry.target;
  }

  resolveWindow(windowRef: string): InternalWindowTarget {
    this.expireIdle();
    const invalidReason = this.invalidWindowReasons.get(windowRef);
    if (invalidReason !== undefined) {
      throw new ComputerUseError(invalidReason, invalidReason, "discover_again", true);
    }
    const entry = this.windowsByRef.get(windowRef);
    if (entry === undefined) {
      throw new ComputerUseError("window_not_found", "window_not_found", "discover_again", true);
    }
    entry.lastUsedAtMs = this.now();
    const app = this.appsByRef.get(entry.target.appRef);
    if (app !== undefined) app.lastUsedAtMs = entry.lastUsedAtMs;
    return entry.target;
  }

  invalidateWindow(windowRef: string): void {
    const entry = this.windowsByRef.get(windowRef);
    if (entry !== undefined) this.invalidateWindowEntry(entry, "window_owner_changed");
  }

  clear(): void {
    this.appsByRef.clear();
    this.appsByNative.clear();
    this.windowsByRef.clear();
    this.windowsByNative.clear();
    this.invalidWindowReasons.clear();
  }

  expireIdle(): void {
    const now = this.now();
    for (const entry of [...this.windowsByRef.values()]) {
      if (now - entry.lastUsedAtMs > this.idleMs) this.removeWindowEntry(entry);
    }
    for (const entry of [...this.appsByRef.values()]) {
      if (now - entry.lastUsedAtMs > this.idleMs) this.removeAppEntry(entry);
    }
  }

  private registerApp(candidate: NativeAppTarget): InternalAppTarget | undefined {
    const current = this.appsByNative.get(candidate.nativeKey);
    if (current !== undefined) {
      const target = frozenApp(candidate, current.target.appRef);
      this.appsByRef.set(target.appRef, current);
      current.target = target;
      current.lastUsedAtMs = this.now();
      return target;
    }
    if (this.appsByRef.size >= this.maxApps) return undefined;
    const target = frozenApp(candidate, this.mint("app", this.appsByRef));
    const entry = { target, lastUsedAtMs: this.now() };
    this.appsByRef.set(target.appRef, entry);
    this.appsByNative.set(target.nativeKey, entry);
    return target;
  }

  private replaceWindowEntry(
    entry: Entry<InternalWindowTarget>,
    target: InternalWindowTarget,
  ): void {
    entry.target = target;
    entry.lastUsedAtMs = this.now();
    this.windowsByRef.set(target.windowRef, entry);
    this.windowsByNative.set(target.nativeKey, entry);
  }

  private invalidateWindowEntry(
    entry: Entry<InternalWindowTarget>,
    reason: "window_owner_changed",
  ): void {
    this.removeWindowEntry(entry);
    if (this.invalidWindowReasons.size >= this.maxWindows) {
      const oldest = this.invalidWindowReasons.keys().next().value as string | undefined;
      if (oldest !== undefined) this.invalidWindowReasons.delete(oldest);
    }
    this.invalidWindowReasons.set(entry.target.windowRef, reason);
  }

  private removeWindowEntry(entry: Entry<InternalWindowTarget>): void {
    this.windowsByRef.delete(entry.target.windowRef);
    if (this.windowsByNative.get(entry.target.nativeKey) === entry) {
      this.windowsByNative.delete(entry.target.nativeKey);
    }
  }

  private removeAppEntry(entry: Entry<InternalAppTarget>): void {
    this.appsByRef.delete(entry.target.appRef);
    if (this.appsByNative.get(entry.target.nativeKey) === entry) {
      this.appsByNative.delete(entry.target.nativeKey);
    }
  }

  private mint(prefix: "app" | "win", refs: ReadonlyMap<string, unknown>): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const token = this.token();
      if (!/^[A-Za-z0-9_-]{16,}$/.test(token)) {
        throw new Error("Target ref token must be URL-safe and at least 16 characters");
      }
      const ref = `${prefix}_${token}`;
      if (!refs.has(ref)) return ref;
    }
    throw new Error("Unable to mint a unique target ref");
  }
}
