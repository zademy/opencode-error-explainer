/**
 * Per-fingerprint frequency index.
 *
 * Maintains `index.json` mapping `fingerprint → { first_seen, last_seen,
 * times_seen }` so the same logical error accumulates a count across the
 * session/history (Sentry's "frequency"). All failures are swallowed — index
 * maintenance must never break the session.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

import type { Frequency } from "../event/types.js";

const INDEX_FILE = "index.json";
const MAX_ENTRIES = 500; // bound the index; drop oldest `last_seen` beyond this

export interface FrequencyIndex {
  [fingerprint: string]: Frequency;
}

/** Read the index (empty when missing/corrupt). */
export async function readIndex(dir: string): Promise<FrequencyIndex> {
  try {
    const raw = await readFile(join(dir, INDEX_FILE), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isIndex(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isIndex(value: unknown): value is FrequencyIndex {
  if (!value || typeof value !== "object") return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.every(
    ([, v]) =>
      v &&
      typeof v === "object" &&
      typeof (v as Frequency).times_seen === "number" &&
      typeof (v as Frequency).first_seen === "string" &&
      typeof (v as Frequency).last_seen === "string",
  );
}

/**
 * Record an occurrence of `fingerprint` at `timestamp` and persist the updated
 * index. Returns the updated {@link Frequency} for that fingerprint.
 */
export async function recordFrequency(
  dir: string,
  fingerprint: string,
  timestamp: string,
  onError?: (err: unknown) => void,
): Promise<Frequency> {
  const index = await readIndex(dir);
  const prev = index[fingerprint];
  const updated: Frequency = prev
    ? {
        first_seen: prev.first_seen,
        last_seen: timestamp,
        times_seen: prev.times_seen + 1,
      }
    : { first_seen: timestamp, last_seen: timestamp, times_seen: 1 };
  index[fingerprint] = updated;

  prune(index);

  try {
    await mkdir(dir, { recursive: true });
    await safeWrite(
      join(dir, INDEX_FILE),
      `${JSON.stringify(index, null, 2)}\n`,
    );
  } catch (err) {
    onError?.(err);
  }
  return updated;
}

/** Drop the oldest entries beyond {@link MAX_ENTRIES}. */
function prune(index: FrequencyIndex): void {
  const keys = Object.keys(index);
  if (keys.length <= MAX_ENTRIES) return;
  keys
    .map((k) => ({ k, last: index[k]?.last_seen ?? "" }))
    .sort((a, b) => (a.last < b.last ? -1 : 1))
    .slice(0, keys.length - MAX_ENTRIES)
    .forEach(({ k }) => {
      delete index[k];
    });
}

async function safeWrite(target: string, contents: string): Promise<void> {
  const tmp = join(
    dirname(target),
    `.index.${randomBytes(6).toString("hex")}.tmp`,
  );
  await writeFile(tmp, contents, "utf8");
  await rename(tmp, target);
}
