import { z } from "zod";

import { ERROR_CODES } from "./errors.js";
import { PROTOCOL_VERSION } from "./version.js";

const coordinate = z.number().finite().min(0);
const dragDuration = z.number().int().min(0).max(10_000).optional();
const key = z.string().min(1).max(24).regex(/^[A-Za-z0-9_+-]+$/);
const boundedText = z.string().max(20_000);
const query = z.string().min(1).max(200);

export const AppRefSchema = z.string().regex(/^app_[A-Za-z0-9_-]{16,}$/);
export const WindowRefSchema = z.string().regex(/^win_[A-Za-z0-9_-]{16,}$/);
export const ElementRefSchema = z.string().regex(/^el_[A-Za-z0-9_-]{16,}$/);
export const SnapshotIdSchema = z.string().regex(/^snap_[A-Za-z0-9_-]{8,}$/);

export const DeliverySchema = z.enum(["background", "foreground"]);
const clickTypes = ["click", "double_click", "right_click"] as const;

const coordinateClicks = clickTypes.map((type) => z.object({
  type: z.literal(type),
  x: coordinate,
  y: coordinate,
}).strict());
const elementClicks = clickTypes.map((type) => z.object({
  type: z.literal(type),
  element_ref: ElementRefSchema,
}).strict());

const ScrollFields = {
  direction: z.enum(["up", "down", "left", "right"]),
  amount: z.number().int().min(1).max(50),
  by: z.enum(["line", "page"]).optional(),
};

export const ComputerActionSchema = z.union([
  ...coordinateClicks,
  ...elementClicks,
  z.object({ type: z.literal("move"), x: coordinate, y: coordinate }).strict(),
  z.object({
    type: z.literal("drag"),
    from_x: coordinate,
    from_y: coordinate,
    to_x: coordinate,
    to_y: coordinate,
    duration_ms: dragDuration,
  }).strict(),
  z.object({ type: z.literal("scroll"), x: coordinate, y: coordinate, ...ScrollFields }).strict(),
  z.object({ type: z.literal("scroll"), element_ref: ElementRefSchema, ...ScrollFields }).strict(),
  z.object({ type: z.literal("set_value"), element_ref: ElementRefSchema, value: boundedText }).strict(),
  z.object({ type: z.literal("type"), text: boundedText }).strict(),
  z.object({ type: z.literal("type"), element_ref: ElementRefSchema, text: boundedText }).strict(),
  z.object({ type: z.literal("type"), x: coordinate, y: coordinate, text: boundedText }).strict(),
  z.object({ type: z.literal("type_text"), text: boundedText }).strict(),
  z.object({ type: z.literal("type_text"), element_ref: ElementRefSchema, text: boundedText }).strict(),
  z.object({ type: z.literal("type_text"), x: coordinate, y: coordinate, text: boundedText }).strict(),
  z.object({ type: z.literal("keypress"), keys: z.array(key).min(1).max(8) }).strict(),
  z.object({ type: z.literal("keypress"), element_ref: ElementRefSchema, keys: z.array(key).min(1).max(8) }).strict(),
  z.object({ type: z.literal("keypress"), x: coordinate, y: coordinate, keys: z.array(key).min(1).max(8) }).strict(),
  z.object({ type: z.literal("invoke_menu"), path: z.array(query).min(1).max(16) }).strict(),
  z.object({ type: z.literal("launch_app"), app_ref: AppRefSchema }).strict(),
  z.object({ type: z.literal("wait"), ms: z.number().int().min(0).max(15_000) }).strict(),
]);

const DesktopTargetInputSchema = z.object({ kind: z.literal("desktop") }).strict();
const WindowTargetInputSchema = z.object({
  kind: z.literal("window"),
  window_ref: WindowRefSchema,
}).strict();
const DiscoverInputSchema = z.object({
  apps: z.boolean().optional(),
  windows: z.boolean().optional(),
  query: query.optional(),
  window_app_ref: AppRefSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.apps !== true && value.windows !== true) {
    context.addIssue({ code: "custom", message: "discover must request apps or windows" });
  }
  if (value.window_app_ref !== undefined && value.windows !== true) {
    context.addIssue({ code: "custom", path: ["window_app_ref"], message: "window_app_ref requires windows: true" });
  }
});

