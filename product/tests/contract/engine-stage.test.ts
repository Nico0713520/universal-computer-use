import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { EngineLockSchema, loadEngineLock } from "../../src/engine/lock.js";

type StageOptions = {
  version: string;
  lockPath: string;
  packagePath: string;
  dependencyLockPath: string;
  sourceMapPath: string;
};

type StageDependencies = {
  isWorktreeClean(): Promise<boolean>;
  resolveTagCommit(tag: string): Promise<string>;
  isAncestor(ancestor: string, descendant: string): Promise<boolean>;
  download(url: URL): Promise<Uint8Array>;
  updateDependencyLock(input: {
    version: string;
    packagePath: string;
    dependencyLockPath: string;
  }): Promise<void>;
  verifyContracts(): Promise<void>;
};

type StageModule = {
  stageEngineRelease(options: StageOptions, dependencies: StageDependencies): Promise<unknown>;
};

async function stageModule(): Promise<StageModule> {
  const url = new URL("../../scripts/select-engine-release.mjs", import.meta.url);
  return (await import(url.href)) as unknown as StageModule;
}

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "computer-use-stage-test-"));
  roots.push(root);
  const lockPath = join(root, "engine.lock.json");
  const packagePath = join(root, "package.json");
  const dependencyLockPath = join(root, "pnpm-lock.yaml");
  const sourceMapPath = join(root, "upstream-sources.md");
  const lock = structuredClone(await loadEngineLock());
  lock.required_fix_commits = ["a".repeat(40)];
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  await writeFile(
    packagePath,
    `${JSON.stringify(
      { dependencies: { "@trycua/cua-driver": "0.22.1", zod: "4.4.3" } },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    dependencyLockPath,
    "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      '@trycua/cua-driver':\n        specifier: 0.22.1\n        version: 0.22.1\n",
  );
  await writeFile(
    sourceMapPath,
    "- 开发基线 release：`cua-driver-rs-v0.22.1`\n- 开发基线 commit：`c60ef6ad2db8774fb342938843e2f17f26c68240`\n",
  );
  return { root, lockPath, packagePath, dependencyLockPath, sourceMapPath };
}

const version = "1.2.3";
const tag = `cua-driver-rs-v${version}`;
const sourceCommit = "b".repeat(40);
const files: Record<string, string> = {
  "install.sh": "new mac installer",
  "_install-rust.sh": "new mac helper",
  "_install-common.sh": "new common shell helper",
  "uninstall.sh": "new mac uninstaller",
  "install.ps1": "new windows installer",
  "_install-common.psm1": "new powershell helper",
  "uninstall.ps1": "new windows uninstaller",
};
const macAsset = `cua-driver-rs-${version}-darwin-universal.tar.gz`;
const windowsAsset = `cua-driver-rs-${version}-windows-x86_64.zip`;
const checksums = `${sha256("mac asset")}  ${macAsset}\n${sha256("windows asset")}  ${windowsAsset}\n`;

function dependencies(overrides: Partial<StageDependencies> = {}) {
  const urls: string[] = [];
  const verifyContracts = vi.fn(async () => undefined);
  const updateDependencyLock = vi.fn(async ({ version: nextVersion, packagePath, dependencyLockPath }) => {
    const pkg = JSON.parse(await readFile(packagePath, "utf8"));
    expect(pkg.dependencies["@trycua/cua-driver"]).toBe(nextVersion);
    await writeFile(
      dependencyLockPath,
      `lockfileVersion: '9.0'\nsdk-version: ${nextVersion}\n`,
    );
  });
  const deps: StageDependencies = {
    isWorktreeClean: vi.fn(async () => true),
    resolveTagCommit: vi.fn(async (receivedTag) => {
      expect(receivedTag).toBe(tag);
      return sourceCommit;
    }),
    isAncestor: vi.fn(async () => true),
    async download(url) {
      urls.push(url.href);
      const name = url.pathname.split("/").at(-1) ?? "";
      if (name === "checksums.txt") return Buffer.from(checksums);
      const value = files[name];
      if (value === undefined) throw new Error(`unexpected download: ${url.href}`);
      return Buffer.from(value);
    },
    updateDependencyLock,
    verifyContracts,
    ...overrides,
  };
  return { deps, urls, updateDependencyLock, verifyContracts };
}

describe("candidate engine stage", () => {
  it("stages one exact formal release and leaves both platforms non-release-eligible", async () => {
    const paths = await fixture();
    const edge = dependencies();
    const { stageEngineRelease } = await stageModule();

    await stageEngineRelease({ version, ...paths }, edge.deps);

    const lock = JSON.parse(await readFile(paths.lockPath, "utf8"));
    const pkg = JSON.parse(await readFile(paths.packagePath, "utf8"));
    const dependencyLock = await readFile(paths.dependencyLockPath, "utf8");
    const sourceMap = await readFile(paths.sourceMapPath, "utf8");
    expect(lock).toMatchObject({ version, tag, source_commit: sourceCommit });
    expect(() => EngineLockSchema.parse(lock)).not.toThrow();
    expect(lock.platforms.macos).toMatchObject({
      asset: macAsset,
      sha256: sha256("mac asset"),
      development_eligible: true,
      release_eligible: false,
      signer: {
        kind: "apple",
        team_id: null,
        bundle_id: null,
        designated_requirement_sha256: null,
      },
      e2e_evidence: [],
    });
    expect(lock.platforms.windows).toMatchObject({
      asset: windowsAsset,
      sha256: sha256("windows asset"),
      development_eligible: true,
      release_eligible: false,
      signer: { kind: "authenticode", subject: null, thumbprint: null },
      e2e_evidence: [],
    });
    expect(lock.platforms.macos.installer_files).toEqual([
      { name: "install.sh", source: "release", sha256: sha256(files["install.sh"]) },
      { name: "_install-rust.sh", source: "source_commit", sha256: sha256(files["_install-rust.sh"]) },
      { name: "_install-common.sh", source: "source_commit", sha256: sha256(files["_install-common.sh"]) },
    ]);
    expect(lock.platforms.windows.installer_files).toEqual([
      { name: "install.ps1", source: "release", sha256: sha256(files["install.ps1"]) },
      { name: "_install-common.psm1", source: "source_commit", sha256: sha256(files["_install-common.psm1"]) },
    ]);
    expect(lock.platforms.macos.uninstaller_file.sha256).toBe(sha256(files["uninstall.sh"]));
    expect(lock.platforms.windows.uninstaller_file.sha256).toBe(sha256(files["uninstall.ps1"]));
    expect(pkg.dependencies["@trycua/cua-driver"]).toBe(version);
    expect(dependencyLock).toContain(`sdk-version: ${version}`);
    expect(edge.updateDependencyLock).toHaveBeenCalledWith({
      version,
      packagePath: paths.packagePath,
      dependencyLockPath: paths.dependencyLockPath,
    });
    expect(sourceMap).toContain(`开发基线 release：\`${tag}\``);
    expect(sourceMap).toContain(`开发基线 commit：\`${sourceCommit}\``);
    expect(edge.urls).toContain(
      `https://github.com/trycua/cua/releases/download/${tag}/checksums.txt`,
    );
    expect(edge.urls.every((url) => !url.includes("latest"))).toBe(true);
    expect(edge.deps.isAncestor).toHaveBeenCalledWith("a".repeat(40), sourceCommit);
    expect(edge.verifyContracts).toHaveBeenCalledOnce();
  });

  it.each(["latest", "1.2.3-nightly.20260827.1", "v1.2.3", "1.2"]) (
    "rejects non-explicit stable SemVer %s before downloads",
    async (invalidVersion) => {
      const paths = await fixture();
      const edge = dependencies();
      const { stageEngineRelease } = await stageModule();

      await expect(
        stageEngineRelease({ version: invalidVersion, ...paths }, edge.deps),
      ).rejects.toThrow("explicit stable SemVer");
      expect(edge.urls).toEqual([]);
    },
  );

  it("rejects a dirty worktree before resolving or downloading a release", async () => {
    const paths = await fixture();
    const edge = dependencies({ isWorktreeClean: vi.fn(async () => false) });
    const { stageEngineRelease } = await stageModule();

    await expect(stageEngineRelease({ version, ...paths }, edge.deps)).rejects.toThrow(
      "dirty worktree",
    );
    expect(edge.deps.resolveTagCommit).not.toHaveBeenCalled();
    expect(edge.urls).toEqual([]);
  });

  it("requires every locked fix commit to be an ancestor of the tag", async () => {
    const paths = await fixture();
    const edge = dependencies({ isAncestor: vi.fn(async () => false) });
    const { stageEngineRelease } = await stageModule();

    await expect(stageEngineRelease({ version, ...paths }, edge.deps)).rejects.toThrow(
      "required fix commit",
    );
    expect(edge.verifyContracts).not.toHaveBeenCalled();
  });

  it("does not mutate any target when a required asset is absent", async () => {
    const paths = await fixture();
    const before = await Promise.all([
      readFile(paths.lockPath, "utf8"),
      readFile(paths.packagePath, "utf8"),
      readFile(paths.dependencyLockPath, "utf8"),
      readFile(paths.sourceMapPath, "utf8"),
    ]);
    const edge = dependencies({
      async download(url) {
        const name = url.pathname.split("/").at(-1) ?? "";
        if (name === "checksums.txt") {
          return Buffer.from(`${sha256("mac asset")}  ${macAsset}\n`);
        }
        return Buffer.from(files[name] ?? "");
      },
    });
    const { stageEngineRelease } = await stageModule();

    await expect(stageEngineRelease({ version, ...paths }, edge.deps)).rejects.toThrow(
      `checksum missing for ${windowsAsset}`,
    );
    await expect(
      Promise.all([
        readFile(paths.lockPath, "utf8"),
        readFile(paths.packagePath, "utf8"),
        readFile(paths.dependencyLockPath, "utf8"),
        readFile(paths.sourceMapPath, "utf8"),
      ]),
    ).resolves.toEqual(before);
  });

  it.each(["dependency update", "contract verification"] as const)(
    "rolls back all four target files when %s fails",
    async (failurePoint) => {
    const paths = await fixture();
    const before = await Promise.all([
      readFile(paths.lockPath, "utf8"),
      readFile(paths.packagePath, "utf8"),
      readFile(paths.dependencyLockPath, "utf8"),
      readFile(paths.sourceMapPath, "utf8"),
    ]);
    const edge = dependencies(
      failurePoint === "dependency update"
        ? {
            updateDependencyLock: vi.fn(async ({ dependencyLockPath }) => {
              await writeFile(dependencyLockPath, "partially updated\n");
              throw new Error("dependency update failed");
            }),
          }
        : {
            verifyContracts: vi.fn(async () => {
              throw new Error("contract failed");
            }),
          },
    );
    const { stageEngineRelease } = await stageModule();

    await expect(stageEngineRelease({ version, ...paths }, edge.deps)).rejects.toThrow();
    await expect(
      Promise.all([
        readFile(paths.lockPath, "utf8"),
        readFile(paths.packagePath, "utf8"),
        readFile(paths.dependencyLockPath, "utf8"),
        readFile(paths.sourceMapPath, "utf8"),
      ]),
    ).resolves.toEqual(before);
    },
  );
});
