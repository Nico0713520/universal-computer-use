# Universal Computer Use v0.2.3 macOS Test Truth Design

**Status:** Approved in conversation; written-spec review pending  
**Date:** 2026-08-30  
**Product target:** `0.2.3`  
**Protocol target:** unchanged at `1.2.0`  
**Engine lock:** unchanged at Cua Driver `0.22.2`

## 1. Decision

v0.2.3 is a macOS-first reliability release. It makes the existing test and diagnostic system truthful before changing execution behavior. The public MCP interface remains exactly `computer_observe` and `computer_act`; no model, provider, private Cua flag, third tool, hidden retry, or fixed post-action delay is added.

The release fixes four proven gaps:

1. The real macOS performance lane resets the browser fixture before every sample, including observe-only and native-AppKit scenarios that do not use that browser state. Two consecutive real runs failed at `fixture_reset_ack_timeout` after approximately 70 and 103 seconds.
2. Performance evidence collapses latency and correctness into one `status`, so a reviewer cannot tell whether a scenario was slow, inaccurate, or both.
3. `doctor` currently sets `desktop_unlocked:true` after any successful screenshot. A login-window screenshot therefore previously produced a false healthy claim.
4. Parser tests contain hand-written values but do not maintain a complete, source-attributed set of locked Cua `0.22.2` response fixtures for the discovery/window path.

## 2. Alternatives considered

### A. Report-only patch

Add `correct_count` and timing fields while leaving the runner and `doctor` unchanged. This is rejected because the full real lane currently fails before it can emit the report, and the public diagnostic would remain misleading.

### B. Test-truth patch with unchanged runtime behavior — selected

Make scenario setup minimal, preserve one-action safety, capture already-emitted redacted timing metadata, repair the macOS interactive-session diagnostic, and add locked upstream contract fixtures. This gives actionable evidence without changing what host Agents call or weakening execution checks.

### C. Test patch plus Cua performance fork

Also fork or patch Cua's cursor animation and approximately one-second window-change detector. This is rejected for v0.2.3. The current evidence must first prove where time is spent, and UCU must not depend on Cua private bypass arguments.

## 3. Goals

- A real macOS run either produces a complete schema-v3 acceptance artifact or a separate, redacted fatal diagnostic that identifies the failing phase.
- Four performance profiles retain exactly five warm-ups and thirty measured calls.
- Every profile reports exact correctness counts separately from latency gates.
- Stage aggregates identify queueing, Cua execution, post-action observation, UCU projection, and total runtime cost where those fields apply.
- Scenario preparation contains no work unrelated to the scenario under measurement.
- macOS `doctor` never infers an unlocked desktop merely from a successful capture.
- Locked Cua `0.22.2` discovery and window response shapes are proven by source-attributed fixtures.
- The final checkout passes deterministic tests, three consecutive full macOS acceptance runs, package inspection, and cleanup checks before it is pushed.

## 4. Non-goals

- No Windows precision or background-window implementation.
- No change to Cua Driver `0.22.2`.
- No CDP, DOM, OCR, model, planner, or additional MCP tool.
- No automatic retry of a failed input action or failed release sample.
- No promise that arbitrary covered Canvas/WebGL/game coordinates can be delivered in the background.
- No Beta or Stable promotion. v0.2.3 remains a Developer Preview until platform, named-host, and soak evidence gates are separately satisfied.

## 5. Frozen public interface

- Product version becomes `0.2.3`.
- Protocol remains `1.2.0`.
- Tool inventory remains exactly two tools.
- Existing request and response schemas for both tools remain unchanged.
- Timing details remain absent from MCP tool results. They are emitted only through the existing redacted metadata logger and consumed only by the source-only acceptance harness.
- Snapshot single-consumption, FIFO execution, one action per call, target ownership checks, and visual-recovery rules remain unchanged.

## 6. Scenario-owned preparation

