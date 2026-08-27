import { z } from "zod";

import { PROTOCOL_VERSION } from "./version.js";

const coordinate = z.number().finite().min(0);
const dragDuration = z.number().int().min(0).max(10_000).optional();
const key = z.string().min(1).max(24).regex(/^[A-Za-z0-9_+-]+$/);

export const ComputerActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click"), x: coordinate, y: coordinate }).strict(),
  z.object({ type: z.literal("double_click"), x: coordinate, y: coordinate }).strict(),
  z.object({ type: z.literal("right_click"), x: coordinate, y: coordinate }).strict(),
  z.object({ type: z.literal("move"), x: coordinate, y: coordinate }).strict(),
  z.object({
    type: z.literal("drag"),
    from_x: coordinate,
    from_y: coordinate,
    to_x: coordinate,
    to_y: coordinate,
    duration_ms: dragDuration,
  }).strict(),
  z.object({
    type: z.literal("scroll"),
    x: coordinate,
    y: coordinate,
    direction: z.enum(["up", "down", "left", "right"]),
    amount: z.number().int().min(1).max(50),
    by: z.enum(["line", "page"]).optional(),
  }).strict(),
  z.object({ type: z.literal("type"), text: z.string().max(20_000) }).strict(),
  z.object({ type: z.literal("keypress"), keys: z.array(key).min(1).max(8) }).strict(),
  z.object({ type: z.literal("wait"), ms: z.number().int().min(0).max(15_000) }).strict(),
]);

export const ObserveInputSchema = z.object({}).strict();
export const ActInputSchema = z.object({
  snapshot_id: z.string().regex(/^snap_[A-Za-z0-9_-]{8,}$/),
  action: ComputerActionSchema,
}).strict();

const JSON_SCHEMA_OPTIONS = {
  target: "draft-07",
  reused: "inline",
  io: "input",
} as const;

export const ObserveInputJsonSchema = z.toJSONSchema(ObserveInputSchema, JSON_SCHEMA_OPTIONS);
export const ActInputJsonSchema = z.toJSONSchema(ActInputSchema, JSON_SCHEMA_OPTIONS);

export const PUBLIC_TOOL_SCHEMAS = [
  { name: "computer_observe", inputSchema: ObserveInputJsonSchema },
  { name: "computer_act", inputSchema: ActInputJsonSchema },
] as const;

export type ComputerAction = z.infer<typeof ComputerActionSchema>;
export type ActInput = z.infer<typeof ActInputSchema>;

const ScreenshotSchema = z.object({
  mime_type: z.literal("image/png"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}).strict();

const EngineSchema = z.object({
  name: z.literal("cua-driver"),
  version: z.string(),
}).strict();

const ActionResultSchema = z.object({
  status: z.enum(["executed", "refused", "failed"]),
  effect: z.enum(["confirmed", "partial", "unverifiable", "suspected_noop", "refused"]),
  route: z.enum([
    "accessibility",
    "synthetic_events",
    "global_input",
    "system_api",
    "dom",
    "trusted_input",
    "unknown",
  ]),
  delivery: z.enum(["background", "foreground", "not_applicable", "unknown"]),
  error_code: z.string().optional(),
}).strict();

export const ObservationOutputSchema = z.object({
  protocol_version: z.literal(PROTOCOL_VERSION),
  session_id: z.string(),
  snapshot_id: z.string(),
  platform: z.enum(["macos", "windows"]),
  display_id: z.literal("primary"),
  screenshot: ScreenshotSchema,
  engine: EngineSchema,
}).strict();

export const ActOutputSchema = z.object({
  protocol_version: z.literal(PROTOCOL_VERSION),
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
