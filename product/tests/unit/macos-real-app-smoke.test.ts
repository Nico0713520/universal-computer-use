import { readFile } from "node:fs/promises";

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";

import {
  cleanupSmokeResources,
  cleanupOwnedTextEdit,
  ownFreshTextEditWindow,
  restoreCalculator,
  selectExactVisibleWindow,
  ensureCalculatorWindow,
  runRealAppSmoke,
  terminateOwnedTextEditPid,
  type TextEditProcessController,
  validTextEditSetValueResult,
} from "../e2e/development/macos-real-app-smoke.js";

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");

function result(structuredContent: Record<string, unknown>, image = false): CallToolResult {
  return {
    content: image
      ? [{ type: "image", mimeType: "image/png", data: PNG }]
      : [{ type: "text", text: "ok" }],
    structuredContent,
  };
}

function desktop(snapshot: string, windows: readonly string[]): CallToolResult {
  return result({
    snapshot_id: snapshot,
    apps: [{ app_ref: "app_textedit", display_name: "TextEdit", running: windows.length > 0 }],
    windows: windows.map((window_ref) => ({
      window_ref,
      app_ref: "app_textedit",
      app_name: "TextEdit",
      title: window_ref,
    })),
  }, true);
}

function desktopWithTitles(
  snapshot: string,
  windows: readonly Readonly<{ ref: string; title: string; visible?: boolean }>[],
  appName = "TextEdit",
): CallToolResult {
  return result({
    snapshot_id: snapshot,
    apps: [{ app_ref: "app_textedit", display_name: "TextEdit", running: windows.length > 0 }],
    windows: windows.map((window) => ({
      window_ref: window.ref,
      app_ref: "app_textedit",
      app_name: appName,
      title: window.title,
      is_on_screen: window.visible ?? true,
      minimized: false,
    })),
  }, true);
}

function windowState(
  snapshot: string,
  windowRef: string,
  editable = false,
  chineseMenu = false,
): CallToolResult {
  return result({
    snapshot_id: snapshot,
    screenshot: { width: 800, height: 600 },
    target: { kind: "window", window_ref: windowRef, app_ref: "app_textedit" },
    elements: [
      ...(editable ? [{
          element_ref: `element_${snapshot}`,
          role: "AXTextArea",
          label: "Body",
          value: "nonce",
          actions: ["set_value"],
        }] : []),
      ...(chineseMenu ? [{
        element_ref: `menu_${snapshot}`,
        role: "AXMenuBarItem",
        label: "文件",
        actions: ["click"],
      }] : []),
    ],
  }, true);
}

function acted(snapshot: string, windowRef = "owned"): CallToolResult {
  return result({
    snapshot_id: snapshot,
    next_state: "available",
    target: { kind: "window", window_ref: windowRef, app_ref: "app_textedit" },
    action_result: { status: "executed", effect: "confirmed", delivery: "background" },
    verification: { status: "satisfied" },
    elements: [{
      element_ref: `element_${snapshot}`,
      role: "AXTextArea",
      label: "Body",
      value: "",
      actions: ["set_value"],
    }],
  });
}

function calculatorState(snapshot: string, windowRef: string): CallToolResult {
  return result({
    snapshot_id: snapshot,
    target: { kind: "window", window_ref: windowRef, app_ref: "app_calculator" },
    elements: [{
      element_ref: `clear_${snapshot}`,
      role: "AXButton",
      label: "AC",
      actions: ["click"],
    }],
  }, true);
}

function calculatorActed(snapshot: string, windowRef: string): CallToolResult {
  return result({
    snapshot_id: snapshot,
    next_state: "available",
    target: { kind: "window", window_ref: windowRef, app_ref: "app_calculator" },
    action_result: { status: "executed", effect: "confirmed", delivery: "background" },
    verification: { status: "satisfied" },
    elements: [{
      element_ref: `display_${snapshot}`,
      role: "AXStaticText",
      label: "Display",
      value: "0",
    }],
  });
}

function saveSheet(snapshot: string, windowRef: string): CallToolResult {
  return result({
    snapshot_id: snapshot,
    target: { kind: "window", window_ref: windowRef, app_ref: "app_textedit" },
    elements: [{
      element_ref: `discard_${snapshot}`,
      role: "AXButton",
      label: "Don't Save",
      actions: ["click"],
    }],
  }, true);
}

