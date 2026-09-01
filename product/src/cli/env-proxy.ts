import { spawn } from "node:child_process";

const PROXY_ENVIRONMENT_VARIABLES = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
] as const;
const ENV_PROXY_BOOTSTRAP_MARKER = "__COMPUTER_USE_ENV_PROXY_BOOTSTRAPPED";
const BOOTSTRAP_FAILURE_MESSAGE = "setup proxy bootstrap failed";
const REDACTED_PROXY_VALUE = "[redacted-proxy]";

export type EnvProxyBootstrapInput = Readonly<{
  argv: readonly string[];
  execArgv: readonly string[];
  environment: NodeJS.ProcessEnv;
  nodeExecutablePath: string;
  entrypointPath: string;
}>;

export type EnvProxyReexecOptions = Readonly<{
  environment: NodeJS.ProcessEnv;
  stdio: "inherit";
  shell: false;
}>;

export type EnvProxyReexec = (
  command: string,
  args: readonly string[],
  options: EnvProxyReexecOptions,
) => Promise<number>;

export function shouldBootstrapSetupEnvProxy(
  input: EnvProxyBootstrapInput,
): boolean {
  if (input.argv[0] !== "setup") return false;
  if (input.environment.NODE_USE_ENV_PROXY === "1") return false;
  if (input.execArgv.includes("--use-env-proxy")) return false;
  if (/(?:^|\s)--use-env-proxy(?:\s|$)/u.test(input.environment.NODE_OPTIONS ?? "")) {
    return false;
  }
  if (input.environment[ENV_PROXY_BOOTSTRAP_MARKER] === "1") return false;
  return PROXY_ENVIRONMENT_VARIABLES.some(
    (variable) => Boolean(input.environment[variable]),
  );
}

export function redactProxyEnvironmentValues(
  value: string,
  environment: NodeJS.ProcessEnv,
): string {
  const sensitiveValues = new Set<string>();
  for (const variable of PROXY_ENVIRONMENT_VARIABLES) {
    const configured = environment[variable];
    if (configured === undefined || configured.length === 0) continue;
    sensitiveValues.add(configured);
    try {
      const parsed = new URL(configured);
      sensitiveValues.add(parsed.href);
      if (parsed.username.length > 0) {
        sensitiveValues.add(parsed.username);
        sensitiveValues.add(decodeURIComponent(parsed.username));
      }
      if (parsed.password.length > 0) {
        sensitiveValues.add(parsed.password);
        sensitiveValues.add(decodeURIComponent(parsed.password));
      }
      if (parsed.username.length > 0 && parsed.password.length > 0) {
        sensitiveValues.add(`${parsed.username}:${parsed.password}`);
        sensitiveValues.add(
          `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`,
        );
      }
    } catch {
      // A malformed configured value is still redacted exactly as supplied.
    }
  }
  return [...sensitiveValues]
    .filter((candidate) => candidate.length > 0)
    .sort((left, right) => right.length - left.length)
    .reduce(
      (redacted, candidate) => redacted.replaceAll(candidate, REDACTED_PROXY_VALUE),
      value,
    );
}

const reexecCliWithEnvProxy: EnvProxyReexec = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      env: options.environment,
      shell: options.shell,
      stdio: options.stdio,
    });
    child.once("error", () => reject(new Error(BOOTSTRAP_FAILURE_MESSAGE)));
    child.once("close", (code) => {
      if (code === null) {
        reject(new Error(BOOTSTRAP_FAILURE_MESSAGE));
        return;
      }
      resolve(code);
    });
  });

export async function bootstrapSetupEnvProxy(
  input: EnvProxyBootstrapInput,
  reexec: EnvProxyReexec = reexecCliWithEnvProxy,
): Promise<number | undefined> {
  if (!shouldBootstrapSetupEnvProxy(input)) return undefined;

  try {
    return await reexec(
      input.nodeExecutablePath,
      ["--use-env-proxy", input.entrypointPath, ...input.argv],
      {
        environment: {
          ...input.environment,
          [ENV_PROXY_BOOTSTRAP_MARKER]: "1",
        },
        shell: false,
        stdio: "inherit",
      },
    );
  } catch {
    throw new Error(BOOTSTRAP_FAILURE_MESSAGE);
  }
}
