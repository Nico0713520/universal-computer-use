# Universal Computer Use v0.2.2 macOS Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing two-tool macOS computer-use loop faster for confirmed semantic actions while preserving single-use snapshots, pixel-coordinate proof, visual recovery, and truthful real-machine evidence.

**Architecture:** Keep Cua Driver 0.22.2 behind the unchanged `EnginePort`. Add one pure observation-policy module that chooses semantic or visual post-action state, expose only an optional `next_observation` preference on `computer_act`, and keep all native execution inside the current serialized runtime. Instrument only UCU-owned timing boundaries, then prove p50/p95 performance through the public stdio MCP and an independent fixture oracle.

**Tech Stack:** TypeScript 5.7, Node.js 22.19+, Vitest 3.2, Zod 4.4, Ajv 8.20 (`ajv/dist/2020.js`), MCP SDK 1.30, Cua Driver 0.22.2, JSON Schema 2020-12, isolated Chrome app window on macOS.

## Global Constraints

- Public product version is `0.2.2`; public protocol version is `1.2.0`.
- The public MCP tool inventory remains exactly `computer_observe` and `computer_act`.
- Cua Driver remains exactly `0.22.2`; do not modify `EnginePort`, the Cua adapter, `engine.lock.json`, or either platform's eligibility flags.
- A snapshot is consumed once immediately before mutation; no batch actions, automatic action retry, or old-snapshot reuse.
- No fixed post-action delay. Allowed waits are explicit `wait(ms)`, bounded verification polling at 50/100/200/400/500 ms, engine timeouts, and upstream action-specific waits.
- Semantic post-action state is allowed only for a safe element/menu/unaddressed-keyboard route with executed status, `accessibility|system_api`, `background|not_applicable`, no escalation, and a confirmed effect or resolved expectation.
- Coordinate, foreground, unknown-delivery, failed, refused, wait, unconfirmed, and unsafe-route paths use visual recovery.
- A semantic snapshot cannot execute any coordinate-addressed action; rejection happens before `EnginePort.execute` and does not invent a pixel frame.
- Metadata never includes screenshots, text, keys, labels, values, titles, paths, PIDs, native IDs, raw refs, tokens, prompts, environment maps, or stack traces.
- Performance qualification uses 5 warm-ups plus 30 measured samples, external monotonic MCP wall time, nearest-rank p50/p95, independent reset/oracles, and no discarded failures.
- Windows remains desktop-only in this milestone; macOS Beta promotion, installer work, named-host qualification, Browser/CDP, multi-display, and a native UCU runtime remain out of scope.

---

## Task 1: Build the pure safety and observation-policy core

**Files:**
- Create: `product/src/core/observation-policy.ts`
- Create: `product/tests/unit/observation-policy.test.ts`
- Modify: `product/src/core/act.ts`
- Modify: `product/tests/unit/act.test.ts`

**Interfaces:**
- Consumes: `SnapshotObserveOptions`, `EngineWindowAction`, `EngineExecution`, and `VerificationResult`.
- Produces: `decideInitialObservation(input): InitialObservationDecision` and `decideFinalObservation(input): FinalObservationDecision` for Task 2.
- Produces: one complete pre-engine coordinate guard covering every coordinate-bearing action.

- [ ] **Step 1: Write failing table-driven policy tests**

Create `tests/unit/observation-policy.test.ts` with the exact exported types below and cases for explicit visual, inherited visual, confirmed semantic, expectation-assisted semantic, coordinate recovery, unsafe route, foreground/unknown delivery, escalation, refused/failed, wait, and final verification recovery:

```ts
import { describe, expect, it } from "vitest";

import {
  decideFinalObservation,
  decideInitialObservation,
} from "../../src/core/observation-policy.js";
import type { EngineExecution, EngineWindowAction } from "../../src/engine/port.js";

const OPTIONS = Object.freeze({
  includeScreenshot: true,
  query: "button",
  maxElements: 80,
  maxDepth: 8,
});
const ELEMENT_CLICK: EngineWindowAction = {
  type: "click",
  address: { kind: "element", token: "private-token" },
};
const CONFIRMED: EngineExecution = {
  status: "executed",
  effect: "confirmed",
  route: "accessibility",
  delivery: "background",
};

describe("post-action observation policy", () => {
  it("keeps a confirmed background element action semantic", () => {
    expect(decideInitialObservation({
      consumedOptions: OPTIONS,
      requestedMode: "semantic",
      action: ELEMENT_CLICK,
      execution: CONFIRMED,
      hasResolvedExpectation: false,
    })).toEqual({
      options: { ...OPTIONS, includeScreenshot: false },
      observationMode: "semantic",
      semanticCandidate: true,
      hasResolvedExpectation: false,
    });
  });

  it.each([
    [{ type: "click", address: { kind: "coordinate", x: 20, y: 30 } }, CONFIRMED],
    [ELEMENT_CLICK, { ...CONFIRMED, route: "synthetic_events" }],
    [ELEMENT_CLICK, { ...CONFIRMED, delivery: "foreground" }],
    [ELEMENT_CLICK, { ...CONFIRMED, delivery: "unknown" }],
    [ELEMENT_CLICK, { ...CONFIRMED, status: "failed", effect: "unverifiable" }],
    [ELEMENT_CLICK, { ...CONFIRMED, status: "refused", effect: "refused" }],
    [{ type: "wait", ms: 0 }, CONFIRMED],
  ] as const)("recovers visual for unsafe action/result %#", (action, execution) => {
    expect(decideInitialObservation({
      consumedOptions: { ...OPTIONS, includeScreenshot: false },
      action: action as EngineWindowAction,
      execution: execution as EngineExecution,
      hasResolvedExpectation: false,
    })).toMatchObject({
      options: { includeScreenshot: true },
      observationMode: "visual_recovery",
      semanticCandidate: false,
    });
  });

  it("allows a resolved expectation to prove an initially unverifiable effect", () => {
    const initial = decideInitialObservation({
      consumedOptions: OPTIONS,
      requestedMode: "semantic",
      action: ELEMENT_CLICK,
      execution: { ...CONFIRMED, effect: "unverifiable" },
      hasResolvedExpectation: true,
    });
    expect(initial.semanticCandidate).toBe(true);
    expect(decideFinalObservation({
      initial,
      verification: { status: "satisfied" },
      finalExecution: CONFIRMED,
    })).toMatchObject({ observationMode: "semantic", requiresVisualRecovery: false });
    expect(decideFinalObservation({
      initial,
      verification: { status: "unsatisfied", reason: "predicate_unsatisfied" },
      finalExecution: { ...CONFIRMED, effect: "unverifiable" },
    })).toMatchObject({
      options: { includeScreenshot: true },
      observationMode: "visual_recovery",
      requiresVisualRecovery: true,
    });
  });

  it("keeps visual when requested or inherited and preserves element limits", () => {
    for (const requestedMode of ["visual", undefined] as const) {
      expect(decideInitialObservation({
        consumedOptions: OPTIONS,
        ...(requestedMode === undefined ? {} : { requestedMode }),
        action: ELEMENT_CLICK,
        execution: CONFIRMED,
        hasResolvedExpectation: false,
      })).toEqual({
        options: OPTIONS,
        observationMode: "visual",
        semanticCandidate: false,
        hasResolvedExpectation: false,
      });
    }
  });

  it("inherits semantic only from an existing no-screenshot snapshot", () => {
    expect(decideInitialObservation({
      consumedOptions: { ...OPTIONS, includeScreenshot: false },
      action: ELEMENT_CLICK,
      execution: CONFIRMED,
      hasResolvedExpectation: false,
    })).toMatchObject({ observationMode: "semantic", semanticCandidate: true });
  });

  it("gives escalation priority over an otherwise confirmed semantic route", () => {
    expect(decideInitialObservation({
      consumedOptions: OPTIONS,
      requestedMode: "semantic",
      action: ELEMENT_CLICK,
      execution: {
        ...CONFIRMED,
        escalation: { reason: "foreground_required", suggestedDelivery: "foreground" },
      },
      hasResolvedExpectation: false,
    })).toMatchObject({ observationMode: "visual_recovery", semanticCandidate: false });
  });
});
```

