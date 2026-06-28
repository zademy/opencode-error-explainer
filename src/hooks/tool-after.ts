/**
 * `tool.execute.after` orchestrator (v0.2 — Sentry-grade).
 *
 * Thin by design: guard → classify → gather context (async, all failures
 * isolated) → assemble event → persist. Every side effect is wrapped so a
 * failure in one enrichment never breaks the user's opencode session — the
 * event simply omits that section.
 */

import type {
  Classification,
  ErrorPattern,
  Severity,
} from "../classify/types.js";
import { classifyError } from "../classify/engine.js";
import { isReadOnlyCommand } from "../classify/read-only.js";
import type { PluginOptions } from "../config.js";
import { gatherGit } from "../context/git.js";
import { gatherOs, gatherRuntime } from "../context/env.js";
import { enrichFrames } from "../context/source.js";
import { gatherBreadcrumbs } from "../breadcrumbs/session.js";
import { redactSecrets } from "../enrich/redact.js";
import { buildExplanation } from "../enrich/explainer.js";
import { appendHistory } from "../persist/history.js";
import { recordFrequency } from "../persist/frequency.js";
import { writeEvent } from "../persist/writer.js";
import { assembleEvent } from "../event/assemble.js";
import { fingerprintOf } from "../event/fingerprint.js";
import {
  parseStacktrace,
  stackToLanguage,
  syntheticFrame,
} from "../trace/parser.js";
import type { Frame, Contexts, Breadcrumb, Frequency } from "../event/types.js";

/** Structurally compatible with opencode's `tool.execute.after` input. */
export interface ToolAfterInput {
  readonly tool: string;
  readonly sessionID: string;
  readonly callID: string;
  readonly args: { readonly command?: string } & Record<string, unknown>;
}

/** Structurally compatible with opencode's `tool.execute.after` output (mutable). */
export interface ToolAfterOutput {
  title: string;
  output: string;
  metadata: Record<string, unknown>;
}

export interface HookDeps {
  readonly patterns: readonly ErrorPattern[];
  readonly options: PluginOptions;
  readonly outputDir: string | null;
  readonly version: string;
  /** Worktree root, for source/git/cwd context. */
  readonly worktree: string | null;
  /** opencode SDK client (used defensively for breadcrumbs). */
  readonly client: unknown;
  readonly log?: (msg: string) => void;
}

export function createToolAfterHandler(
  deps: HookDeps,
): (input: ToolAfterInput, output: ToolAfterOutput) => Promise<void> {
  const { patterns, options, outputDir, version, worktree, client } = deps;
  const log = deps.log ?? ((m: string) => console.warn(m));

  return async function toolExecuteAfter(input, output): Promise<void> {
    if (!options.enabled) return;
    if (!isTerminalTool(input.tool)) return;

    const command = input.args?.command;
    if (typeof command !== "string") return;

    // Skip read-only inspection commands (grep/cat of logs etc.) so printed
    // error-like text isn't misclassified as a fresh failure.
    if (
      options.skipReadOnlyCommands &&
      options.readOnlyCommands &&
      isReadOnlyCommand(command, options.readOnlyCommands)
    ) {
      return;
    }

    const classification = classifyError(
      output.output,
      command,
      patterns,
      options.stacks,
    );
    if (!classification) return; // Successful or signal-less — do not pollute.

    const timestamp = new Date().toISOString();
    const stamped: Classification = { ...classification, timestamp };

    // ── Gather context (each pass is throw-safe; failure omits only its section) ──
    const frames = await gatherFrames(stamped, options, worktree, log);
    const git = options.gitContext ? gatherGit(worktree) : emptyGit();
    const os = options.runtimeContext
      ? gatherOs()
      : { name: "unknown", version: null, arch: null };
    const runtime = options.runtimeContext
      ? gatherRuntime(stamped.stack)
      : { name: "node", version: null };
    const breadcrumbs = options.breadcrumbs
      ? await gatherBreadcrumbs(
          client,
          input.sessionID,
          input.callID,
          options.breadcrumbLimit,
        )
      : [];

    const contexts: Contexts = {
      os,
      runtime,
      app: {
        worktree,
        cwd: worktree,
        git_branch: git.branch,
        git_commit: git.commit,
        git_dirty: git.dirty,
      },
      opencode: {
        version: null, // not exposed to the hook; filled where available
        session_id: input.sessionID,
        agent: null,
        model: null,
      },
    };

    const fingerprint = options.fingerprint ? fingerprintOf(stamped) : "";

    // Frequency must be computed BEFORE assembling so the persisted event
    // carries the up-to-date `times_seen`.
    let frequency: Frequency | null = null;
    if (outputDir && options.fingerprint && fingerprint) {
      try {
        frequency = await recordFrequency(
          outputDir,
          fingerprint,
          timestamp,
          (err) =>
            log(`[error-explainer] frequency failed: ${errSummary(err)}`),
        );
      } catch (err) {
        log(`[error-explainer] frequency error (ignored): ${errSummary(err)}`);
      }
    }

    const event = assembleEvent({
      classification: stamped,
      frames,
      contexts,
      breadcrumbs,
      fingerprint,
      frequency,
      sdkVersion: version,
      timestamp,
    });

    // Persist (best-effort). Redact raw output + source context before writing.
    if (outputDir) {
      const persisted = redactEvent(event, options.redact);
      try {
        await writeEvent(outputDir, persisted, (err) =>
          log(`[error-explainer] write failed: ${errSummary(err)}`),
        );
        if (options.historyLimit > 0) {
          const historyClass = options.redact
            ? redactClassification(stamped)
            : stamped;
          await appendHistory(outputDir, historyClass, {
            limit: options.historyLimit,
            onError: (err) =>
              log(`[error-explainer] history failed: ${errSummary(err)}`),
          });
        }
      } catch (err) {
        log(
          `[error-explainer] persistence error (ignored): ${errSummary(err)}`,
        );
      }
    }

    // Structured metadata for the model/machine.
    output.metadata.errorExplainer = {
      version,
      event_id: event.event_id,
      id: stamped.id,
      type: stamped.type,
      stack: stamped.stack,
      severity: stamped.severity,
      suggestion: stamped.suggestion,
      file: stamped.file ?? null,
      line: stamped.line ?? null,
      fingerprint: fingerprint || null,
      times_seen: frequency?.times_seen ?? null,
    };

    // Inline append (minimal by default — full report lives in the artifact/tool).
    appendInline(output, stamped, options);
  };
}

