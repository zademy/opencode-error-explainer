/**
 * Persist pipeline for bus signals (PRD §7): classify → assemble → persist,
 * then enqueue the lesson note for deferred delivery (prompt hook).
 *
 * Mirrors the terminal-tool path's persist calls (tool-after.ts) with a
 * minimal context: no frames, no breadcrumbs (the subscriber records those in
 * the trail as they happen), and `extra.source: "event-bus"` on the event.
 *
 * The whole body is wrapped so a bus signal can never throw into the host.
 */

import { classifyError } from "../classify/engine.js";
import type { ErrorPattern } from "../classify/types.js";
import type { PluginOptions } from "../config.js";
import { gatherOs, gatherRuntime } from "../context/env.js";
import { gatherGit } from "../context/git.js";
import type { Contexts } from "../event/types.js";
import { assembleEvent } from "../event/assemble.js";
import { fingerprintOf } from "../event/fingerprint.js";
import type { Frequency } from "../event/types.js";
import type { LessonPolicy } from "../enrich/lessons.js";
import { redactSecrets } from "../enrich/redact.js";
import { appendHistory } from "../persist/history.js";
import { recordFrequency } from "../persist/frequency.js";
import { writeEvent } from "../persist/writer.js";
import type { PendingNotes } from "./pending.js";
import type { BusSignal } from "./types.js";

export interface BusPipelineDeps {
  readonly patterns: readonly ErrorPattern[];
  readonly options: PluginOptions;
  readonly outputDir: string | null;
  readonly version: string;
  readonly worktree: string | null;
  readonly sdkVersion: string | null;
  readonly lessons: LessonPolicy;
  readonly pending: PendingNotes;
  readonly log?: (msg: string) => void;
}

function errSummary(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createBusPipeline(
  deps: BusPipelineDeps,
): (signal: BusSignal) => Promise<void> {
  const {
    patterns,
    options,
    outputDir,
    version,
    worktree,
    sdkVersion,
    lessons,
    pending,
  } = deps;
  const log = deps.log ?? (() => {});

  return async function runBusPipeline(signal): Promise<void> {
    try {
      const classification = classifyError(
        signal.text,
        signal.command,
        patterns,
        options.stacks,
      );
      if (!classification) return;

      const timestamp = new Date().toISOString();
      const stamped = { ...classification, timestamp };

      const git = options.gitContext
        ? gatherGit(worktree)
        : { branch: null, commit: null, dirty: null };
      const os = options.runtimeContext
        ? gatherOs()
        : { name: "unknown", version: null, arch: null };
      const runtime = options.runtimeContext
        ? gatherRuntime(stamped.stack)
        : { name: "node", version: null };

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
          version: sdkVersion,
          session_id: signal.sessionID,
          agent: null,
          model: null,
        },
      };

      const fingerprint = options.fingerprint ? fingerprintOf(stamped) : "";

      // Frequency before assembly so the event carries the fresh times_seen.
      let frequency: Frequency | null = null;
      if (outputDir && options.fingerprint && fingerprint) {
        try {
          frequency = await recordFrequency(
            outputDir,
            fingerprint,
            timestamp,
            (err) =>
              log(`[error-explainer] bus frequency failed: ${errSummary(err)}`),
          );
        } catch (err) {
          log(
            `[error-explainer] bus frequency error (ignored): ${errSummary(err)}`,
          );
        }
      }

      const event = assembleEvent({
        classification: stamped,
        frames: [],
        contexts,
        breadcrumbs: [],
        fingerprint,
        frequency,
        sdkVersion: version,
        timestamp,
        source: "event-bus",
      });

      // Lesson note (deferred delivery — never sent directly).
      const count = lessons.count(signal.sessionID, fingerprint || stamped.id);
      const line = lessons.lessonLine({
        count,
        type: stamped.type,
        command: signal.command,
        resolution: lessons.resolutionFor(signal.sessionID, signal.command),
      });
      if (line) pending.enqueue(signal.sessionID, line);

      if (outputDir) {
        // Redact every string this path can set before it hits disk.
        const persisted = options.redact
          ? {
              ...event,
              logger: redactSecrets(event.logger),
              exception: {
                values: event.exception.values.map((v) => ({
                  ...v,
                  value: redactSecrets(v.value),
                })),
              },
              extra: {
                ...event.extra,
                command: redactSecrets(event.extra.command as string),
                matched_lines: (
                  event.extra.matched_lines as readonly string[]
                ).map(redactSecrets),
                raw_output_excerpts: (
                  event.extra.raw_output_excerpts as readonly string[]
                ).map(redactSecrets),
              },
            }
          : event;
        try {
          await writeEvent(outputDir, persisted, (err) =>
            log(`[error-explainer] bus write failed: ${errSummary(err)}`),
          );
          if (options.historyLimit > 0) {
            const historyClass = options.redact
              ? {
                  ...stamped,
                  command: redactSecrets(stamped.command),
                  matchedLines: stamped.matchedLines.map(redactSecrets),
                  raw: redactSecrets(stamped.raw),
                }
              : stamped;
            await appendHistory(outputDir, historyClass, {
              limit: options.historyLimit,
              onError: (err) =>
                log(`[error-explainer] bus history failed: ${errSummary(err)}`),
            });
          }
        } catch (err) {
          log(
            `[error-explainer] bus persistence error (ignored): ${errSummary(err)}`,
          );
        }
      }
    } catch (err) {
      log(`[error-explainer] bus pipeline error (ignored): ${errSummary(err)}`);
    }
  };
}
