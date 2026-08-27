# Lightweight Cross-Platform Computer Use Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a model-free local MCP plugin that exposes two screenshot-driven tools and delegates all native macOS/Windows capture and input work to an unmodified, version-locked Cua Driver Runtime.

**Architecture:** One small TypeScript package owns the public protocol, one-current-snapshot guard, single-action orchestration, Cua SDK adapter, stdio MCP server, setup/doctor CLI, Skill, and host configuration generators. Cua Driver remains a separately installed signed Runtime; the repository contains no copied Cua Rust code and the release gate rejects an unverified engine version.

**Tech Stack:** Node.js `>=22.19.0`, TypeScript `5.7.3`, pnpm `9.0.4`, Zod `4.4.3`, MCP TypeScript SDK `1.30.0`, Vitest `3.2.4`, Cua TypeScript SDK development baseline `0.22.1`, macOS shell and Windows PowerShell only for delegating the upstream installer.

## 中文执行总览

这不是复制 Cua 的中大型原生工程，而是给它加一层我们拥有的轻量产品协议。主路径固定为：

```text
宿主多模态 Agent
  → canonical Computer Use Skill
  → 2 个 stdio MCP 工具
  → snapshot/串行/超时/错误控制层
  → 锁定版本的 Cua TypeScript SDK
  → 用户机器上原样安装的官方签名 Cua Runtime
  → macOS / Windows 桌面
```

实施分五个阶段，但任务编号保持连续，方便每个子代理独立交付和复核：

| 阶段 | Tasks | 交付结果 | 退出条件 |
|---|---:|---|---|
| A. 协议地基 | 1–3 | 单包工程、引擎锁、两个工具 Schema、一次性 snapshot | 契约快照稳定；旧 snapshot 与非法输入在到达 Cua 前失败 |
| B. 执行接缝 | 4–6 | Cua 连接、九类动作映射、串行循环、超时与操作后截图 | 全部由 Fake SDK/Engine 确定性通过；无真实桌面依赖 |
| C. 可安装插件 | 7–9 | stdio MCP、setup/doctor/config/uninstall、canonical Skill、Codex/Kimi 接入 | Agent 能收到 PNG、连续调用、只暴露两个工具；安装链路精确固定 |
| D. 双平台证明 | 10 | macOS Retina、Windows 100/125/150% DPI、固定桌面 Fixture、真实 App 验收 | 每个平台确定性 Fixture 20/20；旧截图点击和坐标漂移均被发现 |
| E. 发布加固 | 11 | WorkBuddy/DeepSeek 薄适配、隐私日志、CI、版本晋级和发布门禁 | 两个平台 E2E 与 Codex/Kimi 宿主证据齐全后才允许发布 |

关键路径是 `1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11`。Task 1–9 是我们真正维护的轻量代码，复杂度中等；Task 10–11 偏重，但主要是双系统真实环境、签名/权限/DPI 证明，不是再造执行引擎。

当前唯一明确的外部发布门槛是 macOS Retina：`0.22.1` 可用于接口开发，但公开 macOS 包必须先晋级到包含提交 `90295148d34dac8e5a1307bac917e08171af5839` 的正式 Cua release。门槛未满足时允许继续完成代码和无桌面测试，但 `setup` 和正式发布必须明确失败，不能偷偷用 main/nightly 或在我方补一套 DPI 实现。

## Global Constraints

- Public protocol version is exactly `1.0.0`.
- The MCP server exposes exactly `computer_observe` and `computer_act`.
- The plugin contains no model client, model API key, planner, OCR, hidden model loop, or chat GUI.
- `computer_act` accepts exactly one action and always requires the current `snapshot_id`.
- v1 operates only the unlocked interactive primary display and exposes screenshot-pixel coordinates.
- v1 does not expose accessibility trees, element tokens, semantic verification, batching, background guarantees, multi-display selection, or privilege escalation.
- macOS and Windows x64 use byte-identical public JSON Schemas.
- Cua Driver is an external signed Runtime; never copy, patch, repackage, or re-sign its native files.
- Development may use Cua `0.22.1`; public macOS release requires a formal Cua release containing commit `90295148d34dac8e5a1307bac917e08171af5839` or an upstream-equivalent verified Retina fix.
- The installed engine version and tool contract must match `product/engine.lock.json`; never follow `latest` silently.
- Every engine action has a 20-second timeout; session idle timeout is 30 minutes.
- Logs never contain typed text, key contents, screenshots, clipboard contents, environment variables, or model prompts.
- All implementation work is test-first and each task ends in a focused commit.

---

## File map

```text
product/
  package.json                         Build, test, CLI and binary metadata
  pnpm-lock.yaml                       Exact JavaScript dependency graph
  tsconfig.json                        Strict Node ESM compilation
  tsconfig.test.json                   Strict typecheck for test sources
  vitest.config.ts                     Unit/contract test configuration
  engine.lock.json                     Exact Cua release and asset contract
  src/
    version.ts                         Product and protocol constants
    protocol.ts                        Zod schemas and inferred public types
    errors.ts                          Stable product errors and recovery hints
    snapshot-store.ts                  One-current-snapshot lifecycle
    engine/
      port.ts                          Narrow fakeable engine contract
      lock.ts                          Engine lock loading and validation
      cua.ts                           Cua SDK connection and observation
      action-mapper.ts                 Public action to Cua tool translation
      result-mapper.ts                 Cua result/error normalization
    core/
      observe.ts                       Observe use case
      act.ts                           Consume, execute, recapture use case
      serial-executor.ts               FIFO serialization for one desktop
      runtime.ts                       Session lifetime and timeout ownership
    mcp/
      handlers.ts                      Two tool handlers
      server.ts                        MCP server construction
      main.ts                          stdout-safe stdio entry point
    cli/
      process-runner.ts                Injectable subprocess boundary
      setup.ts                         Upstream installer delegation
      doctor.ts                        Machine-readable diagnostics
      config.ts                        Host MCP configuration output
      uninstall.ts                     Product-only uninstall and optional engine handoff
      main.ts                          `computer-use` command router
    logging/
      logger.ts                        Metadata-only JSONL logging
      redaction.ts                     Sensitive-field rejection
  skills/computer-use/SKILL.md          Canonical host Agent loop
  integrations/
    generic/mcp.json                   Generic stdio MCP example
    codex/README.md                    Codex install command
    kimi/README.md                     Kimi MCP install command
    workbuddy/                         Thin host manifest, after validation
    deepseek-harness/                  Thin host adapter, after validation
  tests/
    helpers/
      fake-cua-sdk.ts                  SDK-boundary fake with call recording
      fake-engine.ts                   Pure EnginePort fake for core tests
    unit/                              Pure protocol/core/adapter tests
    contract/                          MCP, lock, Skill and artifact contracts
    fixtures/
      cua/                             Sanitized Cua ToolResult fixtures
      desktop-harness/                 Fixed visual test page and state oracle
    e2e/
      macos/                           Interactive macOS runner
      windows/                         Interactive Windows runner
      host/                            Codex/Kimi/other host acceptance
  scripts/
    select-engine-release.mjs          Promote a verified Cua release
    verify-release.mjs                 Artifact/license/engine gate
docs/
  installation/macos.md
  installation/windows.md
  host-compatibility.md
  troubleshooting.md
  THIRD_PARTY_NOTICES.md
```

---

### Task 1: Create the lightweight package and lock the engine contract

**Files:**

- Create: `product/package.json`
- Create: `product/tsconfig.json`
- Create: `product/tsconfig.test.json`
- Create: `product/vitest.config.ts`
- Create: `product/engine.lock.json`
- Create: `product/README.md`
- Create: `product/LICENSE`
- Create: `product/src/version.ts`
- Create: `product/src/engine/lock.ts`
- Create: `product/tests/contract/engine-lock.test.ts`

**Interfaces:**

- Produces: `PRODUCT_VERSION`, `PROTOCOL_VERSION`, `EngineLockSchema`, `loadEngineLock()`, `assertReleaseEligible()`.
- Consumes: no product code.

- [ ] **Step 1: Write the failing lock contract test**

