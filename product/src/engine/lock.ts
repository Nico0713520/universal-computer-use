import { readFile } from "node:fs/promises";

import { z } from "zod";

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const CommitSchema = z.string().regex(/^[0-9a-f]{40}$/);

const InstallerFileSchema = z
  .object({
    name: z.string().min(1),
    source: z.enum(["release", "source_commit"]),
    sha256: Sha256Schema,
  })
  .strict();

const SignerSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("apple"),
      team_id: z.string().min(1).nullable(),
      bundle_id: z.string().min(1).nullable(),
      designated_requirement_sha256: Sha256Schema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("authenticode"),
      subject: z.string().min(1).nullable(),
      thumbprint: z.string().regex(/^[0-9A-Fa-f]{40}$/).nullable(),
    })
    .strict(),
]);

type Signer = z.infer<typeof SignerSchema>;

function hasReleaseSigner(signer: Signer): boolean {
  return signer.kind === "apple"
    ? signer.team_id !== null &&
        signer.bundle_id !== null &&
        signer.designated_requirement_sha256 !== null
    : signer.subject !== null && signer.thumbprint !== null;
}

const PlatformLockSchema = z
  .object({
    development_eligible: z.boolean(),
    release_eligible: z.boolean(),
    asset: z.string().min(1),
    sha256: Sha256Schema,
    installer_entrypoint: z.enum(["install.sh", "install.ps1"]),
    installer_files: z.array(InstallerFileSchema).min(1),
    uninstaller_file: InstallerFileSchema,
    signer: SignerSchema,
    e2e_evidence: z.array(z.string().trim().min(1)),
  })
  .strict()
  .superRefine((value, context) => {
    const installerNames = value.installer_files.map(({ name }) => name);
    if (new Set(installerNames).size !== installerNames.length) {
      context.addIssue({ code: "custom", message: "duplicate installer filename" });
    }
    if (!installerNames.includes(value.installer_entrypoint)) {
      context.addIssue({
        code: "custom",
        message: "installer entrypoint must be present in installer_files",
      });
    }
    if (value.release_eligible && !hasReleaseSigner(value.signer)) {
      context.addIssue({ code: "custom", message: "release requires signer identity" });
    }
    if (value.release_eligible && value.e2e_evidence.length === 0) {
      context.addIssue({ code: "custom", message: "release requires platform E2E evidence" });
    }
  });

export const EngineLockSchema = z
  .object({
    schema_version: z.literal(2),
    engine: z.literal("cua-driver"),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    tag: z.string().min(1),
    source_commit: CommitSchema,
    required_fix_commits: z.array(CommitSchema),
    required_tools: z.array(z.string().min(1)).min(1),
    platforms: z
      .object({
        macos: PlatformLockSchema,
        windows: PlatformLockSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.platforms.macos.signer.kind !== "apple") {
      context.addIssue({ code: "custom", message: "macos requires apple signer metadata" });
    }
    if (value.platforms.windows.signer.kind !== "authenticode") {
      context.addIssue({ code: "custom", message: "windows requires authenticode signer metadata" });
    }
  });

export type EngineLock = z.infer<typeof EngineLockSchema>;
export type EnginePlatform = keyof EngineLock["platforms"];

export async function loadEngineLock(): Promise<EngineLock> {
  const raw = await readFile(new URL("../../engine.lock.json", import.meta.url), "utf8");
  return EngineLockSchema.parse(JSON.parse(raw));
}

export function assertDevelopmentEligible(
  lock: EngineLock,
  platform: EnginePlatform,
): void {
  if (!lock.platforms[platform].development_eligible) {
    throw new Error("engine_not_development_eligible");
  }
}

export function assertReleaseEligible(lock: EngineLock, platform: EnginePlatform): void {
  if (!lock.platforms[platform].release_eligible) {
    throw new Error("engine_not_release_eligible");
  }
}
