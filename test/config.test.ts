import { describe, expect, it } from "vitest";

import { DEFAULT_OPTIONS, resolveOptions } from "../src/config.js";

describe("resolveOptions — v0.5 event-bus options", () => {
  it("defaults captureEvents/lessonThreshold/sessionMemory when raw is empty", () => {
    const o = resolveOptions({});
    expect(o.captureEvents).toBe(true);
    expect(o.lessonThreshold).toBe(2);
    expect(o.sessionMemory).toBe(true);
  });

  it("defaults when raw is null (non-object falls back entirely)", () => {
    const o = resolveOptions(null);
    expect(o.captureEvents).toBe(DEFAULT_OPTIONS.captureEvents);
    expect(o.lessonThreshold).toBe(DEFAULT_OPTIONS.lessonThreshold);
    expect(o.sessionMemory).toBe(DEFAULT_OPTIONS.sessionMemory);
  });

  it("accepts explicit values", () => {
    const o = resolveOptions({
      captureEvents: false,
      lessonThreshold: 3,
      sessionMemory: false,
    });
    expect(o.captureEvents).toBe(false);
    expect(o.lessonThreshold).toBe(3);
    expect(o.sessionMemory).toBe(false);
  });

  it("falls back to 2 when lessonThreshold is 0 (0 would mean never-configurable)", () => {
    const o = resolveOptions({ lessonThreshold: 0 });
    expect(o.lessonThreshold).toBe(2);
  });

  it("falls back silently on invalid types", () => {
    const o = resolveOptions({
      captureEvents: "yes",
      lessonThreshold: "many",
      sessionMemory: 1,
    });
    expect(o.captureEvents).toBe(true);
    expect(o.lessonThreshold).toBe(2);
    expect(o.sessionMemory).toBe(true);
  });
});