- [ ] **Step 2: Run the policy test and confirm RED**

Run: `cd product && npx --yes pnpm@9.0.4 exec vitest run tests/unit/observation-policy.test.ts`

Expected: FAIL because `core/observation-policy.ts` does not exist.

- [ ] **Step 3: Implement the pure two-stage policy**

Create `src/core/observation-policy.ts` with no engine calls, snapshot writes, timers, logging, or mutable global state:

```ts
import type { EngineExecution, EngineWindowAction } from "../engine/port.js";
import type { SnapshotObserveOptions } from "../snapshot-store.js";
import type { VerificationResult } from "./verifier.js";

export type ObservationMode = "visual" | "semantic" | "visual_recovery";

export type InitialObservationDecision = Readonly<{
  options: SnapshotObserveOptions;
  observationMode: ObservationMode;
  semanticCandidate: boolean;
  hasResolvedExpectation: boolean;
}>;

export type FinalObservationDecision = Readonly<{
  options: SnapshotObserveOptions;
  observationMode: ObservationMode;
  requiresVisualRecovery: boolean;
}>;

function semanticAddress(action: EngineWindowAction): boolean {
  switch (action.type) {
    case "click":
    case "double_click":
    case "right_click":
    case "scroll":
      return action.address.kind === "element";
    case "set_value":
    case "invoke_menu":
      return true;
    case "type_text":
    case "keypress":
      return action.address?.kind !== "coordinate";
    case "drag":
    case "wait":
      return false;
  }
}

export function decideInitialObservation(input: Readonly<{
  consumedOptions: SnapshotObserveOptions;
  requestedMode?: "visual" | "semantic";
  action: EngineWindowAction;
  execution: EngineExecution;
  hasResolvedExpectation: boolean;
}>): InitialObservationDecision {
  const wantsSemantic = input.requestedMode === "semantic" ||
    (input.requestedMode === undefined && !input.consumedOptions.includeScreenshot);
  const safe = wantsSemantic &&
    semanticAddress(input.action) &&
    input.execution.status === "executed" &&
    (input.execution.effect === "confirmed" || input.hasResolvedExpectation) &&
    (input.execution.route === "accessibility" || input.execution.route === "system_api") &&
    (input.execution.delivery === "background" || input.execution.delivery === "not_applicable") &&
    input.execution.escalation === undefined;
  const includeScreenshot = !safe;
  return {
    options: { ...input.consumedOptions, includeScreenshot },
    observationMode: safe ? "semantic" : wantsSemantic ? "visual_recovery" : "visual",
    semanticCandidate: safe,
    hasResolvedExpectation: input.hasResolvedExpectation,
  };
}

export function decideFinalObservation(input: Readonly<{
  initial: InitialObservationDecision;
  verification: VerificationResult;
  finalExecution: EngineExecution;
}>): FinalObservationDecision {
  const verified = !input.initial.hasResolvedExpectation ||
    (input.verification.status === "satisfied" &&
      input.finalExecution.status === "executed" &&
      input.finalExecution.effect === "confirmed");
  const recover = input.initial.semanticCandidate && !verified;
  return {
    options: recover
      ? { ...input.initial.options, includeScreenshot: true }
      : input.initial.options,
    observationMode: recover ? "visual_recovery" : input.initial.observationMode,
    requiresVisualRecovery: recover,
  };
}
```

- [ ] **Step 4: Write failing coordinate-guard regression tests**

Extend `tests/unit/act.test.ts` so a complete local semantic snapshot rejects every coordinate-bearing action before engine execution:

```ts
import { assertCoordinates } from "../../src/core/act.js";
import type { SnapshotRecord } from "../../src/snapshot-store.js";

function semanticSnapshot(): SnapshotRecord {
  return {
    id: "snap_semantic123",
    sessionId: "session-test",
    target: { kind: "window", windowRef: "win_semantic123456" },
    visualStatus: "not_requested",
    coordinateSpace: "window_screenshot_pixels",
    windowTarget: {
      windowRef: "win_semantic123456",
      appRef: "app_semantic123456",
      nativeKey: "window:1",
      ownerKey: "pid:1",
    },
    observeOptions: { includeScreenshot: false, maxElements: 150, maxDepth: 12 },
    createdAtMs: 1,
  };
}

it.each([
  { type: "type", x: 10, y: 11, text: "once" },
  { type: "type_text", x: 10, y: 11, text: "once" },
  { type: "keypress", x: 10, y: 11, keys: ["enter"] },
  { type: "click", x: 10, y: 11 },
  { type: "scroll", x: 10, y: 11, direction: "down", amount: 1 },
  { type: "drag", from_x: 10, from_y: 11, to_x: 20, to_y: 21 },
] as const)("rejects coordinate action $type without a proven pixel frame", (action) => {
  expect(() => assertCoordinates(action, semanticSnapshot())).toThrowError("pixel_frame_unproven");
});
```

Run: `cd product && npx --yes pnpm@9.0.4 exec vitest run tests/unit/act.test.ts`

Expected RED: the three coordinate-addressed text/keypress cases do not throw because the current guard omits them.

- [ ] **Step 5: Make coordinate extraction exhaustive and confirm GREEN**

Replace the ad-hoc action list in `assertCoordinates` with this single extraction rule:

```ts
const points: readonly (readonly [number, number])[] =
  action.type === "drag"
    ? [[action.from_x, action.from_y], [action.to_x, action.to_y]]
    : "x" in action && "y" in action
      ? [[action.x, action.y]]
      : [];
```

Run:

