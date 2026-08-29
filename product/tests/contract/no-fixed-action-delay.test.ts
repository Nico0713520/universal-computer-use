import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  scanDelayCalls,
  scanProductionDelayCalls,
} from "../helpers/fixed-delay-scan.js";

describe("no fixed action delay contract", () => {
  it("finds direct, aliased, member, and Promise-wrapped fixed delays", () => {
    const findings = scanDelayCalls([{
      path: "src/core/poisoned.ts",
      text: [
        "const POST_DELAY = 3_000;",
        "async function run() {",
        "  await sleep(POST_DELAY);",
        "  const pause = sleep;",
        "  await pause(POST_DELAY);",
        "  await timersPromises.setTimeout(POST_DELAY);",
        "  await new Promise((resolve) => setTimeout(resolve, POST_DELAY));",
        "}",
      ].join("\n"),
    }]);

    expect(findings).toEqual([
      { path: "src/core/poisoned.ts", line: 3, callee: "sleep" },
      { path: "src/core/poisoned.ts", line: 5, callee: "sleep" },
      { path: "src/core/poisoned.ts", line: 6, callee: "setTimeout" },
      { path: "src/core/poisoned.ts", line: 7, callee: "setTimeout" },
    ]);
  });

  it("allows only the six exact timeout and bounded-verification tuples", () => {
    const sources = [
      {
        path: "src/core/observe.ts",
        text: "function withTimeout(timeoutMs: number) { setTimeout(() => undefined, timeoutMs); }",
      },
      {
        path: "src/core/verifier.ts",
        text: [
          "function cancellableSleep(ms: number) { setTimeout(() => undefined, ms); }",
          "async function verifyWindowState(delay: number) { await sleep(delay); }",
        ].join("\n"),
      },
      {
        path: "src/engine/cua.ts",
        text: "function cancellableWait(waitMs: number) { setTimeout(() => undefined, waitMs); }",
      },
      {
        path: "src/cli/process-runner.ts",
        text: [
          "const TERMINATION_GRACE_MS = 250;",
          "const runner = {",
          "  run(options: { timeoutMs: number }) {",
          "    setTimeout(() => undefined, options.timeoutMs);",
          "    setTimeout(() => undefined, TERMINATION_GRACE_MS);",
          "  },",
          "};",
        ].join("\n"),
      },
    ];

    expect(scanDelayCalls(sources)).toEqual([]);
    expect(scanDelayCalls([{
      path: "src/core/observe.ts",
      text: "function withTimeout(timeoutMs: number) { setTimeout(() => undefined, 3000); }",
    }])).toEqual([
      { path: "src/core/observe.ts", line: 1, callee: "setTimeout" },
    ]);
  });

  it("finds no generic fixed delay in production sources", async () => {
    const productRoot = fileURLToPath(new URL("../..", import.meta.url));

    await expect(scanProductionDelayCalls(productRoot)).resolves.toEqual([]);
  });
});
