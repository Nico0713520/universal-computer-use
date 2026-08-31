export type CursorMode = "auto" | "visible" | "hidden";

const MODES = new Set<CursorMode>(["auto", "visible", "hidden"]);

export function parseCursorMode(value: string | undefined): CursorMode {
  if (value === undefined) return "auto";
  if (MODES.has(value as CursorMode)) return value as CursorMode;
  throw new Error("cursor mode must be auto, visible, or hidden");
}

export function resolveCursorMode(
  argv: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): CursorMode {
  if (argv.length === 0) return parseCursorMode(environment.UCU_CURSOR_MODE);
  if (argv.length !== 2 || argv[0] !== "--cursor") {
    throw new Error("cursor mode requires exactly --cursor <auto|visible|hidden>");
  }
  return parseCursorMode(argv[1]);
}
