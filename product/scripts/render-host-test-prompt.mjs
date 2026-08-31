#!/usr/bin/env node

import process from "node:process";

const EXPECTED_REPOSITORY = "https://github.com/Nico0713520/universal-computer-use";
const HOSTS = {
  codex: "Codex",
  hanaagent: "HanaAgent",
  workbuddy: "WorkBuddy",
};

function fail() {
  process.stderr.write("host_prompt_failed:invalid_arguments\n");
  process.exitCode = 1;
}

function parseArguments(argv) {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      !["--host", "--repo", "--commit"].includes(flag)
      || typeof value !== "string"
      || value.startsWith("--")
      || values.has(flag)
    ) {
      return undefined;
    }
    values.set(flag, value);
  }
  if (values.size !== 3 || args.length !== 6) return undefined;

  const host = values.get("--host");
  const repository = values.get("--repo");
  const commit = values.get("--commit");
  if (
    !Object.hasOwn(HOSTS, host)
    || repository !== EXPECTED_REPOSITORY
    || !/^[0-9a-f]{40}$/.test(commit)
    || commit === "0".repeat(40)
  ) {
    return undefined;
  }
  return { host, repository, commit };
}

function renderPrompt({ host, repository, commit }) {
  const hostName = HOSTS[host];
  return `# Universal Computer Use exact-commit ${hostName} acceptance

Test only ${hostName}, and run host acceptance serially. No other Agent may execute UCU actions on this Mac until this run ends.

Repository: ${repository}
Exact commit: ${commit}

## 1. Obtain exactly this source revision

Prefer a fresh clone:

\`\`\`bash
git clone --no-checkout ${repository} universal-computer-use-${host}-preview
cd universal-computer-use-${host}-preview
git fetch origin ${commit}
git checkout --detach ${commit}
test "$(git rev-parse HEAD)" = "${commit}"
\`\`\`

Alternatively, use an existing checkout only if its worktree is clean. Confirm its origin is exactly ${repository}, fetch the exact commit, use \`git checkout --detach ${commit}\`, and run the same \`test "$(git rev-parse HEAD)" = "${commit}"\` equality check before building. Never test a branch, tag, short SHA, moving \`main\`, or dirty checkout.

## 2. Build and prepare the locked Runtime

\`\`\`bash
cd product
npx --yes pnpm@9.0.4 install --frozen-lockfile
npx --yes pnpm@9.0.4 build
node dist/cli/main.js setup --development
node dist/cli/main.js doctor --json
node dist/cli/main.js config --client ${host}
\`\`\`

Stop on any failure. macOS Screen Recording and Accessibility permission must be granted manually to CuaDriver in System Settings > Privacy & Security. Never bypass macOS permission controls. After the user grants a required permission, rerun doctor.

Manually register the generated absolute Node and MCP entrypoint as a direct stdio server. Do not let this command or this test edit unknown host settings. Restart ${hostName} and start a new conversation before checking the tools.

## 3. Prove one direct loop

Confirm the MCP server is named \`computer-use\` and its complete public tool inventory contains exactly these two tools: \`computer_observe\` and \`computer_act\`. There must be no third UCU tool.

The same host-reported model must receive the first PNG and second PNG in the same direct loop. Continue repeated observe/action calls from fresh snapshots until the visible goal is proved, then make a natural stop.

Run these three tasks in order from a fresh state:

1. \`calculator\`: use only the Calculator GUI to enter \`37 × 19\`, visibly confirm \`703\`, and stop naturally.
2. \`unique_input\`: create an ephemeral one-use value at run time, write it exactly once into the UCU-owned native text Fixture, and use the independent oracle to prove the complete value and \`write_count: 1\`. Do not retain or return the value; report only exact confirmation and \`nonce_recorded: false\`.
3. \`covered_window\`: cover the UCU Fixture with another application, prove one semantic background effect and one pixel-window effect, and prove the target remained background with \`foreground_fallback: not-needed\`, then stop naturally.

Using a shell bridge, shell-driven JSON-RPC, host built-in Computer Use, AppleScript, DOM automation, or mental arithmetic instead of the Calculator GUI invalidates the result. Diagnostic output from an invalid path cannot be converted into acceptance evidence.

## 4. Return only the privacy-safe v2 JSON report

Return only the privacy-safe v2 JSON report conforming to \`tests/e2e/host/development-evidence.schema.json\`. It must include \`schema_version: 2\`, \`evidence_origin: external-run\`, repository \`${repository}\`, commit \`${commit}\`, product \`0.2.7\`, protocol \`1.2.0\`, engine \`0.22.2\`, the exact ${hostName} version and host-reported model, macOS version/architecture, \`direct_stdio: true\`, \`shell_bridge: false\`, \`builtin_computer_use: false\`, exactly the two tools, both PNG turns, the same model/direct loop, all three task results, limitations, and natural stop.

Do not return or store screenshots, prompts, the ephemeral value, nonces, tool arguments, clipboard contents, typed content, raw image payloads, paths, environment data, user or host identities, native IDs, window/snapshot refs, element tokens, or secrets. Use \`verified-development\` only if every required proof passes; otherwise return the truthful \`failed\`, \`blocked\`, or \`not-run\` record with its allowlisted non-pass signal.
`;
}

const parsed = parseArguments(process.argv.slice(2));
if (!parsed) {
  fail();
} else {
  process.stdout.write(renderPrompt(parsed));
}
