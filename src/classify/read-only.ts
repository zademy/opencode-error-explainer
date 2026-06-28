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
  const stripped = head
    .replace(/^(?:sudo\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)+/i, "")
    .replace(/^(?:sudo\s+)?(?:builtin\s+|command\s+|-?\s*)/i, "")
    .trim();
  const m = stripped.match(/([A-Za-z][\w.-]*)/);
  return m ? (m[1] ?? "").toLowerCase() : "";
}

/**
 * True when the command is a read-only inspection of text. Such commands are
 * skipped to avoid false positives when their output merely contains error
 * words.
 */
export function isReadOnlyCommand(
  command: string,
  readOnlyCommands: readonly string[],
): boolean {
  const head = commandHead(command);
  if (!head) return false;
  const set = new Set(readOnlyCommands.map((c) => c.toLowerCase()));
  return set.has(head);
}
