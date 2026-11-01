/**
 * Primary delivery for pending notes and the session digest (PRD §4/§5).
 *
 * Prepends to a prompt that is ALREADY being submitted — nothing is ever
 * sent on the plugin's own initiative, no session.prompt() calls, no
 * interruptions. The prompt hook fires for every prompt in every session;
 * the plugin only ever adds a prefix to its text.
 *
 * `PromptInput.Prompt` carries a plain mutable `text: string`
 * (verified against @opencode/plugin 2.0.26); any other shape is logged
 * and skipped, never thrown on.
 */

import type { PluginOptions } from "../config.js";
import type { PendingNotes } from "../bus/pending.js";

export interface PromptHookDeps {
  readonly options: PluginOptions;
  readonly pending: PendingNotes;
  /** Build the digest for this worktree (injected: () => buildDigest(outputDir)). */
  readonly digest: () => Promise<string | null>;
  /** True when the session should receive the digest (main sessions only). */
  readonly isMainSession: (sessionID: string) => Promise<boolean>;
  readonly log?: (msg: string) => void;
}

interface PromptLike {
  text: string;
}

export function createPromptHook(
  deps: PromptHookDeps,
): (input: { sessionID: string; prompt: unknown }) => Promise<void> {
  const { options, pending, digest, isMainSession } = deps;
  const log = deps.log ?? (() => {});
  /** Sessions that already received their digest. */
  const digested = new Set<string>();

  return async function promptHook(input): Promise<void> {
    try {
      if (!input || typeof input.sessionID !== "string") return;
      const prompt = input.prompt as Partial<PromptLike> | null;
      if (
        !prompt ||
        typeof prompt !== "object" ||
        typeof prompt.text !== "string"
      ) {
        log("[error-explainer] prompt hook: unexpected prompt shape, skipping");
        return;
      }

      const prefixes: string[] = [];

      // Digest: once per session, main sessions only, switchable.
      if (options.sessionMemory && !digested.has(input.sessionID)) {
        digested.add(input.sessionID);
        if (await isMainSession(input.sessionID)) {
          const digestText = await digest();
          if (digestText) {
            prefixes.push(
              `[Error Explainer] Prior errors in this worktree:\n${digestText}`,
            );
          }
        }
      }

      // Pending notes (oldest first), drained on delivery.
      const notes = pending.drain(input.sessionID);
      prefixes.push(...notes);

      if (prefixes.length === 0) return;
      prompt.text = `${prefixes.join("\n")}\n${prompt.text}`;
    } catch (err) {
      log(
        `[error-explainer] prompt hook error (ignored): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
}
