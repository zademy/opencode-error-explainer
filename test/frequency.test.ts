import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readIndex, recordFrequency } from "../src/persist/frequency.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ee-freq-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("frequency index", () => {
  it("records first occurrence and increments on repeats", async () => {
    const fp = "abc123";
    const f1 = await recordFrequency(dir, fp, "2024-01-01T00:00:00.000Z");
    expect(f1.times_seen).toBe(1);
    expect(f1.first_seen).toBe("2024-01-01T00:00:00.000Z");

    const f2 = await recordFrequency(dir, fp, "2024-01-02T00:00:00.000Z");
    expect(f2.times_seen).toBe(2);
    expect(f2.first_seen).toBe("2024-01-01T00:00:00.000Z");
    expect(f2.last_seen).toBe("2024-01-02T00:00:00.000Z");
  });

  it("persists to index.json and reads back", async () => {
    await recordFrequency(dir, "fp1", "2024-01-01T00:00:00.000Z");
    const index = await readIndex(dir);
    expect(index.fp1).toBeDefined();
    expect(index.fp1!.times_seen).toBe(1);
  });

  it("returns an empty index when the file is missing or corrupt", async () => {
    expect(await readIndex(dir)).toEqual({});
    // corrupt file
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, "index.json"), "{ not json", "utf8");
    expect(await readIndex(dir)).toEqual({});
  });

  it("does not throw on a write failure", async () => {
    // A regular file used as a directory: mkdir fails with ENOTDIR on every
    // OS. The old /dev/null/cant trick silently SUCCEEDED on Windows, so the
    // expected error never fired there.
    const blocker = join(dir, "blocker");
    await writeFile(blocker, "not a directory", "utf8");
    let err: unknown = null;
    const res = await recordFrequency(
      join(blocker, "cant"),
      "fp",
      "t",
      (e) => (err = e),
    );
    expect(res.times_seen).toBe(1);
    // An error was reported, but the function still returned.
    expect(err).not.toBeNull();
  });
});
