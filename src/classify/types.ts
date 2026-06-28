/**
 * Core domain types for error classification.
 *
 * All functions that produce or consume these types are kept PURE so they can
 * be unit-tested without touching the filesystem or the opencode runtime.
 */

/** Technology stacks we have purpose-built patterns for. */
export type Stack =
  | "node"
  | "typescript"
  | "python"
  | "java"
  | "go"
  | "rust"
  | "docker"
  | "kubernetes"
  | "git"
  | "sql"
  | "shell"
  | "network"
  | "os"
  | "generic";

/** How confident/severe a classification is. Drives ordering + formatting. */
export type Severity = "critical" | "error" | "warning" | "info";

/**
 * A single error signature.
 *
 * `pattern` is matched against the COMBINED tool output string (stdout + stderr
 * merged by opencode — there is no exit code available to hooks).
 *
 * `file`/`line` are optional extractors: when the pattern matches, these regexes
 * are run against the matched region to pull out a likely source location.
 */
export interface ErrorPattern {
  /** Stable identifier, unique within the registry. */
  readonly id: string;
  /** Stack this pattern belongs to. */
  readonly stack: Stack;
  /** Human-readable error category, e.g. "Missing dependency". */
  readonly type: string;
  /** Default severity when this pattern is the best match. */
  readonly severity: Severity;
  /** Regex tested against the full output. */
  readonly pattern: RegExp;
  /** Actionable, language-neutral guidance (English only in v0.1). */
  readonly suggestion: string;
  /** Optional follow-up steps, rendered in detailed mode. */
  readonly nextSteps?: readonly string[];
  /**
   * Optional extractors for a probable source location.
   * Captured group 1 is used as the value.
   */
  readonly extractors?: {
    readonly file?: RegExp;
    readonly line?: RegExp;
  };
}

/**
 * The result of classifying one tool output.
 * `null` means "this output does not look like an error" — the plugin must not
 * pollute successful command runs.
 */
export interface Classification {
  /** Id of the matching pattern, or "generic_unclassified" for the fallback. */
  readonly id: string;
  readonly stack: Stack;
  readonly type: string;
  readonly severity: Severity;
  readonly suggestion: string;
  readonly nextSteps: readonly string[];
  /** The original command that produced this output, for context. */
  readonly command: string;
  /** Output lines that matched the pattern or carry error signal. */
  readonly matchedLines: readonly string[];
  /** Best-effort source location, if an extractor matched. */
  readonly file?: string;
  readonly line?: number;
  /** The full (possibly redacted) output that was classified. */
  readonly raw: string;
  /** ISO-8601 timestamp of when the classification happened. */
  readonly timestamp: string;
}

/** Stack inferred from the command prefix, used to prioritise pattern search. */
export type CommandContext = Stack | "unknown";

/** A redaction rule. Group 0 of each match is replaced with `[REDACTED]`. */
export interface RedactionRule {
  readonly id: string;
  readonly pattern: RegExp;
}
