import { describe, expect, it, vi } from "vitest";

import {
  bootstrapSetupEnvProxy,
  redactProxyEnvironmentValues,
  shouldBootstrapSetupEnvProxy,
  type EnvProxyBootstrapInput,
  type EnvProxyReexec,
} from "../../src/cli/env-proxy.js";

function bootstrapInput(
  overrides: Partial<EnvProxyBootstrapInput> = {},
): EnvProxyBootstrapInput {
  return {
    argv: ["setup"],
    execArgv: [],
    environment: { HTTPS_PROXY: "http://proxy.example.test:8080" },
    nodeExecutablePath: "/opt/node/bin/node",
    entrypointPath: "/opt/computer-use/dist/cli/main.js",
    ...overrides,
  };
}

describe("setup environment proxy bootstrap", () => {
  it.each(["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"])(
    "recognizes the standard %s proxy variable",
    (variable) => {
      expect(
        shouldBootstrapSetupEnvProxy(
          bootstrapInput({ environment: { [variable]: "http://proxy.test" } }),
        ),
      ).toBe(true);
    },
  );

  it("does not bootstrap without a standard proxy variable", () => {
    expect(
      shouldBootstrapSetupEnvProxy(
        bootstrapInput({ environment: { ALL_PROXY: "socks5://proxy.test" } }),
      ),
    ).toBe(false);
  });

  it("does not bootstrap commands other than setup", () => {
    expect(
      shouldBootstrapSetupEnvProxy(bootstrapInput({ argv: ["doctor"] })),
    ).toBe(false);
  });

  it("does not bootstrap when NODE_USE_ENV_PROXY is already enabled", () => {
    expect(
      shouldBootstrapSetupEnvProxy(
        bootstrapInput({
          environment: {
            HTTPS_PROXY: "http://proxy.test",
            NODE_USE_ENV_PROXY: "1",
          },
        }),
      ),
    ).toBe(false);
  });

  it("does not bootstrap when Node already has --use-env-proxy", () => {
    expect(
      shouldBootstrapSetupEnvProxy(
        bootstrapInput({ execArgv: ["--use-env-proxy"] }),
      ),
    ).toBe(false);
  });

  it("does not bootstrap when NODE_OPTIONS already enables the proxy flag", () => {
    expect(
      shouldBootstrapSetupEnvProxy(
        bootstrapInput({
          environment: {
            HTTPS_PROXY: "http://proxy.test",
            NODE_OPTIONS: "--trace-warnings --use-env-proxy",
          },
        }),
      ),
    ).toBe(false);
  });

  it("re-execs the exact CLI once, inherits stdio, and preserves its exit code", async () => {
    let childEnvironment: NodeJS.ProcessEnv | undefined;
    const reexec = vi.fn<EnvProxyReexec>(
      async (_command, _args, options) => {
        childEnvironment = options.environment;
        return 37;
      },
    );
    const input = bootstrapInput({ argv: ["setup", "--development"] });

    await expect(bootstrapSetupEnvProxy(input, reexec)).resolves.toBe(37);
    expect(reexec).toHaveBeenCalledWith(
      "/opt/node/bin/node",
      [
        "--use-env-proxy",
        "/opt/computer-use/dist/cli/main.js",
        "setup",
        "--development",
      ],
      expect.objectContaining({ stdio: "inherit", shell: false }),
    );

    const secondReexec = vi.fn<EnvProxyReexec>(async () => 0);
    await expect(
      bootstrapSetupEnvProxy(
        bootstrapInput({ environment: childEnvironment }),
        secondReexec,
      ),
    ).resolves.toBeUndefined();
    expect(secondReexec).not.toHaveBeenCalled();
  });

  it("does not expose a proxy value when re-exec fails", async () => {
    const secretProxy = "http://user:very-secret@proxy.example.test:8080";
    const reexec = vi.fn<EnvProxyReexec>(async () => {
      throw new Error(secretProxy);
    });

    const failure = await bootstrapSetupEnvProxy(
      bootstrapInput({ environment: { HTTPS_PROXY: secretProxy } }),
      reexec,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain(secretProxy);
  });

  it("redacts full proxy URLs and credentials from external process output", () => {
    const proxy = "http://build-user:very-secret@proxy.example.test:8080";
    const output = `installer echoed ${proxy} and very-secret`;

    const redacted = redactProxyEnvironmentValues(output, { HTTPS_PROXY: proxy });

    expect(redacted).not.toContain(proxy);
    expect(redacted).not.toContain("very-secret");
    expect(redacted).toContain("[redacted-proxy]");
  });
});
