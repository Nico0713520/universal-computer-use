import type {
  ProcessResult,
  ProcessRunner,
} from "./process-runner.js";

export async function probeMacInteractiveSession(
  runner: ProcessRunner,
): Promise<boolean | null> {
  const script = [
    "ObjC.import('AppKit');",
    "const app = $.NSWorkspace.sharedWorkspace.frontmostApplication;",
    "JSON.stringify({bundleIdentifier: ObjC.unwrap(app.bundleIdentifier)});",
  ].join(" ");

  let result: ProcessResult;
  try {
    result = await runner.run(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", script],
      { timeoutMs: 2_000 },
    );
  } catch {
    return null;
  }

  if (result.code !== 0) return null;
  try {
    const value = JSON.parse(result.stdout) as { bundleIdentifier?: unknown };
    if (
      typeof value.bundleIdentifier !== "string" ||
      value.bundleIdentifier === ""
    ) {
      return null;
    }
    return value.bundleIdentifier !== "com.apple.loginwindow";
  } catch {
    return null;
  }
}
