export type IndependentCorrectnessChecks = Readonly<{
  semanticSequence: () => Promise<boolean>;
  uniqueText: () => Promise<boolean>;
  overlayOnce: () => Promise<boolean>;
  focusPreserved: () => Promise<boolean>;
}>;

export type IndependentCorrectnessResults = Readonly<{
  semanticSequence: boolean;
  uniqueText: boolean;
  overlayOnce: boolean;
  focusPreserved: boolean;
}>;

async function settle(check: () => Promise<boolean>): Promise<boolean> {
  try {
    return await check();
  } catch {
    return false;
  }
}

export async function runIndependentCorrectnessChecks(
  checks: IndependentCorrectnessChecks,
): Promise<IndependentCorrectnessResults> {
  return {
    semanticSequence: await settle(checks.semanticSequence),
    uniqueText: await settle(checks.uniqueText),
    overlayOnce: await settle(checks.overlayOnce),
    focusPreserved: await settle(checks.focusPreserved),
  };
}
