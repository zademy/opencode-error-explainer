/**
 * Breadcrumbs: the most recent tool calls leading up to a failure.
 *
 * V1 read these back out of the host SDK (`client.session.messages`). V2's plugin
 * context has no message-reading API, so we keep our own ring buffer instead:
 * the plugin already sees every `tool.execute.before`/`execute.after` event, and
 * recording them is both cheaper and synchronous.
 *
 * Per-session so concurrent worktrees never bleed into each other's context.
 */

import type { Breadcrumb } from "../event/types.js";

/** One recorded tool call. Updated in place as the call progresses. */
export interface ToolCallEntry {
  readonly callID: string;
  readonly sessionID: string;
  readonly tool: string;
  readonly command: string;
  readonly status: string;
  readonly timestamp: string;
  readonly message: string;
}

export interface BreadcrumbTrail {
  record(entry: ToolCallEntry): void;
  /**
   * Most recent calls for a session, oldest-first, EXCLUDING the current call so
   * an error only shows what happened BEFORE it.
   */
  snapshot(
    sessionID: string,
    excludeCallID: string | undefined,
    limit: number,
  ): readonly Breadcrumb[];
}

const PER_SESSION_CAP = 50;

/**
 * `execute.before` reports "running"; the matching `execute.after` overwrites it,
 * so a call that never finished still shows up rather than vanishing.
 */
function toLevel(status: string): Breadcrumb["level"] {
  if (status === "error") return "error";
  if (status === "running") return "warning";
  return "info";
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export function createTrail(): BreadcrumbTrail {
  const sessions = new Map<string, ToolCallEntry[]>();

  return {
    record(entry) {
      let entries = sessions.get(entry.sessionID);
      if (!entries) {
        entries = [];
        sessions.set(entry.sessionID, entries);
      }
      const at = entries.findIndex((e) => e.callID === entry.callID);
      if (at >= 0) entries[at] = entry;
      else entries.push(entry);
      // shortcut: one session map entry grows without bound; drop the oldest.
      if (entries.length > PER_SESSION_CAP)
        entries.splice(0, entries.length - PER_SESSION_CAP);
    },

    snapshot(sessionID, excludeCallID, limit) {
      const entries = sessions.get(sessionID);
      if (!entries || limit <= 0) return [];
      return entries
        .filter((e) => e.callID !== excludeCallID)
        .slice(-limit)
        .map((e) => ({
          timestamp: e.timestamp,
          type: "default",
          category: "tool",
          level: toLevel(e.status),
          message: truncate(e.message, 160),
          data: {
            tool: e.tool,
            command: truncate(e.command, 240),
            status: e.status,
          },
        }));
    },
  };
}