```bash
cd product
npx --yes pnpm@9.0.4 exec vitest run tests/unit/observation-policy.test.ts tests/unit/act.test.ts
npx --yes pnpm@9.0.4 typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the safety core**

```bash
git add product/src/core/observation-policy.ts product/src/core/act.ts product/tests/unit/observation-policy.test.ts product/tests/unit/act.test.ts
git commit -m "feat: define safe observation policy"
```

## Task 2: Publish protocol 1.2 and wire adaptive runtime state

**Files:**
- Modify: `product/src/version.ts`
- Modify: `product/package.json`
- Modify: `product/pnpm-lock.yaml`
- Modify: `product/src/errors.ts`
- Modify: `product/src/protocol.ts`
- Modify: `product/src/snapshot-store.ts`
- Modify: `product/src/core/runtime.ts`
- Modify: `product/src/core/observe.ts`
- Modify: `product/src/core/act.ts`
- Create: `product/tests/helpers/fake-window-engine.ts`
- Modify: `product/tests/unit/protocol.test.ts`
- Modify: `product/tests/unit/snapshot-store.test.ts`
- Modify: `product/tests/unit/observe.test.ts`
- Modify: `product/tests/unit/window-runtime.test.ts`
- Modify: `product/tests/contract/protocol-snapshot.test.ts`
- Modify: `product/tests/contract/mcp-server.test.ts`
- Modify: `product/tests/contract/engine-lock.test.ts`
- Modify: `product/tests/contract/development-acceptance-cli.test.ts`
- Modify: `product/tests/contract/development-evidence.test.ts`
- Modify: `product/tests/unit/acceptance-recorder.test.ts`
- Modify: `product/tests/unit/cli-doctor.test.ts`
- Modify: `product/tests/unit/cli-setup.test.ts`

**Interfaces:**
- Consumes: Task 1's policy decisions.
- Produces: optional `ActInput.next_observation`, required window `observation_mode`, runtime error `next_observation_target_conflict`, and one final snapshot whose `observeOptions` match the actual final observation.
- Preserves: exact two-tool MCP inventory and all existing desktop/unavailable envelope shapes.

- [ ] **Step 1: Write failing protocol and schema tests**

Add these assertions to `tests/unit/protocol.test.ts` and `tests/contract/protocol-snapshot.test.ts`:

```ts
expect(ActInputSchema.parse({
  snapshot_id: "snap_12345678",
  action: { type: "wait", ms: 0 },
  next_observation: { mode: "semantic" },
}).next_observation).toEqual({ mode: "semantic" });

for (const invalid of [
  { mode: "fast" },
  {},
  { mode: "visual", extra: true },
]) {
  expect(() => ActInputSchema.parse({
    snapshot_id: "snap_12345678",
    action: { type: "wait", ms: 0 },
    next_observation: invalid,
  })).toThrow();
}

expect(ObservationOutputSchema.parse(windowObservation({
  observation_mode: "semantic",
  visual_status: "not_requested",
}))).not.toHaveProperty("screenshot");
expect(() => ObservationOutputSchema.parse(windowObservation({
  observation_mode: "semantic",
  visual_status: "available",
  screenshot: { mime_type: "image/png", width: 100, height: 100 },
}))).toThrow();
```

Update the inline public JSON Schema snapshot so `computer_act` has optional strict `next_observation`, remains required only for `snapshot_id` and `action`, and has no `actions` batch field. In `mcp-server.test.ts`, validate both success/error `oneOf` branches still reject `{}` and mixed outputs.

- [ ] **Step 2: Run the protocol tests and confirm RED**

Run:

```bash
cd product
npx --yes pnpm@9.0.4 exec vitest run tests/unit/protocol.test.ts tests/contract/protocol-snapshot.test.ts tests/contract/mcp-server.test.ts
```

Expected: FAIL because the new input/output fields and versions do not exist.

- [ ] **Step 3: Add exact public types and discriminated output branches**

In `src/protocol.ts`, add:

```ts
export const NextObservationSchema = z.object({
  mode: z.enum(["visual", "semantic"]),
}).strict();
export const ObservationModeSchema = z.enum(["visual", "semantic", "visual_recovery"]);

// inside ActInputSchema
next_observation: NextObservationSchema.optional(),
```

Split the existing combined window semantic/degraded schemas so the following combinations are the only valid ones:

```ts
const WindowVisualOutputSchema = WindowOutputBaseSchema.extend({
  observation_mode: z.literal("visual"),
  visual_status: z.literal("available"),
  screenshot: ScreenshotSchema,
}).strict();
const WindowDegradedVisualOutputSchema = WindowOutputBaseSchema.extend({
  observation_mode: z.literal("visual"),
  visual_status: z.enum(["capture_unavailable", "pixel_frame_unproven"]),
}).strict();
const WindowSemanticOutputSchema = WindowOutputBaseSchema.extend({
  observation_mode: z.literal("semantic"),
  visual_status: z.literal("not_requested"),
}).strict();
```

For available window action outputs, use the same three-way split except visual branches accept `observation_mode: z.enum(["visual", "visual_recovery"])`. Keep desktop outputs and `next_state:"unavailable"` without `observation_mode`.

Update both MCP object adapters as well as the source-of-truth unions. Add optional `observation_mode: ObservationModeSchema.optional()` to `ObservationMcpOutputSchema` and `ActMcpOutputSchema`; their existing `superRefine` must continue delegating to the strict target-specific unions for MCP SDK runtime parsing.

Do **not** generate the public JSON Schema from either broad MCP adapter: Zod `superRefine` is not representable in JSON Schema. Instead, export/use the exact strict branches and build the published lists directly from them:

```ts
const observeToolOneOf = [
  jsonSchemaBranch(WindowVisualOutputSchema),
  jsonSchemaBranch(WindowDegradedVisualOutputSchema),
  jsonSchemaBranch(WindowSemanticOutputSchema),
  jsonSchemaBranch(DesktopOutputSchema),
  jsonSchemaBranch(McpErrorOutputSchema),
];
const actToolOneOf = [
  jsonSchemaBranch(WindowVisualActOutputSchema),
  jsonSchemaBranch(WindowDegradedVisualActOutputSchema),
  jsonSchemaBranch(WindowSemanticActOutputSchema),
  jsonSchemaBranch(DesktopActOutputSchema),
  jsonSchemaBranch(UnavailableActOutputSchema),
  jsonSchemaBranch(McpErrorOutputSchema),
];
```

The broad adapters remain only the MCP SDK's object-shaped runtime bridge. Add exact `ajv@8.20.0` as a direct `devDependency` and refresh `product/pnpm-lock.yaml`; tests import `Ajv2020` from `ajv/dist/2020.js`, compile the published JSON Schema 2020-12 `oneOf`, and prove every exact valid branch passes, while desktop/unavailable plus `observation_mode`, empty objects, and mixed visual/semantic objects fail both runtime Zod validation and the published JSON Schema. Do not rely on pnpm exposing MCP SDK's transitive Ajv installation.

Add `next_observation_target_conflict` to `ERROR_CODES`, but not to `ActionErrorCodeSchema`, because it is a pre-action MCP error rather than an engine action result.

Set:

```ts
export const PRODUCT_VERSION = "0.2.2" as const;
export const PROTOCOL_VERSION = "1.2.0" as const;
```

Set `product/package.json` version to `0.2.2`, add only the test-time Ajv devDependency above, and leave runtime dependencies and the Cua lock unchanged.

- [ ] **Step 4: Make observation mode part of snapshot state**

Change `SnapshotCreateInput` to a desktop/window discriminated union. Both create valid records, but only window input carries `observationMode`:

```ts
export type SnapshotCreateInput =
  | Readonly<{
      sessionId: string;
      target: Readonly<{ kind: "desktop" }>;
      visual: Readonly<{ status: "available"; width: number; height: number }>;
      coordinateSpace: "desktop_screenshot_pixels";
      observeOptions: SnapshotObserveOptions;
    }>
  | Readonly<{
      sessionId: string;
      target: Readonly<{ kind: "window"; windowRef: string }>;
      observationMode: "visual" | "semantic" | "visual_recovery";
      visual:
        | Readonly<{ status: "available"; width: number; height: number }>
        | Readonly<{ status: Exclude<SnapshotVisualStatus, "available"> }>;
      coordinateSpace: "window_screenshot_pixels";
      upstreamSnapshotId?: string;
      windowTarget: SnapshotWindowTarget;
      elements: readonly SnapshotElement[];
      observeOptions: SnapshotObserveOptions;
    }>;
