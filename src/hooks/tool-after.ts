/**
 * `tool.execute.after` orchestrator.
 *
 * This is the ONLY entry point that touches the opencode runtime. It stays thin:
 * guard → classify → enrich → persist. All heavy lifting is delegated to pure,
 * unit-tested modules so the hook itself is obvious to read and hard to get
 * wrong. Every persistence failure is swallowed — the user's session must never
 * die because we couldn't write a debug file.
 */

import type { Classification, ErrorPattern } from "../classify/types.js";
import { classifyError } from "../classify/engine.js";
import type { PluginOptions } from "../config.js";
import { buildExplanation } from "../enrich/explainer.js";
import { redactSecrets } from "../enrich/redact.js";
import { appendHistory } from "../persist/history.js";
import { writeArtifacts } from "../persist/writer.js";

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
  /** Absolute dir, or null to disable persistence. */
  readonly outputDir: string | null;
  readonly version: string;
  /** Sink for non-fatal diagnostics. Defaults to console.warn. */
  readonly log?: (msg: string) => void;
}

/**
 * Build a `tool.execute.after` handler bound to resolved dependencies.
 *
 * The returned function has the exact signature opencode expects, so `index.ts`
 * can assign it directly into the hooks object.
 */
export function createToolAfterHandler(
  deps: HookDeps,
): (input: ToolAfterInput, output: ToolAfterOutput) => Promise<void> {
  const { patterns, options, outputDir, version } = deps;
  const log = deps.log ?? ((m: string) => console.warn(m));

  return async function toolExecuteAfter(input, output): Promise<void> {
    if (!options.enabled) return;

    // Only terminal-style tools carry a command. opencode's terminal tool is
    // `bash`; we also accept `shell`/`terminal` defensively in case of variants.
    if (!isTerminalTool(input.tool)) return;

    const command = input.args?.command;
    if (typeof command !== "string") return;

    // Classify (pure). Stack filter from options is applied here.
    const classification = classifyError(
      output.output,
      command,
      patterns,
      options.stacks,
    );
    if (!classification) return; // Successful or signal-less — do not pollute.

    const stamped: Classification = {
      ...classification,
      timestamp: new Date().toISOString(),
    };

    // Enrich the structured metadata the AI/machine can read.
    output.metadata.errorExplainer = {
      version,
      id: stamped.id,
      type: stamped.type,
      stack: stamped.stack,
      severity: stamped.severity,
      suggestion: stamped.suggestion,
      file: stamped.file ?? null,
      line: stamped.line ?? null,
    };

    // Append a concise explanation so the model sees it without an extra call.
    if (options.appendToOutput) {
      output.output = `${output.output}\n${buildExplanation(stamped, options.verbosity)}`;
    }

    // Persist to disk (best-effort). Redact before writing.
    if (outputDir) {
      const persisted = options.redact
        ? { ...stamped, raw: redactSecrets(stamped.raw) }
        : stamped;
      try {
        await writeArtifacts(outputDir, persisted, version, (err) =>
          log(
            `[error-explainer] failed to write artifacts: ${errSummary(err)}`,
          ),
        );
        if (options.historyLimit > 0) {
          await appendHistory(outputDir, persisted, {
            limit: options.historyLimit,
            onError: (err) =>
              log(
                `[error-explainer] history update failed: ${errSummary(err)}`,
              ),
          });
        }
      } catch (err) {
        log(
          `[error-explainer] persistence error (ignored): ${errSummary(err)}`,
        );
      }
    }
  };
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

function errSummary(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
