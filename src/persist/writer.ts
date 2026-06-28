/**
 * Write the `last-error.md` + `last-error.json` artifacts.
 *
 * Crash-safe: each file is written to a sibling temp file then renamed, so a
 * reader never sees a half-written artifact. ALL failures are swallowed and
 * reported via the `onError` callback — persistence must NEVER break the user's
 * opencode session.
 */

import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

import type { Classification } from "../classify/types.js";
import { buildMarkdownReport } from "../enrich/explainer.js";
import { cap, toSerializable } from "../util/extract.js";

export interface WriteResult {
  readonly dir: string;
  readonly jsonPath: string;
  readonly mdPath: string;
}

/**
 * Persist a classification to disk.
 *
 * @param dir       Output directory (must already be resolved & absolute).
 * @param c         The classification (with `raw` already redacted by the caller).
 * @param version   Plugin version, stored for diagnostics.
 * @param onError   Invoked with any error instead of throwing.
 * @returns The written paths, or `null` if the write failed.
 */
export async function writeArtifacts(
  dir: string,
  c: Classification,
  version: string,
  onError?: (err: unknown) => void,
): Promise<WriteResult | null> {
  const jsonPath = join(dir, "last-error.json");
  const mdPath = join(dir, "last-error.md");

  const serializable = {
    ...toSerializable(c, version),
    rawOutputExcerpt: cap(c.raw),
  };

  const json = `${JSON.stringify(serializable, null, 2)}\n`;
  const md = buildMarkdownReport({ ...c, raw: cap(c.raw) });

  try {
    await mkdir(dir, { recursive: true });
    await safeWrite(jsonPath, json);
    await safeWrite(mdPath, md);
    return { dir, jsonPath, mdPath };
  } catch (err) {
    onError?.(err);
    return null;
  }
}

/**
 * Atomic-ish write: stage to `<path>.<rand>.tmp` then rename over the target.
 * Keeps readers from observing a truncated file if the process is interrupted.
 */
async function safeWrite(target: string, contents: string): Promise<void> {
  const tmp = join(
    dirname(target),
    `.${basename(target)}.${randomBytes(6).toString("hex")}.tmp`,
  );
  await writeFile(tmp, contents, "utf8");
  await rename(tmp, target);
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] ?? p;
}
