/**
 * Plugin configuration.
 *
 * Options are passed as the second element of the plugin tuple in opencode.json:
 *
 * ```json
 * "plugin": [
 *   ["opencode-error-explainer", { "verbosity": "detailed" }]
 * ]
 * ```
 *
 * They arrive as the second argument to the plugin entry function, typed as
 * `Record<string, unknown>` by the opencode runtime. `resolveOptions` validates
 * and coerces them into a strongly-typed {@link PluginOptions} object.
 */

import type { Stack } from "./classify/types.js";

export type Verbosity = "concise" | "detailed";
export type AppendMode = "minimal" | "full" | "off";

/** Strongly-typed plugin options after validation. */
export interface PluginOptions {
  /** Master switch. Set to false to disable all behaviour. */
  readonly enabled: boolean;
  /**
   * Absolute directory where artifacts are written (last-error.md/json + history).
   * Defaults to `<worktree>/.opencode/error-explainer`.
   */
  readonly outputDir: string | null;
  /** How many recent errors to keep in the history ring buffer. 0 disables history. */
  readonly historyLimit: number;
  /**
   * Restrict activation to these stacks. Empty/omitted = all stacks.
   * Use this in monorepos to keep noise down, e.g. ["java", "typescript"].
   */
  readonly stacks: readonly Stack[] | null;
  /** How much detail to append to the tool output the AI sees. */
  readonly verbosity: Verbosity;
  /** Strip likely secrets from any persisted output before writing to disk. */
  readonly redact: boolean;
  /**
   * What to append to `output.output` so the AI sees the diagnosis directly.
   * `minimal` = one line, `full` = the concise block, `off` = nothing. The full
   * report always lives in the artifact + the explain_error tool response.
   */
  readonly appendMode: AppendMode;
  /** Back-compat alias of appendMode !== "off" (kept from v0.1). */
  readonly appendToOutput: boolean;
  /**
   * Path (relative to worktree) to a user-supplied patterns file that augments
   * or overrides built-in patterns. Defaults to `.error-patterns.json`.
   * Set to null to disable.
   */
  readonly customPatternsPath: string | null;
  // ── v0.2 Sentry-grade context ────────────────────────────────────────────
  /** Read `±sourceContextLines` around each in-app frame from the worktree. */
  readonly sourcePreview: boolean;
  /** Lines of source context captured on each side of the error line. */
  readonly sourceContextLines: number;
  /** Gather breadcrumbs from the opencode session (prior tool calls). */
  readonly breadcrumbs: boolean;
  /** How many breadcrumbs to retain. */
  readonly breadcrumbLimit: number;
  /** Capture git branch/commit/dirty from the worktree. */
  readonly gitContext: boolean;
  /** Capture OS + runtime versions. */
  readonly runtimeContext: boolean;
  /** Compute a grouping fingerprint + per-fingerprint frequency index. */
  readonly fingerprint: boolean;
  /**
   * Skip commands that only READ text (cat/grep/less/head/tail/rg/find/ls).
   * These often print error-like text without an actual failure, which would
   * otherwise trip the content-based detector.
   */
  readonly skipReadOnlyCommands: boolean;
  /** Custom set of command-prefixes to treat as read-only (overrides default). */
  readonly readOnlyCommands: readonly string[] | null;
}

/** Defaults applied when an option is omitted or invalid. */
export const DEFAULT_OPTIONS: PluginOptions = {
  enabled: true,
  outputDir: null,
  historyLimit: 10,
  stacks: null,
  verbosity: "concise",
  redact: true,
  appendMode: "minimal",
  appendToOutput: true,
  customPatternsPath: ".error-patterns.json",
  sourcePreview: true,
  sourceContextLines: 5,
  breadcrumbs: true,
  breadcrumbLimit: 15,
  gitContext: true,
  runtimeContext: true,
  fingerprint: true,
  skipReadOnlyCommands: true,
  readOnlyCommands: null,
};