export const ObserveInputSchema = z.object({
  target: z.union([DesktopTargetInputSchema, WindowTargetInputSchema]).optional(),
  discover: DiscoverInputSchema.optional(),
  include_screenshot: z.boolean().optional(),
  elements: z.object({
    query: query.optional(),
    max_elements: z.number().int().min(1).max(150).optional(),
    max_depth: z.number().int().min(1).max(12).optional(),
  }).strict().optional(),
}).strict().superRefine((value, context) => {
  const targetKind = value.target?.kind ?? "desktop";
  if (targetKind === "desktop") {
    if (value.include_screenshot !== undefined) {
      context.addIssue({ code: "custom", path: ["include_screenshot"], message: "include_screenshot requires a window target" });
    }
    if (value.elements !== undefined) {
      context.addIssue({ code: "custom", path: ["elements"], message: "elements requires a window target" });
    }
  } else if (value.discover !== undefined) {
    context.addIssue({ code: "custom", path: ["discover"], message: "discover is only available with a desktop target" });
  }
});

const ElementExpectationSchema = z.object({
  element_ref: ElementRefSchema,
  value_equals: boundedText.optional(),
  enabled: z.boolean().optional(),
  selected: z.boolean().optional(),
}).strict().superRefine((value, context) => {
  if (value.value_equals === undefined && value.enabled === undefined && value.selected === undefined) {
    context.addIssue({ code: "custom", message: "an element expectation must assert at least one property" });
  }
});

export const ActInputSchema = z.object({
  snapshot_id: SnapshotIdSchema,
  action: ComputerActionSchema,
  delivery: DeliverySchema.optional(),
  expect: z.object({
    element: ElementExpectationSchema,
    timeout_ms: z.number().int().min(0).max(10_000).optional(),
  }).strict().optional(),
}).strict().superRefine((value, context) => {
  if (["move", "set_value", "invoke_menu", "launch_app", "wait"].includes(value.action.type)
      && value.delivery !== undefined) {
    context.addIssue({ code: "custom", path: ["delivery"], message: `delivery is not valid for ${value.action.type}` });
  }
  if (value.action.type === "launch_app" && value.expect !== undefined) {
    context.addIssue({ code: "custom", path: ["expect"], message: "launch_app cannot verify a prior-snapshot element" });
  }
  if (value.action.type === "set_value" && value.expect !== undefined) {
    if (value.expect.element.element_ref !== value.action.element_ref) {
      context.addIssue({ code: "custom", path: ["expect", "element", "element_ref"], message: "set_value expectation must target the same element" });
    }
    const expected = value.expect.element.value_equals;
    if (expected !== undefined && expected !== value.action.value) {
      context.addIssue({ code: "custom", path: ["expect", "element", "value_equals"], message: "set_value expectation must match the requested value" });
    }
  }
});

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
export type ObserveInput = z.infer<typeof ObserveInputSchema>;
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

const BoundsSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
}).strict();
const AppCapabilitySchema = z.enum(["launch", "windows"]);
const CapabilityStatusSchema = z.enum(["available", "unavailable", "unknown"]);

const AppOutputSchema = z.object({
  app_ref: AppRefSchema,
  display_name: z.string(),
  running: z.boolean(),
  capabilities: z.array(AppCapabilitySchema).max(2),
}).strict();
const WindowOutputSchema = z.object({
  window_ref: WindowRefSchema,
  app_ref: AppRefSchema,
  app_name: z.string(),
  title: z.string(),
  bounds: BoundsSchema.extend({ coordinate_space: z.literal("desktop_logical") }).strict(),
  is_on_screen: z.boolean().optional(),
  // Cua 0.22.2 does not expose these fields on every platform/backend. Omit
  // unknown facts instead of fabricating false values.
  on_current_space: z.boolean().optional(),
  minimized: z.boolean().optional(),
  capabilities: z.object({
    elements: CapabilityStatusSchema,
    window_screenshot: CapabilityStatusSchema,
    background_actions: CapabilityStatusSchema,
  }).strict(),
}).strict();
const ElementOutputSchema = z.object({
  element_ref: ElementRefSchema,
  role: z.string(),
  label: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  bounds: BoundsSchema.optional(),
  enabled: z.boolean().optional(),
  selected: z.boolean().optional(),
  focused: z.boolean().optional(),
  actions: z.array(z.enum(["click", "double_click", "right_click", "scroll", "set_value", "type_text", "keypress"])).max(7),
}).strict();

