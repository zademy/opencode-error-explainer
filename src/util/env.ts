/**
 * Filesystem/path helpers.
 *
 * All persistence is rooted under the worktree so paths stay stable regardless
 * of the session's cwd. The user can override the directory via `outputDir`.
 */

import { isAbsolute, join, normalize, resolve, sep } from "node:path";

import type { PluginOptions } from "../config.js";

/**
 * Resolve the directory where artifacts are written.
 *
 * Priority:
 *   1. `options.outputDir` (string), resolved relative to the worktree if not
 *      absolute.
 *   2. `<worktree>/.opencode/error-explainer`.
 *
 * Returns `null` when neither `worktree` nor an absolute override is available
 * — the caller then disables persistence rather than guessing a path.
 */
export function resolveOutputDir(
  worktree: string | null | undefined,
  options: PluginOptions,
): string | null {
  if (options.outputDir && options.outputDir.trim()) {
    return options.outputDir.startsWith("/") ||
      /^[A-Za-z]:[\\/]/.test(options.outputDir)
      ? normalize(options.outputDir)
      : safeJoin(worktree, options.outputDir);
  }
  if (!worktree) return null;
  return join(worktree, ".opencode", "error-explainer");
}

/**
 * Resolve the custom-patterns file path relative to the worktree.
 * Returns `null` when disabled or the worktree is unavailable.
 */
export function resolveCustomPatternsPath(
  worktree: string | null | undefined,
  options: PluginOptions,
): string | null {
  if (!options.customPatternsPath || !worktree) return null;
  return options.customPatternsPath.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(options.customPatternsPath)
    ? options.customPatternsPath
    : join(worktree, options.customPatternsPath);
}

/**
 * Join a base directory with a relative path, guarding against path traversal.
 * If the relative segment escapes the base (after normalization), the base
 * alone is returned.
 */
export function safeJoin(base: string | null | undefined, rel: string): string {
  if (!base) {
    // No base: only allow an already-absolute path.
    return isAbsolute(rel) ? normalize(rel) : normalize(rel);
  }
  const combined = resolve(join(base, rel));
  const normalizedBase = resolve(base);
  if (
    combined === normalizedBase ||
    combined.startsWith(`${normalizedBase}${sep}`)
  ) {
    return combined;
  }
  return normalizedBase;
}