const DEFAULT_READ_ONLY_COMMANDS: readonly string[] = [
  "cat",
  "bat",
  "head",
  "tail",
  "less",
  "more",
  "grep",
  "rg",
  "ag",
  "ack",
  "find",
  "fd",
  "ls",
  "ll",
  "tree",
  "wc",
  "sort",
  "uniq",
  "cut",
  "tr",
  "awk",
  "sed",
  "jq",
  "yq",
  "file",
];

const VALID_STACKS = new Set<Stack>([
  "node",
  "typescript",
  "python",
  "java",
  "go",
  "rust",
  "docker",
  "kubernetes",
  "git",
  "sql",
  "shell",
  "network",
  "os",
  "generic",
]);

const VALID_VERBOSITY = new Set<Verbosity>(["concise", "detailed"]);
const VALID_APPEND_MODE = new Set<AppendMode>(["minimal", "full", "off"]);

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return fallback;
}

function asStacks(value: unknown): readonly Stack[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const filtered = value.filter(
    (s): s is Stack => typeof s === "string" && VALID_STACKS.has(s as Stack),
  );
  return filtered.length > 0 ? filtered : null;
}

function asVerbosity(value: unknown, fallback: Verbosity): Verbosity {
  return typeof value === "string" && VALID_VERBOSITY.has(value as Verbosity)
    ? (value as Verbosity)
    : fallback;
}

function asAppendMode(value: unknown, fallback: AppendMode): AppendMode {
  return typeof value === "string" && VALID_APPEND_MODE.has(value as AppendMode)
    ? (value as AppendMode)
    : fallback;
}

function asStringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const filtered = value
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim());
  return filtered.length > 0 ? filtered : null;
}

/**
 * Merge raw user options over defaults, validating and coercing each field.
 * Never throws — an invalid field silently falls back to its default so a bad
 * config can never break the user's opencode session.
 */
export function resolveOptions(raw: unknown): PluginOptions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_OPTIONS;
  }
  const r = raw as Record<string, unknown>;
  const appendMode = asAppendMode(r.appendMode, DEFAULT_OPTIONS.appendMode);
  return {
    enabled: asBool(r.enabled, DEFAULT_OPTIONS.enabled),
    outputDir:
      typeof r.outputDir === "string" && r.outputDir.trim().length > 0
        ? r.outputDir
        : DEFAULT_OPTIONS.outputDir,
    historyLimit: asPositiveInt(r.historyLimit, DEFAULT_OPTIONS.historyLimit),
    stacks: asStacks(r.stacks),
    verbosity: asVerbosity(r.verbosity, DEFAULT_OPTIONS.verbosity),
    redact: asBool(r.redact, DEFAULT_OPTIONS.redact),
    appendMode,
    appendToOutput: appendMode !== "off" && asBool(r.appendToOutput, true),
    customPatternsPath:
      typeof r.customPatternsPath === "string"
        ? r.customPatternsPath.trim() || null
        : DEFAULT_OPTIONS.customPatternsPath,
    sourcePreview: asBool(r.sourcePreview, DEFAULT_OPTIONS.sourcePreview),
    sourceContextLines: asPositiveInt(
      r.sourceContextLines,
      DEFAULT_OPTIONS.sourceContextLines,
    ),
    breadcrumbs: asBool(r.breadcrumbs, DEFAULT_OPTIONS.breadcrumbs),
    breadcrumbLimit: asPositiveInt(
      r.breadcrumbLimit,
      DEFAULT_OPTIONS.breadcrumbLimit,
    ),
    gitContext: asBool(r.gitContext, DEFAULT_OPTIONS.gitContext),
    runtimeContext: asBool(r.runtimeContext, DEFAULT_OPTIONS.runtimeContext),
    fingerprint: asBool(r.fingerprint, DEFAULT_OPTIONS.fingerprint),
    skipReadOnlyCommands: asBool(
      r.skipReadOnlyCommands,
      DEFAULT_OPTIONS.skipReadOnlyCommands,
    ),
    readOnlyCommands:
      asStringArray(r.readOnlyCommands) ?? DEFAULT_READ_ONLY_COMMANDS,
  };
}