```ts
// product/tests/contract/engine-lock.test.ts
import { describe, expect, it } from "vitest";
import { loadEngineLock, assertReleaseEligible } from "../../src/engine/lock.js";

describe("engine lock", () => {
  it("pins the reviewed Cua development baseline", async () => {
    const lock = await loadEngineLock();
    expect(lock.engine).toBe("cua-driver");
    expect(lock.version).toBe("0.22.1");
    expect(lock.source_commit).toBe("c60ef6ad2db8774fb342938843e2f17f26c68240");
    expect(lock.required_tools).toEqual([
      "click", "drag", "end_session", "get_desktop_state", "hotkey", "move_cursor",
      "press_key", "scroll", "start_session", "type_text"
    ]);
    expect(lock.platforms.macos.installer_files.map(({ name }) => name)).toEqual([
      "install.sh", "_install-rust.sh", "_install-common.sh"
    ]);
    expect(lock.platforms.windows.installer_files.map(({ name }) => name)).toEqual([
      "install.ps1", "_install-common.psm1"
    ]);
  });

  it("blocks a public macOS release until the Retina fix is in a formal release", async () => {
    const lock = await loadEngineLock();
    expect(() => assertReleaseEligible(lock, "macos")).toThrowError("engine_not_release_eligible");
    expect(() => assertReleaseEligible(lock, "windows")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run: `cd product && corepack pnpm exec vitest run tests/contract/engine-lock.test.ts`

Expected: FAIL because `src/engine/lock.ts` and the package workspace do not exist.

- [ ] **Step 3: Create the exact package manifest**

```json
{
  "name": "@universal-computer-use/plugin",
  "version": "0.1.0",
  "type": "module",
  "publishConfig": { "access": "public" },
  "files": ["dist", "skills", "integrations", "engine.lock.json", "README.md", "LICENSE"],
  "packageManager": "pnpm@9.0.4",
  "engines": { "node": ">=22.19.0" },
  "bin": {
    "computer-use": "dist/cli/main.js",
    "computer-use-mcp": "dist/mcp/main.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run tests/unit tests/contract",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json --noEmit",
    "release:verify": "node scripts/verify-release.mjs"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.30.0",
    "@trycua/cua-driver": "0.22.1",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@types/node": "22.15.3",
    "typescript": "5.7.3",
    "vitest": "3.2.4"
  }
}
```

Use strict ESM settings with `module` and `moduleResolution` set to `NodeNext`, `target` set to `ES2022`, `rootDir` set to `src`, `outDir` set to `dist`, and `include` restricted to `src/**/*.ts`. This makes the declared bins resolve to `dist/cli/main.js` and `dist/mcp/main.js`. Add `tsconfig.test.json` extending the production config with `noEmit:true`, `rootDir:"."`, and includes for `src/**/*.ts`, `tests/**/*.ts`, and `vitest.config.ts`, so test helpers are also typechecked without entering the published build.

Configure Vitest for Node with a 10-second default timeout and deterministic non-concurrent test files. The ordinary `pnpm test` command names only `tests/unit` and `tests/contract`; interactive desktop E2E must never run merely because a developer ran the default test command.

Create `product/LICENSE` with the MIT license for our product code and a README that states Cua Driver is a separate MIT-licensed runtime dependency rather than bundled product code.

```ts
// product/src/version.ts
export const PRODUCT_VERSION = "0.1.0" as const;
export const PROTOCOL_VERSION = "1.0.0" as const;
```

- [ ] **Step 4: Add the reviewed baseline lock**

```json
{
  "schema_version": 1,
  "engine": "cua-driver",
  "version": "0.22.1",
  "tag": "cua-driver-rs-v0.22.1",
  "source_commit": "c60ef6ad2db8774fb342938843e2f17f26c68240",
  "required_fix_commits": ["90295148d34dac8e5a1307bac917e08171af5839"],
  "required_tools": [
    "click", "drag", "end_session", "get_desktop_state", "hotkey", "move_cursor",
    "press_key", "scroll", "start_session", "type_text"
  ],
  "platforms": {
    "macos": {
      "release_eligible": false,
      "asset": "cua-driver-rs-0.22.1-darwin-universal.tar.gz",
      "sha256": "cf4a1a74d6ad8ee7c094a381a061568028ff1353c19932e5806c6f0c1944ba7d",
      "installer_entrypoint": "install.sh",
      "installer_files": [
        { "name": "install.sh", "source": "release", "sha256": "317ba3a49fdba10f2a7f1b9f392c1bc1b7657f3aae85e1e2e43684cf17a1bf3b" },
        { "name": "_install-rust.sh", "source": "source_commit", "sha256": "71ed3b3987020447ad7663e821f51e8d471f711d6fd9be9938ce978136c30664" },
        { "name": "_install-common.sh", "source": "source_commit", "sha256": "5bc3aa010eb8667a099b582a9ada9a8f93001745b842cc7cf3cc6c472520cf29" }
      ]
    },
    "windows": {
      "release_eligible": true,
      "asset": "cua-driver-rs-0.22.1-windows-x86_64.zip",
      "sha256": "b08f6a006a659e853b376f2ffca3ac9b1c25c28fb9730ebe1821defb725bb28f",
      "installer_entrypoint": "install.ps1",
      "installer_files": [
        { "name": "install.ps1", "source": "release", "sha256": "ff0bf5887f5566101c040a33b698a86f6cc94f50d18f9ca8207a0bc08549ad8a" },
        { "name": "_install-common.psm1", "source": "source_commit", "sha256": "324bca98ad19f0487d4afd36a9e2d06478fcfb8e1e20225cdd8ec8ef5150e720" }
      ]
    }
  }
}
```

`EngineLockSchema` must be strict, validate 64-character lowercase SHA-256 values and 40-character commit IDs, reject extra platforms, reject duplicate installer filenames, and require `installer_entrypoint` to name one member of `installer_files`.

- [ ] **Step 5: Implement lock loading and release gating**

```ts
// product/src/engine/lock.ts
import { readFile } from "node:fs/promises";
import { z } from "zod";

