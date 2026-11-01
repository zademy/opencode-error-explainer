/**
 * Session-start digest of the worktree's recurring errors (PRD §5).
 *
 * Plan deviation (ledgered): the history ring stores Classifications WITHOUT
 * fingerprints, so the designed index↔history join by fingerprint is
 * impossible. The digest instead aggregates history entries by classification
 * id — the label is the classification's `type`. Counts are therefore
 * per-recent-history-window, which matches the digest's intent (recent
 * recurring errors, capped at 8 lines).
 *
 * All reads are defensive: corrupt entries are skipped, never thrown.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_CAP = 8;

interface HistoryEntry {
  readonly id: string;
  readonly type: string;
  readonly timestamp: string;
}

interface Aggregate {
  count: number;
  lastSeen: string;
  label: string;
}

async function readHistoryEntries(
  dir: string,
): Promise<readonly HistoryEntry[]> {
  const historyDir = join(dir, "history");
  let names: string[];
  try {
    names = await readdir(historyDir);
  } catch {
    return [];
  }
  const entries: HistoryEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(historyDir, name), "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (
        typeof parsed.id === "string" &&
        typeof parsed.type === "string" &&
        typeof parsed.timestamp === "string"
      ) {
        entries.push({
          id: parsed.id,
          type: parsed.type,
          timestamp: parsed.timestamp,
        });
      }
    } catch {
      // corrupt entry — skip silently
    }
  }
  return entries;
}

/**
 * Top recurring classifications (max `cap` lines, default 8), sorted by
 * count desc then recency desc. Line format: `<type> (<n>×)`.
 * Returns null when there is no usable history.
 */
export async function buildDigest(
  dir: string,
  cap: number = DEFAULT_CAP,
): Promise<string | null> {
  const entries = await readHistoryEntries(dir);
  if (entries.length === 0) return null;

  const byId = new Map<string, Aggregate>();
  for (const e of entries) {
    const prev = byId.get(e.id);
    if (prev) {
      prev.count += 1;
      if (e.timestamp > prev.lastSeen) prev.lastSeen = e.timestamp;
    } else {
      byId.set(e.id, { count: 1, lastSeen: e.timestamp, label: e.type });
    }
  }

  const lines = [...byId.values()]
    .sort((a, b) =>
      b.count !== a.count
        ? b.count - a.count
        : a.lastSeen < b.lastSeen
          ? 1
          : -1,
    )
    .slice(0, Math.max(0, cap))
    .map((a) => `${a.label} (${a.count}×)`);

  return lines.length > 0 ? lines.join("\n") : null;
}
