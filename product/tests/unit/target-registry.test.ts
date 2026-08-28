import { describe, expect, it } from "vitest";

import {
  TargetRegistry,
  type NativeAppTarget,
  type NativeWindowTarget,
} from "../../src/target-registry.js";

function app(nativeKey: string, displayName: string): NativeAppTarget {
  return {
    nativeKey,
    displayName,
    running: true,
    capabilities: ["launch"],
    native: { bundle_id: nativeKey },
  };
}

function windowTarget(
  nativeKey: string,
  ownerKey: string,
  ownerApp: NativeAppTarget,
): NativeWindowTarget {
  return {
    nativeKey,
    ownerKey,
    app: ownerApp,
    title: "Calculator",
    bounds: { x: 10, y: 20, width: 460, height: 816 },
    focused: false,
    minimized: false,
    capabilities: ["observe", "click"],
    native: { pid: 42, window_id: nativeKey },
  };
}

describe("TargetRegistry", () => {
  it("mints opaque refs and deterministically reuses the same native targets", () => {
    const tokens = ["abcdefghijklmnop", "qrstuvwxyzABCDEF"];
    const registry = new TargetRegistry({ token: () => tokens.shift()! });
    const calculator = app("com.apple.calculator", "Calculator");

    const [first] = registry.registerApps([calculator]);
    const [again] = registry.registerApps([calculator]);
    const [window] = registry.registerWindows([
      windowTarget("7", "pid:42", calculator),
    ]);

    expect(first?.appRef).toBe("app_abcdefghijklmnop");
    expect(again?.appRef).toBe(first?.appRef);
    expect(window).toMatchObject({
      windowRef: "win_qrstuvwxyzABCDEF",
      appRef: first?.appRef,
    });
    expect(registry.resolveApp(first!.appRef)).toMatchObject({
      nativeKey: "com.apple.calculator",
      native: { bundle_id: "com.apple.calculator" },
    });
    expect(registry.resolveWindow(window!.windowRef)).toMatchObject({
      nativeKey: "7",
      ownerKey: "pid:42",
      native: { pid: 42, window_id: "7" },
    });
  });

  it("invalidates instead of migrating a window whose owner changes", () => {
    const tokens = ["abcdefghijklmnop", "qrstuvwxyzABCDEF", "ghijklmnopqrstuv"];
    const registry = new TargetRegistry({ token: () => tokens.shift()! });
    const calculator = app("com.apple.calculator", "Calculator");
    const [first] = registry.registerWindows([
      windowTarget("7", "pid:42", calculator),
    ]);
    const [replacement] = registry.registerWindows([
      windowTarget("7", "pid:99", calculator),
    ]);

    expect(replacement?.windowRef).not.toBe(first?.windowRef);
    expect(() => registry.resolveWindow(first!.windowRef)).toThrowError("window_owner_changed");
    expect(registry.resolveWindow(replacement!.windowRef).ownerKey).toBe("pid:99");
  });

  it("sorts candidates and never evicts a live ref to admit overflow", () => {
    const tokens = ["abcdefghijklmnop", "qrstuvwxyzABCDEF"];
    const registry = new TargetRegistry({
      token: () => tokens.shift()!,
      maxApps: 1,
      maxWindows: 1,
    });
    const alpha = app("app:a", "Alpha");
    const beta = app("app:b", "Beta");

    const registered = registry.registerApps([beta, alpha]);
    expect(registered.map(({ displayName }) => displayName)).toEqual(["Alpha"]);
    const alphaRef = registered[0]!.appRef;
    expect(registry.registerApps([beta])).toEqual([]);
    expect(registry.resolveApp(alphaRef).nativeKey).toBe("app:a");

    const firstWindow = registry.registerWindows([
      windowTarget("2", "pid:2", alpha),
      windowTarget("1", "pid:1", alpha),
    ]);
    expect(firstWindow.map(({ nativeKey }) => nativeKey)).toEqual(["1"]);
    const firstWindowRef = firstWindow[0]!.windowRef;
    expect(registry.registerWindows([windowTarget("3", "pid:3", alpha)])).toEqual([]);
    expect(registry.resolveWindow(firstWindowRef).nativeKey).toBe("1");
  });

  it("orders running apps and visible front windows before lexical fallbacks", () => {
    let serial = 0;
    const registry = new TargetRegistry({ token: () => `abcdefghijklmnop${serial++}` });
    const stopped = { ...app("app:a", "Alpha"), running: false };
    const running = app("app:z", "Zulu");
    expect(registry.registerApps([stopped, running]).map(({ displayName }) => displayName)).toEqual([
      "Zulu",
      "Alpha",
    ]);

    const back = {
      ...windowTarget("1", "pid:1", running),
      title: "Back",
      onCurrentSpace: true,
      isOnScreen: true,
      zIndex: 1,
    };
    const front = {
      ...windowTarget("2", "pid:1", running),
      title: "Front",
      onCurrentSpace: true,
      isOnScreen: true,
      zIndex: 10,
    };
    const otherSpace = {
      ...windowTarget("3", "pid:1", running),
      title: "Other Space",
      onCurrentSpace: false,
      isOnScreen: true,
      zIndex: 100,
    };
    expect(registry.registerWindows([back, otherSpace, front]).map(({ title }) => title)).toEqual([
      "Front",
      "Back",
      "Other Space",
    ]);
  });

  it("expires idle refs after thirty minutes and clears the transport scope", () => {
    let now = 0;
    const tokens = [
      "abcdefghijklmnop",
      "qrstuvwxyzABCDEF",
      "ghijklmnopqrstuv",
      "wxyzABCDEFGHIJKL",
    ];
    const registry = new TargetRegistry({ now: () => now, token: () => tokens.shift()! });
    const calculator = app("com.apple.calculator", "Calculator");
    const [registeredApp] = registry.registerApps([calculator]);
    const [registeredWindow] = registry.registerWindows([
      windowTarget("7", "pid:42", calculator),
    ]);

    now = 30 * 60 * 1_000 + 1;
    expect(() => registry.resolveApp(registeredApp!.appRef)).toThrowError("stale_app_ref");
    expect(() => registry.resolveWindow(registeredWindow!.windowRef)).toThrowError("window_not_found");

    const [freshApp] = registry.registerApps([calculator]);
    const [freshWindow] = registry.registerWindows([
      windowTarget("8", "pid:42", calculator),
    ]);
    registry.clear();
    expect(() => registry.resolveApp(freshApp!.appRef)).toThrowError("stale_app_ref");
    expect(() => registry.resolveWindow(freshWindow!.windowRef)).toThrowError("window_not_found");
  });
});
