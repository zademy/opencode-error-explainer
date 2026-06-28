/**
 * Write the `last-error.md` + `last-error.json` artifacts.
 *
 * The JSON is the full Sentry-grade event; the Markdown is the sectioned report
 * rendered by {@link buildEventMarkdown}. Both are written crash-safe (temp +
 * rename). ALL failures are swallowed and reported via `onError` — persistence
 * must NEVER break the user's opencode session.
 */

import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

import { buildEventMarkdown } from "../event/render.js";
import type { SentryGradeEvent } from "../event/types.js";

export interface WriteResult {
  readonly dir: string;
  readonly jsonPath: string;
  readonly mdPath: string;
}

/**
 * Persist an assembled event to disk.
 *
 * @param dir     Output directory (resolved & absolute).
 * @param event   The Sentry-grade event (raw output already redacted by caller).
 * @param onError Invoked with any error instead of throwing.
 * @returns The written paths, or `null` if the write failed.
 */
export async function writeEvent(
  dir: string,
  event: SentryGradeEvent,
  onError?: (err: unknown) => void,
): Promise<WriteResult | null> {
  const jsonPath = join(dir, "last-error.json");
  const mdPath = join(dir, "last-error.md");
  const json = `${JSON.stringify(event, null, 2)}\n`;
  const md = buildEventMarkdown(event);

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
 * Atomic-ish write: stage to `<path>.<rand>.tmp` then rename over the target,
 * so readers never observe a truncated file if the process is interrupted.
 */
export async function safeWrite(
  target: string,
  contents: string,
): Promise<void> {
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
