/**
 * Per-session lesson policy for repeat errors (PRD §3).
 *
 * In-session only for v0.5.0: occurrence counts and "what resolved it" are
 * derived from the in-memory trail. Cross-session resolution memory is a
 * documented future extension, not this release.
 *
 * The lesson line format is fixed:
 * `[Error Explainer] <n><ordinal> <type> in this session; last resolved by: <resolution>`
 * — or `; no known resolution yet` when nothing succeeded since. Never
 * fabricate a resolution.
 */

const MAX_RESOLUTIONS_PER_SESSION = 50;

function ordinal(n: number): string {
  const rem10 = n % 10;
  const rem100 = n % 100;
  if (rem10 === 1 && rem100 !== 11) return `${n}st`;
  if (rem10 === 2 && rem100 !== 12) return `${n}nd`;
  if (rem10 === 3 && rem100 !== 13) return `${n}rd`;
  return `${n}th`;
}

export interface LessonPolicy {
  /** Record an occurrence; returns the count INCLUDING this one. */
  count(sessionID: string, fingerprint: string): number;
  /** Record that `command` later completed successfully (resolution source). */
  markSuccess(sessionID: string, command: string): void;
  /** "re-running <command> succeeded" when a success was recorded, else null. */
  resolutionFor(sessionID: string, command: string): string | null;
  /**
   * Lesson line for repeat occurrences; null when count < threshold.
   * Callers must not repeat the full diagnosis alongside the lesson.
   */
  lessonLine(input: {
    count: number;
    type: string;
    command: string;
    resolution: string | null;
  }): string | null;
}

export function createLessonPolicy(threshold: number): LessonPolicy {
  /** sessionID → fingerprint → count. */
  const counts = new Map<string, Map<string, number>>();
  /** sessionID → command → true (insertion-ordered for pruning). */
  const successes = new Map<string, Set<string>>();

  function pruneOldest(set: Set<string>): void {
    if (set.size > MAX_RESOLUTIONS_PER_SESSION) {
      const first = set.values().next().value;
      if (first !== undefined) set.delete(first);
    }
  }

  return {
    count(sessionID, fingerprint) {
      let perSession = counts.get(sessionID);
      if (!perSession) {
        perSession = new Map();
        counts.set(sessionID, perSession);
      }
      const next = (perSession.get(fingerprint) ?? 0) + 1;
      perSession.set(fingerprint, next);
      return next;
    },

    markSuccess(sessionID, command) {
      if (!command) return;
      let set = successes.get(sessionID);
      if (!set) {
        set = new Set();
        successes.set(sessionID, set);
      }
      set.delete(command);
      set.add(command);
      pruneOldest(set);
    },

    resolutionFor(sessionID, command) {
      return successes.get(sessionID)?.has(command)
        ? `re-running ${command} succeeded`
        : null;
    },

    lessonLine({ count, type, resolution }) {
      if (count < threshold) return null;
      const tail = resolution
        ? `last resolved by: ${resolution}`
        : "no known resolution yet";
      return `[Error Explainer] ${ordinal(count)} ${type} in this session; ${tail}`;
    },
  };
}