const ObservationBaseSchema = z.object({
  protocol_version: z.literal(PROTOCOL_VERSION),
  session_id: z.string(),
  snapshot_id: SnapshotIdSchema,
  platform: z.enum(["macos", "windows"]),
  engine: EngineSchema,
}).strict();
const DesktopOutputSchema = ObservationBaseSchema.extend({
  display_id: z.literal("primary"),
  target: z.object({ kind: z.literal("desktop"), display_id: z.literal("primary") }).strict(),
  coordinate_space: z.literal("desktop_screenshot_pixels"),
  screenshot: ScreenshotSchema,
  apps: z.array(AppOutputSchema).max(50).optional(),
  apps_truncated: z.boolean().optional(),
  windows: z.array(WindowOutputSchema).max(30).optional(),
  windows_truncated: z.boolean().optional(),
}).strict();
const WindowOutputBaseSchema = ObservationBaseSchema.extend({
  target: z.object({
    kind: z.literal("window"),
    window_ref: WindowRefSchema,
    app_ref: AppRefSchema,
    app_name: z.string(),
    title: z.string(),
  }).strict(),
  coordinate_space: z.literal("window_screenshot_pixels"),
  elements: z.array(ElementOutputSchema).max(150),
  elements_truncated: z.boolean(),
});
const WindowVisualOutputSchema = WindowOutputBaseSchema.extend({
  visual_status: z.literal("available"),
  screenshot: ScreenshotSchema,
}).strict();
const WindowSemanticOutputSchema = WindowOutputBaseSchema.extend({
  visual_status: z.enum(["not_requested", "capture_unavailable", "pixel_frame_unproven"]),
}).strict();

export const ObservationOutputSchema = z.union([
  WindowVisualOutputSchema,
  WindowSemanticOutputSchema,
  DesktopOutputSchema,
]);

// The MCP SDK currently normalizes output schemas as object schemas before
// validation. Keep the exact discriminated union above as the source of truth,
// and expose an object-shaped adapter that delegates its semantic validation to
// that union.
export const ObservationMcpOutputSchema = z.object({
  protocol_version: z.literal(PROTOCOL_VERSION),
  session_id: z.string(),
  snapshot_id: SnapshotIdSchema,
  platform: z.enum(["macos", "windows"]),
  engine: EngineSchema,
  display_id: z.literal("primary").optional(),
  target: z.union([
    z.object({ kind: z.literal("desktop"), display_id: z.literal("primary") }).strict(),
    z.object({ kind: z.literal("window"), window_ref: WindowRefSchema, app_ref: AppRefSchema, app_name: z.string(), title: z.string() }).strict(),
  ]),
  coordinate_space: z.enum(["desktop_screenshot_pixels", "window_screenshot_pixels"]),
  screenshot: ScreenshotSchema.optional(),
  apps: z.array(AppOutputSchema).max(50).optional(),
  apps_truncated: z.boolean().optional(),
  windows: z.array(WindowOutputSchema).max(30).optional(),
  windows_truncated: z.boolean().optional(),
  elements: z.array(ElementOutputSchema).max(150).optional(),
  elements_truncated: z.boolean().optional(),
  visual_status: z.enum(["available", "not_requested", "capture_unavailable", "pixel_frame_unproven"]).optional(),
}).strict().superRefine((value, context) => {
  const parsed = ObservationOutputSchema.safeParse(value);
  if (!parsed.success) {
    context.addIssue({ code: "custom", message: "observation output violates its target-specific contract" });
  }
});

