import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function isDirectEntryPoint(
  entryPath: string | undefined,
  moduleUrl: string,
): boolean {
  if (entryPath === undefined) return false;
  try {
    return realpathSync(resolve(entryPath)) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
