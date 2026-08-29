import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import ts from "typescript";

export type DelayFinding = Readonly<{
  path: string;
  line: number;
  callee: string;
}>;

type Source = Readonly<{ path: string; text: string }>;

const TRACKED = new Set(["sleep", "delay", "setTimeout"]);

const ALLOWED = new Set([
  "src/core/observe.ts|withTimeout|setTimeout|timeoutMs",
  "src/core/verifier.ts|cancellableSleep|setTimeout|ms",
  "src/core/verifier.ts|verifyWindowState|sleep|delay",
  "src/engine/cua.ts|cancellableWait|setTimeout|waitMs",
  "src/cli/process-runner.ts|run|setTimeout|options.timeoutMs",
  "src/cli/process-runner.ts|run|setTimeout|TERMINATION_GRACE_MS",
]);

function normalizedPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function propertyName(expression: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression)) {
    const argument = expression.argumentExpression;
    if (argument !== undefined && ts.isStringLiteral(argument)) return argument.text;
  }
  return undefined;
}

function directTrackedCallee(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression) && TRACKED.has(expression.text)) return expression.text;
  const property = propertyName(expression);
  return property !== undefined && TRACKED.has(property) ? property : undefined;
}

function collectAliases(sourceFile: ts.SourceFile): Map<string, string> {
  const candidates: Array<Readonly<{ name: string; initializer: ts.Expression }>> = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      candidates.push({ name: node.name.text, initializer: node.initializer });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const aliases = new Map<string, string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of candidates) {
      const direct = directTrackedCallee(candidate.initializer);
      const indirect = ts.isIdentifier(candidate.initializer)
        ? aliases.get(candidate.initializer.text)
        : undefined;
      const resolved = direct ?? indirect;
      if (resolved !== undefined && aliases.get(candidate.name) !== resolved) {
        aliases.set(candidate.name, resolved);
        changed = true;
      }
    }
  }
  return aliases;
}

function resolvedCallee(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, string>,
): string | undefined {
  return directTrackedCallee(expression) ??
    (ts.isIdentifier(expression) ? aliases.get(expression.text) : undefined);
}

function declaredFunctionName(node: ts.Node): string | undefined {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isMethodDeclaration(node)) &&
    node.name !== undefined
  ) {
    return node.name.getText();
  }
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    ts.isVariableDeclaration(node.parent) &&
    ts.isIdentifier(node.parent.name)
  ) {
    return node.parent.name.text;
  }
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    ts.isPropertyAssignment(node.parent)
  ) {
    return node.parent.name.getText();
  }
  return undefined;
}

function delayExpression(
  call: ts.CallExpression,
  callee: string,
): ts.Expression | undefined {
  if (callee === "setTimeout") return call.arguments.at(-1);
  return call.arguments[0];
}

export function scanDelayCalls(sources: readonly Source[]): DelayFinding[] {
  const findings: DelayFinding[] = [];
  for (const source of sources) {
    const sourcePath = normalizedPath(source.path);
    const sourceFile = ts.createSourceFile(
      sourcePath,
      source.text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const aliases = collectAliases(sourceFile);
    const namedFunctions: string[] = [];

    const visit = (node: ts.Node): void => {
      const name = declaredFunctionName(node);
      if (name !== undefined) namedFunctions.push(name);

      if (ts.isCallExpression(node)) {
        const callee = resolvedCallee(node.expression, aliases);
        if (callee !== undefined) {
          const delay = delayExpression(node, callee);
          const expression = delay?.getText(sourceFile).replace(/\s+/g, "");
          const functionName = namedFunctions.at(-1) ?? "<module>";
          const tuple = `${sourcePath}|${functionName}|${callee}|${expression ?? "<missing>"}`;
          if (!ALLOWED.has(tuple)) {
            findings.push({
              path: sourcePath,
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
              callee,
            });
          }
        }
      }

      ts.forEachChild(node, visit);
      if (name !== undefined) namedFunctions.pop();
    };
    visit(sourceFile);
  }
  return findings;
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")
      ? [absolute]
      : [];
  }));
  return nested.flat().sort();
}

export async function scanProductionDelayCalls(root: string): Promise<DelayFinding[]> {
  const productRoot = path.basename(root) === "src" ? path.dirname(root) : root;
  const srcRoot = path.basename(root) === "src" ? root : path.join(root, "src");
  const files = await sourceFiles(srcRoot);
  const sources = await Promise.all(files.map(async (file) => ({
    path: normalizedPath(path.relative(productRoot, file)),
    text: await readFile(file, "utf8"),
  })));
  return scanDelayCalls(sources);
}

export function scanCanonicalSkillFixedDelay(text: string): DelayFinding[] {
  const directives = [
    /\b(?:wait|sleep)\b.*\bafter (?:every|each) action\b/i,
    /\bafter (?:every|each) action\b.*\b(?:wait|sleep)\b/i,
  ];
  return text.split(/\r?\n/u).flatMap((line, index) =>
    !/\b(?:never|do not|don't|must not|no universal)\b/i.test(line) &&
      directives.some((directive) => directive.test(line))
      ? [{
          path: "skills/computer-use/SKILL.md",
          line: index + 1,
          callee: "fixed_post_action_wait",
        }]
      : []);
}

export async function scanNoFixedActionDelay(root: string): Promise<DelayFinding[]> {
  const productRoot = path.basename(root) === "src" ? path.dirname(root) : root;
  const [sourceFindings, skill] = await Promise.all([
    scanProductionDelayCalls(productRoot),
    readFile(path.join(productRoot, "skills/computer-use/SKILL.md"), "utf8"),
  ]);
  return [...sourceFindings, ...scanCanonicalSkillFixedDelay(skill)];
}
