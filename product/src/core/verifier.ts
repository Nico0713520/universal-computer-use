import type { EngineElement, EngineWindowObservation } from "../engine/port.js";
import type { ElementIdentity } from "../snapshot-store.js";
import { elementIdentityFor } from "./observe.js";

export type VerificationExpectation = Readonly<{
  identity: ElementIdentity;
  valueEquals?: string;
  enabled?: boolean;
  selected?: boolean;
  preSatisfied: boolean | "unknown";
}>;

export type VerificationResult =
  | Readonly<{ status: "not_requested" | "satisfied" }>
  | Readonly<{
      status: "unsatisfied" | "unknown";
      reason: "predicate_unsatisfied" | "element_not_unique" | "element_missing" | "observation_unavailable" | "timeout" | "untrusted_source";
    }>;

export type IdentityMatch =
  | Readonly<{ kind: "unique"; element: EngineElement }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "multiple" }>;

function sameIdentity(left: ElementIdentity, right: ElementIdentity): boolean {
  return left.role === right.role &&
    left.label === right.label &&
    left.parentChain.length === right.parentChain.length &&
    left.parentChain.every((node, index) => {
      const candidate = right.parentChain[index];
      return candidate !== undefined && node.role === candidate.role && node.label === candidate.label;
    });
}

export function matchIdentity(
  identity: ElementIdentity,
  elements: readonly EngineElement[],
): IdentityMatch {
  const byIndex = new Map(elements.map((element) => [element.index, element]));
  const matches = elements.filter((element) => sameIdentity(identity, elementIdentityFor(element, byIndex)));
  if (matches.length === 0) return { kind: "missing" };
  if (matches.length > 1) return { kind: "multiple" };
  return { kind: "unique", element: matches[0]! };
}

export function expectationSatisfied(
  expectation: Omit<VerificationExpectation, "identity" | "preSatisfied">,
  state: Readonly<{ value?: string; enabled?: boolean; selected?: boolean }>,
): boolean {
  return (expectation.valueEquals === undefined || state.value === expectation.valueEquals) &&
    (expectation.enabled === undefined || state.enabled === expectation.enabled) &&
    (expectation.selected === undefined || state.selected === expectation.selected);
}

function expectationTrustworthy(
  expectation: Omit<VerificationExpectation, "identity" | "preSatisfied">,
  state: Readonly<{ value?: string; enabled?: boolean; selected?: boolean }>,
): boolean {
  return (expectation.valueEquals === undefined || state.value !== undefined) &&
    (expectation.enabled === undefined || state.enabled !== undefined) &&
    (expectation.selected === undefined || state.selected !== undefined);
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

async function cancellableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function verifyWindowState(input: Readonly<{
  observe: () => Promise<EngineWindowObservation>;
  expectation: VerificationExpectation;
  timeoutMs: number;
  signal: AbortSignal;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}>): Promise<Readonly<{
  observation: EngineWindowObservation;
  verification: VerificationResult;
  transitioned: boolean;
}>> {
  const delays = [50, 100, 200, 400, 500] as const;
  const sleep = input.sleep ?? cancellableSleep;
  let elapsed = 0;
  let attempt = 0;
  let lastObservation: EngineWindowObservation | undefined;
  let lastVerification: VerificationResult = { status: "unknown", reason: "observation_unavailable" };

  while (true) {
    if (input.signal.aborted) throw abortError();
    lastObservation = await input.observe();
    const match = matchIdentity(input.expectation.identity, lastObservation.elements);
    if (match.kind === "unique") {
      if (!expectationTrustworthy(input.expectation, match.element)) {
        lastVerification = { status: "unknown", reason: "untrusted_source" };
      } else if (expectationSatisfied(input.expectation, match.element)) {
        return {
          observation: lastObservation,
          verification: { status: "satisfied" },
          transitioned: input.expectation.preSatisfied === false,
        };
      } else {
        lastVerification = { status: "unsatisfied", reason: "predicate_unsatisfied" };
      }
    } else {
      lastVerification = match.kind === "missing"
        ? { status: "unknown", reason: "element_missing" }
        : { status: "unknown", reason: "element_not_unique" };
    }

    const delay = delays[Math.min(attempt, delays.length - 1)]!;
    if (elapsed + delay > input.timeoutMs) {
      return { observation: lastObservation, verification: lastVerification, transitioned: false };
    }
    await sleep(delay, input.signal);
    elapsed += delay;
    attempt += 1;
  }
}
