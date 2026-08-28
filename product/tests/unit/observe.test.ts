import { describe, expect, it } from "vitest";

import { ComputerUseError } from "../../src/errors.js";
import { fixtureRuntime } from "../helpers/fake-engine.js";

describe("ComputerUseRuntime.observe", () => {
  it("returns one current snapshot with the exact engine PNG", async () => {
    const { runtime, engine } = fixtureRuntime({
      width: 100,
      height: 80,
      dataBase64: "cG5n",
    });

    const first = await runtime.observe();
    const second = await runtime.observe();

    expect(first.image?.dataBase64).toBe("cG5n");
    if (!("screenshot" in second.structured)) throw new Error("expected visual observation");
    expect(second.structured.screenshot).toEqual({
      mime_type: "image/png",
      width: 100,
      height: 80,
    });
    expect(second.structured.snapshot_id).not.toBe(first.structured.snapshot_id);
    await expect(
      runtime.act({
        snapshot_id: first.structured.snapshot_id,
        action: { type: "wait", ms: 0 },
      }),
    ).rejects.toMatchObject({ code: "stale_snapshot" });
    expect(engine.observations).toBe(2);
  });

  it("leaves no snapshot when capture fails", async () => {
    const { runtime } = fixtureRuntime({
      observationSequence: ["success", "capture_failed"],
    });
    const first = await runtime.observe();

    await expect(runtime.observe()).rejects.toMatchObject({ code: "capture_failed" });
    await expect(
      runtime.act({
        snapshot_id: first.structured.snapshot_id,
        action: { type: "wait", ms: 0 },
      }),
    ).rejects.toMatchObject({ code: "stale_snapshot" });
  });

  it("does not retry a public observation", async () => {
    const { runtime, engine } = fixtureRuntime({
      observationSequence: ["capture_failed", "success"],
    });

    await expect(runtime.observe()).rejects.toBeInstanceOf(ComputerUseError);
    expect(engine.observations).toBe(1);
  });
});
