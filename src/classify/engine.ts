/**
 * The pure classification engine.
 *
 * Given the merged tool output, the originating command, and a pattern list,
 * it returns a {@link Classification} or `null` (when the output does not look
 * like an error). It never touches the filesystem, the network, or `Date.now`
 * indirectly — all side-effecting work (timestamps, file writes) is the caller's
 * responsibility, which keeps this module trivially unit-testable.
 */

import type {
  Classification,
  CommandContext,
  ErrorPattern,
  Severity,
  Stack,
} from "./types.js";

/** Signal words that, on their own, indicate the output is probably an error. */
const SIGNAL_WORDS = [
  "error",
  "failed",
  "failure",
  "exception",
  "caused by",
  "cannot find",
  "not found",
  "permission denied",
  "eaddrinuse",
  "econnrefused",
  "enoent",
  "eacces",
  "enospc",
  "build failure",
  "fatal",
  "panic",
  "traceback",
  "undefined is not",
  "uncaught",
  "segfault",
  "core dumped",
] as const;

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  error: 1,
  warning: 2,
  info: 3,
};

/** Map a command's first token to a stack, used to prioritise the search. */
export function inferStackFromCommand(command: string): CommandContext {
  const first = firstToken(command);
  if (!first) return "unknown";

  // Direct tool name matches.
  if (
    first === "npm" ||
    first === "pnpm" ||
    first === "yarn" ||
    first === "node" ||
    first === "npx" ||
    first === "bun" ||
    first === "bunx" ||
    first === "deno"
  ) {
    return "node";
  }
  if (first === "tsc" || first === "ts-node" || first === "tsx")
    return "typescript";
  if (
    first === "python" ||
    first === "python3" ||
    first === "pip" ||
    first === "pip3" ||
    first === "poetry" ||
    first === "uv" ||
    first === "pytest"
  ) {
    return "python";
  }
  if (
    first === "mvn" ||
    first === "gradle" ||
    first === "gradlew" ||
    first === "java" ||
    first === "javac"
  ) {
    return "java";
  }
  if (first === "cargo" || first === "rustc") return "rust";
  if (first === "go" || first === "gotest") return "go";
  if (
    first === "docker" ||
    first === "docker-compose" ||
    first === "podman" ||
    first === "buildah"
  ) {
    return "docker";
  }
  if (
    first === "kubectl" ||
    first === "helm" ||
    first === "kustomize" ||
    first === "k9s"
  ) {
    return "kubernetes";
  }
  if (first === "git") return "git";
  if (
    first === "psql" ||
    first === "mysql" ||
    first === "sqlite3" ||
    first === "sqlc"
  )
    return "sql";
  if (
    first === "bash" ||
    first === "sh" ||
    first === "zsh" ||
    first === "fish" ||
    first === "dash"
  )
    return "shell";
  return "unknown";
}

function firstToken(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return "";
  // Strip a leading `sudo `, env assignments (FOO=bar), and capture the first
  // real token after any shell metacharacters so `FOO=1 npm run x` → "npm".
  const withoutEnv = trimmed
    .replace(/^(?:sudo\s+)?(?:[A-Z_][A-Z0-9_]*=\S+\s+)+/i, "")
    .replace(/^(?:sudo\s+)/i, "");
  const match = withoutEnv.match(/([\w./@-]+)/);
  return match ? (match[1] ?? "").toLowerCase() : "";
}

/**
 * Classify a single tool output.
 *
 * @param output   Merged stdout+stderr (what opencode hands us — no exit code).
 * @param command  The original command string.
 * @param patterns Patterns to test (built-ins already merged with customs).
 * @param stacks   Optional allow-list of stacks; patterns outside it are skipped.
 * @returns A classification, or `null` if the output does not look like an error.
 */
export function classifyError(
  output: string,
  command: string,
  patterns: readonly ErrorPattern[],
  stacks?: readonly Stack[] | null,
): Classification | null {
  if (!output) return null;

  const ctxStack = inferStackFromCommand(command);

  // Order: stack-aligned first, then others; within each group, by severity.
  const ordered = orderPatterns(patterns, ctxStack, stacks);

  for (const pattern of ordered) {
    const match = pattern.pattern.exec(output);
    if (!match) continue;
    return buildClassification(pattern, output, command, match);
  }

  // No specific signature — fall back to signal density.
  if (looksLikeError(output)) {
    return buildGenericClassification(output, command);
  }

  return null;
}

