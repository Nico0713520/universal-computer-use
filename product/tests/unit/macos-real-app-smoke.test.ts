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

describe("TextEdit owned-window smoke", () => {
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
    const openDocument = vi.fn(async () => undefined);
    const client = scriptedClient([
      desktop("desktop-1", []),
      desktop("desktop-2", ["owned"]),
    ], calls);

    await expect(ownFreshTextEditWindow(client, "/private/owned.txt", openDocument))
      .resolves.toBe("owned");
    expect(calls.map((call) => call.name)).toEqual([
      "computer_observe",
      "computer_observe",
    ]);
    expect(openDocument).toHaveBeenCalledExactlyOnceWith("/private/owned.txt");
    expect(JSON.stringify(calls)).not.toContain("set_value");
  });

  it("opens an owned document beside existing windows and proves exactly one new ref", async () => {
    const calls: Array<Readonly<{ name: string; arguments?: Record<string, unknown> }>> = [];
    const openDocument = vi.fn(async () => undefined);
    const client = scriptedClient([
      desktop("desktop-1", ["preexisting"]),
      desktop("desktop-2", ["preexisting", "owned"]),
    ], calls);

    await expect(ownFreshTextEditWindow(client, "/private/owned.txt", openDocument))
      .resolves.toBe("owned");
    expect(openDocument).toHaveBeenCalledExactlyOnceWith("/private/owned.txt");
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls)).not.toContain("set_value");
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
  it("still attempts TextEdit discovery after Calculator is unavailable", async () => {
    const calls: Array<Readonly<{ name: string; arguments?: Record<string, unknown> }>> = [];
    const unavailable = result({ snapshot_id: "desktop", apps: [], windows: [] }, true);
    const client = scriptedClient([unavailable, unavailable], calls);

    await expect(runRealAppSmoke(client)).resolves.toMatchObject({
      calculator_703: false,
      textedit_unique_value: false,
      textedit_single_write: false,
      error_code: "calculator_unavailable",
    });
    expect(calls.map((call) => call.arguments?.discover)).toEqual([
      { apps: true, windows: true, query: "com.apple.calculator" },
      { apps: true, windows: true, query: "com.apple.TextEdit" },
    ]);
  });
});
