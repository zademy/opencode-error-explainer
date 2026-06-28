/**
 * Source-context enrichment for stack frames.
 *
 * For each in-app frame, read `±contextLines` around `lineno` from the file on
 * disk and attach it as `context`. External frames (`node_modules`, stdlib) are
 * skipped (Sentry convention). Binary/minified files are skipped; reads are
 * size-capped so a huge/minified file never floods the artifact.
 *
 * Side effects are limited to `fs` reads; every failure yields a frame with
 * `context: null` so the event still builds.
 */

import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve as resolvePath } from "node:path";

import type { Frame } from "../event/types.js";

const MAX_FILE_BYTES = 256 * 1024; // skip files larger than 256KB (likely minified/generated)

/**
 * Resolve a frame filename against the worktree, defensively.
 *
 * Security: every resolved path is CONFINED to the worktree. Absolute paths
 * and `../` traversals that would escape the worktree root are rejected
 * (return null) so a crafted stack frame can never read arbitrary files
 * (e.g. `/etc/passwd`, `~/.ssh/id_rsa`).
 */
function resolve(worktree: string | null, filename: string): string | null {
  if (!filename || filename.startsWith("node:") || filename === "(unknown)")
    return null;
  if (!worktree) return null;
  const resolved = isAbsolute(filename)
    ? filename
    : resolvePath(worktree, filename);
  // Confinement: reject anything that resolves outside the worktree.
  const rel = relative(worktree, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return resolved;
}

function looksBinary(buf: Uint8Array): boolean {
  // Heuristic: a NUL byte in the first 8KB → binary.
  const slice = buf.subarray(0, Math.min(buf.length, 8192));
  for (let i = 0; i < slice.length; i++) {
    if (slice[i] === 0) return true;
  }
  return false;
}

/** Read ±N lines around `lineno` from a file. Returns null when unreadable. */
async function readContext(
  filePath: string,
  lineno: number | null,
  contextLines: number,
): Promise<ReadonlyArray<{ line: number; source: string }> | null> {
  if (lineno == null || lineno <= 0) return null;
  let buf: Buffer;
  try {
    buf = await readFile(filePath);
  } catch {
    return null;
  }
  if (buf.byteLength > MAX_FILE_BYTES) return null;
  if (looksBinary(buf)) return null;

  const text = buf.toString("utf8");
  const lines = text.split("\n");
  const start = Math.max(0, lineno - 1 - contextLines);
  const end = Math.min(lines.length, lineno + contextLines);
  const out: { line: number; source: string }[] = [];
  for (let i = start; i < end; i++) {
    const src = lines[i];
    if (src === undefined) continue;
    out.push({ line: i + 1, source: src });
  }
  return out.length > 0 ? out : null;
}

/**
 * Enrich frames with source context, in place. Returns the same array (frames
 * with `context` populated where readable). External frames keep `context: null`.
 */
export async function enrichFrames(
  frames: readonly Frame[],
  worktree: string | null,
  contextLines: number,
): Promise<Frame[]> {
  const result: Frame[] = [];
  for (const frame of frames) {
    if (!frame.in_app || frame.lineno == null) {
      result.push(frame);
      continue;
    }
    const filePath = resolve(worktree, frame.filename);
    const context = filePath
      ? await readContext(filePath, frame.lineno, contextLines)
      : null;
    result.push(context ? { ...frame, context } : frame);
  }
  return result;
}
