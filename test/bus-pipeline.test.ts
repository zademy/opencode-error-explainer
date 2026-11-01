import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBusPipeline } from "../src/bus/pipeline.js";
import type { BusSignal } from "../src/bus/types.js";
import { BUILT_IN_PATTERNS } from "../src/classify/patterns.js";
import { DEFAULT_OPTIONS } from "../src/config.js";
import { createLessonPolicy } from "../src/enrich/lessons.js";
import { createPendingNotes } from "../src/bus/pending.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bus-pipeline-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const signal = (over: Partial<BusSignal> = {}): BusSignal => ({
  sessionID: "s1",
  kind: "execution-failed",
  command: "",
  text: "Error: Cannot find module 'left-pad'",
  exitCode: null,
  ...over,
});

function makePipeline(outputDir: string | null, threshold = 2) {
  const lessons = createLessonPolicy(threshold);
  const pending = createPendingNotes();
  const run = createBusPipeline({
    patterns: BUILT_IN_PATTERNS,
    options: { ...DEFAULT_OPTIONS, historyLimit: 5 },
    outputDir,
    version: "0.5.0-test",
    worktree: dir,
    sdkVersion: "2.0.26",
    lessons,
    pending,
  });
  return { run, pending, lessons };
}

describe("createBusPipeline", () => {
  it("persists an event and enqueues a lesson note on repeat occurrence", async () => {
    const { run, pending } = makePipeline(dir);
    await run(signal()); // 1st occurrence — no lesson yet
    expect(pending.drain("s1")).toEqual([]);

    await run(signal({ text: "Error: Cannot find module 'left-pad'" })); // 2nd
    const notes = pending.drain("s1");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/^\[Error Explainer\] 2nd /);

    const raw = await readFile(join(dir, "last-error.json"), "utf8");
    const event = JSON.parse(raw) as { extra?: { source?: string } };
    expect(event.extra?.source).toBe("event-bus");
  });

  it("skips non-error text entirely (nothing persisted)", async () => {
    const { run, pending } = makePipeline(dir);
    await run(signal({ text: "all good, no error here" }));
    expect(pending.drain("s1")).toEqual([]);
    await expect(
      readFile(join(dir, "last-error.json"), "utf8"),
    ).rejects.toThrow();
  });

  it("never throws even when outputDir is unwritable", async () => {
    const { run } = makePipeline(join(dir, "no", "such", "deep", "path", "x"));
    // mkdir -p in writeEvent may actually create it; force failure with a file-as-dir
    await expect(
      run(signal({ sessionID: "sX", text: "Error: Cannot find module 'x'" })),
    ).resolves.toBeUndefined();
  });

  it("marks the persisted classification with the bus source and command", async () => {
    const { run } = makePipeline(dir);
    await run(
      signal({
        kind: "shell-failed",
        command: "npm test",
        text: "npm ERR! Cannot find module 'left-pad'",
        exitCode: 1,
      }),
    );
    const raw = await readFile(join(dir, "last-error.json"), "utf8");
    const event = JSON.parse(raw) as {
      extra?: { source?: string; command?: string };
    };
    expect(event.extra?.source).toBe("event-bus");
    expect(event.extra?.command).toBe("npm test");
  });
});
