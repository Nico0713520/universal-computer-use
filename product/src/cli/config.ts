import { isAbsolute, win32 } from "node:path";

export type ConfigClient =
  | "generic"
  | "codex"
  | "kimi"
  | "hanaagent"
  | "workbuddy";

export type ConfigOutput = Readonly<{
  stdout: string;
  stderr: string;
}>;

function isAbsoluteOnAnySupportedPlatform(path: string): boolean {
  return isAbsolute(path) || win32.isAbsolute(path);
}

function commandArgument(path: string): string {
  if (path.includes('"')) throw new Error("executable paths containing quotes are unsupported");
  return `"${path}"`;
}

function namedHostGuidance(client: "hanaagent" | "workbuddy"): string {
  const displayName = client === "hanaagent" ? "HanaAgent" : "WorkBuddy";
  return [
    `${displayName} configuration generated for manual registration; no host settings were changed.`,
    `Restart ${displayName} and start a new conversation before expecting computer_observe and computer_act to appear.`,
    "Follow the packaged canonical Skill at skills/computer-use/SKILL.md.",
    "This plugin uses the host Agent's current multimodal model; it does not configure a model or API key.",
    "",
  ].join("\n");
}

export function renderConfig(
  client: ConfigClient,
  nodeExecutablePath: string,
  mcpScriptPath: string,
): ConfigOutput {
  if (
    !isAbsoluteOnAnySupportedPlatform(nodeExecutablePath) ||
    !isAbsoluteOnAnySupportedPlatform(mcpScriptPath)
  ) {
    throw new Error("absolute Node executable and MCP script paths required");
  }

  const legacyStderr =
    "This plugin uses the host Agent's current multimodal model; it does not configure a model or API key.\n";
  if (client === "generic" || client === "hanaagent" || client === "workbuddy") {
    return {
      stdout: `${JSON.stringify(
        {
          mcpServers: {
            "computer-use": {
              command: nodeExecutablePath,
              args: [mcpScriptPath],
            },
          },
        },
        null,
        2,
      )}\n`,
      stderr: client === "generic" ? legacyStderr : namedHostGuidance(client),
    };
  }
  return {
    stdout: `${client} mcp add computer-use -- ${commandArgument(nodeExecutablePath)} ${commandArgument(mcpScriptPath)}\n`,
    stderr: legacyStderr,
  };
}
