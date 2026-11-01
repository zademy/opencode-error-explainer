/**
 * Per-session queue of one-liner notes awaiting delivery (PRD §4).
 *
 * Bus-only errors cannot be injected at the instant they happen (no tool
 * result is in flight); their guidance is enqueued here and delivered by the
 * prompt hook — prepended to a prompt already being submitted — or rides
 * along with the next terminal injection as fallback.
 */

const MAX_PER_SESSION = 10;

export interface PendingNotes {
  /** Returns false when an identical line is already queued for the session. */
  enqueue(sessionID: string, line: string): boolean;
  /** Removes and returns all lines for the session (oldest first). */
  drain(sessionID: string): readonly string[];
}

export function createPendingNotes(
  log: (msg: string) => void = () => {},
): PendingNotes {
  /** sessionID → queued lines (oldest first). */
  const queues = new Map<string, string[]>();

  return {
    enqueue(sessionID, line) {
      let q = queues.get(sessionID);
      if (!q) {
        q = [];
        queues.set(sessionID, q);
      }
      if (q.includes(line)) return false;
      if (q.length >= MAX_PER_SESSION) {
        log(
          `[Error Explainer] pending-note cap reached for session ${sessionID}; dropping note`,
        );
        return false;
      }
      q.push(line);
      return true;
    },
    drain(sessionID) {
      const q = queues.get(sessionID);
      if (!q) return [];
      queues.delete(sessionID);
      return q;
    },
  };
}
