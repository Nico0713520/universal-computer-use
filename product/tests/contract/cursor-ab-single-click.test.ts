import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const fixtureUrl = new URL("../fixtures/desktop-harness/index.html", import.meta.url);
const specUrl = new URL("../e2e/development/macos-cursor-ab.spec.ts", import.meta.url);

describe("Cursor A/B synthetic-event route contract", () => {
  it("asks Cua for one routed right click that bypasses the left-click AX shortcut", async () => {
    const source = await readFile(specUrl, "utf8");
    const call = source.match(/sdk\.callTool\("click", JSON\.stringify\(\{([\s\S]*?)\}\)\);/);

    expect(call?.[1]).toContain('button: "right"');
    expect(call?.[1]).not.toContain('button: "left"');
    expect(call?.[1]).not.toContain('button: "middle"');
    expect(call?.[1]).toContain("count: 1");
    expect(call?.[1]).toContain('delivery_mode: "background"');
    expect(call?.[1]).not.toContain("modifier:");
    expect(source).toContain('if (execution.route !== "synthetic_events")');
  });

  it("records one oracle effect only after a paired canvas right-button down and up", async () => {
    const source = await readFile(fixtureUrl, "utf8");
    expect(source).toContain('addEventListener("mousedown", (event) => {');
    expect(source).toContain('if (event.button === 2) cursorAbRightDown = true;');
    expect(source).toContain('addEventListener("mouseup", (event) => {');
    expect(source).toContain('if (event.button !== 2 || !cursorAbRightDown) return;');
    expect(source).toContain('cursorAbRightDown = false;');
    expect(source.match(/record\("canvas_click"/g)).toHaveLength(1);
    expect(source).toContain('addEventListener("contextmenu", (event) => event.preventDefault())');
    expect(source).not.toContain('byId("cursor-ab-target").addEventListener("click"');
    expect(source).not.toContain('byId("cursor-ab-target").addEventListener("dblclick"');
    expect(source).not.toContain('byId("cursor-ab-target").addEventListener("auxclick"');
  });

  it("fails fast on the first missing exactly-once effect", async () => {
    const source = await readFile(specUrl, "utf8");

    expect(source).toContain('throw new Error("cursor_ab_effect_mismatch")');
    expect(source).toContain("correct: true");
    expect(source).not.toContain("correct: after.canvas_clicks === before.canvas_clicks + 1");
  });
});
