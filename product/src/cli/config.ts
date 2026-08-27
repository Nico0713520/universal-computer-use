import { isAbsolute, win32 } from "node:path";

export type ConfigClient = "generic" | "codex" | "kimi";

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

  const stderr =
    "This plugin uses the host Agent's current multimodal model; it does not configure a model or API key.\n";
  if (client === "generic") {
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
      stderr,
    };
  }
  return {
    stdout: `${client} mcp add computer-use -- ${commandArgument(nodeExecutablePath)} ${commandArgument(mcpScriptPath)}\n`,
    stderr,
  };
}
