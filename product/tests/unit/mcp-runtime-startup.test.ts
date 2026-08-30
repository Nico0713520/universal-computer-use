import { describe, expect, it, vi } from "vitest";

import { CuaEngine } from "../../src/engine/cua.js";
import { loadEngineLock } from "../../src/engine/lock.js";
import { runDefaultServer } from "../../src/mcp/main.js";
import { FakeEngine } from "../helpers/fake-engine.js";

describe("direct MCP Runtime startup", () => {
  it("loads the lock and connects before exposing the server", async () => {
    const events: string[] = [];
    const engine = new FakeEngine();

    await runDefaultServer({
      async loadLock() {
        events.push("lock");
        return loadEngineLock();
      },
      async connectEngine() {
        events.push("connect");
        return engine as unknown as CuaEngine;
      },
      async runServer(runtime) {
        events.push("server");
        await runtime.close();
      },
    });

    expect(events).toEqual(["lock", "connect", "server"]);
  });

  it("does not expose tools when the startup connection fails", async () => {
    const runServer = vi.fn();

    await expect(runDefaultServer({
      loadLock: loadEngineLock,
      async connectEngine() {
        throw new Error("fixture startup failed");
      },
      runServer,
    })).rejects.toThrow("fixture startup failed");
    expect(runServer).not.toHaveBeenCalled();
  });
});