const InstallerFileSchema = z.object({
  name: z.string().min(1),
  source: z.enum(["release", "source_commit"]),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

const PlatformLockSchema = z.object({
  release_eligible: z.boolean(),
  asset: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  installer_entrypoint: z.enum(["install.sh", "install.ps1"]),
  installer_files: z.array(InstallerFileSchema).min(1),
}).strict();

export const EngineLockSchema = z.object({
  schema_version: z.literal(1),
  engine: z.literal("cua-driver"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  tag: z.string().min(1),
  source_commit: z.string().regex(/^[0-9a-f]{40}$/),
  required_fix_commits: z.array(z.string().regex(/^[0-9a-f]{40}$/)),
  required_tools: z.array(z.string()).min(1),
  platforms: z.object({ macos: PlatformLockSchema, windows: PlatformLockSchema }).strict(),
}).strict();

export type EngineLock = z.infer<typeof EngineLockSchema>;

export async function loadEngineLock(): Promise<EngineLock> {
  const raw = await readFile(new URL("../../engine.lock.json", import.meta.url), "utf8");
  return EngineLockSchema.parse(JSON.parse(raw));
}

export function assertReleaseEligible(lock: EngineLock, platform: "macos" | "windows"): void {
  if (!lock.platforms[platform].release_eligible) throw new Error("engine_not_release_eligible");
}
```

- [ ] **Step 6: Install and run the contract test**

Run: `cd product && corepack pnpm install && corepack pnpm exec vitest run tests/contract/engine-lock.test.ts && corepack pnpm typecheck`

Expected: two tests pass and TypeScript exits 0.

- [ ] **Step 7: Commit**

```bash
git add product/package.json product/pnpm-lock.yaml product/tsconfig.json product/tsconfig.test.json product/vitest.config.ts product/engine.lock.json product/README.md product/LICENSE product/src/version.ts product/src/engine/lock.ts product/tests/contract/engine-lock.test.ts
git commit -m "chore: establish lightweight computer use package"
```

---

### Task 2: Define the two-tool public protocol

**Files:**

- Create: `product/src/protocol.ts`
- Create: `product/src/errors.ts`
- Create: `product/tests/unit/protocol.test.ts`
- Create: `product/tests/contract/protocol-snapshot.test.ts`

**Interfaces:**

- Produces: `ObserveInputSchema`, `ActInputSchema`, `ComputerAction`, `ObservationOutput`, `ActOutput`, `ComputerUseError`, and stable JSON Schemas for both MCP tools.
- Consumes: `PROTOCOL_VERSION` from `src/version.ts`.

- [ ] **Step 1: Write failing action and limit tests**

```ts
// product/tests/unit/protocol.test.ts
import { describe, expect, it } from "vitest";
import { ActInputSchema, ObserveInputSchema } from "../../src/protocol.js";

describe("public protocol", () => {
  it("accepts an empty observe input and rejects unknown fields", () => {
    expect(ObserveInputSchema.parse({})).toEqual({});
    expect(() => ObserveInputSchema.parse({ display: "secondary" })).toThrow();
  });

  it("accepts exactly one action", () => {
    expect(ActInputSchema.parse({ snapshot_id: "snap_12345678", action: { type: "click", x: 20, y: 30 } })).toBeTruthy();
    expect(() => ActInputSchema.parse({ snapshot_id: "snap_12345678", actions: [] })).toThrow();
  });

  it("enforces bounded text, keys, wait, and duration", () => {
    expect(() => ActInputSchema.parse({ snapshot_id: "snap_12345678", action: { type: "type", text: "x".repeat(20001) } })).toThrow();
    expect(() => ActInputSchema.parse({ snapshot_id: "snap_12345678", action: { type: "keypress", keys: [] } })).toThrow();
    expect(() => ActInputSchema.parse({ snapshot_id: "snap_12345678", action: { type: "wait", ms: 20001 } })).toThrow();
    expect(() => ActInputSchema.parse({ snapshot_id: "snap_12345678", action: { type: "drag", from_x: 1, from_y: 1, to_x: 2, to_y: 2, duration_ms: 10001 } })).toThrow();
    expect(() => ActInputSchema.parse({ snapshot_id: "snap_12345678", action: { type: "scroll", x: 1, y: 1, direction: "down", amount: 51 } })).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail on missing schemas**

Run: `cd product && corepack pnpm exec vitest run tests/unit/protocol.test.ts`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement strict discriminated action schemas**

```ts
// product/src/protocol.ts
import { z } from "zod";

const coordinate = z.number().finite().min(0);
const dragDuration = z.number().int().min(0).max(10_000).optional();
const key = z.string().min(1).max(24).regex(/^[a-z0-9_+-]+$/i);

export const ComputerActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click"), x: coordinate, y: coordinate }).strict(),
  z.object({ type: z.literal("double_click"), x: coordinate, y: coordinate }).strict(),
  z.object({ type: z.literal("right_click"), x: coordinate, y: coordinate }).strict(),
  z.object({ type: z.literal("move"), x: coordinate, y: coordinate }).strict(),
  z.object({ type: z.literal("drag"), from_x: coordinate, from_y: coordinate, to_x: coordinate, to_y: coordinate, duration_ms: dragDuration }).strict(),
  z.object({ type: z.literal("scroll"), x: coordinate, y: coordinate, direction: z.enum(["up", "down", "left", "right"]), amount: z.number().int().min(1).max(50), by: z.enum(["line", "page"]).optional() }).strict(),
  z.object({ type: z.literal("type"), text: z.string().max(20_000) }).strict(),
  z.object({ type: z.literal("keypress"), keys: z.array(key).min(1).max(8) }).strict(),
  z.object({ type: z.literal("wait"), ms: z.number().int().min(0).max(20_000) }).strict(),
]);

export const ObserveInputSchema = z.object({}).strict();
export const ActInputSchema = z.object({
  snapshot_id: z.string().regex(/^snap_[A-Za-z0-9_-]{8,}$/),
  action: ComputerActionSchema,
}).strict();

export type ComputerAction = z.infer<typeof ComputerActionSchema>;
export type ActInput = z.infer<typeof ActInputSchema>;

const ScreenshotSchema = z.object({
  mime_type: z.literal("image/png"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}).strict();

const EngineSchema = z.object({ name: z.literal("cua-driver"), version: z.string() }).strict();
const ActionResultSchema = z.object({
  status: z.enum(["executed", "refused", "failed"]),
  effect: z.enum(["confirmed", "partial", "unverifiable", "suspected_noop", "refused"]),
  route: z.enum(["accessibility", "synthetic_events", "global_input", "system_api", "dom", "trusted_input", "unknown"]),
  delivery: z.enum(["background", "foreground", "not_applicable", "unknown"]),
  error_code: z.string().optional(),
}).strict();

export const ObservationOutputSchema = z.object({
  protocol_version: z.literal("1.0.0"),
  session_id: z.string(),
  snapshot_id: z.string(),
  platform: z.enum(["macos", "windows"]),
  display_id: z.literal("primary"),
  screenshot: ScreenshotSchema,
  engine: EngineSchema,
}).strict();

export const ActOutputSchema = z.object({
  protocol_version: z.literal("1.0.0"),
  session_id: z.string(),
  consumed_snapshot_id: z.string(),
  snapshot_id: z.string(),
  action_result: ActionResultSchema,
  screenshot: ScreenshotSchema,
}).strict();

export type ObservationOutput = z.infer<typeof ObservationOutputSchema>;
export type ActOutput = z.infer<typeof ActOutputSchema>;
export type ImagePayload = Readonly<{ mimeType: "image/png"; dataBase64: string }>;
export type ObservationEnvelope = Readonly<{ structured: ObservationOutput; image: ImagePayload }>;
export type ActEnvelope = Readonly<{ structured: ActOutput; image: ImagePayload }>;
```

- [ ] **Step 4: Implement stable errors**

```ts
// product/src/errors.ts
export const ERROR_CODES = [
  "runtime_missing", "runtime_unavailable", "engine_version_mismatch", "engine_not_release_eligible",
  "permission_required", "unsupported_platform", "interactive_session_required",
  "target_privilege_mismatch", "stale_snapshot", "coordinate_out_of_bounds",
  "action_timeout", "action_refused", "action_failed", "capture_failed",
  "unsupported_action"
] as const;

export type ComputerUseErrorCode = typeof ERROR_CODES[number];

export class ComputerUseError extends Error {
  constructor(
    public readonly code: ComputerUseErrorCode,
    message: string,
    public readonly recovery: "setup" | "doctor" | "observe_again" | "grant_permission" | "stop",
    public readonly retryable: boolean,
  ) { super(message); }
}
```

- [ ] **Step 5: Snapshot the public JSON Schemas**

Use Zod's JSON Schema conversion to write an inline Vitest snapshot containing exactly two tool names. Assert `computer_act` requires `snapshot_id` and `action`, has no `actions` property, and both objects reject additional properties.

- [ ] **Step 6: Run tests and typecheck**

Run: `cd product && corepack pnpm exec vitest run tests/unit/protocol.test.ts tests/contract/protocol-snapshot.test.ts && corepack pnpm typecheck`

Expected: all tests pass; snapshot shows two tools only.

- [ ] **Step 7: Commit**

```bash
git add product/src/protocol.ts product/src/errors.ts product/tests/unit/protocol.test.ts product/tests/contract/protocol-snapshot.test.ts
git commit -m "feat: define lightweight computer use protocol"
```

---

### Task 3: Enforce one-current-snapshot semantics

**Files:**

- Create: `product/src/snapshot-store.ts`
- Create: `product/tests/unit/snapshot-store.test.ts`

**Interfaces:**

- Produces: `SnapshotRecord`, `SnapshotStore.create()`, `SnapshotStore.requireCurrent()`, `SnapshotStore.consume()`, `SnapshotStore.clear()`, `SnapshotStore.expireIdle()`.
- Consumes: `ComputerUseError`.

- [ ] **Step 1: Write failing lifecycle tests**

```ts
// product/tests/unit/snapshot-store.test.ts
import { describe, expect, it } from "vitest";
import { SnapshotStore } from "../../src/snapshot-store.js";

describe("SnapshotStore", () => {
  it("keeps exactly one current snapshot", () => {
    const store = new SnapshotStore(() => 1000, () => "token_a");
    const first = store.create("ses_a", 100, 80);
    const second = store.create("ses_a", 120, 90);
    expect(() => store.requireCurrent(first.id)).toThrowError("stale_snapshot");
    expect(store.requireCurrent(second.id).width).toBe(120);
  });

  it("consumes before execution and rejects reuse", () => {
    const store = new SnapshotStore(() => 1000, () => "token_b");
    const snapshot = store.create("ses_a", 100, 80);
    expect(store.consume(snapshot.id).id).toBe(snapshot.id);
    expect(() => store.consume(snapshot.id)).toThrowError("stale_snapshot");
  });

  it("expires after thirty idle minutes", () => {
    let now = 0;
    const store = new SnapshotStore(() => now, () => "token_c");
    const snapshot = store.create("ses_a", 100, 80);
    now = 30 * 60 * 1000 + 1;
    store.expireIdle();
    expect(() => store.requireCurrent(snapshot.id)).toThrowError("stale_snapshot");
  });
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `cd product && corepack pnpm exec vitest run tests/unit/snapshot-store.test.ts`

Expected: FAIL because `SnapshotStore` is undefined.

- [ ] **Step 3: Implement the one-record store**

```ts
// product/src/snapshot-store.ts
import { randomBytes } from "node:crypto";
import { ComputerUseError } from "./errors.js";

export type SnapshotRecord = Readonly<{
  id: string;
  sessionId: string;
  width: number;
  height: number;
  createdAtMs: number;
}>;

export class SnapshotStore {
  private current?: SnapshotRecord;
  constructor(
    private readonly now: () => number = Date.now,
    private readonly token: () => string = () => randomBytes(18).toString("base64url"),
    private readonly idleMs = 30 * 60 * 1000,
  ) {}

  create(sessionId: string, width: number, height: number): SnapshotRecord {
    this.current = Object.freeze({ id: `snap_${this.token()}`, sessionId, width, height, createdAtMs: this.now() });
    return this.current;
  }

  requireCurrent(id: string): SnapshotRecord {
    this.expireIdle();
    if (!this.current || this.current.id !== id) throw new ComputerUseError("stale_snapshot", "stale_snapshot", "observe_again", true);
    return this.current;
  }

  consume(id: string): SnapshotRecord {
    const value = this.requireCurrent(id);
    this.current = undefined;
    return value;
  }

  clear(): void { this.current = undefined; }
  expireIdle(): void {
    if (this.current && this.now() - this.current.createdAtMs > this.idleMs) this.current = undefined;
  }
}
```

- [ ] **Step 4: Add session-clear and malformed-dimension cases**

Reject non-positive or non-integer dimensions at `create()`. Add tests showing `clear()` invalidates the current record and a new session replaces the previous session's snapshot.

- [ ] **Step 5: Run tests and commit**

Run: `cd product && corepack pnpm exec vitest run tests/unit/snapshot-store.test.ts && corepack pnpm typecheck`

Expected: all lifecycle tests pass.

```bash
git add product/src/snapshot-store.ts product/tests/unit/snapshot-store.test.ts
git commit -m "feat: guard actions with current snapshots"
```

---

### Task 4: Define the engine port and connect to the installed Cua daemon

**Files:**

- Create: `product/src/engine/port.ts`
- Create: `product/src/engine/cua.ts`
- Create: `product/tests/helpers/fake-cua-sdk.ts`
- Create: `product/tests/unit/cua-connection.test.ts`
- Create: `product/tests/fixtures/cua/desktop-state.json`

**Interfaces:**

- Produces: `EnginePort`, `EngineObservation`, `EngineExecution`, `CuaEngine.connect()`, `CuaSdkLike`.
- Consumes: `EngineLock`, `ComputerAction`, `ComputerUseError`.

- [ ] **Step 1: Write failing connection and contract tests**

```ts
// product/tests/unit/cua-connection.test.ts
import { describe, expect, it } from "vitest";
import { CaptureScope } from "@trycua/cua-driver";
import { CuaEngine } from "../../src/engine/cua.js";
import { loadEngineLock } from "../../src/engine/lock.js";
import { fakeSdk } from "../helpers/fake-cua-sdk.js";

const baselineLock = await loadEngineLock();
const requiredTools = [...baselineLock.required_tools];

it("rejects a daemon version that differs from the lock", async () => {
  const sdk = fakeSdk({ driverVersion: "0.22.0", tools: requiredTools });
  await expect(CuaEngine.fromSdk(sdk, baselineLock)).rejects.toMatchObject({ code: "engine_version_mismatch" });
});

it("rejects a missing required tool", async () => {
  const sdk = fakeSdk({ driverVersion: "0.22.1", tools: requiredTools.filter((name) => name !== "drag") });
  await expect(CuaEngine.fromSdk(sdk, baselineLock)).rejects.toMatchObject({ code: "engine_version_mismatch" });
});

it("starts one explicitly desktop-scoped session", async () => {
  const sdk = fakeSdk({ driverVersion: "0.22.1", tools: requiredTools, desktopUnlocked: true });
  const engine = await CuaEngine.fromSdk(sdk, baselineLock);
  expect(engine.sessionId).toMatch(/^ucu_/);
  expect(sdk.startSessionCalls).toHaveLength(1);
  expect(sdk.startSessionCalls[0]).toMatchObject({ captureScope: CaptureScope.Desktop });
});
```

Create `fake-cua-sdk.ts` as an intentionally narrow structural fake. It returns only `metadata`, `listToolsJson`, `startSession`, `callTool`, and `endSession`, plus call-record arrays used by assertions. `listToolsJson` must return `JSON.stringify({tools: names.map(name => ({name}))})`; `startSession` records its input and returns `{state:{session: input.session, desktopUnlocked}}`. `callTool` throws `unexpected_sdk_call` unless a test explicitly supplies a `ToolResult`. This makes tests fail if product code reaches another SDK method or silently changes the upstream JSON shape.

- [ ] **Step 2: Run and verify the missing-port failure**

Run: `cd product && corepack pnpm exec vitest run tests/unit/cua-connection.test.ts`

Expected: FAIL.

- [ ] **Step 3: Define the narrow port**

```ts
// product/src/engine/port.ts
import type { ComputerAction } from "../protocol.js";

export type EngineImage = Readonly<{ mimeType: "image/png"; dataBase64: string; width: number; height: number }>;
export type EngineObservation = Readonly<{ image: EngineImage; platform: "macos" | "windows"; scaleFactor: number }>;
export type EngineExecution = Readonly<{
  status: "executed" | "refused" | "failed";
  effect: "confirmed" | "partial" | "unverifiable" | "suspected_noop" | "refused";
  route: "accessibility" | "synthetic_events" | "global_input" | "system_api" | "dom" | "trusted_input" | "unknown";
  delivery: "background" | "foreground" | "not_applicable" | "unknown";
  errorCode?: string;
}>;

export interface EnginePort {
  readonly name: "cua-driver";
  readonly version: string;
  readonly sessionId: string;
  observe(signal: AbortSignal): Promise<EngineObservation>;
  execute(action: ComputerAction, signal: AbortSignal): Promise<EngineExecution>;
  close(): Promise<void>;
}
```

- [ ] **Step 4: Implement installed-daemon connection only**

```ts
// excerpt: product/src/engine/cua.ts
import { randomUUID } from "node:crypto";
import { CaptureScope, CuaDriver, type CuaDriverLike, type ToolResult } from "@trycua/cua-driver";

export type CuaSdkLike = Pick<CuaDriverLike,
  "metadata" | "listToolsJson" | "startSession" | "callTool" | "endSession"
>;

export class CuaEngine {
  readonly name = "cua-driver" as const;
  private constructor(
    private readonly sdk: CuaSdkLike,
    readonly version: string,
    readonly sessionId: string,
  ) {}

  static async connect(lock: EngineLock): Promise<CuaEngine> {
    let sdk: CuaSdkLike;
    try { sdk = CuaDriver.connect(undefined); }
    catch { throw new ComputerUseError("runtime_unavailable", "Cua Driver daemon is unavailable", "doctor", true); }
    return CuaEngine.fromSdk(sdk, lock);
  }

  static async fromSdk(sdk: CuaSdkLike, lock: EngineLock): Promise<CuaEngine> {
    const metadata = await sdk.metadata();
    if (metadata.driverVersion !== lock.version) throw new ComputerUseError("engine_version_mismatch", "Installed Cua version differs from engine.lock.json", "setup", false);
    const inventory = JSON.parse(await sdk.listToolsJson()) as { tools: Array<{ name: string }> };
    const names = new Set(inventory.tools.map((tool) => tool.name));
    if (lock.required_tools.some((name) => !names.has(name))) throw new ComputerUseError("engine_version_mismatch", "Cua tool contract is incomplete", "setup", false);
    const publicSession = `ucu_${randomUUID()}`;
    const started = await sdk.startSession({ session: publicSession, captureScope: CaptureScope.Desktop });
    if (!started.state.desktopUnlocked) throw new ComputerUseError("engine_version_mismatch", "Cua did not establish the requested desktop scope", "setup", false);
    return new CuaEngine(sdk, lock.version, started.state.session);
  }

  async observe(signal: AbortSignal): Promise<EngineObservation> {
    const result = await this.sdk.callTool("get_desktop_state", JSON.stringify({ session: this.sessionId }), { signal });
    return parseDesktopObservation(result);
  }

  async close(): Promise<void> {
    await this.sdk.endSession({ session: this.sessionId });
  }
}
```

Do not call `CuaDriver.create*`; only `connect()` preserves the separately installed daemon and macOS TCC identity.

- [ ] **Step 5: Parse one desktop observation fixture**

Store a sanitized `ToolResult` fixture with one PNG `images` entry and structured JSON containing platform, screenshot width/height, screen width/height and scale factor. Test missing image, non-PNG image, malformed JSON and zero dimensions as `capture_failed`.

`parseDesktopObservation()` must parse `result.structuredJson`, accept only `platform:"macos"|"windows"`, require exactly one usable PNG image, and return the image's declared screenshot width/height. It must not infer dimensions from `screen_width` or trust `scale_factor` as the action coordinate frame.

- [ ] **Step 6: Run tests and commit**

Run: `cd product && corepack pnpm exec vitest run tests/unit/cua-connection.test.ts && corepack pnpm typecheck`

Expected: connection/version/desktop-scope tests pass without accessing the real desktop. Actual locked-session and Session 0 detection belongs to observation/doctor error mapping, not the deprecated Cua capture-policy field named `desktopUnlocked`.

```bash
git add product/src/engine product/tests/helpers/fake-cua-sdk.ts product/tests/unit/cua-connection.test.ts product/tests/fixtures/cua/desktop-state.json
git commit -m "feat: connect to locked cua runtime"
```

---

### Task 5: Map nine actions and normalize Cua results

**Files:**

- Create: `product/src/engine/action-mapper.ts`
- Create: `product/src/engine/result-mapper.ts`
- Modify: `product/src/engine/cua.ts`
- Create: `product/tests/unit/action-mapper.test.ts`
- Create: `product/tests/unit/result-mapper.test.ts`

**Interfaces:**

- Produces: `mapAction(action, sessionId)`, `mapCuaResult(result)`, complete `CuaEngine.execute()`.
- Consumes: `ComputerAction`, `CuaSdkLike`, `EngineExecution`.

- [ ] **Step 1: Write the complete table-driven action test**

```ts
const cases = [
  [{ type: "click", x: 10, y: 20 }, "click", { x: 10, y: 20, button: "left", count: 1 }],
  [{ type: "double_click", x: 10, y: 20 }, "click", { x: 10, y: 20, button: "left", count: 2 }],
  [{ type: "right_click", x: 10, y: 20 }, "click", { x: 10, y: 20, button: "right", count: 1 }],
  [{ type: "move", x: 10, y: 20 }, "move_cursor", { x: 10, y: 20 }],
  [{ type: "drag", from_x: 1, from_y: 2, to_x: 3, to_y: 4, duration_ms: 200 }, "drag", { from_x: 1, from_y: 2, to_x: 3, to_y: 4, duration_ms: 200 }],
  [{ type: "scroll", x: 10, y: 20, direction: "down", amount: 5, by: "line" }, "scroll", { x: 10, y: 20, direction: "down", amount: 5, by: "line" }],
  [{ type: "type", text: "hello" }, "type_text", { text: "hello" }],
  [{ type: "keypress", keys: ["enter"] }, "press_key", { key: "enter" }],
  [{ type: "keypress", keys: ["cmd", "s"] }, "hotkey", { keys: ["cmd", "s"] }],
] as const;
```

For every Cua call append `session` and `target:{kind:"desktop",display_id:"primary"}` only when that Cua tool accepts `target`. Snapshot the exact JSON arguments so snake_case/camelCase drift fails loudly.

- [ ] **Step 2: Run and verify failure**

Run: `cd product && corepack pnpm exec vitest run tests/unit/action-mapper.test.ts tests/unit/result-mapper.test.ts`

Expected: FAIL because both mappers are missing.

- [ ] **Step 3: Implement a pure action mapper**

```ts
export type CuaCall = Readonly<{ tool: string; args: Record<string, unknown> }>;

export function mapAction(action: ComputerAction, session: string): CuaCall | { waitMs: number } {
  const desktop = { kind: "desktop", display_id: "primary" };
  switch (action.type) {
    case "click": return { tool: "click", args: { session, target: desktop, x: action.x, y: action.y, button: "left", count: 1 } };
    case "double_click": return { tool: "click", args: { session, target: desktop, x: action.x, y: action.y, button: "left", count: 2 } };
    case "right_click": return { tool: "click", args: { session, target: desktop, x: action.x, y: action.y, button: "right", count: 1 } };
    case "move": return { tool: "move_cursor", args: { session, target: desktop, x: action.x, y: action.y } };
    case "drag": return { tool: "drag", args: { session, target: desktop, from_x: action.from_x, from_y: action.from_y, to_x: action.to_x, to_y: action.to_y, duration_ms: action.duration_ms } };
    case "scroll": return { tool: "scroll", args: { session, target: desktop, x: action.x, y: action.y, direction: action.direction, amount: action.amount, by: action.by ?? "line" } };
    case "type": return { tool: "type_text", args: { session, target: desktop, text: action.text } };
    case "keypress": return action.keys.length === 1
      ? { tool: "press_key", args: { session, target: desktop, key: action.keys[0] } }
      : { tool: "hotkey", args: { session, target: desktop, keys: action.keys } };
    case "wait": return { waitMs: action.ms };
  }
  const exhaustive: never = action;
  throw new ComputerUseError("unsupported_action", `Unsupported action: ${String(exhaustive)}`, "stop", false);
}
```

- [ ] **Step 4: Map outcomes without inventing success**

Use `ToolResult.action` when present. Map `isError`, `errorCode`, effect and escalation into stable errors. Preserve all five effects. A Cua `refused` effect becomes `status:"refused"`; `partial`, `unverifiable`, and `suspected_noop` remain `status:"executed"` with their original effect so the model can inspect the next screenshot.

Map known permission, locked-desktop and privilege errors explicitly; unknown non-transport errors become `action_failed`, not `runtime_unavailable`.

- [ ] **Step 5: Implement cancellable local wait and SDK execution**

Change the class declaration to `export class CuaEngine implements EnginePort` and add:

```ts
async execute(action: ComputerAction, signal: AbortSignal): Promise<EngineExecution> {
  const mapped = mapAction(action, this.sessionId);
  if ("waitMs" in mapped) {
    await cancellableWait(mapped.waitMs, signal);
    return { status: "executed", effect: "confirmed", route: "system_api", delivery: "not_applicable" };
  }
  const result = await this.sdk.callTool(mapped.tool, JSON.stringify(mapped.args), { signal });
  return mapCuaResult(result);
}
```

`cancellableWait` registers one abort listener, clears its timer on abort, and removes the listener on resolve. It rejects with an `AbortError`; the core timeout mapper converts that to `action_timeout`.

- [ ] **Step 6: Run focused tests and commit**

Run: `cd product && corepack pnpm exec vitest run tests/unit/action-mapper.test.ts tests/unit/result-mapper.test.ts && corepack pnpm typecheck`

Expected: all nine mapping rows and all result classifications pass.

```bash
git add product/src/engine product/tests/unit/action-mapper.test.ts product/tests/unit/result-mapper.test.ts
git commit -m "feat: translate lightweight actions to cua"
```

---

### Task 6: Implement observe and single-action orchestration

**Files:**

- Create: `product/src/core/observe.ts`
- Create: `product/src/core/act.ts`
- Create: `product/src/core/serial-executor.ts`
- Create: `product/src/core/runtime.ts`
- Create: `product/tests/helpers/fake-engine.ts`
- Create: `product/tests/unit/observe.test.ts`
- Create: `product/tests/unit/act.test.ts`

**Interfaces:**

- Produces: `SerialExecutor.run()`, `ComputerUseRuntime.observe()`, `ComputerUseRuntime.act(input)`, `ComputerUseRuntime.close()`.
- Consumes: `EnginePort`, `SnapshotStore`, protocol output types.

- [ ] **Step 1: Write failing observe tests**

```ts
it("returns one current snapshot with the exact engine PNG", async () => {
  const { runtime, engine } = fixtureRuntime({ width: 100, height: 80, dataBase64: "cG5n" });
  const first = await runtime.observe();
  const second = await runtime.observe();
  expect(first.image.dataBase64).toBe("cG5n");
  expect(second.structured.screenshot).toEqual({ mime_type: "image/png", width: 100, height: 80 });
  expect(second.structured.snapshot_id).not.toBe(first.structured.snapshot_id);
  await expect(runtime.act({ snapshot_id: first.structured.snapshot_id, action: { type: "wait", ms: 0 } }))
    .rejects.toMatchObject({ code: "stale_snapshot" });
  expect(engine.observations).toBe(2);
});

it("leaves no snapshot when capture fails", async () => {
  const { runtime } = fixtureRuntime({ observationSequence: ["success", "capture_failed"] });
  const first = await runtime.observe();
  await expect(runtime.observe()).rejects.toMatchObject({ code: "capture_failed" });
  await expect(runtime.act({ snapshot_id: first.structured.snapshot_id, action: { type: "wait", ms: 0 } }))
    .rejects.toMatchObject({ code: "stale_snapshot" });
});
```

- [ ] **Step 2: Write failing act tests**

```ts
it("rejects out-of-bounds coordinates before the engine call", async () => {
  const { runtime, engine } = fixtureRuntime({ width: 100, height: 80 });
  const observed = await runtime.observe();
  await expect(runtime.act({ snapshot_id: observed.structured.snapshot_id, action: { type: "click", x: 100, y: 20 } }))
    .rejects.toMatchObject({ code: "coordinate_out_of_bounds" });
  expect(engine.executions).toHaveLength(0);
});

it("consumes before action and returns a new screenshot after failure", async () => {
  const { runtime, engine } = fixtureRuntime({ actionError: "action_failed" });
  const observed = await runtime.observe();
  const result = await runtime.act({ snapshot_id: observed.structured.snapshot_id, action: { type: "click", x: 10, y: 10 } });
  expect(result.structured.action_result.status).toBe("failed");
  expect(result.structured.snapshot_id).not.toBe(observed.structured.snapshot_id);
  await expect(runtime.act({ snapshot_id: observed.structured.snapshot_id, action: { type: "wait", ms: 0 } }))
    .rejects.toMatchObject({ code: "stale_snapshot" });
  expect(engine.observations).toBe(2);
});
```

Also test timeout at 20 seconds, action plus recapture failure, one transient recapture retry, stale snapshot, key/text actions that have no coordinates, and two concurrent acts using the same snapshot. The concurrent case must execute the engine exactly once; the second call receives `stale_snapshot`.

Create `tests/helpers/fake-engine.ts` before implementing the runtime. It exports `fixtureRuntime(options)` and a `FakeEngine implements EnginePort` with fixed name/version/session, an `observations` counter, an `executions: ComputerAction[]` recorder, and configurable `width`, `height`, `dataBase64`, `platform`, `observationSequence`, and `actionError`. `observe()` consumes `observationSequence` and throws a retryable `ComputerUseError("capture_failed", ...)` only for the configured failure entries. `execute()` records exactly one action, throws the configured stable error when requested, and otherwise returns `{status:"executed", effect:"unverifiable", route:"unknown", delivery:"unknown"}`. No helper accesses Cua or the real desktop.

- [ ] **Step 3: Run and verify failures**

Run: `cd product && corepack pnpm exec vitest run tests/unit/observe.test.ts tests/unit/act.test.ts`

Expected: FAIL.

- [ ] **Step 4: Implement FIFO serialization and coordinate validation**

`SerialExecutor` is a promise-tail queue whose `run()` schedules the next operation after either success or failure of the previous one. Every public `observe`, `act`, and final engine close goes through this one queue. Invocation order therefore defines desktop order even if a host issues parallel MCP calls; the queue never retries or combines actions.

```ts
export class SerialExecutor {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
```

```ts
export function assertCoordinates(action: ComputerAction, snapshot: SnapshotRecord): void {
  const points = action.type === "drag"
    ? [[action.from_x, action.from_y], [action.to_x, action.to_y]]
    : action.type === "click" || action.type === "double_click" || action.type === "right_click" || action.type === "move" || action.type === "scroll"
      ? [[action.x, action.y]]
      : [];
  for (const [x, y] of points) {
    if (x < 0 || y < 0 || x >= snapshot.width || y >= snapshot.height) {
      throw new ComputerUseError("coordinate_out_of_bounds", "Coordinate is outside the current screenshot", "observe_again", true);
    }
  }
}
```

Out-of-bounds requests do not consume the snapshot because no engine call can occur.

- [ ] **Step 5: Implement the runtime**

```ts
export class ComputerUseRuntime {
  private readonly serial = new SerialExecutor();
  private readonly lifecycle = new AbortController();
  private closePromise?: Promise<void>;
  constructor(private readonly engine: EnginePort, private readonly snapshots = new SnapshotStore()) {}

  async observe(): Promise<ObservationEnvelope> {
    return this.serial.run(() => this.observeUnlocked());
  }

  private async observeUnlocked(): Promise<ObservationEnvelope> {
    this.snapshots.clear();
    const observed = await withTimeout((signal) => this.engine.observe(signal), 20_000, "capture_failed", this.lifecycle.signal);
    const snapshot = this.snapshots.create(this.engine.sessionId, observed.image.width, observed.image.height);
    return toObservationEnvelope(this.engine, snapshot, observed);
  }

  async act(input: ActInput): Promise<ActEnvelope> {
    return this.serial.run(() => this.actUnlocked(input));
  }

  private async actUnlocked(input: ActInput): Promise<ActEnvelope> {
    const snapshot = this.snapshots.requireCurrent(input.snapshot_id);
    assertCoordinates(input.action, snapshot);
    this.snapshots.consume(input.snapshot_id);
    let actionResult: EngineExecution;
    try { actionResult = await withTimeout((signal) => this.engine.execute(input.action, signal), 20_000, "action_timeout", this.lifecycle.signal); }
    catch (error) { actionResult = failedExecution(error); }
    const observed = await observeWithOneTransientRetry(this.engine, this.lifecycle.signal);
    const next = this.snapshots.create(this.engine.sessionId, observed.image.width, observed.image.height);
    return toActEnvelope(this.engine, snapshot.id, next, actionResult, observed);
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.lifecycle.abort();
    this.closePromise = this.serial.run(async () => { this.snapshots.clear(); await this.engine.close(); });
    return this.closePromise;
  }
}
```

Add the helpers below to `observe.ts` and `act.ts`:

```ts
export async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  timeoutCode: "action_timeout" | "capture_failed",
  lifecycleSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const signal = lifecycleSignal ? AbortSignal.any([controller.signal, lifecycleSignal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await run(signal); }
  catch (error) {
    if (controller.signal.aborted) throw new ComputerUseError(timeoutCode, timeoutCode, "observe_again", true);
    if (lifecycleSignal?.aborted) throw new ComputerUseError("runtime_unavailable", "Runtime is closing", "stop", false);
    throw error;
  } finally { clearTimeout(timer); }
}

export async function observeWithOneTransientRetry(engine: EnginePort, lifecycleSignal: AbortSignal): Promise<EngineObservation> {
  try { return await withTimeout((signal) => engine.observe(signal), 20_000, "capture_failed", lifecycleSignal); }
  catch (error) {
    if (!(error instanceof ComputerUseError) || error.code !== "capture_failed" || !error.retryable) throw error;
    return withTimeout((signal) => engine.observe(signal), 20_000, "capture_failed", lifecycleSignal);
  }
}

export function failedExecution(error: unknown): EngineExecution {
  const code = error instanceof ComputerUseError ? error.code : "action_failed";
  return { status: "failed", effect: "unverifiable", route: "unknown", delivery: "unknown", errorCode: code };
}

export function toObservationEnvelope(engine: EnginePort, snapshot: SnapshotRecord, value: EngineObservation): ObservationEnvelope {
  return {
    structured: {
      protocol_version: PROTOCOL_VERSION,
      session_id: engine.sessionId,
      snapshot_id: snapshot.id,
      platform: value.platform,
      display_id: "primary",
      screenshot: { mime_type: "image/png", width: value.image.width, height: value.image.height },
      engine: { name: engine.name, version: engine.version },
    },
    image: { mimeType: "image/png", dataBase64: value.image.dataBase64 },
  };
}

export function toActEnvelope(
  engine: EnginePort,
  consumedId: string,
  snapshot: SnapshotRecord,
  result: EngineExecution,
  value: EngineObservation,
): ActEnvelope {
  return {
    structured: {
      protocol_version: PROTOCOL_VERSION,
      session_id: engine.sessionId,
      consumed_snapshot_id: consumedId,
      snapshot_id: snapshot.id,
      action_result: {
        status: result.status,
        effect: result.effect,
        route: result.route,
        delivery: result.delivery,
        ...(result.errorCode ? { error_code: result.errorCode } : {}),
      },
      screenshot: { mime_type: "image/png", width: value.image.width, height: value.image.height },
    },
    image: { mimeType: "image/png", dataBase64: value.image.dataBase64 },
  };
}
```

If recapture fails twice, the store remains empty because the consumed snapshot was already removed and no new snapshot is created. Never repeat the action.

- [ ] **Step 6: Run all core tests and commit**

Run: `cd product && corepack pnpm exec vitest run tests/unit/{snapshot-store,observe,act}.test.ts && corepack pnpm typecheck`

Expected: all tests pass with fake timers and no real desktop access.

```bash
git add product/src/core product/tests/helpers/fake-engine.ts product/tests/unit/observe.test.ts product/tests/unit/act.test.ts
git commit -m "feat: run one screenshot-bound action at a time"
```

---

### Task 7: Expose the runtime through a two-tool stdio MCP server

**Files:**

- Create: `product/src/mcp/handlers.ts`
- Create: `product/src/mcp/server.ts`
- Create: `product/src/mcp/main.ts`
- Create: `product/tests/contract/mcp-server.test.ts`
- Create: `product/tests/contract/stdio-smoke.test.ts`

**Interfaces:**

- Produces: `createComputerUseServer(runtime)`, executable `computer-use-mcp`.
- Consumes: `ComputerUseRuntime`, protocol schemas and stable errors.

- [ ] **Step 1: Write a failing in-memory MCP contract test**

Connect an MCP `Client` and server with `InMemoryTransport.createLinkedPair()`. Assert the listed tools are exactly `computer_observe` and `computer_act`; observe returns one text block, one PNG image block and matching `structuredContent`; act rejects `actions[]`; stable errors set `isError:true` and include `code`, `recovery`, and `retryable`.

- [ ] **Step 2: Run and verify missing server failure**

Run: `cd product && corepack pnpm exec vitest run tests/contract/mcp-server.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement handlers with image-safe responses**

```ts
export function observationToMcp(value: ObservationEnvelope): CallToolResult {
  return {
    content: [
      { type: "text", text: JSON.stringify(value.structured) },
      { type: "image", mimeType: value.image.mimeType, data: value.image.dataBase64 },
    ],
    structuredContent: value.structured,
  };
}
```

`act` uses the same two-block pattern. Validate inputs before calling the runtime. Convert `ComputerUseError` to a tool error without stack traces or input echoing.

- [ ] **Step 4: Register exactly two tools**

Use `McpServer.registerTool` with strict input schemas and read-only/destructive annotations that truthfully describe observe and act. Do not mark act read-only merely to suppress host approvals.

- [ ] **Step 5: Protect stdout and process shutdown**

The stdio entry point writes diagnostics to stderr only. On `SIGINT`, `SIGTERM`, or transport close, abort the active call, close the product runtime, end the Cua session and exit. Add a smoke child-process test that initializes, lists tools, closes stdin, and asserts exit code 0 with parseable stdout frames only.

- [ ] **Step 6: Build, test, and commit**

Run: `cd product && corepack pnpm build && corepack pnpm exec vitest run tests/contract/{mcp-server,stdio-smoke}.test.ts`

Expected: two tools listed; both image responses round-trip; clean shutdown passes.

```bash
git add product/src/mcp product/tests/contract/mcp-server.test.ts product/tests/contract/stdio-smoke.test.ts
git commit -m "feat: expose two-tool computer use mcp"
```

---

### Task 8: Add setup, doctor, config and safe uninstall commands

**Files:**

- Create: `product/src/cli/process-runner.ts`
- Create: `product/src/cli/setup.ts`
- Create: `product/src/cli/doctor.ts`
- Create: `product/src/cli/config.ts`
- Create: `product/src/cli/uninstall.ts`
- Create: `product/src/cli/main.ts`
- Create: `product/tests/unit/cli-setup.test.ts`
- Create: `product/tests/unit/cli-doctor.test.ts`
- Create: `product/tests/unit/cli-config.test.ts`
- Create: `docs/installation/macos.md`
- Create: `docs/installation/windows.md`

**Interfaces:**

- Produces: `computer-use setup|doctor|config|uninstall|mcp`.
- Consumes: `EngineLock`, `CuaEngine.connect()`, MCP main entry point.

- [ ] **Step 1: Write failing setup delegation tests**

Using a fake downloader and process runner, assert:

- macOS downloads `install.sh` from the exact release plus `_install-rust.sh` and `_install-common.sh` from the exact source commit into one temporary directory, verifies every recorded SHA-256, and executes the local entry point with `CUA_DRIVER_RS_VERSION=0.22.1` plus `--autostart`;
- Windows downloads `install.ps1` from the exact release plus `_install-common.psm1` from the exact source commit into one temporary directory, verifies every SHA-256, and runs `powershell.exe -NoProfile -ExecutionPolicy Bypass -File INSTALLER_PATH -Release 0.22.1 -AutoStart`;
- a checksum mismatch in any installer file deletes the exact temporary directory and never executes an installer;
- unsupported OS/architecture returns `unsupported_platform`;
- a platform whose lock has `release_eligible:false` returns `engine_not_release_eligible` before any download;
- setup never downloads `latest` and never modifies a host config automatically.

- [ ] **Step 2: Write failing doctor tests**

Doctor JSON must contain product/protocol/engine versions, supported platform, engine connected, required tools present, desktop unlocked, permissions status where reported, observation succeeded, screenshot dimensions, and an overall `ok`. Any required failure sets `ok:false` and process exit 1.

- [ ] **Step 3: Run and verify failures**

Run: `cd product && corepack pnpm exec vitest run tests/unit/cli-{setup,doctor,config}.test.ts`

Expected: FAIL.

- [ ] **Step 4: Implement a fully injected process boundary**

```ts
export interface ProcessRunner {
  run(command: string, args: string[], options: { env?: NodeJS.ProcessEnv; timeoutMs: number }): Promise<{ code: number; stdout: string; stderr: string }>;
}

export interface Downloader {
  download(url: URL, destination: string): Promise<void>;
}
```

Use `mkdtemp` under the OS temporary directory and remove that exact directory in `finally`. Do not use shell interpolation; pass executable and arguments separately.

- [ ] **Step 5: Implement setup and doctor**

Construct release-file URLs from `https://github.com/trycua/cua/releases/download/{tag}/{name}` and source-file URLs from `https://raw.githubusercontent.com/trycua/cua/{source_commit}/libs/cua-driver/scripts/{name}`. Never fetch executable installer code through `cua.ai` or a moving branch. Placing all helper files beside the entry point forces Cua's own local-helper path and avoids its network fallback.

After upstream installation, verify the reported Cua version equals the lock. On macOS, require `codesign --verify --deep --strict` and a successful Gatekeeper assessment for `CuaDriver.app`; on Windows, require `Get-AuthenticodeSignature` status `Valid` for the installed executable. Then start/kick the official daemon, run doctor, and print the generic config command. macOS permission prompts are delegated to Cua's official `permissions grant` flow. Doctor performs one observation only and never sends an input action. The locked release-asset SHA is release-promotion evidence; setup does not claim to hash the archive internally downloaded by the unmodified upstream installer.

- [ ] **Step 6: Implement deterministic config output**

Generic output:

```json
{
  "mcpServers": {
    "computer-use": {
      "command": "/absolute/path/to/computer-use-mcp",
      "args": []
    }
  }
}
```

Codex prints `codex mcp add computer-use -- /absolute/path/to/computer-use-mcp`. Kimi prints `kimi mcp add computer-use -- /absolute/path/to/computer-use-mcp`. JSON output is stdout-only; explanation goes to stderr.

- [ ] **Step 7: Implement safe uninstall semantics**

Default `computer-use uninstall` removes only product-owned Skill/config links and prints whether Cua remains installed. `computer-use uninstall --engine` delegates to the exact upstream uninstaller only after an explicit flag; it does not remove user host configuration outside known product-owned entries.

- [ ] **Step 8: Document platform setup**

Both platform guides include prerequisites, setup, doctor, system permission/UAC limitations, host config, upgrade, uninstall, troubleshooting, and the statement “this plugin uses the host Agent's current multimodal model.”

- [ ] **Step 9: Run tests and commit**

Run: `cd product && corepack pnpm exec vitest run tests/unit/cli-*.test.ts && corepack pnpm build`

Expected: all delegation/diagnostic/config tests pass without downloading or installing Cua.

```bash
git add product/src/cli product/tests/unit/cli-*.test.ts docs/installation
git commit -m "feat: add computer use setup and diagnostics"
```

---

### Task 9: Publish the canonical Skill and initial host integrations

**Files:**

- Create: `product/skills/computer-use/SKILL.md`
- Create: `product/integrations/generic/mcp.json`
- Create: `product/integrations/codex/README.md`
- Create: `product/integrations/kimi/README.md`
- Create: `product/tests/contract/skill-policy.test.ts`
- Create: `product/tests/contract/integrations.test.ts`
- Create: `docs/host-compatibility.md`

**Interfaces:**

- Produces: one canonical loop used by every host; generic/Codex/Kimi installation instructions.
- Consumes: two MCP tool names and protocol behavior.

- [ ] **Step 1: Write failing Skill policy checks**

The test must assert the Skill says:

1. observe before the first act;
2. inspect the newest screenshot before every next action;
3. use only the newest snapshot ID;
4. send one action per act call;
5. never repeat a failed or uncertain action blindly;
6. stop tool use when the visible goal is satisfied;
7. report permission/runtime blockers;
8. use the host's current vision model and never request a plugin model key.

It must reject the strings `computer_verify`, `element_token`, `actions[]`, and any instruction to bypass host policy.

- [ ] **Step 2: Run and verify failure**

Run: `cd product && corepack pnpm exec vitest run tests/contract/skill-policy.test.ts tests/contract/integrations.test.ts`

Expected: FAIL because Skill and integrations are absent.

- [ ] **Step 3: Write the canonical Skill**

Keep it under 180 lines. Include the action schema, recovery table and loop once. Host README files link or install the canonical Skill; they must not copy the loop text.

- [ ] **Step 4: Add generic, Codex and Kimi integration files**

Every integration launches the same `computer-use-mcp` binary and exposes the same two tools. No file contains model endpoint, model name, API key, TokenHub or provider SDK fields.

- [ ] **Step 5: Define compatibility status vocabulary**

`docs/host-compatibility.md` uses only `verified`, `experimental`, `not-compatible`, and `not-tested`, with evidence date, OS, host version, image delivery, continuous loop, automatic-mode behavior and limitation columns.

- [ ] **Step 6: Test and commit**

Run: `cd product && corepack pnpm exec vitest run tests/contract/{skill-policy,integrations}.test.ts`

Expected: policy and all three initial integration contracts pass.

```bash
git add product/skills product/integrations product/tests/contract/skill-policy.test.ts product/tests/contract/integrations.test.ts docs/host-compatibility.md
git commit -m "feat: package computer use skill and host configs"
```

---

### Task 10: Build deterministic desktop and platform E2E lanes

**Files:**

- Create: `product/tests/fixtures/desktop-harness/index.html`
- Create: `product/tests/fixtures/desktop-harness/server.mjs`
- Create: `product/tests/e2e/shared/desktop-harness.spec.ts`
- Create: `product/tests/e2e/macos/run.sh`
- Create: `product/tests/e2e/macos/retina.spec.ts`
- Create: `product/tests/e2e/windows/run.ps1`
- Create: `product/tests/e2e/windows/dpi.spec.ts`
- Create: `product/tests/e2e/host/codex.md`
- Create: `product/tests/e2e/host/kimi.md`

**Interfaces:**

- Produces: repeatable evidence that the wrapper crosses MCP → Cua → OS → visible fixture and back.
- Consumes: built CLI/MCP package and installed eligible Cua Runtime.

- [ ] **Step 1: Create the fixed visual harness before the runner**

The page must contain at fixed CSS coordinates: a click counter, double/right-click counters, text input, scroll target, drag source/drop target and a visible JSON state panel. `server.mjs` exposes `/state` so tests verify external state rather than trusting an action result.

- [ ] **Step 2: Write the failing shared E2E**

The test launches the harness in a fixed-size Chrome/Edge window, calls `computer_observe`, derives action coordinates from the fixed window placement, performs every v1 action one at a time, and reads `/state` after each action. It also proves old snapshot rejection and checks every act response includes a different PNG snapshot.

- [ ] **Step 3: Add macOS runner gates**

`run.sh` requires an interactive Aqua session, exact eligible Cua version, Screen Recording, Accessibility, Chrome, and a nonzero Retina backing scale. Missing prerequisites are hard failures in `CUA_E2E=1` mode. `retina.spec.ts` compares screenshot dimensions, Cua scale metadata and a click oracle on the fixed fixture.

- [ ] **Step 4: Add Windows runner gates**

`run.ps1` rejects Session 0, locked/disconnected desktop, non-x64 v1 hosts and incorrect Cua version. Run the shared fixture at 100%, 125% and 150% scaling on separate configured lanes. `dpi.spec.ts` checks click and drag oracles and verifies an elevated target returns `target_privilege_mismatch` rather than silently succeeding.

- [ ] **Step 5: Add real-app acceptance scripts**

The Codex and Kimi checklists each run “open TextEdit/Notepad and type a unique sentence” plus “calculate 37 × 19 and report the visible result.” Record host/model/OS versions, tool discovery, image delivery, natural stop and approval behavior. These are host acceptance checks, not substitutes for the deterministic fixture.

- [ ] **Step 6: Run the platform lanes**

macOS: `cd product && CUA_E2E=1 corepack pnpm exec vitest run tests/e2e/shared tests/e2e/macos --sequence.concurrent=false`

Windows: `cd product; $env:CUA_E2E='1'; corepack pnpm exec vitest run tests/e2e/shared tests/e2e/windows --sequence.concurrent=false`

Expected: all nine actions change the external fixture as expected, every old snapshot is rejected, and all screenshots use the same coordinate frame as actions.

- [ ] **Step 7: Repeat the deterministic fixture 20 times per platform**

Run the same suite with a repeat flag. Required plugin-seam result is 20/20 on each accepted lane; Cua refusals that are part of the declared platform limitation must be classified, not counted as success.

- [ ] **Step 8: Commit**

```bash
git add product/tests/fixtures product/tests/e2e
git commit -m "test: prove desktop control on macos and windows"
```

---

### Task 11: Add remaining host wrappers, private logs and release gates

**Files:**

- Create: `product/integrations/workbuddy/.codebuddy-plugin/plugin.json`
- Create: `product/integrations/workbuddy/.mcp.json`
- Create: `product/integrations/deepseek-harness/package.json`
- Create: `product/integrations/deepseek-harness/index.js`
- Create: `product/integrations/deepseek-harness/cordis.patch.yml`
- Create: `product/src/logging/logger.ts`
- Create: `product/src/logging/redaction.ts`
- Create: `product/tests/unit/redaction.test.ts`
- Create: `product/tests/contract/release.test.ts`
- Create: `product/scripts/select-engine-release.mjs`
- Create: `product/scripts/verify-release.mjs`
- Create: `docs/THIRD_PARTY_NOTICES.md`
- Create: `docs/troubleshooting.md`
- Create: `.github/workflows/computer-use-ci.yml`
- Create: `.github/workflows/computer-use-e2e.yml`

**Interfaces:**

- Produces: remaining thin host adapters, metadata-only logs, verified npm artifact, engine promotion workflow and CI gates.
- Consumes: canonical Skill, engine lock, built MCP binary, platform E2E commands.

- [ ] **Step 1: Write failing privacy and release tests**

Seed fixtures with distinctive typed text, keys, screenshot base64, environment secret and model prompt. Assert none appear in log output. Release tests assert package contents, two-tool schemas, engine lock, MIT notice, absence of Cua native binaries/Rust source, and absence of model SDK dependencies.

- [ ] **Step 2: Run and verify failures**

Run: `cd product && corepack pnpm exec vitest run tests/unit/redaction.test.ts tests/contract/release.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement metadata-only JSONL logging**

Allow levels `off` and `metadata`, default `metadata`. Record timestamp, session ID hash, snapshot ID hash, tool name, action type, duration, effect, route, delivery and stable error code. Redaction receives structured events and drops any keys named `text`, `keys`, `data`, `dataBase64`, `clipboard`, `prompt`, `env`, or `environment` recursively.

- [ ] **Step 4: Build thin WorkBuddy and DeepSeek Harness wrappers**

WorkBuddy uses `.codebuddy-plugin/plugin.json` plus `.mcp.json`. DeepSeek Harness follows its `dsh` bundle/Cordis shape but only starts `computer-use-mcp`; it must not include a model client, image analyzer or internal agent loop. Mark each wrapper `experimental` until its host acceptance checklist passes.

- [ ] **Step 5: Implement exact engine promotion**

`select-engine-release.mjs VERSION` takes one explicit semantic version argument. It must query the matching GitHub release/tag, verify the release commit contains every `required_fix_commits` commit, download `checksums.txt`, select the macOS universal and Windows x64 assets, hash the release entry installers and source-commit helper scripts, update `engine.lock.json`, update `@trycua/cua-driver` to the same exact version, run contract/unit tests, and set platform eligibility true only after platform E2E evidence paths are supplied. It refuses nightly tags and uncommitted working trees.

- [ ] **Step 6: Implement release verification**

`verify-release.mjs` runs package tests/typecheck/build, calls `assertReleaseEligible` for both platforms, verifies `pnpm pack --dry-run` contents, checks third-party notices, and rejects native Cua files, `.env` files, screenshots and trace artifacts.

- [ ] **Step 7: Add CI**

Pull requests run unit, contract, typecheck, build and package inspection on macOS and Windows. Interactive E2E runs only on labeled, logged-in machines and publishes redacted JSON results without screenshots by default. Release requires both platform E2E gates and Codex/Kimi host checklists.

- [ ] **Step 8: Complete documentation and compatibility statuses**

Document known v1 limits, permission recovery, engine mismatch, locked desktop, Windows elevation, Retina/DPI diagnosis, host approval settings and log location. WorkBuddy/DeepSeek status changes to `verified` only after the same image-loop-stop evidence required for Codex/Kimi.

- [ ] **Step 9: Run the full release gate and commit**

Run: `cd product && corepack pnpm test && corepack pnpm typecheck && corepack pnpm build && corepack pnpm release:verify`

Expected: all code gates pass. Before an eligible Retina-fixed Cua release is selected, the final command must fail only with `engine_not_release_eligible`; after promotion and E2E evidence, it exits 0.

```bash
git add product/integrations product/src/logging product/tests product/scripts docs .github/workflows
git commit -m "chore: harden computer use release"
```

---

## Subagent execution order and review gates

Use one fresh implementation subagent per task. Tasks 1–9 are sequential because later interfaces depend on earlier ones. Task 10 may begin only after Task 7's real stdio server works and Task 8's doctor passes on the target machine. Task 11 begins after the deterministic E2E harness exists.

The primary agent performs two reviews after every task:

1. **Specification review:** confirm the task changed only its declared files and did not add models, batches, element trees, background semantics, native Cua code or extra MCP tools.
2. **Quality review:** run the focused tests, typecheck touched interfaces, inspect logs for sensitive data and check the commit diff for unrelated changes.

Any subagent that needs to edit Cua Rust/native files, change the two-tool protocol, follow `latest`, introduce a GUI or weaken truthful MCP annotations must stop and return the evidence instead of implementing the change.

## Final acceptance checklist

- [ ] `computer-use-mcp` lists exactly two tools.
- [ ] Both tools return byte-valid PNG `ImageContent` plus matching structured content.
- [ ] Every act accepts exactly one action and consumes the current snapshot before the engine call.
- [ ] Old and out-of-bounds screenshot coordinates cannot reach Cua.
- [ ] Action failure never triggers an automatic action retry.
- [ ] Action and capture failures remain distinguishable.
- [ ] Cua version/tool drift fails closed.
- [ ] No Cua Rust/native binary is copied into the repository or npm package.
- [ ] Public release uses a formal Cua version containing the Retina fix.
- [ ] macOS permission setup and Windows privilege mismatch are explicit.
- [ ] macOS Retina and Windows 100/125/150% DPI lanes pass.
- [ ] Deterministic fixture passes 20/20 on both accepted platforms.
- [ ] Codex and Kimi receive images, continue the loop and stop naturally.
- [ ] Host approval limitations are documented truthfully.
- [ ] WorkBuddy and DeepSeek Harness are never labeled verified without evidence.
- [ ] No plugin model endpoint, key or provider dependency exists.
- [ ] Logs contain no text, keys, images, clipboard, prompts or environment data.
- [ ] Installation, doctor, upgrade, safe uninstall, license and troubleshooting docs are complete.