`performanceIteration` must not run a universal fixture reset. Preparation belongs to the state the individual scenario actually mutates:

| Scenario | Preparation before a sample | Independent oracle |
|---|---|---|
| `window_visual_observe` | none | public envelope has exact target, PNG, snapshot, and valid dimensions |
| `window_semantic_observe` | none | public envelope has exact target, no PNG, bounded elements, and snapshot |
| `semantic_action_next_state` | reset only the owned AppKit sentinel text state | sentinel reports the exact nonce and exactly one write |
| `pixel_action_next_state` | read current fixture counter; do not reset the DOM | counter increases by exactly one and the public result proves visual next state |

One initial fixture reset remains before correctness work begins. Correctness scenarios may reset state when the reset itself is part of their independent setup. No release sample is silently discarded or repeated.

This change removes up to 140 unrelated browser reset/ack handshakes from one full performance run. It is a test-harness correction, not a product latency optimization.

## 7. Performance evidence schema v3

The source-only macOS development evidence advances from schema version 2 to 3. Each fixed performance profile contains:

```ts
type PerformanceFailureKind =
  | "tool_error"
  | "contract_mismatch"
  | "oracle_mismatch"
  | "target_lost"
  | "fixture_unavailable"
  | "telemetry_missing";

type PerformanceProfile = Readonly<{
  sample_count: 30;
  correct_count: number;
  failed_count: number;
  success_rate: number;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
  slo: Readonly<{ p50_ms: number; p95_ms: number }>;
  latency_status: "passed" | "failed";
  correctness_status: "passed" | "failed";
  failure_counts: Partial<Record<PerformanceFailureKind, number>>;
  stages: Partial<Record<
    "queue_wait" | "engine_execute" | "post_action_observe" |
    "projection" | "tool_total" | "transport_overhead",
    Readonly<{ sample_count: number; p50_ms: number; p95_ms: number; max_ms: number }>
  >>;
  status: "passed" | "failed";
}>;
```

Rules:

- `correct_count + failed_count === 30`.
- `success_rate === correct_count / 30`.
- `correctness_status` passes only at 30/30.
- `latency_status` depends only on the existing p50/p95 SLO.
- Overall `status` passes only when both statuses pass and telemetry required for that scenario is complete.
- Warm-ups are validated but excluded from all measured aggregates.
- Failed measured calls keep their wall-clock durations.
- No raw sample, screenshot, text, title, path, PID, native ID, ref, or token appears in evidence.

## 8. Stage timing collection

The production runtime already emits one redacted metadata record before each MCP response completes. The development stdio transport currently drains these records. v0.2.3 replaces that drain with a test-only sequential collector.

For each measured call, the harness records the collector cursor before invoking the tool, then consumes exactly the next matching tool record after the response. The stdio client and runtime are FIFO and issue no concurrent measured calls, so call order is the correlation mechanism. Any missing, duplicate, malformed, or wrong-tool record becomes `telemetry_missing`; it is not replaced by a guessed zero.

The collector accepts only the existing allowlisted metadata fields:

- `queue_wait_ms`
- `engine_execute_ms`
- `post_action_observe_ms`
- `projection_ms`
- `tool_total_ms`

`transport_overhead` is `max(0, external_wall_clock_ms - tool_total_ms)`. It is computed in the test harness and never written to production logs.

## 9. Fatal diagnostic artifact

A failure that prevents a complete schema-v3 artifact writes a separate sibling diagnostic file instead of forging partial acceptance evidence. Its schema is version 1 and contains only:

- `status:"failed"`
- stable `phase`
- optional performance scenario name
- `sample_kind:"warmup"|"measured"|null`
- zero-based sample index or `null`
- stable error code
- elapsed milliseconds
- booleans for owned fixture, browser, sentinel, MCP, and cleanup liveness
- last redacted tool name and stable tool error code when available
- UTC timestamp