async function gatherFrames(
  c: Classification,
  options: PluginOptions,
  worktree: string | null,
  log: (m: string) => void,
): Promise<readonly Frame[]> {
  const lang = stackToLanguage(c.stack);
  let frames = lang ? parseStacktrace(c.raw, lang) : [];
  if (frames.length === 0) {
    const synth = syntheticFrame(c.file, c.line);
    frames = synth ? [synth] : [];
  }
  if (options.sourcePreview && frames.length > 0) {
    try {
      frames = await enrichFrames(frames, worktree, options.sourceContextLines);
    } catch (err) {
      log(`[error-explainer] source preview failed: ${errSummary(err)}`);
    }
  }
  return frames;
}

/**
 * Redact every persisted string that may carry user/runtime output.
 *
 * Covers: logger (command), extra.command, extra.matched_lines,
 * extra.raw_output_excerpts, exception value, source context lines, and
 * breadcrumb messages/commands. A missed field leaks secrets to disk.
 */
function redactEvent(event: ReturnType<typeof assembleEvent>, redact: boolean) {
  if (!redact) return event;
  const values = event.exception.values.map((v) => ({
    ...v,
    value: v.value ? redactSecrets(v.value) : v.value,
    stacktrace: {
      frames: v.stacktrace.frames.map((f) =>
        f.context
          ? {
              ...f,
              context: f.context.map((c) => ({
                line: c.line,
                source: redactSecrets(c.source),
              })),
            }
          : f,
      ),
    },
  }));
  const breadcrumbs = event.breadcrumbs.map((b) => ({
    ...b,
    message: redactSecrets(b.message),
    data: { ...b.data, command: redactSecrets(b.data.command) },
  }));
  const redactStrings = (val: unknown): unknown =>
    Array.isArray(val)
      ? val.map(redactStrings)
      : typeof val === "string"
        ? redactSecrets(val)
        : val;
  return {
    ...event,
    logger: redactSecrets(event.logger),
    exception: { values },
    breadcrumbs,
    extra: {
      ...event.extra,
      command: redactStrings(event.extra.command),
      matched_lines: redactStrings(event.extra.matched_lines),
      raw_output_excerpts: (
        event.extra.raw_output_excerpts as string[] | undefined
      )?.map(redactSecrets),
    },
  };
}

/**
 * Redact the string fields of a Classification before it is serialized to the
 * history ring buffer. The history file must not leak secrets any more than the
 * full event artifact does.
 */
function redactClassification(c: Classification): Classification {
  return {
    ...c,
    command: redactSecrets(c.command),
    matchedLines: c.matchedLines.map(redactSecrets),
    raw: redactSecrets(c.raw),
  };
}

function appendInline(
  output: ToolAfterOutput,
  c: Classification,
  options: PluginOptions,
): void {
  if (options.appendMode === "off" || !options.appendToOutput) return;
  if (options.appendMode === "minimal") {
    output.output = `${output.output}\n> [Error Explainer] ${c.type}: ${c.suggestion}`;
    return;
  }
  output.output = `${output.output}\n${buildExplanation(c, options.verbosity)}`;
}

function isTerminalTool(tool: string): boolean {
  const t = tool.toLowerCase();
  return (
    t === "bash" ||
    t === "shell" ||
    t === "terminal" ||
    t === "sh" ||
    t === "zsh"
  );
}

function emptyGit() {
  return {
    branch: null,
    commit: null,
    dirty: null,
    remote: null,
  } as ReturnType<typeof gatherGit>;
}

function errSummary(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Keep referenced types exported for callers/tests.
export type { Severity, Breadcrumb };