const EvidenceSchema = z.enum([
  "value_readback", "selection_readback", "predicate_satisfied", "process_running", "window_ready", "focus_preserved",
]);
const ActionErrorCodeSchema = z.enum([
  "action_refused", "action_failed", "permission_required", "interactive_session_required", "background_unavailable", "foreground_required", "window_not_ready", "window_target_ambiguous", "verification_unsatisfied", "verification_unknown",
]);
const ActionResultCommonSchema = z.object({
  route: z.enum(["accessibility", "synthetic_events", "global_input", "system_api", "dom", "trusted_input", "unknown"]),
  delivery: z.enum(["background", "foreground", "not_applicable", "unknown"]),
  evidence: z.array(EvidenceSchema).max(8),
  delivered_count: z.number().int().nonnegative().optional(),
  escalation: z.object({
    reason: z.enum(["background_unavailable", "foreground_required", "effect_unconfirmed", "window_not_ready", "window_target_ambiguous"]),
    suggested_delivery: z.literal("foreground").optional(),
  }).strict().optional(),
}).strict();
const ExecutedActionResultSchema = ActionResultCommonSchema.extend({
  status: z.literal("executed"),
  effect: z.enum(["confirmed", "partial", "unverifiable", "suspected_noop"]),
  error_code: ActionErrorCodeSchema.optional(),
}).strict();
const RefusedActionResultSchema = ActionResultCommonSchema.extend({
  status: z.literal("refused"),
  effect: z.literal("refused"),
  evidence: z.array(EvidenceSchema).length(0),
  error_code: ActionErrorCodeSchema,
}).strict();
const FailedActionResultSchema = ActionResultCommonSchema.extend({
  status: z.literal("failed"),
  effect: z.literal("unverifiable"),
  evidence: z.array(EvidenceSchema).length(0),
  error_code: ActionErrorCodeSchema,
}).strict();
export const ActionResultSchema = z.union([
  ExecutedActionResultSchema,
  RefusedActionResultSchema,
  FailedActionResultSchema,
]);

export const VerificationStatusSchema = z.enum([
  "not_requested", "satisfied", "unsatisfied", "unknown",
]);
const VerificationSchema = z.union([
  z.object({ status: z.literal("not_requested") }).strict(),
  z.object({ status: z.literal("satisfied") }).strict(),
  z.object({
    status: z.enum(["unsatisfied", "unknown"]),
    reason: z.enum(["predicate_unsatisfied", "element_not_unique", "element_missing", "observation_unavailable", "timeout", "untrusted_source"]),
  }).strict(),
]);
const ActOutputBaseSchema = z.object({
  protocol_version: z.literal(PROTOCOL_VERSION),
  session_id: z.string(),
  consumed_snapshot_id: SnapshotIdSchema,
  action_result: ActionResultSchema,
  verification: VerificationSchema,
}).strict();
const DesktopActOutputSchema = ActOutputBaseSchema.extend({
  next_state: z.literal("available"),
  snapshot_id: SnapshotIdSchema,
  target: z.object({ kind: z.literal("desktop"), display_id: z.literal("primary") }).strict(),
  coordinate_space: z.literal("desktop_screenshot_pixels"),
  screenshot: ScreenshotSchema,
  windows: z.array(WindowOutputSchema).max(30).optional(),
  windows_truncated: z.boolean().optional(),
}).strict();
const WindowActOutputBaseSchema = ActOutputBaseSchema.extend({
  next_state: z.literal("available"),
  snapshot_id: SnapshotIdSchema,
  target: z.object({
    kind: z.literal("window"),
    window_ref: WindowRefSchema,
    app_ref: AppRefSchema,
    app_name: z.string(),
    title: z.string(),
  }).strict(),
  coordinate_space: z.literal("window_screenshot_pixels"),
  elements: z.array(ElementOutputSchema).max(150),
  elements_truncated: z.boolean(),
});
const WindowVisualActOutputSchema = WindowActOutputBaseSchema.extend({
  visual_status: z.literal("available"),
  screenshot: ScreenshotSchema,
}).strict();
const WindowSemanticActOutputSchema = WindowActOutputBaseSchema.extend({
  visual_status: z.enum(["not_requested", "capture_unavailable", "pixel_frame_unproven"]),
}).strict();
const UnavailableActOutputSchema = ActOutputBaseSchema.extend({
  next_state: z.literal("unavailable"),
  next_observation_error: z.object({
    code: z.enum(["target_lost", "capture_failed", "window_owner_changed"]),
    recovery: z.literal("observe_desktop"),
  }).strict(),
}).strict();

export const ActOutputSchema = z.union([
  WindowVisualActOutputSchema,
  WindowSemanticActOutputSchema,
  DesktopActOutputSchema,
  UnavailableActOutputSchema,
]);