```

Add optional `observationMode` only to stored `SnapshotRecord`, set it for every window snapshot, and make `toWindowObservationEnvelope`/`toWindowActEnvelope` publish `snapshot.observationMode`. Unit tests must prove desktop records cannot gain a mode, window records preserve it, and degraded visual records do not gain dimensions.

- [ ] **Step 5: Extract a configurable fake window engine and write RED runtime tests**

Move `WindowFixtureEngine` from `window-runtime.test.ts` to `tests/helpers/fake-window-engine.ts`. Preserve its defaults and add:

```ts
readonly executions: EngineAction[] = [];
readonly observeInputs: EngineObserveInput[] = [];
readonly observations: EngineWindowObservation[];
execution: EngineExecution;
```

Each window observe pushes its input and shifts only when more than one observation remains. Add runtime tests for:

1. desktop snapshot + `next_observation` returns `next_observation_target_conflict`, `snapshot_consumed` absent, execution count zero, and the same snapshot can still execute a valid action;
2. confirmed background element action + semantic preference calls post-observe once with `includeScreenshot:false` and returns `observation_mode:"semantic"`, no image, fresh snapshot;
3. set_value implicit expectation is resolved even without input `expect` and publishes semantic only after value readback confirmation;
4. unsatisfied/unknown/final-unconfirmed verification calls semantic observe then exactly one visual recovery observe and publishes only the final refs/snapshot;
5. coordinate, wait, foreground, unknown delivery, unsafe route, failed and refused results call visual observe and return `observation_mode:"visual_recovery"` when the consumed preference was semantic;
6. no `next_observation` on a visual snapshot preserves `includeScreenshot:true`;
7. coordinate type/type_text/keypress on a semantic snapshot returns `pixel_frame_unproven` with execution count zero.

Run: `cd product && npx --yes pnpm@9.0.4 exec vitest run tests/unit/window-runtime.test.ts`

Expected RED: `next_observation` is not accepted, observation modes are absent, and the current runtime always inherits the consumed screenshot flag.

- [ ] **Step 6: Wire the two-stage runtime in the frozen order**

In `actUnlocked`, preserve this order exactly:

```ts
const snapshot = this.snapshots.requireCurrent(input.snapshot_id);
if (input.next_observation !== undefined && snapshot.target.kind !== "window") {
  throw new ComputerUseError(
    "next_observation_target_conflict",
    "next_observation requires a window snapshot",
    "observe_again",
    true,
  );
}
// health, coordinate guard, expectation/action resolution
this.snapshots.consume(input.snapshot_id);
// one engine execute
```

For the window branch, use Task 1's policy and existing verification helpers:

```ts
const initial = decideInitialObservation({
  consumedOptions: snapshot.observeOptions,
  requestedMode: input.next_observation?.mode,
  action: engineAction.action,
  execution: actionResult,
  hasResolvedExpectation: verificationExpectation !== undefined,
});
const observeWith = (options: SnapshotObserveOptions) =>
  observeWindowWithOneTransientRetry(this.engine, {
    target: { kind: "window", window },
    includeScreenshot: options.includeScreenshot,
    ...(options.query === undefined ? {} : { query: options.query }),
    maxElements: options.maxElements,
    maxDepth: options.maxDepth,
  }, this.lifecycle.signal);

let observed: EngineWindowObservation;
let verification: VerificationResult = { status: "not_requested" };
let transitioned = false;
if (verificationExpectation === undefined) {
  observed = await observeWith(initial.options);
} else {
  const verified = await verifyWindowState({
    observe: () => observeWith(initial.options),
    expectation: verificationExpectation.expectation,
    timeoutMs: verificationExpectation.timeoutMs,
    signal: this.lifecycle.signal,
  });
  observed = verified.observation;
  verification = verified.verification;
  transitioned = verified.transitioned;
}
actionResult = this.applyVerification(
  actionResult,
  verification,
  transitioned,
  verificationExpectation?.setValue === true,
);
const final = decideFinalObservation({ initial, verification, finalExecution: actionResult });
if (final.requiresVisualRecovery) observed = await observeWith(final.options);
```

Project only `observed`, create exactly one snapshot with `observationMode: final.observationMode` and `observeOptions: final.options`, and return that final state. Intermediate verification observations never enter `SnapshotStore`.

- [ ] **Step 7: Update version fixtures and confirm GREEN**

From the repository root, use `rg -n '0\.2\.1|1\.1\.0' product/tests product/README.md README.md docs --glob '!docs/superpowers/**'` to enumerate current-version fixtures. Update only product/protocol assertions and current documentation; do not rewrite historical approved specs/plans or Cua `0.22.1` historical references.

Run:

```bash
cd product
npx --yes pnpm@9.0.4 exec vitest run \
  tests/unit/protocol.test.ts \
  tests/unit/snapshot-store.test.ts \
  tests/unit/observe.test.ts \
  tests/unit/act.test.ts \
  tests/unit/window-runtime.test.ts \
  tests/unit/verifier.test.ts \
  tests/contract/protocol-snapshot.test.ts \
  tests/contract/mcp-server.test.ts \
  tests/contract/engine-lock.test.ts
npx --yes pnpm@9.0.4 test
npx --yes pnpm@9.0.4 typecheck
```

Expected: the focused tests and complete unit/contract suite PASS; MCP inventory is still exactly two tools. The full run covers the doctor, setup, acceptance-recorder, development-evidence, and acceptance-launcher version fixtures that are not repeated in the focused command.

- [ ] **Step 8: Commit protocol and runtime integration**

```bash
git add product/package.json product/pnpm-lock.yaml product/src product/tests/helpers/fake-window-engine.ts product/tests/unit product/tests/contract
git commit -m "feat: add adaptive observation protocol"
```

## Task 3: Record bounded UCU timing metadata without leaking content

**Files:**
- Create: `product/src/logging/timing.ts`
- Create: `product/tests/unit/timing.test.ts`
- Create: `product/tests/unit/runtime-timing.test.ts`
- Modify: `product/src/logging/redaction.ts`
- Modify: `product/src/logging/logger.ts`
- Modify: `product/src/core/runtime.ts`
- Modify: `product/src/mcp/main.ts`
- Modify: `product/tests/unit/redaction.test.ts`
- Modify: `product/tests/contract/logging-surface.test.ts`

**Interfaces:**
- Produces: injected monotonic `RuntimeTiming`, fixed timing allowlist, and one metadata record per completed/failed public runtime call.
- Preserves: no timing fields in MCP structured output and no production logger output in unit tests unless explicitly injected.

- [ ] **Step 1: Write failing timing-accumulator tests**

Create `tests/unit/timing.test.ts` with a manually advanced clock:

```ts
it("accumulates repeated phases and reports nonnegative integer milliseconds", async () => {
  let now = 100;
  const timing = new RuntimeTiming(() => now);
  now = 107.2;
  timing.markDequeued();
  await timing.measure("postActionObserveMs", async () => { now = 117.4; });
  await timing.measure("postActionObserveMs", async () => { now = 120.1; });
  timing.measureSync("projectionMs", () => { now = 121.2; });
  expect(timing.finish()).toEqual({
    queueWaitMs: 8,
    postActionObserveMs: 13,
    projectionMs: 2,
    toolTotalMs: 22,
  });
});
```

Also prove `finish()` is idempotent, phases not used are absent, a throwing measured operation rethrows unchanged while retaining elapsed time, and a backward clock is clamped to zero.

Run: `cd product && npx --yes pnpm@9.0.4 exec vitest run tests/unit/timing.test.ts`

Expected RED: `RuntimeTiming` does not exist.

- [ ] **Step 2: Implement the monotonic phase accumulator**

Create `src/logging/timing.ts`:

```ts
export type RuntimeTimingPhase =
  | "engineExecuteMs"
  | "postActionObserveMs"
  | "projectionMs";