function scriptedClient(
  responses: readonly CallToolResult[],
  calls: Array<Readonly<{ name: string; arguments?: Record<string, unknown> }>>,
): Client {
  let index = 0;
  return {
    callTool: async (request: Readonly<{ name: string; arguments?: Record<string, unknown> }>) => {
      calls.push(request);
      const response = responses[index++];
      if (response === undefined) throw new Error("unexpected_call");
      return response;
    },
  } as unknown as Client;
}

function textEditProcesses(
  pidSnapshots: readonly (readonly number[])[] = [[41], [41, 73]],
): TextEditProcessController & {
  openDocument: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
} {
  let snapshot = 0;
  return {
    listPids: vi.fn(async () => new Set(pidSnapshots[Math.min(snapshot++, pidSnapshots.length - 1)])),
    openDocument: vi.fn(async () => undefined),
    terminate: vi.fn(async () => undefined),
  };
}

describe("TextEdit owned-window smoke", () => {
  it("opens the owned document without foregrounding TextEdit", async () => {
    const source = await readFile(
      new URL("../e2e/development/macos-real-app-smoke.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('["-n", "-F", "-g", "-a", "TextEdit", documentPath]');
  });

  it("terminates and waits for only the proven TextEdit PID", async () => {
    let aliveChecks = 0;
    const signal = vi.fn((pid: number, value: NodeJS.Signals | 0) => {
      expect(pid).toBe(73);
      if (value === 0 && (aliveChecks += 1) >= 3) {
        const exited = new Error("process exited") as NodeJS.ErrnoException;
        exited.code = "ESRCH";
        throw exited;
      }
    });
    const wait = vi.fn(async () => undefined);

    await expect(terminateOwnedTextEditPid(73, {
      signal,
      wait,
      now: () => 0,
    })).resolves.toBeUndefined();
    expect(signal).toHaveBeenNthCalledWith(1, 73, "SIGTERM");
    expect(signal).not.toHaveBeenCalledWith(41, expect.anything());
    expect(wait).toHaveBeenCalled();
  });

  it("accepts confirmed TextEdit readback when Cua honestly reports verification_unknown", () => {
    const response = result({
      snapshot_id: "fresh",
      next_state: "available",
      action_result: {
        status: "executed",
        effect: "confirmed",
        delivery: "background",
        evidence: ["value_readback"],
        error_code: "verification_unknown",
      },
      verification: { status: "unknown", reason: "element_missing" },
      observation_mode: "visual_recovery",
      visual_status: "available",
      elements: [{ value: "controlled-nonce" }],
    }, true);

    expect(validTextEditSetValueResult(response, "controlled-nonce")).toBe(true);
  });

  it("opens an owned temporary document when no window exists", async () => {
    const calls: Array<Readonly<{ name: string; arguments?: Record<string, unknown> }>> = [];
    const processes = textEditProcesses();
    const client = scriptedClient([
      desktopWithTitles("desktop-1", []),
      desktopWithTitles("desktop-2", [{ ref: "owned", title: "owned.txt" }], "文本编辑"),
    ], calls);

    await expect(ownFreshTextEditWindow(client, "/private/owned.txt", processes))
      .resolves.toEqual({ windowRef: "owned", pid: 73 });
    expect(calls.map((call) => call.name)).toEqual([
      "computer_observe",
      "computer_observe",
    ]);
    expect(processes.openDocument).toHaveBeenCalledExactlyOnceWith("/private/owned.txt");
    expect(processes.listPids).toHaveBeenCalledTimes(2);
    expect(processes.terminate).not.toHaveBeenCalled();
    expect(JSON.stringify(calls)).not.toContain("set_value");
  });

  it("waits for the one new TextEdit PID when process discovery trails open", async () => {
    const processes = textEditProcesses([[41], [41], [41, 73]]);
    const client = scriptedClient([
      desktopWithTitles("desktop-1", []),
      desktopWithTitles("desktop-2", [{ ref: "owned", title: "owned.txt" }]),
    ], []);

    await expect(ownFreshTextEditWindow(client, "/private/owned.txt", processes))
      .resolves.toEqual({ windowRef: "owned", pid: 73 });
    expect(processes.listPids).toHaveBeenCalledTimes(3);
    expect(processes.terminate).not.toHaveBeenCalled();
  });

  it("terminates only the proven new PID when exact-title window discovery fails", async () => {
    const processes = textEditProcesses([[41], [41, 73]]);
    const discoveryFailure: CallToolResult = {
      isError: true,
      content: [{ type: "text", text: "controlled discovery failure" }],
    };
    const client = scriptedClient([
      desktopWithTitles("desktop-1", []),
      discoveryFailure,
    ], []);

    await expect(ownFreshTextEditWindow(client, "/private/owned.txt", processes))
      .rejects.toThrow("verification_failed");
    expect(processes.terminate).toHaveBeenCalledExactlyOnceWith(73);
    expect(processes.terminate).not.toHaveBeenCalledWith(41);
  });

  it("reclaims the proven new PID even when open reports failure", async () => {
    const processes = textEditProcesses([[41], [41, 73]]);
    processes.openDocument.mockRejectedValueOnce(new Error("controlled open failure"));
    const client = scriptedClient([
      desktopWithTitles("desktop-1", []),
    ], []);

    await expect(ownFreshTextEditWindow(client, "/private/owned.txt", processes))
      .rejects.toThrow("textedit_unavailable");
    expect(processes.terminate).toHaveBeenCalledExactlyOnceWith(73);
    expect(processes.terminate).not.toHaveBeenCalledWith(41);
  });

  it("fails closed without terminating anything when two new TextEdit PIDs appear", async () => {
    const processes = textEditProcesses([[41], [41, 73, 74]]);
    const client = scriptedClient([
      desktopWithTitles("desktop-1", []),
    ], []);

    await expect(ownFreshTextEditWindow(client, "/private/owned.txt", processes))
      .rejects.toThrow("textedit_unavailable");
    expect(processes.openDocument).toHaveBeenCalledExactlyOnceWith("/private/owned.txt");
    expect(processes.terminate).not.toHaveBeenCalled();
  });

  it("opens an owned document beside existing windows and proves its exact title", async () => {
    const calls: Array<Readonly<{ name: string; arguments?: Record<string, unknown> }>> = [];
    const processes = textEditProcesses();
    const client = scriptedClient([
      desktopWithTitles("desktop-1", [{ ref: "preexisting", title: "notes.txt" }]),
      desktopWithTitles("desktop-2", [
        { ref: "preexisting", title: "notes.txt" },
        { ref: "owned", title: "owned.txt" },
      ]),
    ], calls);

    await expect(ownFreshTextEditWindow(client, "/private/owned.txt", processes))
      .resolves.toEqual({ windowRef: "owned", pid: 73 });
    expect(processes.openDocument).toHaveBeenCalledExactlyOnceWith("/private/owned.txt");
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls)).not.toContain("set_value");
  });

  it("selects the exact owned title even when another window appears concurrently", async () => {
    const processes = textEditProcesses();
    const client = scriptedClient([
      desktopWithTitles("desktop-1", [{ ref: "preexisting", title: "notes.txt" }]),
      desktopWithTitles("desktop-2", [
        { ref: "preexisting", title: "notes.txt" },
        { ref: "unrelated", title: "other.txt" },
        { ref: "owned", title: "owned.txt" },
      ]),
    ], []);

    await expect(ownFreshTextEditWindow(client, "/private/owned.txt", processes))
      .resolves.toEqual({ windowRef: "owned", pid: 73 });
    expect(processes.openDocument).toHaveBeenCalledExactlyOnceWith("/private/owned.txt");
  });

  it("fails closed before opening when the supposedly unique title already exists", async () => {
    const processes = textEditProcesses();
    const client = scriptedClient([
      desktopWithTitles("desktop-1", [{ ref: "preexisting", title: "owned.txt" }]),
    ], []);

    await expect(ownFreshTextEditWindow(client, "/private/owned.txt", processes))
      .rejects.toThrow("textedit_unavailable");
    expect(processes.openDocument).not.toHaveBeenCalled();
    expect(processes.terminate).not.toHaveBeenCalled();
  });

  it("closes only the owned ref and proves it disappeared without inventing an empty AXValue", async () => {
    const calls: Array<Readonly<{ name: string; arguments?: Record<string, unknown> }>> = [];
    const client = scriptedClient([
      windowState("fresh-before-clear", "owned", true),
      acted("after-close"),
      desktop("desktop-after", ["preexisting"]),
    ], calls);

    await expect(cleanupOwnedTextEdit(
      client,
      "owned",
      windowState("before-clear", "owned", true),
    )).resolves.toBeUndefined();
    expect(calls[1]?.arguments).toMatchObject({
      snapshot_id: "fresh-before-clear",
      action: { type: "invoke_menu", path: ["File", "Close"] },
    });
    expect(calls[2]?.arguments).toMatchObject({
      discover: { query: "com.apple.TextEdit" },
    });
    expect(calls[1]?.arguments?.snapshot_id).toBe("fresh-before-clear");
    expect(JSON.stringify(calls)).not.toContain("set_value");
  });

  it("treats an absent TextEdit app after close as successful cleanup", async () => {
    const calls: Array<Readonly<{ name: string; arguments?: Record<string, unknown> }>> = [];
    const client = scriptedClient([
      windowState("fresh-before-close", "owned", true),
      acted("after-close"),
      result({ snapshot_id: "desktop-after", apps: [], windows: [] }, true),
    ], calls);

    await expect(cleanupOwnedTextEdit(
      client,
      "owned",
      windowState("before-close", "owned", true),
    )).resolves.toBeUndefined();
  });

  it("polls the owned ref until an asynchronous close transition finishes", async () => {
    const calls: Array<Readonly<{ name: string; arguments?: Record<string, unknown> }>> = [];
    const client = scriptedClient([
      windowState("fresh-before-close", "owned", true),
      acted("after-close"),
      desktop("desktop-closing", ["owned"]),
      desktop("desktop-after", []),
    ], calls);

    await expect(cleanupOwnedTextEdit(
      client,
      "owned",
      windowState("before-close", "owned", true),
    )).resolves.toBeUndefined();
    expect(calls.filter((call) => call.arguments?.discover !== undefined)).toHaveLength(2);
  });

  it("fails cleanup when the owned ref survives close", async () => {
    const calls: Array<Readonly<{ name: string; arguments?: Record<string, unknown> }>> = [];
    const client = scriptedClient([
      windowState("fresh-before-clear", "owned", true),
      acted("after-close"),
      desktop("desktop-after", ["preexisting", "owned"]),
      windowState("sheet-without-discard", "owned"),
    ], calls);

    await expect(cleanupOwnedTextEdit(
      client,
      "owned",
      windowState("before-clear", "owned", true),
      0,
    )).rejects.toThrow("verification_failed");
  });

  it("uses the localized exact-window menu path when the AX menu is Chinese", async () => {
    const calls: Array<Readonly<{ name: string; arguments?: Record<string, unknown> }>> = [];
    const client = scriptedClient([
      windowState("fresh-before-close", "owned", true, true),
      acted("after-close"),
      desktop("desktop-after", ["preexisting"]),
    ], calls);

    await expect(cleanupOwnedTextEdit(
      client,
      "owned",
      windowState("old", "owned", true),
      0,
    )).resolves.toBeUndefined();
    expect(calls[1]?.arguments).toMatchObject({
      action: { type: "invoke_menu", path: ["文件", "关闭"] },
    });
  });

  it("saves its uniquely titled temporary document before closing it", async () => {
    const calls: Array<Readonly<{ name: string; arguments?: Record<string, unknown> }>> = [];
    const client = scriptedClient([
      windowState("fresh-before-save", "owned", true),
      acted("after-save"),
      windowState("fresh-before-close", "owned", true),
      acted("after-close"),
      desktop("desktop-after", ["preexisting"]),
    ], calls);

    await expect(cleanupOwnedTextEdit(
      client,
      "owned",
      windowState("old", "owned", true),
      0,
      "ucu-owned.txt",
    )).resolves.toBeUndefined();
    expect(calls[1]?.arguments).toMatchObject({
      action: { type: "invoke_menu", path: ["File", "Save"] },
    });
    expect(calls[3]?.arguments).toMatchObject({
      action: { type: "invoke_menu", path: ["File", "Close"] },
    });
  });
});

