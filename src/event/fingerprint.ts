/**
 * Grouping fingerprint.
 *
 * A normalized signature is SHA-1 hashed so the same logical error produces a
 * stable `fingerprint` regardless of absolute paths, line numbers, variable
 * values, or timestamps. Used to dedupe events in the frequency index.
 *
 * Pure + deterministic → trivially unit-testable.
 */

import { createHash } from "node:crypto";

import type { Classification } from "../classify/types.js";

/**
 * Normalize an error signature: lowercase, strip absolute-path prefixes,
 * numbers, common dynamic tokens (hex hashes, ids, quoted strings), and
 * collapse whitespace.
 */
export function normalizeSignature(text: string): string {
  return text
    .replace(/file:\/\/[^ ]*/g, "<path>") // file URIs
    .replace(/(?:\/[\w.@-]+)+\/([\w.-]+)/g, "$1") // strip dir prefixes, keep basename
    .replace(/\b\d+\b/g, "N") // all integers → N
    .replace(/0x[0-9a-f]+/gi, "0xH") // hex offsets
    .replace(/[0-9a-f]{8,}/gi, "H") // long hex (hashes/ids)
    .replace(/'[^']*'/g, "'…'") // single-quoted values
    .replace(/"[^"]*"/g, '"…"') // double-quoted values
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Build a deterministic fingerprint from a classification. */
export function fingerprintOf(c: Classification): string {
  const head = `${c.id}|${c.stack}|${c.severity}`;
  const body = normalizeSignature(c.matchedLines.slice(0, 3).join(" "));
  return createHash("sha1").update(`${head}::${body}`).digest("hex");
}