The launcher prints the diagnostic path and exits nonzero. It never retries the run automatically. It never writes screenshots, exception stacks, text contents, paths, process identifiers, window titles, native handles, refs, or environment data.

## 10. Truthful macOS interactive-session diagnostic

`doctor` gains an injected `InteractiveSessionProbe` seam. The production macOS adapter performs a read-only AppKit/NSWorkspace query through `/usr/bin/osascript -l JavaScript` and returns:

- `false` when the frontmost bundle identifier is `com.apple.loginwindow`;
- `true` for another non-empty frontmost bundle identifier;
- an unavailable result when the process fails or returns malformed data.

The probe runs after the locked engine connects and validates its required-tool inventory, but before a screenshot is requested.

- A `false` result returns `ok:false`, `desktop_unlocked:false`, `observation_succeeded:false`, no screenshot, and `interactive_session_required`.
- An unavailable result fails closed with `desktop_unlocked:null`, no screenshot, and `runtime_unavailable`.
- A `true` result permits the existing single side-effect-free observation.

The Windows path is unchanged in v0.2.3. The seam is dependency-injected so unit tests never invoke AppKit or a shell process.

## 11. Locked Cua contract fixtures

Add sanitized, source-attributed `0.22.2` fixtures for:

- app list;
- window list using `{x,y,width,height}` bounds;
- exact window state using `{x,y,w,h}` Accessibility frames and `{x,y,width,height}` window bounds;
- health report.

Parser and connection contract tests consume these files through public parser/engine seams. Each fixture records its upstream tag/commit and tool name in adjacent documentation, not inside the JSON passed to the parser. Tests must still include malformed variants that fail closed with `engine_contract_changed` or the existing capture error.

## 12. Test seams and TDD order

The approved seams are:

1. `runDoctor` plus injected `InteractiveSessionProbe`.
2. `PerformanceRecorder` input/output.
3. The source-only stdio metadata collector exposed through the development `Connection` helper.
4. Public Cua JSON parsers and `CuaEngine.fromSdk` using locked raw fixtures.
5. `acceptance:macos` as the full real-machine seam.

Implementation uses vertical red-green slices in that order. Tests must prove behavior through these seams, not private fields or implementation-specific call graphs.

## 13. Acceptance gates

Before GitHub push:

1. Build and typecheck pass.
2. All unit and contract tests pass five consecutive times with no flake.
3. Fixed-delay scan remains clean; no universal post-action sleep is added.
4. Npm dry-pack contains only the intended model-free surface.
5. macOS `doctor` passes while unlocked and fails closed against an injected login-window result.
6. Full macOS acceptance passes three consecutive times on the same unlocked machine.
7. Every performance profile reports 30/30 correctness.
8. Cleanup leaves no owned browser, fixture, sentinel, or MCP process.
9. Release verification remains intentionally blocked with `engine_not_release_eligible`.
10. Git working tree is clean and all v0.2.3 commits are pushed to `origin/main`.

If a real run fails, implementation stops to diagnose that failure. A later successful retry does not erase or replace the failed result.

## 14. Documentation and status language

README and development acceptance documentation must distinguish:

- v0.2.1 historical development evidence;
- v0.2.2 incomplete/failing fresh acceptance attempts;
- v0.2.3 results produced by this work.

Named-host rows remain `not-tested` or `experimental` until HanaAgent and WorkBuddy run the published v0.2.3 checkout. The release table must not convert Developer Preview evidence into Beta eligibility.

## 15. Expected result

After v0.2.3, a developer can run one macOS acceptance command and receive either:

- a complete report saying exactly how many calls were correct, how fast each path was, and whether time was spent in Cua execution, observation, UCU projection, or transport; or
- a small redacted diagnostic identifying the exact stage and sample at which the harness stopped.

This release does not claim that actions are faster. It produces the trustworthy evidence required to make the next Cua/UCU performance decision without guessing.