export const ActMcpOutputSchema = z.object({
  protocol_version: z.literal(PROTOCOL_VERSION),
  session_id: z.string(),
  consumed_snapshot_id: SnapshotIdSchema,
  action_result: ActionResultSchema,
  verification: VerificationSchema,
  next_state: z.enum(["available", "unavailable"]),
  snapshot_id: SnapshotIdSchema.optional(),
  target: z.union([
    z.object({ kind: z.literal("desktop"), display_id: z.literal("primary") }).strict(),
    z.object({ kind: z.literal("window"), window_ref: WindowRefSchema, app_ref: AppRefSchema, app_name: z.string(), title: z.string() }).strict(),
  ]).optional(),
  coordinate_space: z.enum(["desktop_screenshot_pixels", "window_screenshot_pixels"]).optional(),
  screenshot: ScreenshotSchema.optional(),
  windows: z.array(WindowOutputSchema).max(30).optional(),
  windows_truncated: z.boolean().optional(),
  elements: z.array(ElementOutputSchema).max(150).optional(),
  elements_truncated: z.boolean().optional(),
  visual_status: z.enum(["available", "not_requested", "capture_unavailable", "pixel_frame_unproven"]).optional(),
  next_observation_error: z.object({
    code: z.enum(["target_lost", "capture_failed", "window_owner_changed"]),
    recovery: z.literal("observe_desktop"),
  }).strict().optional(),
}).strict().superRefine((value, context) => {
  const parsed = ActOutputSchema.safeParse(value);
  if (!parsed.success) {
    context.addIssue({ code: "custom", message: "action output violates its next-state contract" });
  }
});

export const McpErrorOutputSchema = z.object({
  code: z.enum(ERROR_CODES),
  recovery: z.enum(["setup", "doctor", "observe_again", "discover_again", "grant_permission", "use_element", "use_foreground", "stop"]),
  retryable: z.boolean(),
  snapshot_consumed: z.literal(true).optional(),
}).strict();

// MCP SDK clients cache the advertised output schema after tools/list and
// validate structuredContent even when isError is true. Advertise both the
// success and the stable safe-error shapes so real hosts can receive recovery
// codes such as stale_snapshot instead of a client-side -32602. The high-level
// SDK currently requires an object schema at the root, so the runtime object
// keeps the union refinement while JSON Schema metadata publishes the same
// alternatives as a real oneOf. This prevents generated clients from accepting
// empty or mixed partial objects merely because refinements are not serialised.
function jsonSchemaBranch(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _dialect, ...branch } = z.toJSONSchema(schema, { target: "draft-7" });
  return branch;
}

const observeToolOneOf = [
  jsonSchemaBranch(ObservationMcpOutputSchema),
  jsonSchemaBranch(McpErrorOutputSchema),
];
const actToolOneOf = [
  jsonSchemaBranch(ActMcpOutputSchema),
  jsonSchemaBranch(McpErrorOutputSchema),
];

export const ObserveToolMcpOutputSchema = z.object({
  ...ObservationMcpOutputSchema.shape,
  ...McpErrorOutputSchema.shape,
}).partial().strict().superRefine((value, context) => {
  if (!ObservationMcpOutputSchema.safeParse(value).success &&
      !McpErrorOutputSchema.safeParse(value).success) {
    context.addIssue({ code: "custom", message: "observe output is neither success nor safe error" });
  }
}).meta({ oneOf: observeToolOneOf });
export const ActToolMcpOutputSchema = z.object({
  ...ActMcpOutputSchema.shape,
  ...McpErrorOutputSchema.shape,
}).partial().strict().superRefine((value, context) => {
  if (!ActMcpOutputSchema.safeParse(value).success &&
      !McpErrorOutputSchema.safeParse(value).success) {
    context.addIssue({ code: "custom", message: "act output is neither success nor safe error" });
  }
}).meta({ oneOf: actToolOneOf });

export type ObservationOutput = z.infer<typeof ObservationOutputSchema>;
export type ActOutput = z.infer<typeof ActOutputSchema>;
export type ActionResult = z.infer<typeof ActionResultSchema>;
export type ImagePayload = Readonly<{ mimeType: "image/png"; dataBase64: string }>;
export type ObservationEnvelope = Readonly<{ structured: ObservationOutput; image?: ImagePayload }>;
export type ActEnvelope = Readonly<{ structured: ActOutput; image?: ImagePayload }>;
