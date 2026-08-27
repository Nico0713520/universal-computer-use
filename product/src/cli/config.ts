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
  return /\s/.test(path) ? JSON.stringify(path) : path;
}

export function renderConfig(
  client: ConfigClient,
  mcpExecutablePath: string,
): ConfigOutput {
  if (!isAbsoluteOnAnySupportedPlatform(mcpExecutablePath)) {
    throw new Error("absolute MCP executable path required");
  }

  const stderr =
    "This plugin uses the host Agent's current multimodal model; it does not configure a model or API key.\n";
  if (client === "generic") {
    return {
      stdout: `${JSON.stringify(
        {
          mcpServers: {
            "computer-use": {
              command: mcpExecutablePath,
              args: [],
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
    stdout: `${client} mcp add computer-use -- ${commandArgument(mcpExecutablePath)}\n`,
    stderr,
  };
}
