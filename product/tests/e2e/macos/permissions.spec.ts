import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, describe, expect, it } from "vitest";

import { handleObserve } from "../../../src/mcp/handlers.js";
import { ComputerUseError } from "../../../src/errors.js";
import { fixtureRuntime } from "../../helpers/fake-engine.js";

const execFileAsync = promisify(execFile);
const REAL_E2E = process.env.CUA_E2E === "1";
const MCP_SCRIPT = resolve("dist/mcp/main.js");
const EVIDENCE_SCHEMA = resolve("tests/e2e/macos/evidence.schema.json");

async function connectClient(name: string): Promise<{
  client: Client;
  transport: StdioClientTransport;
}> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_SCRIPT],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const client = new Client({ name, version: "1.0.0" });
  try {
    await client.connect(transport);
  } catch (error) {
    await transport.close().catch(() => undefined);
    throw error;
  }
  return { client, transport };
}

describe("controlled permission error contract (not real TCC evidence)", () => {
  it.each(["Screen Recording", "Accessibility"])(
    "maps a controlled missing %s grant to permission_required",
    async (permission) => {
      const denied = new ComputerUseError(
        "permission_required",
        `controlled missing ${permission} fixture`,
        "grant_permission",
        false,
      );
      const { runtime, engine } = fixtureRuntime({ observationSequence: [denied] });

      await expect(handleObserve(runtime, {})).resolves.toMatchObject({
        isError: true,
        structuredContent: {
          code: "permission_required",
          recovery: "grant_permission",
          retryable: false,
        },
      });
      expect(engine.observations).toBe(1);
      await runtime.close();
    },
  );

  it("keeps the macOS evidence contract strict and excludes sensitive payload fields", async () => {
    const schema = JSON.parse(await readFile(EVIDENCE_SCHEMA, "utf8")) as Record<string, unknown>;
    expect(schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        release_eligible_at_test: { const: false },
      },
      allOf: [
        {
          if: { properties: { mode: { const: "candidate" } } },
          then: {
            properties: {
              results: {
                properties: {
                  repeat_requested: { minimum: 20 },
                  repeat_completed: { minimum: 20 },
                },
              },
            },
          },
        },
      ],
    });
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    for (const property of Object.values(properties)) {
      if (property.type === "object") expect(property.additionalProperties).toBe(false);
    }
    const serialized = JSON.stringify(schema).toLowerCase();
    for (const forbidden of ["screenshot_data", "typed_text", "prompt", "environment", "clipboard", "keys_pressed"]) {
      expect(serialized).not.toContain(`\"${forbidden}\"`);
    }
  });
});

let restartAppPath: string | undefined;

describe.skipIf(!REAL_E2E)("real macOS Runtime restart snapshot boundary", () => {
  afterAll(async () => {
    if (restartAppPath !== undefined) {
      await execFileAsync("/usr/bin/open", [restartAppPath], { timeout: 10_000 }).catch(() => undefined);
    }
  });

  it("rejects a pre-restart snapshot in a new Runtime-backed MCP process", async () => {
    if (process.platform !== "darwin") throw new Error("macOS lane requires Darwin");
    if (process.env.CUA_MACOS_PREFLIGHT !== "passed") {
      throw new Error("run tests/e2e/macos/run.sh; direct Vitest invocation is not evidence");
    }
    const executable = process.env.CUA_E2E_CUA_EXECUTABLE;
    restartAppPath = process.env.CUA_E2E_CUA_APP_PATH;
    if (executable === undefined || restartAppPath === undefined) {
      throw new Error("runner did not provide the reviewed Cua application paths");
    }

    const first = await connectClient("macos-before-runtime-restart");
    const observed = CallToolResultSchema.parse(
      await first.client.callTool({ name: "computer_observe", arguments: {} }),
    );
    expect(observed.isError).not.toBe(true);
    const oldSnapshot = String(observed.structuredContent?.snapshot_id);
    expect(oldSnapshot).toMatch(/^snap_/);
    await first.client.close();
    await first.transport.close().catch(() => undefined);

    await execFileAsync(executable, ["stop"], { timeout: 15_000 });
    await execFileAsync("/usr/bin/open", [restartAppPath], { timeout: 10_000 });

    let second: Awaited<ReturnType<typeof connectClient>> | undefined;
    const deadline = Date.now() + 20_000;
    while (second === undefined && Date.now() < deadline) {
      try {
        second = await connectClient("macos-after-runtime-restart");
      } catch {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
      }
    }
    if (second === undefined) throw new Error("Cua Runtime did not restart within 20 seconds");
    try {
      const stale = CallToolResultSchema.parse(
        await second.client.callTool({
          name: "computer_act",
          arguments: {
            snapshot_id: oldSnapshot,
            action: { type: "move", x: 0, y: 0 },
          },
        }),
      );
      expect(stale).toMatchObject({
        isError: true,
        structuredContent: { code: "stale_snapshot" },
      });
    } finally {
      await second.client.close().catch(() => undefined);
      await second.transport.close().catch(() => undefined);
    }
  }, 60_000);
});
