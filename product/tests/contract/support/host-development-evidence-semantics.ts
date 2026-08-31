type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function child(value: JsonRecord, key: string): JsonRecord {
  const candidate = value[key];
  return isRecord(candidate) ? candidate : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function taskResults(value: JsonRecord): string[] {
  const tasks = child(value, "task_results");
  return ["calculator", "unique_input", "covered_window"]
    .map((name) => child(tasks, name).result)
    .filter((result): result is string => typeof result === "string");
}

const signalContracts: Record<
  string,
  {
    statuses: string[];
    limitation: string;
    fact: (value: JsonRecord) => boolean;
  }
> = {
  "invalid-transport-observed": {
    statuses: ["failed"],
    limitation: "invalid-transport-observed",
    fact: (value) => {
      const transport = child(value, "transport");
      return transport.direct_stdio !== true
        || transport.shell_bridge !== false
        || transport.builtin_computer_use !== false;
    },
  },
  "image-delivery-incomplete": {
    statuses: ["failed"],
    limitation: "host-image-delivery-incomplete",
    fact: (value) => {
      const image = child(value, "image_delivery");
      return image.first_turn_png !== true
        || image.second_turn_png !== true
        || image.same_host_reported_model !== true
        || image.same_direct_loop !== true;
    },
  },
  "loop-incomplete": {
    statuses: ["failed"],
    limitation: "host-loop-incomplete",
    fact: (value) => {
      const loop = child(value, "continuous_loop");
      return loop.repeated_tool_calls !== true
        || typeof loop.turns_observed !== "number"
        || loop.turns_observed < 2;
    },
  },
  "host-policy-blocked": {
    statuses: ["blocked"],
    limitation: "host-policy-blocked",
    fact: (value) => child(value, "automatic_mode").host_authorization === "host-policy-blocked",
  },
  "task-failed": {
    statuses: ["failed"],
    limitation: "task-failed",
    fact: (value) => taskResults(value).includes("fail"),
  },
  "task-not-run": {
    statuses: ["blocked", "not-run"],
    limitation: "task-not-run",
    fact: (value) => taskResults(value).includes("not-run"),
  },
  "natural-stop-failed": {
    statuses: ["failed"],
    limitation: "natural-stop-failed",
    fact: (value) => {
      const stop = child(value, "natural_stop");
      return stop.result !== "pass"
        || (typeof stop.tool_calls_after_goal === "number" && stop.tool_calls_after_goal > 0);
    },
  },
  "precondition-blocked": {
    statuses: ["blocked", "not-run"],
    limitation: "precondition-blocked",
    fact: () => true,
  },
};

export function hostDevelopmentEvidenceSemanticErrors(value: unknown): string[] {
  if (!isRecord(value) || value.evidence_origin !== "external-run") return [];

  const errors: string[] = [];
  const build = child(value, "build");
  const host = child(value, "host");
  const system = child(value, "system");
  const reviewer = child(value, "reviewer");

  if (build.git_commit === "0".repeat(40)) errors.push("external_placeholder_commit");
  if (host.version === "0.0.0-example") errors.push("external_placeholder_host_version");
  if (host.reported_model_id === "example/model-token") errors.push("external_placeholder_model");
  if (system.os_version === "0.0.0") errors.push("external_placeholder_os_version");
  if (reviewer.id === "synthetic-example") errors.push("external_placeholder_reviewer");

  const limitations = strings(value.limitations);
  if (value.status === "verified-development") {
    const authorization = child(value, "automatic_mode").host_authorization;
    if (authorization === "no-host-prompt-observed" && limitations.length !== 0) {
      errors.push("no_prompt_requires_empty_limitations");
    }
    if (
      authorization === "host-approval-observed"
      && (limitations.length !== 1 || limitations[0] !== "host-approval-observed")
    ) {
      errors.push("host_approval_requires_exact_limitation");
    }
    return errors;
  }

  if (!["failed", "blocked", "not-run"].includes(String(value.status))) return errors;
  if (limitations.length === 0) errors.push("non_pass_requires_limitation");

  const signal = typeof value.non_pass_signal === "string" ? value.non_pass_signal : "";
  const contract = signalContracts[signal];
  if (!contract) return [...errors, "unknown_non_pass_signal"];
  if (!contract.statuses.includes(String(value.status))) errors.push("signal_status_mismatch");
  if (!limitations.includes(contract.limitation)) errors.push("signal_limitation_mismatch");
  if (!contract.fact(value)) errors.push("signal_fact_mismatch");
  return errors;
}
