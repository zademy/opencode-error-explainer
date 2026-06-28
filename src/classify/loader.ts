/**
 * Pattern loading.
 *
 * Reads the user's optional `.error-patterns.json` from the worktree and merges
 * it over the built-ins. Kept separate from `patterns.ts` so the data/merge
 * layer stays pure and trivially testable, while filesystem I/O lives here.
 */

import { readFile } from "node:fs/promises";

import { BUILT_IN_PATTERNS, mergeCustomPatterns } from "./patterns.js";
import type { ErrorPattern } from "./types.js";

/**
 * Load the effective pattern list: built-ins merged with user overrides.
 *
 * Failures (missing file, malformed JSON) are non-fatal: they log a warning and
 * fall back to built-ins only, so a bad custom file never breaks the session.
 */
export async function loadPatterns(
  customPath: string | null,
  onWarn?: (msg: string) => void,
): Promise<readonly ErrorPattern[]> {
  if (!customPath) return BUILT_IN_PATTERNS;

  let raw: string;
  try {
    raw = await readFile(customPath, "utf8");
  } catch {
    // Missing file is the normal case — silent.
    return BUILT_IN_PATTERNS;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    onWarn?.(
      `[error-explainer] custom patterns file at ${customPath} is not valid JSON — ignoring it. (${errorSummary(err)})`,
    );
    return BUILT_IN_PATTERNS;
  }

  // The file may be either a raw array of patterns or `{ "patterns": [...] }`.
  const candidates = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as Record<string, unknown>).patterns)
      ? (parsed as Record<string, unknown>).patterns
      : null;

  if (!candidates) {
    onWarn?.(
      `[error-explainer] custom patterns file at ${customPath} has no "patterns" array — ignoring it.`,
    );
    return BUILT_IN_PATTERNS;
  }

  const before = BUILT_IN_PATTERNS.length;
  const merged = mergeCustomPatterns(BUILT_IN_PATTERNS, candidates);
  const added = merged.length - before;
  if (added > 0) {
    onWarn?.(
      `[error-explainer] loaded ${added} custom error pattern(s) from ${customPath}.`,
    );
  }
  return merged;
}

function errorSummary(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
