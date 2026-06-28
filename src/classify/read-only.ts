/**
 * Read-only command skip.
 *
 * Commands that only READ text (cat/grep/less/head/tail/rg/find/ls…) frequently
 * PRINT error-like content without there being an actual failure — e.g. you
 * `grep -i error app.log`. Because the plugin has no exit code, it would
 * otherwise mis-classify that printed text as a fresh error. This module
 * identifies such commands so the hook can skip them.
 *
 * Pure: takes the command string + allow-list of prefixes, returns a boolean.
 */

/** First meaningful token of a command, after sudo/env-assignments/pipes. */
export function commandHead(command: string): string {
  if (!command) return "";
  // Drop everything after the first pipe/&&/;/|| so we judge the leading action.
  const head = command.split(/\s*(?:\|\||&&|;|\|)\s*/)[0] ?? command;
  return tokenOf(head);
}

/**
 * Split a command into its constituent segments at shell combinators
 * (`&&`, `||`, `;`, `|`) and return the meaningful token of each.
 */
export function commandSegments(command: string): string[] {
  if (!command) return [];
  return command
    .split(/\s*(?:\|\||&&|;|\|)\s*/)
    .map((seg) => tokenOf(seg))
    .filter((t) => t.length > 0);
}

/** Extract the first meaningful token from a single command segment. */
function tokenOf(segment: string): string {
  const stripped = segment
    .replace(/^(?:sudo\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)+/i, "")
    .replace(/^(?:sudo\s+)?(?:builtin\s+|command\s+|-?\s*)/i, "")
    .trim();
  const m = stripped.match(/([A-Za-z][\w.-]*)/);
  return m ? (m[1] ?? "").toLowerCase() : "";
}

/**
 * True when the ENTIRE command is a read-only inspection of text — every
 * segment must be read-only. A compound command like `grep x && npm test`
 * is NOT skipped because `npm test` can fail and produce real errors.
 */
export function isReadOnlyCommand(
  command: string,
  readOnlyCommands: readonly string[],
): boolean {
  const segments = commandSegments(command);
  if (segments.length === 0) return false;
  const set = new Set(readOnlyCommands.map((c) => c.toLowerCase()));
  return segments.every((head) => set.has(head));
}
