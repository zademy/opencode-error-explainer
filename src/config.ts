/**
 * Plugin configuration.
 *
 * Options are passed as the second element of the plugin tuple in opencode.json:
 *
 * ```json
 * "plugin": [
 *   ["@zademy/opencode-error-explainer", { "verbosity": "detailed" }]
 * ]
 * ```
 *
 * They arrive as the second argument to the plugin entry function, typed as
 * `Record<string, unknown>` by the opencode runtime. `resolveOptions` validates
 * and coerces them into a strongly-typed {@link PluginOptions} object.
 */

import type { Stack } from "./classify/types.js";

export type Verbosity = "concise" | "detailed";

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
  /** Append an explanation block to `output.output` so the AI sees it directly. */
  readonly appendToOutput: boolean;
  /**
   * Path (relative to worktree) to a user-supplied patterns file that augments
   * or overrides built-in patterns. Defaults to `.error-patterns.json`.
   * Set to null to disable.
   */
  readonly customPatternsPath: string | null;
}

/** Defaults applied when an option is omitted or invalid. */
export const DEFAULT_OPTIONS: PluginOptions = {
  enabled: true,
  outputDir: null,
  historyLimit: 10,
  stacks: null,
  verbosity: "concise",
  redact: true,
  appendToOutput: true,
  customPatternsPath: ".error-patterns.json",
};

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
    appendToOutput: asBool(r.appendToOutput, DEFAULT_OPTIONS.appendToOutput),
    customPatternsPath:
      typeof r.customPatternsPath === "string"
        ? r.customPatternsPath.trim() || null
        : DEFAULT_OPTIONS.customPatternsPath,
  };
}
