/**
 * Sentry-grade local event types.
 *
 * The shapes intentionally echo Sentry's ingest schema (event_id, timestamp,
 * platform, level, exception{values[{type,value,stacktrace{frames}}]},
 * contexts, breadcrumbs, tags, fingerprint, sdk, release, environment) so the
 * persisted `last-error.json` reads like a Sentry event — while staying 100%
 * local and private (nothing is ever transmitted).
 */

import type { Severity, Stack } from "../classify/types.js";

/** A single stack frame, before/after source-context enrichment. */
export interface Frame {
  /** File path as printed by the runtime (may be relative or absolute). */
  filename: string;
  /** Function/method/module symbol, when parseable. */
  function: string | null;
  lineno: number | null;
  colno: number | null;
  /**
   * True for first-party frames. Marked false for dependency/vendor paths
   * (`node_modules`, `.venv`, `vendor`, `<...>/lib/`, stdlib, etc.).
   */
  in_app: boolean;
  /**
   * Source context lines around `lineno` (`{line, source}`). Populated later
   * by the source-preview pass; null when not available/readable.
   */
  context: ReadonlyArray<{ line: number; source: string }> | null;
  /** Coarse package/module, when derivable (e.g. npm package name). */
  module: string | null;
}

export interface ExceptionValue {
  type: string;
  value: string;
  mechanism: { type: string; handled: boolean };
  stacktrace: { frames: readonly Frame[] };
}

/** A breadcrumb = one prior tool call in the session. */
export interface Breadcrumb {
  timestamp: string;
  type: "default";
  category: "tool";
  level: Severity;
  message: string;
  data: { tool: string; command: string; status: string };
}

export interface RuntimeContext {
  name: string;
  version: string | null;
}

export interface OsContext {
  name: string;
  version: string | null;
  arch: string | null;
}

export interface AppContext {
  worktree: string | null;
  cwd: string | null;
  git_branch: string | null;
  git_commit: string | null;
  git_dirty: boolean | null;
}

export interface OpencodeContext {
  version: string | null;
  session_id: string | null;
  agent: string | null;
  model: string | null;
}

export interface Contexts {
  os: OsContext;
  runtime: RuntimeContext;
  app: AppContext;
  opencode: OpencodeContext;
}

export interface Frequency {
  first_seen: string;
  last_seen: string;
  times_seen: number;
}

/**
 * The full, persisted event. Mirrors Sentry's shape with a couple of extras
 * (our `classification`) so the plugin keeps its diagnosis alongside the raw
 * trace.
 */
export interface SentryGradeEvent {
  event_id: string;
  timestamp: string;
  platform: string;
  language: string;
  level: Severity;
  sdk: { name: string; version: string };
  release: string | null;
  environment: string | null;
  logger: string;
  classification: {
    id: string;
    stack: Stack;
    severity: Severity;
    suggestion: string;
    nextSteps: readonly string[];
  };
  exception: { values: readonly ExceptionValue[] };
  contexts: Contexts;
  breadcrumbs: readonly Breadcrumb[];
  tags: Readonly<Record<string, string>>;
  fingerprint: string;
  frequency: Frequency | null;
  extra: Readonly<Record<string, unknown>>;
}
