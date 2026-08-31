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

  it("records one oracle effect for the canvas right-click context menu event", async () => {
    const source = await readFile(fixtureUrl, "utf8");
    const listener = source.match(
      /byId\("cursor-ab-target"\)\.addEventListener\("([^"]+)", \(event\) => \{([\s\S]*?)\n    \}\);/,
    );
    const body = listener?.[2] ?? "";

    expect(listener?.[1]).toBe("contextmenu");
    expect(body).toContain("event.preventDefault();");
    expect(body.match(/record\("canvas_click"/g)).toHaveLength(1);
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
