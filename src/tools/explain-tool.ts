/**
 * Custom tool: `explain_error`.
 *
 * Registered through `ctx.tool.transform` so the AI (or a user-driven command)
 * can ask, on demand:
 *
 *   - "Explain this error text" → pass `text` with the output to classify.
 *   - "What was the last error?" → omit `text`; the tool reads `last-error.json`.
 *
 * This is a major differentiator: the model can recover the structured
 * explanation for an error even when the inline `tool.execute.after` enrichment
 * has scrolled out of context.
 */

import { classifyError } from "../classify/engine.js";
import type { ErrorPattern } from "../classify/types.js";
import type { Verbosity } from "../config.js";
import { buildExplanation } from "../enrich/explainer.js";
import { buildEventMarkdown } from "../event/render.js";
import type { SentryGradeEvent } from "../event/types.js";
import { toSerializable } from "../util/extract.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface ExplainToolDeps {
  readonly patterns: readonly ErrorPattern[];
  readonly outputDir: string | null;
  readonly verbosity: Verbosity;
  readonly version: string;
  readonly log?: (msg: string) => void;
}

/** Structural subset of v2's `Tool.Info` — see @opencode/plugin's tool domain. */
export interface ExplainToolInfo {
  readonly name: string;
  readonly description: string;
  readonly input: Record<string, unknown>;
  // v2 only accepts `content` unless the tool declares an output schema.
  execute(input: unknown): Promise<{
    content: string;
    metadata?: Record<string, unknown>;
  }>;
}

/** Read `text` out of an untyped tool input. */
function textOf(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const t = (input as { text?: unknown }).text;
  return typeof t === "string" ? t : undefined;
}

/** Read a display field off an untyped artifact, falling back when absent. */
function field(
  data: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const v = data[key];
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

/**
 * Build the `explain_error` tool bound to resolved dependencies.
 */
export function createExplainTool(deps: ExplainToolDeps): ExplainToolInfo {
  const { patterns, outputDir, verbosity, version } = deps;
  const log = deps.log ?? ((m: string) => console.warn(m));

  return {
    name: "explain_error",
    description:
      "Explain a terminal error. Pass `text` to classify an arbitrary error " +
      "output, or call with no arguments to recall the most recent captured " +
      "error. Returns a concise diagnosis plus actionable next steps.",
    input: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description:
            "The error text to explain. Omit to recall the last captured error.",
        },
      },
    },

    async execute(input: unknown) {
      // Mode 1: caller supplied text to classify right now.
      const text = textOf(input);
      if (text && text.trim().length > 0) {
        const classification = classifyError(text, "(manual)", patterns);
        if (!classification) {
          return {
            content:
              "The provided text does not contain a recognized error signature. " +
              "Look for the first line starting with `Error`, `Failed`, `Exception`, or `Caused by`.",
          };
        }
        const stamped = {
          ...classification,
          timestamp: new Date().toISOString(),
        };
        return {
          content: buildExplanation(stamped, verbosity),
          metadata: { errorExplainer: toSerializable(stamped, version) },
        };
      }

      // Mode 2: recall the last persisted error.
      if (!outputDir) {
        return {
          content:
            "Persistence is disabled (no output directory resolved), so there is " +
            "no last-error record to recall. Pass `text` to classify an error directly.",
        };
      }

      try {
        const raw = await readFile(join(outputDir, "last-error.json"), "utf8");
        const parsed = JSON.parse(raw) as unknown;
        // v0.2 persisted a full Sentry-grade event → render the rich report.
        if (isSentryEvent(parsed)) {
          return {
            content: buildEventMarkdown(parsed),
            metadata: { errorExplainer: parsed },
          };
        }
        // v0.1-style serializable fallback (older artifact on disk).
        const data = parsed as Record<string, unknown>;
        return {
          content: [
            `Last error — ${field(data, "type", "Unknown")} (${field(data, "severity", "?")})`,
            "",
            `Suggestion: ${field(data, "suggestion", "(none)")}`,
          ].join("\n"),
          metadata: { errorExplainer: data },
        };
      } catch (err) {
        log(
          `[error-explainer] could not read last-error.json: ${errSummary(err)}`,
        );
        return {
          content:
            "No captured error is available yet. Run a command that fails, or pass `text` to classify an error directly.",
        };
      }
    },
  };
}

function isSentryEvent(value: unknown): value is SentryGradeEvent {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.event_id === "string" &&
    !!v.exception &&
    typeof v === "object" &&
    typeof (v as { sdk?: unknown }).sdk === "object"
  );
}

function errSummary(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
