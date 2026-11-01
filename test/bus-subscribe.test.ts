import { describe, expect, it } from "vitest";

import { shouldSubscribe, subscribeBus } from "../src/bus/subscribe.js";
import type { BusSignal } from "../src/bus/types.js";
import { DEFAULT_OPTIONS } from "../src/config.js";
import { createTrail } from "../src/breadcrumbs/trail.js";
import { createLessonPolicy } from "../src/enrich/lessons.js";
import { createPendingNotes } from "../src/bus/pending.js";
import { createDeduper } from "../src/bus/dedupe.js";

function makeDeps(over: Record<string, unknown> = {}) {
  const trail = createTrail();
  const signals: BusSignal[] = [];
  let eventSink: ((e: unknown) => void) | null = null;
  const promptHooks: unknown[] = [];
  const deps = {
    registerEvents: (onEvent: (e: unknown) => void) => {
      eventSink = onEvent;
    },
    registerPromptHook: (cb: unknown) => {
      promptHooks.push(cb);
    },
    isMainSession: () => Promise.resolve(true),
    patterns: [],
    options: { ...DEFAULT_OPTIONS },
    outputDir: null,
    version: "t",
    worktree: null,
    sdkVersion: null,
    trail,
    lessons: createLessonPolicy(2),
    pending: createPendingNotes(),
    deduper: createDeduper(5000),
    log: () => {},
    ...over,
  };
  const pipeline = (s: BusSignal) => {
    signals.push(s);
    return Promise.resolve();
  };
  return {
    deps,
    trail,
    signals,
    pipeline,
    emit: (e: unknown) => eventSink!(e),
    promptHooks,
  };
}

describe("shouldSubscribe", () => {
  it("subscribes only when enabled and captureEvents are on", () => {
    expect(
      shouldSubscribe({
        ...DEFAULT_OPTIONS,
        enabled: true,
        captureEvents: true,
      }),
    ).toBe(true);
    expect(
      shouldSubscribe({
        ...DEFAULT_OPTIONS,
        enabled: false,
        captureEvents: true,
      }),
    ).toBe(false);
    expect(
      shouldSubscribe({
        ...DEFAULT_OPTIONS,
        enabled: true,
        captureEvents: false,
      }),
    ).toBe(false);
  });
});

describe("subscribeBus", () => {
  it("registers one event handler and one prompt hook", () => {
    const { deps, promptHooks } = makeDeps();
    subscribeBus(deps);
    expect(typeof deps.registerEvents).toBe("function");
    expect(promptHooks).toHaveLength(1);
  });

  it("records shell breadcrumbs into the trail", () => {
    const { deps, trail, emit } = makeDeps();
    subscribeBus(deps);
    emit({
      type: "session.shell.started",
      properties: { sessionID: "s1", command: "npm test" },
    });
    const snap = trail.snapshot("s1", "none", 10);
    expect(snap).toHaveLength(1);
  });

  it("runs the pipeline for shell-failed signals unless duplicate", () => {
    const { deps, signals, pipeline, emit } = makeDeps();
    subscribeBus({ ...deps, pipeline });
    const shellFailed = {
      type: "session.shell.ended",
      properties: {
        sessionID: "s1",
        command: "npm test",
        exitCode: 1,
        output: "Error: boom",
      },
    };

    emit(shellFailed);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.kind).toBe("shell-failed");

    // mark it as a duplicate of a tool error → dropped
    deps.deduper.recordToolError("npm test");
    emit(shellFailed);
    expect(signals).toHaveLength(1);
  });

  it("survives a pipeline rejection (never rethrows into the host)", async () => {
    const { deps, emit } = makeDeps();
    subscribeBus({
      ...deps,
      pipeline: () => Promise.reject(new Error("boom")),
    });
    await expect(
      (async () => {
        emit({
          type: "session.execution.failed",
          properties: { sessionID: "s1", error: { message: "x" } },
        });
        await new Promise((r) => setTimeout(r, 5));
      })(),
    ).resolves.toBeUndefined();
  });

  it("digest-pending events do nothing by themselves (prompt hook builds the digest)", () => {
    const { deps, signals, pipeline, emit } = makeDeps();
    subscribeBus({ ...deps, pipeline });
    expect(() =>
      emit({ type: "session.created", properties: { sessionID: "s1" } }),
    ).not.toThrow();
    expect(signals).toHaveLength(0);
  });

  it("the registered prompt hook delivers pending notes (wiring sanity)", async () => {
    const { deps, promptHooks } = makeDeps();
    deps.pending.enqueue("s1", "bus note");
    subscribeBus(deps);
    const hook = promptHooks[0] as (i: unknown) => Promise<void>;
    const input = { sessionID: "s1", prompt: { text: "hello" } };
    await hook(input);
    expect(input.prompt.text).toContain("bus note");
  });
});
