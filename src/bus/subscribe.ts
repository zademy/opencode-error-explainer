/**
 * The single event-bus entry point (PRD §1): one `ctx.event.subscribe` handler
 * plus one `ctx.session.hook("prompt", …)` registration.
 *
 * Discipline: the bus handler catches EVERYTHING — a plugin bug must never
 * propagate into the host session. Unknown/malformed events are dropped by
 * the mapper; this layer only routes the mapper's effects:
 *   - signal      → dedup check (shell vs tool) → pipeline (persist + note)
 *   - breadcrumb  → trail.record (richer Sentry context)
 *   - digest-pending → no-op here; the prompt hook builds the digest lazily
 */

import { randomUUID } from "node:crypto";

import type { PluginOptions } from "../config.js";
import type { ErrorPattern } from "../classify/types.js";
import type { BreadcrumbTrail } from "../breadcrumbs/trail.js";
import { createPromptHook } from "../hooks/prompt.js";
import type { LessonPolicy } from "../enrich/lessons.js";
import { buildDigest } from "./digest.js";
import { createBusPipeline } from "./pipeline.js";
import { createBusState, mapBusEvent } from "./mapper.js";
import type { PendingNotes } from "./pending.js";
import type { BusSignal } from "./types.js";
import type { Deduper } from "./dedupe.js";

export interface SubscribeDeps {
  /**
   * Adapter: deliver every raw event-bus event to `onEvent`. Wired in
   * index.ts against the host's event stream (async-iterable promise
   * flavor); must never throw synchronously.
   */
  readonly registerEvents: (onEvent: (e: unknown) => void) => void;
  /** Adapter: register the prompt-delivery hook with the host session. */
  readonly registerPromptHook: (cb: (i: unknown) => Promise<void>) => void;
  /** True when the session should receive the digest (main sessions only). */
  readonly isMainSession: (sessionID: string) => Promise<boolean>;
  readonly patterns: readonly ErrorPattern[];
  readonly options: PluginOptions;
  readonly outputDir: string | null;
  readonly version: string;
  readonly worktree: string | null;
  readonly sdkVersion: string | null;
  readonly trail: BreadcrumbTrail | null;
  readonly lessons: LessonPolicy;
  readonly pending: PendingNotes;
  readonly deduper: Deduper;
  /** Override the pipeline (dependency injection for tests). */
  readonly pipeline?: (signal: BusSignal) => Promise<void>;
  readonly log?: (msg: string) => void;
}

/** Pure gate used by the entry point: never subscribe when disabled. */
export function shouldSubscribe(options: PluginOptions): boolean {
  return options.enabled && options.captureEvents;
}

export function subscribeBus(deps: SubscribeDeps): void {
  const { options, outputDir, trail, pending, deduper, log } = deps;
  const state = createBusState();
  const pipeline =
    deps.pipeline ??
    createBusPipeline({
      patterns: deps.patterns,
      options,
      outputDir,
      version: deps.version,
      worktree: deps.worktree,
      sdkVersion: deps.sdkVersion,
      lessons: deps.lessons,
      pending,
      log,
    });

  const promptHook = createPromptHook({
    options,
    pending,
    digest: () => (outputDir ? buildDigest(outputDir) : Promise.resolve(null)),
    isMainSession: deps.isMainSession,
    log,
  });
  deps.registerPromptHook(promptHook);

  deps.registerEvents((event) => {
    try {
      const effects = mapBusEvent(event, state);
      for (const eff of effects) {
        if (eff.type === "breadcrumb") {
          trail?.record({
            callID: randomUUID(),
            sessionID: eff.sessionID,
            tool: eff.tool,
            command: eff.command,
            status: eff.status,
            timestamp: new Date().toISOString(),
            message: eff.message,
          });
        } else if (eff.type === "signal") {
          const signal = eff.signal;
          if (
            signal.kind === "shell-failed" &&
            deduper.isDuplicate(signal.command)
          ) {
            continue; // already captured via tool.execute.after
          }
          void pipeline(signal).catch(() => {
            /* pipeline swallows internally; belt and braces */
          });
        }
        // digest-pending: the prompt hook builds the digest lazily — no-op.
      }
    } catch {
      // never propagate into the host
    }
  });
}