function orderPatterns(
  patterns: readonly ErrorPattern[],
  ctxStack: CommandContext,
  stacks: readonly Stack[] | null | undefined,
): readonly ErrorPattern[] {
  const filtered =
    stacks && stacks.length > 0
      ? patterns.filter((p) => stacks.includes(p.stack))
      : patterns.slice();

  const bySeverity = (a: ErrorPattern, b: ErrorPattern) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];

  if (ctxStack === "unknown") {
    return filtered.slice().sort(bySeverity);
  }

  const aligned: ErrorPattern[] = [];
  const rest: ErrorPattern[] = [];
  for (const p of filtered) {
    (p.stack === ctxStack ? aligned : rest).push(p);
  }
  // The generic fallback must always be evaluated LAST, even if aligned.
  aligned.sort((a, b) => {
    if (a.stack === "generic" && b.stack !== "generic") return 1;
    if (b.stack === "generic" && a.stack !== "generic") return -1;
    return bySeverity(a, b);
  });
  rest.sort(bySeverity);
  return [...aligned, ...rest];
}

function buildClassification(
  pattern: ErrorPattern,
  output: string,
  command: string,
  match: RegExpExecArray,
): Classification {
  const matchedLines = extractMatchedLines(output, pattern);
  // Extractors run against the FULL output: the file/line often lives on a
  // neighbouring line (e.g. Rust `--> src/main.rs:42`) rather than inside the
  // matched signature itself.
  const file = pattern.extractors?.file?.exec(output)?.[1];
  const lineRaw = pattern.extractors?.line?.exec(output)?.[1];
  const line = lineRaw ? Number.parseInt(lineRaw, 10) : undefined;
  void match;
  return {
    id: pattern.id,
    stack: pattern.stack,
    type: pattern.type,
    severity: pattern.severity,
    suggestion: pattern.suggestion,
    nextSteps: pattern.nextSteps ?? [],
    command,
    matchedLines,
    file: file || undefined,
    line: Number.isFinite(line) ? line : undefined,
    raw: output,
    // Timestamp is injected by the caller to keep this function pure & deterministic.
    timestamp: "",
  };
}

function buildGenericClassification(
  output: string,
  command: string,
): Classification {
  const matchedLines = extractSignalLines(output).slice(0, 5);
  return {
    id: "generic_unclassified",
    stack: "generic",
    type: "Unclassified error",
    severity: "error",
    suggestion:
      "No specific signature matched. The first line containing Error/Failed/Exception is usually the root cause.",
    nextSteps: [
      "Scan the output for the first line beginning with `Error`, `Failed`, `Exception`, or `Caused by`.",
      "Ignore the toolchain's summary line — read the raw failure above it.",
    ],
    command,
    matchedLines,
    raw: output,
    timestamp: "",
  };
}

/** Lines that match the pattern OR neighbour lines carrying signal words. */
function extractMatchedLines(output: string, pattern: ErrorPattern): string[] {
  const lines = output.split("\n");
  const hits: string[] = [];
  for (const line of lines) {
    if (pattern.pattern.test(line)) {
      hits.push(line.trim());
    } else {
      const lower = line.toLowerCase();
      if (SIGNAL_WORDS.some((w) => lower.includes(w))) {
        hits.push(line.trim());
      }
    }
    if (hits.length >= 8) break;
  }
  return hits;
}

/** Lines carrying signal words — used by the generic fallback. */
function extractSignalLines(output: string): string[] {
  const lines = output.split("\n");
  const hits: string[] = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (SIGNAL_WORDS.some((w) => lower.includes(w))) {
      hits.push(line.trim());
    }
  }
  return hits;
}

/**
 * Heuristic: does this output look like an error at all?
 *
 * Used to decide whether to emit a generic fallback classification, and —
 * crucially — to AVOID polluting the AI's context on successful commands
 * (there is no exit code available to the plugin, so we go by content).
 */
export function looksLikeError(output: string): boolean {
  const lower = output.toLowerCase();
  let hits = 0;
  for (const word of SIGNAL_WORDS) {
    if (lower.includes(word)) hits += 1;
    if (hits >= 2) return true; // require ≥2 distinct signals to be safe
  }
  return false;
}
