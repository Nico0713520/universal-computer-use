import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isDirectEntryPoint,
  runDirectCliEntrypoint,
} from "../../src/cli/entrypoint.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ucu-entrypoint-test-"));
  temporaryRoots.push(root);
  return root;
}

describe("installed CLI entrypoint", () => {
  it("recognizes an npm bin symlink as the direct module entrypoint", async () => {
    const root = await temporaryRoot();
    const target = join(root, "dist-main.js");
    const binLink = join(root, "computer-use");
    await writeFile(target, "");
    await symlink(target, binLink);

    expect(isDirectEntryPoint(binLink, pathToFileURL(target).href)).toBe(true);
  });

  it("does not treat a different executable as the direct entrypoint", async () => {
    const root = await temporaryRoot();
    const modulePath = join(root, "module.js");
    const otherPath = join(root, "other.js");
    await writeFile(modulePath, "");
    await writeFile(otherPath, "");

    expect(isDirectEntryPoint(otherPath, pathToFileURL(modulePath).href)).toBe(false);
  });
});

describe("direct CLI execution", () => {
  it("returns the proxy-enabled setup child exit code without running setup twice", async () => {
    const runCli = vi.fn(async () => 0);
    const reexec = vi.fn(async () => 29);

    await expect(
      runDirectCliEntrypoint(
        {
          argv: ["setup"],
          execArgv: [],
          environment: { HTTPS_PROXY: "http://proxy.test" },
          nodeExecutablePath: "/opt/node/bin/node",
          entrypointPath: "/opt/computer-use/dist/cli/main.js",
        },
        { runCli, reexec },
      ),
    ).resolves.toBe(29);

    expect(runCli).not.toHaveBeenCalled();
    expect(reexec).toHaveBeenCalledWith(
      "/opt/node/bin/node",
      [
        "--use-env-proxy",
        "/opt/computer-use/dist/cli/main.js",
        "setup",
      ],
      expect.objectContaining({ stdio: "inherit", shell: false }),
    );
  });

  it("leaves non-setup commands on the original CLI path", async () => {
    const runCli = vi.fn(async () => 7);
    const reexec = vi.fn(async () => 29);

    await expect(
      runDirectCliEntrypoint(
        {
          argv: ["doctor", "--json"],
          execArgv: [],
          environment: { HTTPS_PROXY: "http://proxy.test" },
          nodeExecutablePath: "/opt/node/bin/node",
          entrypointPath: "/opt/computer-use/dist/cli/main.js",
        },
        { runCli, reexec },
      ),
    ).resolves.toBe(7);

    expect(runCli).toHaveBeenCalledWith(["doctor", "--json"]);
    expect(reexec).not.toHaveBeenCalled();
  });
});
