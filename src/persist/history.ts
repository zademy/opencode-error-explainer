/**
 * Rotating history of recent errors.
 *
 * Each error is stored as `history/<ts>-<id>.json` under the output directory.
 * After every write, the directory is pruned to the newest `limit` entries so
 * the footprint stays bounded. Set `limit` to 0 to disable history entirely.
 */

import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Classification } from "../classify/types.js";
import { toSerializable } from "../util/extract.js";

export interface HistoryOptions {
  /** How many entries to keep. 0 disables history. */
  readonly limit: number;
  /** Called for non-fatal errors instead of throwing. */
  readonly onError?: (err: unknown) => void;
}

/**
 * Append a classification to the history ring buffer and prune old entries.
 * No-ops (returns false) when `limit <= 0` or persistence is unavailable.
 */
export async function appendHistory(
  dir: string,
  c: Classification,
  opts: HistoryOptions,
): Promise<boolean> {
  if (opts.limit <= 0) return false;

  const historyDir = join(dir, "history");
  const stamp = sanitizeTimestamp(c.timestamp);
  const safeId = sanitizeFilename(c.id);
  const filename = `${stamp}-${safeId}.json`;
  const target = join(historyDir, filename);

  try {
    await mkdir(historyDir, { recursive: true });
    await writeFile(
      target,
      `${JSON.stringify(toSerializable(c, "history"), null, 2)}\n`,
      "utf8",
    );
    await prune(historyDir, opts.limit, opts.onError);
    return true;
  } catch (err) {
    opts.onError?.(err);
    return false;
  }
}

/** Keep only the newest `limit` `.json` files by mtime. */
async function prune(
  historyDir: string,
  limit: number,
  onError?: (e: unknown) => void,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(historyDir);
  } catch {
    return;
  }
  const jsonEntries = entries.filter((e) => e.endsWith(".json"));
  if (jsonEntries.length <= limit) return;

  const stamped = await Promise.all(
    jsonEntries.map(async (name) => {
      try {
        const s = await stat(join(historyDir, name));
        return { name, mtime: s.mtimeMs };
      } catch {
        return { name, mtime: 0 };
      }
    }),
  );
  stamped.sort((a, b) => b.mtime - a.mtime);

  const toRemove = stamped.slice(limit);
  await Promise.all(
    toRemove.map(async (entry) => {
      try {
        await unlink(join(historyDir, entry.name));
      } catch (err) {
        onError?.(err);
      }
    }),
  );
}

function sanitizeTimestamp(ts: string): string {
  if (!ts) return `unknown-${Date.now()}`;
  return (
    ts.replace(/[^0-9T:Z.+-]/g, "_").slice(0, 32) || `unknown-${Date.now()}`
  );
}

function sanitizeFilename(id: string): string {
  return id.replace(/[^a-z0-9-_]/gi, "_").slice(0, 48) || "error";
}
