/**
 * Cross-source deduplication for the tool/shell double-capture overlap.
 *
 * A failed agent terminal command may arrive twice — once through
 * `tool.execute.after` and once through the `session.shell.ended` bus event —
 * because the shell service's metadata suggests the terminal tool routes
 * through it. The terminal-tool path records every command it classified as
 * an error; the bus path checks before classifying. If the events never
 * overlap in practice, this layer is a harmless no-op.
 */

const DEFAULT_WINDOW_MS = 5000;

export interface Deduper {
  /** Called by the terminal-tool path whenever it classifies an error. */
  recordToolError(command: string): void;
  /** True when a bus shell signal repeats a recently recorded tool error. */
  isDuplicate(command: string): boolean;
}

export function createDeduper(windowMs: number = DEFAULT_WINDOW_MS): Deduper {
  /** command → last-seen epoch ms. */
  const seen = new Map<string, number>();

  function prune(now: number): void {
    for (const [cmd, at] of seen) {
      if (now - at > windowMs) seen.delete(cmd);
    }
  }

  return {
    recordToolError(command) {
      if (!command) return;
      const now = Date.now();
      prune(now);
      seen.set(command, now);
    },
    isDuplicate(command) {
      if (!command) return false;
      const now = Date.now();
      prune(now);
      const at = seen.get(command);
      return at !== undefined && now - at <= windowMs;
    },
  };
}
