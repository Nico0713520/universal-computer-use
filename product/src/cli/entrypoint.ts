import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  bootstrapSetupEnvProxy,
  type EnvProxyBootstrapInput,
  type EnvProxyReexec,
} from "./env-proxy.js";

type DirectCliEntrypointDependencies = Readonly<{
  runCli: (argv: string[]) => Promise<number>;
  reexec?: EnvProxyReexec;
}>;

export function isDirectEntryPoint(
  entryPath: string | undefined,
  moduleUrl: string,
): boolean {
  if (entryPath === undefined) return false;
  try {
    return realpathSync(resolve(entryPath)) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

export async function runDirectCliEntrypoint(
  input: EnvProxyBootstrapInput,
  dependencies: DirectCliEntrypointDependencies,
): Promise<number> {
  const bootstrapExitCode = await bootstrapSetupEnvProxy(
    input,
    dependencies.reexec,
  );
  return bootstrapExitCode ?? dependencies.runCli([...input.argv]);
}