export type RuntimeTimingSnapshot = Readonly<{
  queueWaitMs: number;
  engineExecuteMs?: number;
  postActionObserveMs?: number;
  projectionMs?: number;
  toolTotalMs: number;
}>;

export class RuntimeTiming {
  readonly #startedAt: number;
  readonly #now: () => number;
  readonly #durations = new Map<RuntimeTimingPhase, number>();
  #queueWaitMs = 0;
  #finished?: RuntimeTimingSnapshot;

  constructor(now: () => number = () => performance.now()) {
    this.#now = now;
    this.#startedAt = now();
  }
  markDequeued(): void {
    this.#queueWaitMs = this.#elapsed(this.#startedAt);
  }
  async measure<T>(phase: RuntimeTimingPhase, operation: () => Promise<T>): Promise<T> {
    const start = this.#now();
    try { return await operation(); }
    finally { this.#add(phase, this.#elapsed(start)); }
  }
  measureSync<T>(phase: RuntimeTimingPhase, operation: () => T): T {
    const start = this.#now();
    try { return operation(); }
    finally { this.#add(phase, this.#elapsed(start)); }
  }
  finish(): RuntimeTimingSnapshot {
    if (this.#finished !== undefined) return this.#finished;
    const phases = Object.fromEntries(
      [...this.#durations].map(([name, duration]) => [name, Math.ceil(duration)]),
    );
    this.#finished = Object.freeze({
      queueWaitMs: Math.ceil(this.#queueWaitMs),
      ...phases,
      toolTotalMs: Math.ceil(this.#elapsed(this.#startedAt)),
    }) as RuntimeTimingSnapshot;
    return this.#finished;
  }
  #elapsed(start: number): number { return Math.max(0, this.#now() - start); }
  #add(phase: RuntimeTimingPhase, value: number): void {
    this.#durations.set(phase, (this.#durations.get(phase) ?? 0) + value);
  }
}
```

- [ ] **Step 3: Write failing redaction and real-runtime logging tests**

Update `redaction.test.ts` so a poisoned event contains every secret class plus:

```ts
timings: {
  queueWaitMs: 1,
  engineExecuteMs: 2,
  postActionObserveMs: 3,
  projectionMs: 4,
  toolTotalMs: 10,
  secret: "drop-me",
},
observationMode: "visual_recovery",
```

Expected output contains only the snake-case fixed fields. Add `runtime-timing.test.ts` using an injected logger and fake window engine; call real `runtime.observe` and `runtime.act`, then assert one record per tool, repeated verification observations accumulate into `post_action_observe_ms`, and no MCP response gains a timing field.

Run:

```bash
cd product
npx --yes pnpm@9.0.4 exec vitest run tests/unit/redaction.test.ts tests/unit/runtime-timing.test.ts tests/contract/logging-surface.test.ts
```

Expected RED: the current allowlist has only `duration_ms`, Runtime has no instrumentation seam, and no tool call emits phase timings.

- [ ] **Step 4: Extend the frozen log allowlist**

Replace the old generic `durationMs` with fixed optional timing fields in `MetadataLogEvent`/`MetadataLogRecord`. Add all current action types to the action allowlist, including `set_value`, `type_text`, `invoke_menu`, and `launch_app`. Project nested timings explicitly:

```ts
const TIMING_FIELDS = [
  ["queueWaitMs", "queue_wait_ms"],
  ["engineExecuteMs", "engine_execute_ms"],
  ["postActionObserveMs", "post_action_observe_ms"],
  ["projectionMs", "projection_ms"],
  ["toolTotalMs", "tool_total_ms"],
] as const;

const timings: Record<string, number> = {};
for (const [inputName, outputName] of TIMING_FIELDS) {
  const value = input.timings?.[inputName];
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    timings[outputName] = Math.ceil(value);
  }
}
if (Object.keys(timings).length > 0) output.timings = timings;
```

Never spread the incoming timing object.

- [ ] **Step 5: Instrument runtime-owned boundaries**

Add a final optional runtime instrumentation argument:

```ts
type RuntimeInstrumentation = Readonly<{
  logger?: MetadataLogger;
  now?: () => number;
}>;
```

Default to a no-op logger in `ComputerUseRuntime`; `mcp/main.ts` passes `createMetadataLogger()` so production stdio keeps metadata JSONL on stderr. Start `RuntimeTiming` before `serial.run`, call `markDequeued()` at the top of the serialized callback, and wrap only these boundaries:

- `EnginePort.execute` → `engineExecuteMs`
- all engine observe/verification/recovery awaits → `postActionObserveMs`
- public projection, snapshot creation and envelope creation → `projectionMs`

Log success metadata from the final envelope. Log a stable `ComputerUseError.code` on failure. Do not serialize the exception.

- [ ] **Step 6: Confirm GREEN and no public-surface leak**

Run:

```bash
cd product
npx --yes pnpm@9.0.4 exec vitest run \
  tests/unit/timing.test.ts \
  tests/unit/runtime-timing.test.ts \
  tests/unit/redaction.test.ts \
  tests/contract/logging-surface.test.ts
npx --yes pnpm@9.0.4 typecheck
```

Expected: PASS; logging contract still sees exactly two tools and no log/timing fields in MCP output.

- [ ] **Step 7: Commit telemetry**

```bash
git add product/src/logging product/src/core/runtime.ts product/src/mcp/main.ts product/tests/unit product/tests/contract/logging-surface.test.ts
git commit -m "feat: record bounded timing metadata"
```

## Task 4: Teach agents the adaptive loop and enforce the no-fixed-delay rule

**Files:**
- Create: `product/tests/helpers/fixed-delay-scan.ts`
- Create: `product/tests/contract/no-fixed-action-delay.test.ts`
- Modify: `product/skills/computer-use/SKILL.md`
- Modify: `product/src/mcp/instructions.ts`
- Modify: `product/src/mcp/server.ts`
- Modify: `product/tests/contract/skill-policy.test.ts`
- Modify: `product/tests/contract/mcp-server.test.ts`
- Modify: `README.md`
- Modify: `product/README.md`
- Modify: `docs/host-compatibility.md`
- Modify: `docs/upstream-sources.md`
- Modify: `product/tests/contract/upstream-sources.test.ts`

**Interfaces:**
- Consumes: protocol 1.2 modes from Task 2.
- Produces: host guidance that selects semantic vs visual intentionally and an AST contract preventing generic action sleeps even when the delay is hidden behind a constant or alias.

- [ ] **Step 1: Write failing Skill and MCP instruction tests**

Require the Canonical Skill and server instructions to contain all of these concepts in plain English:

```ts
for (const phrase of [
  "next_observation",
  "semantic",
  "visual_recovery",
  "semantic snapshot",
  "do not call computer_observe again",
  "Never insert a fixed post-action wait",
]) expect(skill).toContain(phrase);
expect(skill).toMatch(/Canvas|WebGL/);
expect(skill).toMatch(/never.*repeat|Never blindly repeat/i);
```

Keep the server's first instruction paragraph under 512 characters and assert it still includes observe first, exact window, one action, newest snapshot, inspect act state, no blind retry, and stop.

- [ ] **Step 2: Add a source-only fixed-delay scanner and confirm RED**

Create `tests/helpers/fixed-delay-scan.ts` with two exports:

```ts
export type DelayFinding = Readonly<{ path: string; line: number; callee: string }>;
export function scanDelayCalls(sources: readonly Readonly<{ path: string; text: string }>[]): DelayFinding[];
export async function scanProductionDelayCalls(root: string): Promise<DelayFinding[]>;
```

Implement it with the installed TypeScript compiler API (`ts.createSourceFile` and `ts.forEachChild`), not regex. Track direct callees `sleep`, `delay`, `setTimeout`, member calls whose final property has one of those names, and variable aliases whose initializer resolves to a tracked callee. Treat the first argument of sleep/delay and the final argument of setTimeout as the delay expression, then normalize whitespace before comparison. Every tracked `CallExpression` is forbidden unless its exact file/function/callee/delay-expression tuple is in this allowlist:

```ts
const ALLOWED = new Set([
  "src/core/observe.ts|withTimeout|setTimeout|timeoutMs",
  "src/core/verifier.ts|cancellableSleep|setTimeout|ms",
  "src/core/verifier.ts|verifyWindowState|sleep|delay",
  "src/engine/cua.ts|cancellableWait|setTimeout|waitMs",
  "src/cli/process-runner.ts|run|setTimeout|options.timeoutMs",
  "src/cli/process-runner.ts|run|setTimeout|TERMINATION_GRACE_MS",
]);
```

The test must feed poisoned in-memory sources and require findings for all of these forms:

```ts
const POST_DELAY = 3_000;
await sleep(POST_DELAY);
const pause = sleep;
await pause(POST_DELAY);
await timersPromises.setTimeout(POST_DELAY);
await new Promise((resolve) => setTimeout(resolve, POST_DELAY));
```

It must also prove every exact allowlist fixture passes and the real production scan is empty. Separately assert the Skill documents the allowed verification sequence `50/100/200/400/500`, explicit `wait(ms)`, and no universal post-action wait. Do not scan `product/tests/**`, so fixture polling cannot be mistaken for production delay.

Run: `cd product && npx --yes pnpm@9.0.4 exec vitest run tests/contract/no-fixed-action-delay.test.ts`

Expected RED: the AST helper and contract test do not exist.

- [ ] **Step 3: Update the canonical control loop**

Add this policy to `product/skills/computer-use/SKILL.md` without adding a third tool:

```md
After one full window screenshot grounds the task, a confirmed low-risk element or menu action may request `next_observation: {"mode":"semantic"}`. Use the fresh snapshot returned by `computer_act`; do not call `computer_observe` again when it is available. A semantic snapshot has no proven pixel frame, so it may address elements but never coordinates.

`observation_mode:"visual_recovery"` means the requested or inherited semantic path was upgraded because the action was coordinate-based, foreground, failed, refused, unconfirmed, or otherwise unsafe. Inspect the returned PNG and decide again; never replay the action automatically. Canvas, video, and WebGL remain visual one-action/one-frame loops.
```

Update MCP instructions and the `computer_act` description so they promise a fresh target state, not always a primary-display screenshot.

- [ ] **Step 4: Correct current documentation without rewriting history**

Update current README/host compatibility text to product `0.2.2`, protocol `1.2.0`, semantic-next-state behavior, safety recovery, and unchanged Windows boundary. In `docs/upstream-sources.md`, replace the incorrect “GitHub pre-release therefore development candidate” statement with:

```md
The monorepo release is labeled Pre-release to control GitHub's Latest pointer; the plain SemVer driver channel is still a stable upstream release channel. UCU keeps `release_eligible:false` because its own named-host, installer, soak, and Windows evidence gates are incomplete—not because of that GitHub label alone.
```

Do not edit historical approved specs/plans.

- [ ] **Step 5: Confirm GREEN**

Run:

```bash
cd product
npx --yes pnpm@9.0.4 exec vitest run \
  tests/contract/skill-policy.test.ts \
  tests/contract/no-fixed-action-delay.test.ts \
  tests/contract/mcp-server.test.ts \
  tests/contract/upstream-sources.test.ts \
  tests/contract/integrations.test.ts
```

Expected: PASS; static scan finds zero generic fixed delays.

- [ ] **Step 6: Commit agent policy and docs**

```bash
git add README.md product/README.md product/skills product/src/mcp docs/host-compatibility.md docs/upstream-sources.md product/tests/helpers/fixed-delay-scan.ts product/tests/contract
git commit -m "docs: teach adaptive observation loop"
```

## Task 5: Prove real macOS correctness and p50/p95 performance

**Files:**
- Create: `product/tests/e2e/development/performance-recorder.ts`
- Create: `product/tests/unit/performance-recorder.test.ts`
- Create: `product/tests/e2e/development/macos-acceptance-support.ts`
- Create: `product/tests/e2e/development/macos-real-app-smoke.ts`
- Create: `product/tests/fixtures/focus-sentinel/main.swift`
- Create: `product/tests/fixtures/focus-sentinel/Info.plist`
- Modify: `product/tests/fixtures/desktop-harness/index.html`
- Modify: `product/tests/fixtures/desktop-harness/server.mjs`
- Modify: `product/tests/e2e/development/macos-acceptance.spec.ts`
- Modify: `product/tests/e2e/development/acceptance-recorder.ts`
- Modify: `product/tests/e2e/development/evidence.schema.json`
- Modify: `product/tests/unit/acceptance-recorder.test.ts`
- Modify: `product/tests/contract/development-evidence.test.ts`
- Modify: `product/tests/contract/development-acceptance-cli.test.ts`
- Modify: `product/scripts/run-development-acceptance.mjs`
- Modify: `product/tests/e2e/development/README.md`
- Modify: `README.md`
- Modify: `product/README.md`

**Interfaces:**
- Produces: schema-version-2 development evidence with four fixed 30-sample aggregate profiles and independent correctness booleans.
- Preserves: source-only evidence, no screenshot/content/ref leakage, no Beta/Stable promotion, and one long-lived public MCP client.

- [ ] **Step 1: Write failing nearest-rank and aggregate tests**

Create `performance-recorder.ts` with these public contracts and test them with shuffled deterministic samples:

```ts
export type PerformanceScenarioName =
  | "window_visual_observe"
  | "window_semantic_observe"
  | "semantic_action_next_state"
  | "pixel_action_next_state";

export function nearestRank(samples: readonly number[], percentile: number): number;
export function summarizeSamples(samples: readonly number[]): Readonly<{
  sample_count: 30;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
}>;
```

Tests must prove: exactly 30 finite nonnegative samples are required; p50 is sorted rank 15; p95 is sorted rank 29; failures stay in the duration array; and a single `correctnessPassed:false` makes the scenario fail even when latency meets SLO.

Use immutable SLOs:

```ts
const SLOS = {
  window_visual_observe: { p50_ms: 700, p95_ms: 1_500 },
  window_semantic_observe: { p50_ms: 400, p95_ms: 1_000 },
  semantic_action_next_state: { p50_ms: 1_000, p95_ms: 2_000 },
  pixel_action_next_state: { p50_ms: 1_500, p95_ms: 3_000 },
} as const;
```

Run: `cd product && npx --yes pnpm@9.0.4 exec vitest run tests/unit/performance-recorder.test.ts`

Expected RED: `performance-recorder.ts` and its exports do not exist.

- [ ] **Step 2: Implement the pure performance recorder**

Use nearest-rank exactly, not median averaging:

```ts
export function nearestRank(samples: readonly number[], percentile: number): number {
  if (samples.length === 0 || percentile <= 0 || percentile > 1) {
    throw new RangeError("invalid_percentile_samples");
  }
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(percentile * sorted.length) - 1]!;
}
```

The recorder accepts 5 warm-ups without storing them, stores exactly 30 measured `{durationMs, correctnessPassed}` results per fixed name, and emits only count/p50/p95/max/SLO/status. It never receives tool responses, screenshots, nonce text, refs, titles, or paths.

- [ ] **Step 3: Write failing schema-version-2 evidence tests**

Change `acceptance-recorder.test.ts` and `development-evidence.test.ts` fixtures to schema version 2 with a required `performance` object containing the four profiles and a required `real_app_smoke` object. Add failures for missing profiles, 29/31 sample counts, incorrect rank values, screenshots, single-sample arrays, text, refs, paths, PIDs, environment maps, `status:"passed"` with a failed profile, and successful status with a false smoke boolean.

Run: `cd product && npx --yes pnpm@9.0.4 exec vitest run tests/unit/acceptance-recorder.test.ts tests/contract/development-evidence.test.ts`

Expected RED: the existing schema/recorder are version 1 and reject every performance/smoke field.

- [ ] **Step 4: Implement strict schema-version-2 evidence**

Add the required `performance` object containing exactly the four scenario aggregates and a required `real_app_smoke` object with booleans `calculator_703`, `textedit_unique_value`, `textedit_single_write` plus optional fixed `error_code` enum `calculator_unavailable|textedit_unavailable|unsupported_locale|verification_failed`. Permit overall `status:"failed"` when any performance status or required smoke is failed; `passed` requires all old timings target-met, all performance profiles passed, all smoke booleans true, and no smoke error code; `degraded` means old single-call timing degraded while performance and smoke pass. Keep `additionalProperties:false` recursively.

- [ ] **Step 5: Extend the deterministic fixture oracles**

Add only test-visible state, not DOM automation:

```js
// freshState additions
semantic_sequence: [],
text_write_count: 0,
overlay_enabled: false,
```

Add fixed semantic buttons with distinct `aria-label` values, a visible Canvas/overlay control whose pixel hit increments an independent counter, and a text field whose input event increments `text_write_count`. `/reset` restores all server counters and increments a `reset_generation`. The fixture page polls only this generation, clears its DOM input/sequence/overlay state without dispatching input events, and acknowledges the same generation back to the fixture server; acceptance setup waits until `/state.reset_ack_generation === /state.reset_generation` before creating the next snapshot. This fixture-internal reset handshake is test state synchronization, not GUI automation. `/state` remains the only effect oracle. `/layout` publishes fixed visual centers independent of AX bounds.

Do not use a webpage counter as foreground evidence. Add checked-in `tests/fixtures/focus-sentinel/main.swift` and `tests/fixtures/focus-sentinel/Info.plist`. The plist must fix `CFBundleExecutable=UCUAcceptanceFocusSentinel`, `CFBundleIdentifier=dev.universal-computer-use.acceptance-focus-sentinel`, `CFBundleName=UCU Acceptance Focus Sentinel`, `CFBundlePackageType=APPL`, `CFBundleShortVersionString=1.0`, and `CFBundleVersion=1`. The Swift program creates one minimal AppKit window, uses `.regular` activation policy, activates itself, prints one machine-readable ready line containing its PID, and runs until terminated.

`macos-acceptance-support.ts` must first require executable `/usr/bin/swiftc` or fail preflight with stable `focus_sentinel_toolchain_unavailable`. It creates one owned `mkdtemp` directory, builds `<temp>/UCUAcceptanceFocusSentinel.app/Contents/MacOS`, copies the checked-in plist to `Contents/Info.plist`, and invokes the equivalent of:

```bash
/usr/bin/swiftc tests/fixtures/focus-sentinel/main.swift \
  -framework AppKit \
  -o <temp>/UCUAcceptanceFocusSentinel.app/Contents/MacOS/UCUAcceptanceFocusSentinel
/usr/bin/codesign --force --sign - --timestamp=none \
  <temp>/UCUAcceptanceFocusSentinel.app
```

It launches the exact nested executable with `spawn`, retains that child PID, waits for its ready line, then requires the native frontmost oracle to return both the unique bundle ID and that exact PID before continuing. A compile, codesign, launch, ready-timeout, bundle-ID or PID mismatch is a stable preflight failure, not degraded evidence. Cleanup terminates only that child PID, waits for exit, and removes only the recorded `mkdtemp` directory. Do not use TextEdit as the sentinel because LaunchServices can reuse an unrelated user process.

Add a read-only native oracle that invokes `/usr/bin/osascript -l JavaScript` with AppKit/JXA and returns both `bundleIdentifier` and `processIdentifier` from `NSWorkspace.sharedWorkspace.frontmostApplication`. Prove oracle sensitivity first: activate the sentinel and require both its unique bundle ID and exact child PID, execute one explicit foreground fixture action and require Chrome's bundle ID with a different PID, then reactivate the sentinel and require the exact sentinel identity again. Only after this positive control may a background fixture action claim `focus_preserved`; both returned identity fields must still match the owned sentinel and the child process must be alive. Cleanup terminates only the recorded sentinel PID and never targets a process by bundle ID or app name.

- [ ] **Step 6: Factor owned acceptance support and write the real RED lane**

Move process/client/fixture helpers from `macos-acceptance.spec.ts` to `macos-acceptance-support.ts` without changing ownership or cleanup. The real lane must use one long-lived stdio MCP connection and, for each performance scenario:

1. reset fixture outside the timer and confirm the reset oracle;
2. establish the required fresh window snapshot outside the timer;
3. start `performance.now()` immediately before `client.callTool` writes the request;
4. stop after `CallToolResultSchema.parse` returns;
5. verify the independent oracle and returned mode/status;
6. record the duration even when the call result is an error;
7. continue to 30 samples when the fixture remains healthy; never rerun a failed sample as a replacement.

The four lanes are exact:

- full window observe with screenshot and bounded elements;
- semantic window observe with `include_screenshot:false`;
- background `set_value` on the unique fixture text field, whose initial AX value is empty, requesting `next_observation.mode:"semantic"`; its implicit value-readback expectation must return `effect:"confirmed"`, `verification:"satisfied"`, final public value equal to the per-iteration nonce, external `/state.text` equal to that nonce, `text_write_count` increased exactly once, `observation_mode:"semantic"`, and no PNG;
- fixed visual coordinate action requesting/inheriting visual and receiving a PNG.

Run 5 unrecorded warm-ups before each 30-sample lane. Keep reset, discovery, initial snapshot creation and oracle polling outside the timed region.

- [ ] **Step 7: Add deterministic correctness smoke inside the same owned lane**

Before writing evidence, prove:

- a full visual grounding can enter a multi-step semantic element sequence without extra `computer_observe` calls;
- unique nonce input changes the fixture's `text_write_count` by exactly one and the final value matches once;
- an unverifiable/no-op or overlay path returns `visual_recovery` and is not automatically replayed;
- after the native frontmost-oracle positive control, a background semantic action leaves the owned AppKit focus sentinel (exact bundle ID and PID) as the frontmost application;
- the existing independent fixed-pixel oracle still increments exactly once.

These fixture oracles are release evidence for harness behavior. They do not replace real application smoke.

- [ ] **Step 8: Add non-statistical Calculator and TextEdit smoke**

Create `macos-real-app-smoke.ts` exporting:

```ts
export async function runRealAppSmoke(client: Client): Promise<Readonly<{
  calculator_703: boolean;
  textedit_unique_value: boolean;
  textedit_single_write: boolean;
  error_code?: "calculator_unavailable" | "textedit_unavailable" | "unsupported_locale" | "verification_failed";
}>>;
```

The helper uses only `computer_observe` and `computer_act` for GUI discovery, actions and verification:

1. discover Calculator, reusing an existing exact window or launching the discovered `app_ref`;
2. take one visual window grounding, use digit/operator element refs where unique, use a foreground keypress only when the multiply/equal control is not uniquely exposed, and inspect every returned state;
3. require the final public element values to contain exactly `703`, then stop with no extra tool call;
4. discover TextEdit from a desktop snapshot, require its `app_ref`, and record the complete pre-existing `window_ref` set. If no usable TextEdit window exists, consume that desktop snapshot with `launch_app(app_ref)`, rediscover, and require the set difference to contain exactly one new `window_ref`; only that new window becomes owned. If a usable window already exists, first create its window snapshot, invoke New through a window-scoped menu/keypress action, rediscover, and again require the set difference to contain exactly one new `window_ref`; only that new window becomes owned. Neither branch may issue `set_value`, type text, or close anything until ownership is proven. Never reuse an existing user window as the smoke target;
5. require `effect:"confirmed"`, `verification:"satisfied"`, the fresh element value equal to the nonce, and an internal call counter of exactly one mutation request;
6. restore Calculator with `AC`, clear the TextEdit value with one verified `set_value`, and close only the one window proven by the ref-set difference. If new-window ownership cannot be proven, return both TextEdit booleans false with `error_code:"textedit_unavailable"` without editing or closing any existing user document.

Expected application/control failures return false booleans plus one fixed `error_code`; they do not throw before evidence is written. Localized discovery failure maps to `unsupported_locale` and makes v0.2.2 evidence fail on that machine; it must not silently skip or fall back to AppleScript/shell input. The real-app smoke booleans are required in schema-v2 evidence but their latency is excluded from p50/p95.

- [ ] **Step 9: Make failure evidence truthful and source-only**

Raise the real Vitest lane timeout to 10 minutes without changing per-call SLOs. Normalize every expected profile, correctness, locale and real-smoke failure into recorder state. After owned resource cleanup, always derive a complete schema-v2 record, atomically write it with `{flag:"wx"}`, then throw one stable gate error when status is `failed`. Only fatal preflight, fixture death, target loss that prevents 30 samples, or inability to write/validate evidence remains a no-evidence failure.

Update the launcher to accept `passed|degraded` as exit zero and `failed` as exit nonzero. When the Vitest child exits nonzero, the launcher must still attempt to read and strictly validate the requested evidence path: a valid `status:"failed"` record produces a stable failure summary and retains the evidence path; missing/invalid evidence produces `acceptance_failed:evidence_missing_or_invalid`. It must never overwrite an evidence path, never stop a shared Cua daemon, and always clean its fixture/browser/profile resources.

Add CLI contract cases for a failed performance profile, false Calculator smoke, false TextEdit smoke, `unsupported_locale`, and an old single-call hard failure. Each case must prove a schema-valid failed artifact exists, the launcher exits 1, and no success JSON is printed.

Run:

```bash
cd product
npx --yes pnpm@9.0.4 exec vitest run tests/unit/performance-recorder.test.ts tests/contract/development-evidence.test.ts tests/contract/development-acceptance-cli.test.ts
```

Expected RED: schema v1 rejects performance/smoke fields and the current launcher discards child-failure evidence.

- [ ] **Step 10: Confirm deterministic tests GREEN**

Run:

```bash
cd product
npx --yes pnpm@9.0.4 exec vitest run \
  tests/unit/performance-recorder.test.ts \
  tests/unit/acceptance-recorder.test.ts \
  tests/contract/development-evidence.test.ts \
  tests/contract/development-acceptance-cli.test.ts \
  tests/e2e/shared/desktop-harness.spec.ts
npx --yes pnpm@9.0.4 typecheck
```

Expected: PASS without controlling the real desktop.

- [ ] **Step 11: Run the real macOS evidence lane**

Run:

```bash
cd product
npx --yes pnpm@9.0.4 acceptance:macos -- --evidence /tmp/ucu-macos-performance-v0.2.2.json
```

Expected: exit 0, all correctness scenarios true, four profiles each with sample_count 30, p50/p95 within the fixed SLO, no screenshot/text/ref/path inside the evidence, and cleanup true. A nonzero result is a real release blocker to diagnose, not a value to delete or relax.

- [ ] **Step 12: Run the full repository gate**

Run:

```bash
cd product
npx --yes pnpm@9.0.4 test
npx --yes pnpm@9.0.4 typecheck
npx --yes pnpm@9.0.4 build
npm pack --dry-run --json
git diff --check
pgrep -fal 'ucu-development-browser|desktop-harness/server.mjs' || true
```

Expected: all unit/contract tests pass; typecheck/build pass; the package contains dist, canonical Skill, integrations, lock, docs and source-only acceptance wrapper; no fixture/browser process remains.

- [ ] **Step 13: Update current status and commit evidence harness**

Update README status using only claims proven by the generated evidence: protocol 1.2 adaptive observation, exact sample count, the four fixed SLO gates, and continued Developer Preview status. Do not copy the evidence file into the repository and do not mark Cua or UCU release-eligible.

```bash
git add README.md product/README.md product/scripts product/tests
git commit -m "test: prove macos adaptive performance"
```

## Final Review Gate

After all five commits:

1. Review the complete diff against `docs/superpowers/specs/2026-08-29-macos-beta-performance-v0.2.2-design.md`.
2. Re-run `git status --short`, `git log -6 --oneline`, the full repository gate, and the real evidence command.
3. Independently review protocol safety and runtime behavior first, then code quality and evidence truthfulness.
4. Fix every P0/P1 finding with a focused regression test and rerun the affected plus full gates.
5. Push only after the worktree is clean and local `main` contains the complete verified series.
