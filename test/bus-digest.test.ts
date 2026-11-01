import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildDigest } from "../src/bus/digest.js";

let dir: string;

beforeEach(async () => {
  dir = join(
    tmpdir(),
    `digest-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(join(dir, "history"), { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function seed(entries: { name: string; body: unknown }[]) {
  for (const e of entries) {
    await writeFile(
      join(dir, "history", e.name),
      JSON.stringify(e.body),
      "utf8",
    );
  }
}

const entry = (id: string, type: string, timestamp: string) => ({
  id,
  stack: "node",
  type,
  severity: "error",
  suggestion: "s",
  command: "npm test",
  matchedLines: ["x"],
  timestamp,
});

describe("buildDigest", () => {
  it("returns null when there is no history at all", async () => {
    await rm(join(dir, "history"), { recursive: true, force: true });
    expect(await buildDigest(dir)).toBeNull();
  });

  it("returns null for an empty history dir", async () => {
    expect(await buildDigest(dir)).toBeNull();
  });

  it("groups by classification id, sorted by count then recency, capped", async () => {
    await seed([
      {
        name: "a1.json",
        body: entry("id-a", "Missing dependency", "2026-10-01T00:00:00Z"),
      },
      {
        name: "a2.json",
        body: entry("id-a", "Missing dependency", "2026-10-02T00:00:00Z"),
      },
      {
        name: "a3.json",
        body: entry("id-a", "Missing dependency", "2026-10-03T00:00:00Z"),
      },
      {
        name: "b1.json",
        body: entry("id-b", "Port already in use", "2026-10-04T00:00:00Z"),
      },
      {
        name: "c1.json",
        body: entry("id-c", "Type error", "2026-09-01T00:00:00Z"),
      },
      { name: "d1.json", body: entry("id-d", "D1", "2026-10-05T00:00:00Z") },
      { name: "e1.json", body: entry("id-e", "E1", "2026-10-05T00:00:00Z") },
      { name: "f1.json", body: entry("id-f", "F1", "2026-10-05T00:00:00Z") },
      { name: "g1.json", body: entry("id-g", "G1", "2026-10-05T00:00:00Z") },
      { name: "h1.json", body: entry("id-h", "H1", "2026-10-05T00:00:00Z") },
      { name: "i1.json", body: entry("id-i", "I1", "2026-10-05T00:00:00Z") },
    ]);

    const digest = await buildDigest(dir, 8);
    expect(digest).not.toBeNull();
    const lines = (digest as string).split("\n");
    // 8-line cap respected
    expect(lines).toHaveLength(8);
    // most frequent first
    expect(lines[0]).toBe("Missing dependency (3×)");
    // tie between count-1 entries broken by recency: 2026-10-05 ones first
    expect(lines[1]).toMatch(
      /^(Port already in use|D1|E1|F1|G1|H1|I1) \(1×\)$/,
    );
    // oldest single (Type error, 2026-09) dropped by the cap or at the tail
    expect(lines[7]).not.toBe("Type error (1×)");
  });

  it("survives corrupt history entries (skips them silently)", async () => {
    await writeFile(join(dir, "history", "bad.json"), "{not json", "utf8");
    await seed([
      {
        name: "good.json",
        body: entry("id-a", "Missing dependency", "2026-10-01T00:00:00Z"),
      },
    ]);
    const digest = await buildDigest(dir);
    expect(digest).toBe("Missing dependency (1×)");
  });

  it("ignores non-json files", async () => {
    await writeFile(join(dir, "history", "notes.txt"), "hello", "utf8");
    expect(await buildDigest(dir)).toBeNull();
  });
});
