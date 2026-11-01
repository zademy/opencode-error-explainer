/**
 * opencode-error-explainer — plugin entry point (OpenCode v2).
 *
 * Detects failed terminal commands, classifies the error, explains it to the AI,
 * and persists a redacted, structured record for later recall.
 *
 * V2 registers everything on the domain that owns the operation: tool hooks for
 * the pipeline, and a tool transform for the explain_error tool.
 *
 * Activation: drop the built dist/index.js into ~/.config/opencode/plugins/ or
 * .opencode/plugins/. Options come from the plugins entry in opencode.json,
 * e.g. { "plugins": [{ "package": "./error-explainer",
 * "options": { "verbosity": "concise" } }] }.
 */

import { Plugin } from "@opencode/plugin";

import { resolveOptions } from "./config.js";
import { loadPatterns } from "./classify/loader.js";
import { createToolAfterHandler } from "./hooks/tool-after.js";
import { createExplainTool } from "./tools/explain-tool.js";
import { registerExplainCommand } from "./command/explain.js";
import { createTrail } from "./breadcrumbs/trail.js";
import { createLessonPolicy } from "./enrich/lessons.js";
import { createPendingNotes } from "./bus/pending.js";
import { createDeduper } from "./bus/dedupe.js";
import { shouldSubscribe, subscribeBus } from "./bus/subscribe.js";
import {
  argsOf,
  commandOf,
  resultText,
  withAppended,
  type ToolResultLike,
} from "./util/tool-event.js";
import { resolveCustomPatternsPath, resolveOutputDir } from "./util/env.js";
import { VERSION } from "./version.js";

const log = (msg: string): void => {
  // Best-effort, non-fatal diagnostics. Goes to stderr; never throws.
  console.warn(msg);
};

function errSummary(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default Plugin.define({
  id: "opencode-error-explainer",

  async setup(ctx) {
    const opts = resolveOptions(ctx.options);

    // Disabled entirely — register nothing.
    if (!opts.enabled) return;

    const directory = ctx.location.directory;
    const outputDir = resolveOutputDir(directory, opts);
    const patterns = await loadPatterns(
      resolveCustomPatternsPath(directory, opts),
      log,
    );

    // Breadcrumbs come from our own record of the tool calls we observe plus,
    // since v0.5, the OpenCode event bus (session shell + permission events).
    const trail = createTrail();

    // v0.5 — shared cross-source state: lessons, pending notes, dedup.
    const lessons =
      opts.lessonThreshold > 1
        ? createLessonPolicy(opts.lessonThreshold)
        : null;
    const pending = createPendingNotes();
    const deduper = createDeduper();

    const after = createToolAfterHandler({
      patterns,
      options: opts,
      outputDir,
      sdkVersion: ctx.app.version,
      version: VERSION,
      worktree: directory,
      trail,
      lessons,
      deduper,
      pending,
      log,
    });

    await ctx.tool.hook("execute.before", (event) => {
      const command = commandOf(event.input);
      trail.record({
        callID: event.id,
        sessionID: event.sessionID,
        tool: event.tool,
        command,
        status: "running",
        timestamp: new Date().toISOString(),
        message: command || event.tool,
      });
    });

    await ctx.tool.hook("execute.after", async (event) => {
      const failed = event.status === "error";
      const command = commandOf(event.input);
      const text = failed ? event.error.message : resultText(event.result);

      trail.record({
        callID: event.id,
        sessionID: event.sessionID,
        tool: event.tool,
        command,
        status: failed ? "error" : "completed",
        timestamp: new Date().toISOString(),
        message: failed ? event.error.message : command || event.tool,
      });

      // The handler writes its structured payload into metadata and RETURNS the
      // text to append; applying it here keeps knowledge of v2's result shape in
      // one place.
      const carrier: {
        title: string;
        output: string;
        metadata: Record<string, unknown>;
      } = { title: "", output: text, metadata: {} };

      const appended = await after(
        {
          tool: event.tool,
          sessionID: event.sessionID,
          id: event.id,
          agent: event.agent,
          input: argsOf(event.input),
        },
        carrier,
      );

      // Failed tools have no writable result — the explanation still lands in the
      // persisted artifact and the trail, so nothing is silently lost.
      if (failed) return;

      let result = event.result as ToolResultLike;
      if (appended) result = withAppended(result, appended);
      event.result = {
        ...result,
        metadata: { ...result.metadata, ...carrier.metadata },
      } as typeof event.result;
    });

    await ctx.tool.transform((editor) => {
      editor.add(
        createExplainTool({
          patterns,
          outputDir,
          verbosity: opts.verbosity,
          version: VERSION,
          log,
        }),
      );
    });

    await registerExplainCommand(ctx, {
      prompt: (sessionID, text, delivery) =>
        ctx.session.prompt({ sessionID, text, delivery }),
      log,
    });

    // v0.5 — event bus: model/agent-layer errors, session shell commands,
    // permission denials → same pipeline; pending notes + digest delivered
    // through the prompt hook. Read-only subscription, never interrupts.
    if (shouldSubscribe(opts)) {
      subscribeBus({
        registerEvents: (onEvent) => {
          // The host's event surface is typed as an Effect Stream but the
          // runtime hands plugins the promise flavor: an AsyncIterable.
          // Consume defensively — if the shape ever differs, log and keep
          // the terminal path working (bus capture degrades gracefully).
          const subscribe = (
            ctx.event as { subscribe?: (o?: unknown) => unknown }
          ).subscribe;
          const stream = subscribe?.();
          const iterable = stream as AsyncIterable<unknown> | undefined;
          if (
            iterable &&
            typeof iterable[Symbol.asyncIterator] === "function"
          ) {
            void (async () => {
              for await (const event of iterable) {
                onEvent(event);
              }
            })().catch((err) =>
              log(`[error-explainer] event bus ended: ${errSummary(err)}`),
            );
          } else {
            log(
              "[error-explainer] event bus stream is not async-iterable; bus capture disabled",
            );
          }
        },
        registerPromptHook: (cb) => {
          void ctx.session.hook("prompt", cb);
        },
        isMainSession: async (sessionID) => {
          try {
            const info =
              (await (
                ctx.session as unknown as {
                  get?: (
                    id: string,
                  ) => Promise<{ parentID?: string | null } | null>;
                }
              ).get?.(sessionID)) ?? null;
            // Main = no parent; unknown shape → treat as main.
            return !info?.parentID;
          } catch {
            return true;
          }
        },
        patterns,
        options: opts,
        outputDir,
        version: VERSION,
        worktree: directory,
        sdkVersion: ctx.app.version,
        trail,
        // When lessons are off (threshold ≤ 1) the bus pipeline still needs a
        // policy — a never-triggering one keeps bus notes off in that mode.
        lessons: lessons ?? createLessonPolicy(Number.MAX_SAFE_INTEGER),
        pending,
        deduper,
        log,
      });
    }
  },
});

export { VERSION } from "./version.js";
export type { PluginOptions } from "./config.js";
export type {
  Classification,
  ErrorPattern,
  Severity,
  Stack,
} from "./classify/types.js";
export {
  classifyError,
  inferStackFromCommand,
  looksLikeError,
} from "./classify/engine.js";
export { BUILT_IN_PATTERNS, mergeCustomPatterns } from "./classify/patterns.js";
export { redactSecrets } from "./enrich/redact.js";
export { buildExplanation, buildMarkdownReport } from "./enrich/explainer.js";
