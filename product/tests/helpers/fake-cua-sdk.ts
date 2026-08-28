import {
  CaptureScope,
  EffectiveScope,
  type DriverMetadata,
  type EndSessionInput,
  type EndSessionOutput,
  type StartSessionInput,
  type StartSessionOutput,
  type ToolResult,
} from "@trycua/cua-driver";

import type { CuaSdkLike } from "../../src/engine/cua.js";

type FakeSdkOptions = Readonly<{
  driverVersion: string;
  tools: readonly string[];
  toolsJson?: string;
  desktopUnlocked?: boolean;
  effectiveScope?: EffectiveScope;
  toolResult?: ToolResult;
  toolResults?: Readonly<Record<string, ToolResult | readonly ToolResult[]>>;
}>;

export type FakeCuaSdk = CuaSdkLike & {
  readonly startSessionCalls: StartSessionInput[];
  readonly callToolCalls: Array<Readonly<{ name: string; argumentsJson: string }>>;
  readonly endSessionCalls: EndSessionInput[];
};

export function fakeSdk(options: FakeSdkOptions): FakeCuaSdk {
  const startSessionCalls: StartSessionInput[] = [];
  const callToolCalls: Array<Readonly<{ name: string; argumentsJson: string }>> = [];
  const endSessionCalls: EndSessionInput[] = [];
  const perToolResults = new Map<string, ToolResult[]>(
    Object.entries(options.toolResults ?? {}).map(([name, value]) => [
      name,
      Array.isArray(value) ? [...value] : [value as ToolResult],
    ]),
  );

  return {
    startSessionCalls,
    callToolCalls,
    endSessionCalls,
    async metadata(): Promise<DriverMetadata> {
      return {
        driverVersion: options.driverVersion,
        contractVersion: "fixture",
        toolsListSchemaVersion: "fixture",
        capabilityVersion: "fixture",
        mcpProtocolVersion: "fixture",
        pid: 1,
        embedded: false,
      };
    },
    async listToolsJson(): Promise<string> {
      return options.toolsJson ?? JSON.stringify({ tools: options.tools.map((name) => ({ name })) });
    },
    async startSession(input: StartSessionInput): Promise<StartSessionOutput> {
      startSessionCalls.push(input);
      return {
        state: {
          session: input.session ?? "implicit",
          captureScope: input.captureScope ?? CaptureScope.Auto,
          effectiveScope: options.effectiveScope ?? EffectiveScope.Desktop,
          desktopUnlocked: options.desktopUnlocked ?? true,
        },
        active: true,
        revived: false,
      };
    },
    async callTool(name: string, argumentsJson: string): Promise<ToolResult> {
      callToolCalls.push({ name, argumentsJson });
      const queued = perToolResults.get(name);
      if (queued !== undefined && queued.length > 0) return queued.shift()!;
      if (options.toolResult !== undefined) return options.toolResult;
      throw new Error("unexpected_sdk_call");
    },
    async endSession(input: EndSessionInput): Promise<EndSessionOutput> {
      endSessionCalls.push(input);
      return { session: input.session ?? "implicit", active: false };
    },
  };
}
