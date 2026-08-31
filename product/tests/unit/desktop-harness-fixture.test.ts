import { afterEach, describe, expect, it } from "vitest";

import { startDesktopHarness } from "../fixtures/desktop-harness/server.mjs";

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
  await closeHarness?.();
  closeHarness = undefined;
});

async function post(url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
  return await response.json() as Record<string, unknown>;
}

describe("desktop harness cursor A/B target", () => {
  it("publishes a pixel-only center and increments only inside its fixed rectangle", async () => {
    const harness = await startDesktopHarness();
    closeHarness = harness.close;
    const layout = await fetch(`${harness.url}/layout`).then(async (response) => response.json()) as {
      controls: Record<string, { x: number; y: number }>;
    };

    expect(layout.controls["cursor-ab-target"]).toEqual({ x: 640, y: 656 });
    const inside = await post(`${harness.url}/event`, { kind: "canvas_click", x: 640, y: 656 });
    const outside = await post(`${harness.url}/event`, { kind: "canvas_click", x: 559, y: 656 });

    expect(inside.canvas_clicks).toBe(1);
    expect(outside.canvas_clicks).toBe(1);
  });
});
