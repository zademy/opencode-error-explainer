/**
 * Custom tool: `explain_error`.
 *
 * Registered via the `tool: { explain_error: ... }` object hook so the AI (or a
 * user-driven command) can ask, on demand:
 *
 *   - "Explain this error text" → pass `text` with the output to classify.
 *   - "What was the last error?" → omit `text`; the tool reads `last-error.json`.
 *
 * This is a major differentiator: the model can recover the structured
 * explanation for an error even when the inline `tool.execute.after` enrichment
 * has scrolled out of context.
 */

import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import { z } from "zod";

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

/**
 * Build the `explain_error` ToolDefinition bound to resolved dependencies.
 */
export function createExplainTool(deps: ExplainToolDeps): ToolDefinition {
  const { patterns, outputDir, verbosity, version } = deps;
  const log = deps.log ?? ((m: string) => console.warn(m));

  return tool({
    description:
      "Explain a terminal error. Pass `text` to classify an arbitrary error " +
      "output, or call with no arguments to recall the most recent captured " +
      "error. Returns a concise diagnosis plus actionable next steps.",
    args: {
      text: z
        .string()
        .optional()
        .describe(
          "The error text to explain. Omit to recall the last captured error.",
        ),
    },
    async execute(args) {
      // Mode 1: caller supplied text to classify right now.
      if (typeof args.text === "string" && args.text.trim().length > 0) {
        const classification = classifyError(args.text, "(manual)", patterns);
        if (!classification) {
          return {
            title: "No error detected",
            output:
              "The provided text does not contain a recognized error signature. " +
              "Look for the first line starting with `Error`, `Failed`, `Exception`, or `Caused by`.",
          };
        }
        const stamped = {
          ...classification,
          timestamp: new Date().toISOString(),
        };
        return {
          title: `Error Explainer — ${stamped.type}`,
          output: buildExplanation(stamped, verbosity),
          metadata: { errorExplainer: toSerializable(stamped, version) },
        };
      }

      // Mode 2: recall the last persisted error.
      if (!outputDir) {
        return {
          title: "Error Explainer unavailable",
          output:
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
            title: `Last error — ${parsed.exception.values[0]?.type ?? "Error"}`,
            output: buildEventMarkdown(parsed),
            metadata: { errorExplainer: parsed },
          };
        }
        // v0.1-style serializable fallback (older artifact on disk).
        const data = parsed as Record<string, unknown>;
        return {
          title: "Last captured error",
          output: [
            `Last error — ${String(data.type ?? "Unknown")} (${String(data.severity ?? "?")})`,
            "",
            `Suggestion: ${String(data.suggestion ?? "(none)")}`,
          ].join("\n"),
          metadata: { errorExplainer: data },
        };
      } catch (err) {
        log(
          `[error-explainer] could not read last-error.json: ${errSummary(err)}`,
        );
        return {
          title: "No recent error",
          output:
            "No captured error is available yet. Run a command that fails, or pass `text` to classify an error directly.",
        };
      }
    },
  });
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