describe("Calculator cleanup", () => {
  it("selects the one visible Calculator window among hidden Cua windows", () => {
    expect(selectExactVisibleWindow([
      { window_ref: "hidden-1", is_on_screen: false },
      { window_ref: "visible", is_on_screen: true, minimized: false },
      { window_ref: "hidden-2", is_on_screen: false },
      { window_ref: "minimized", is_on_screen: true, minimized: true },
    ])?.window_ref).toBe("visible");
  });

  it("refuses ambiguous visible Calculator windows", () => {
    expect(selectExactVisibleWindow([
      { window_ref: "visible-1", is_on_screen: true },
      { window_ref: "visible-2", is_on_screen: true },
    ])).toBeUndefined();
  });

  it("observes the exact visible ref without launching when Cua returns hidden windows", async () => {
    const calls: Array<Readonly<{ name: string; arguments?: Record<string, unknown> }>> = [];
    const client = scriptedClient([calculatorState("window-state", "visible")], calls);
    const windows = [
      { window_ref: "hidden-1", app_ref: "app_calculator", is_on_screen: false },
      { window_ref: "visible", app_ref: "app_calculator", is_on_screen: true },
      { window_ref: "hidden-2", app_ref: "app_calculator", is_on_screen: false },
    ];

    await expect(ensureCalculatorWindow(client, {
      result: result({ snapshot_id: "desktop" }, true),
      app: { app_ref: "app_calculator" },
      appRef: "app_calculator",
      windows,
      windowRefs: new Set(windows.map((window) => window.window_ref)),
    })).resolves.toMatchObject({ windowRef: "visible" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.arguments).toMatchObject({
      target: { kind: "window", window_ref: "visible" },
    });
    expect(JSON.stringify(calls)).not.toContain("launch_app");
  });

  it("rejects two visible refs before any Calculator mutation", async () => {
    const calls: Array<Readonly<{ name: string; arguments?: Record<string, unknown> }>> = [];
    const client = scriptedClient([], calls);
    const windows = [
      { window_ref: "visible-1", app_ref: "app_calculator", is_on_screen: true },
      { window_ref: "visible-2", app_ref: "app_calculator", is_on_screen: true },
    ];

    await expect(ensureCalculatorWindow(client, {
      result: result({ snapshot_id: "desktop" }, true),
      app: { app_ref: "app_calculator" },
      appRef: "app_calculator",
      windows,
      windowRefs: new Set(windows.map((window) => window.window_ref)),
    })).rejects.toThrow("calculator_unavailable");
    expect(calls).toEqual([]);
  });

  it("re-observes the exact operated window before AC after an intermediate action failure", async () => {
    const calls: Array<Readonly<{ name: string; arguments?: Record<string, unknown> }>> = [];
    const client = scriptedClient([
      calculatorState("fresh-cleanup", "calculator-owned"),
      calculatorActed("after-clear", "calculator-owned"),
      calculatorState("verified-zero", "calculator-owned"),
    ], calls);

    await expect(restoreCalculator(
      client,
      true,
      "calculator-owned",
      calculatorState("verified-703", "calculator-owned"),
      async (_result, expected) => {
        expect(expected).toBe("703");
        return false;
      },
    )).resolves.toBeUndefined();
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({
      name: "computer_observe",
      arguments: {
        target: { kind: "window", window_ref: "calculator-owned" },
      },
    });
    expect(calls[1]).toMatchObject({
      name: "computer_act",
      arguments: {
        snapshot_id: "fresh-cleanup",
        action: { type: "click", element_ref: "clear_fresh-cleanup" },
      },
    });
    expect(calls[2]).toMatchObject({
      name: "computer_observe",
      arguments: {
        target: { kind: "window", window_ref: "calculator-owned" },
      },
    });
  });

  it("fails restoration when the calibrated 703 remains visible after AC", async () => {
    const calls: Array<Readonly<{ name: string; arguments?: Record<string, unknown> }>> = [];
    const client = scriptedClient([
      calculatorState("fresh-cleanup", "calculator-owned"),
      calculatorActed("after-clear", "calculator-owned"),
      calculatorState("still-703", "calculator-owned"),
      calculatorActed("after-second-clear", "calculator-owned"),
      calculatorState("still-703-again", "calculator-owned"),
    ], calls);

    await expect(restoreCalculator(
      client,
      true,
      "calculator-owned",
      calculatorState("verified-703", "calculator-owned"),
      async () => true,
    )).rejects.toThrow("verification_failed");
  });

  it("retries idempotent AC once when the calibrated result survives the first clear", async () => {
    const calls: Array<Readonly<{ name: string; arguments?: Record<string, unknown> }>> = [];
    const client = scriptedClient([
      calculatorState("fresh-cleanup", "calculator-owned"),
      calculatorActed("after-clear", "calculator-owned"),
      calculatorState("still-703", "calculator-owned"),
      calculatorActed("after-second-clear", "calculator-owned"),
      calculatorState("cleared", "calculator-owned"),
    ], calls);
    let checks = 0;

    await expect(restoreCalculator(
      client,
      true,
      "calculator-owned",
      calculatorState("verified-703", "calculator-owned"),
      async () => (checks += 1) === 1,
    )).resolves.toBeUndefined();
    expect(calls.filter((call) =>
      (call.arguments?.action as { type?: unknown } | undefined)?.type === "click"))
      .toHaveLength(2);
  });

  it("still cleans the owned TextEdit window when Calculator restoration fails", async () => {
    const calls: Array<Readonly<{ name: string; arguments?: Record<string, unknown> }>> = [];
    const calculatorObserveFailure: CallToolResult = {
      isError: true,
      content: [{ type: "text", text: "window gone" }],
      structuredContent: { code: "window_not_found" },
    };
    const textCurrent = windowState("text-before-clear", "text-owned", true);
    const client = scriptedClient([
      calculatorObserveFailure,
      windowState("fresh-text-cleanup", "text-owned", true),
      acted("text-after-close", "text-owned"),
      desktop("desktop-after", ["preexisting"]),
    ], calls);

    await expect(cleanupSmokeResources(client, {
      calculatorTouched: true,
      calculatorWindowRef: "calculator-owned",
      calculatorCurrent: calculatorState("verified-703", "calculator-owned"),
      ownedTextEditWindow: "text-owned",
      textEditCurrent: textCurrent,
    })).resolves.toBe(false);
    expect(calls.some((call) => call.arguments?.action !== undefined &&
      (call.arguments.action as { type?: unknown }).type === "set_value")).toBe(false);
    expect(calls.some((call) => call.arguments?.action !== undefined &&
      (call.arguments.action as { type?: unknown }).type === "invoke_menu")).toBe(true);
  });

  it("terminates the proven TextEdit PID even when exact-window cleanup fails", async () => {
    const processes = textEditProcesses();
    const client = scriptedClient([
      windowState("fresh-before-close", "text-owned", true),
      acted("after-close", "text-owned"),
      desktop("still-open", ["text-owned"]),
      desktop("still-open-again", ["text-owned"]),
    ], []);

    await expect(cleanupSmokeResources(client, {
      calculatorTouched: false,
      calculatorWindowRef: undefined,
      ownedTextEditWindow: "text-owned",
      ownedTextEditPid: 73,
      textEditCurrent: windowState("old", "text-owned", true),
    }, processes)).resolves.toBe(false);
    expect(processes.terminate).toHaveBeenCalledExactlyOnceWith(73);
    expect(processes.terminate).not.toHaveBeenCalledWith(41);
  });

  it("dismisses a save sheet only on the exact owned TextEdit ref", async () => {
    const calls: Array<Readonly<{ name: string; arguments?: Record<string, unknown> }>> = [];
    const client = scriptedClient([
      windowState("fresh-text-cleanup", "text-owned", true),
      acted("text-after-close", "text-owned"),
      desktop("desktop-sheet", ["preexisting", "text-owned"]),
      saveSheet("sheet", "text-owned"),
      acted("discarded", "text-owned"),
      desktop("desktop-after", ["preexisting"]),
    ], calls);

    await expect(cleanupOwnedTextEdit(
      client,
      "text-owned",
      result({ isError: true, target: { kind: "window", window_ref: "text-owned" } }),
      0,
    )).resolves.toBeUndefined();
    expect(calls[0]?.arguments).toMatchObject({
      target: { kind: "window", window_ref: "text-owned" },
    });
    expect(calls[4]?.arguments).toMatchObject({
      action: { type: "click", element_ref: "discard_sheet" },
    });
    expect(JSON.stringify(calls)).not.toContain("preexisting\",\"action");
  });
});

describe("real app smoke isolation", () => {
  it("reclaims the owned TextEdit PID after later smoke and window-cleanup failures", async () => {
    const calls: Array<Readonly<{ name: string; arguments?: Record<string, unknown> }>> = [];
    const processes = textEditProcesses([[41], [41, 73]]);
    let titleDiscoveries = 0;
    const client = {
      callTool: async (request: Readonly<{ name: string; arguments?: Record<string, unknown> }>) => {
        calls.push(request);
        const discover = request.arguments?.discover as { query?: string } | undefined;
        if (discover?.query === "com.apple.calculator") {
          return result({ snapshot_id: "calculator-missing", apps: [], windows: [] }, true);
        }
        if (typeof discover?.query === "string") {
          titleDiscoveries += 1;
          return titleDiscoveries === 1
            ? desktopWithTitles("before-open", [])
            : desktopWithTitles("after-open", [{ ref: "owned", title: discover.query }]);
        }
        return {
          isError: true,
          content: [{ type: "text", text: "controlled window failure" }],
        } satisfies CallToolResult;
      },
    } as unknown as Client;

    await expect(runRealAppSmoke(client, processes)).resolves.toMatchObject({
      textedit_unique_value: false,
      textedit_single_write: false,
      cleanup_failed: true,
    });
    expect(processes.terminate).toHaveBeenCalledExactlyOnceWith(73);
    expect(processes.terminate).not.toHaveBeenCalledWith(41);
    expect(calls.some((call) => call.arguments?.target !== undefined)).toBe(true);
  });

  it("retries the same proven PID and reports cleanup failure when termination cannot complete", async () => {
    const unavailable = result({ snapshot_id: "desktop", apps: [], windows: [] }, true);
    const client = scriptedClient([unavailable, unavailable], []);
    const processes = textEditProcesses([[41], [41, 73]]);
    processes.openDocument.mockRejectedValueOnce(new Error("controlled open failure"));
    processes.terminate.mockRejectedValue(new Error("controlled termination failure"));

    await expect(runRealAppSmoke(client, processes)).resolves.toMatchObject({
      textedit_unique_value: false,
      textedit_single_write: false,
      cleanup_failed: true,
    });
    expect(processes.terminate).toHaveBeenCalledTimes(2);
    expect(processes.terminate).toHaveBeenNthCalledWith(1, 73);
    expect(processes.terminate).toHaveBeenNthCalledWith(2, 73);
    expect(processes.terminate).not.toHaveBeenCalledWith(41);
  });

  it("still attempts TextEdit discovery after Calculator is unavailable", async () => {
    const calls: Array<Readonly<{ name: string; arguments?: Record<string, unknown> }>> = [];
    const unavailable = result({ snapshot_id: "desktop", apps: [], windows: [] }, true);
    const client = scriptedClient([unavailable, unavailable], calls);
    const processes = textEditProcesses([[41], [41, 73]]);
    processes.openDocument.mockRejectedValueOnce(new Error("controlled_open_failure"));

    await expect(runRealAppSmoke(client, processes)).resolves.toMatchObject({
      calculator_703: false,
      textedit_unique_value: false,
      textedit_single_write: false,
      error_code: "calculator_unavailable",
    });
    expect(calls[0]?.arguments?.discover).toEqual({
      apps: true,
      windows: true,
      query: "com.apple.calculator",
    });
    expect(calls[1]?.arguments?.discover).toMatchObject({ windows: true });
    expect(calls[1]?.arguments?.discover).not.toHaveProperty("apps");
    expect((calls[1]?.arguments?.discover as { query?: unknown }).query)
      .toMatch(/^ucu-[0-9a-f-]+\.txt$/);
    expect(processes.openDocument).toHaveBeenCalledOnce();
    expect(processes.terminate).toHaveBeenCalledExactlyOnceWith(73);
  });
});
