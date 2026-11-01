import { describe, expect, it } from "vitest";

import { createLessonPolicy } from "../src/enrich/lessons.js";

describe("createLessonPolicy — counting", () => {
  it("counts occurrences per (session, fingerprint) and isolates sessions", () => {
    const p = createLessonPolicy(2);
    expect(p.count("s1", "fp-a")).toBe(1);
    expect(p.count("s1", "fp-a")).toBe(2);
    expect(p.count("s2", "fp-a")).toBe(1);
    expect(p.count("s1", "fp-b")).toBe(1);
  });
});

describe("createLessonPolicy — lessonLine", () => {
  it("returns null below the threshold", () => {
    const p = createLessonPolicy(2);
    expect(
      p.lessonLine({
        count: 1,
        type: "Missing dependency",
        command: "npm test",
        resolution: null,
      }),
    ).toBeNull();
  });

  it("produces a lesson line with ordinal at/above the threshold", () => {
    const p = createLessonPolicy(2);
    expect(
      p.lessonLine({
        count: 2,
        type: "Missing dependency",
        command: "npm test",
        resolution: "re-running npm install succeeded",
      }),
    ).toBe(
      "[Error Explainer] 2nd Missing dependency in this session; last resolved by: re-running npm install succeeded",
    );
    expect(
      p.lessonLine({
        count: 3,
        type: "Missing dependency",
        command: "npm test",
        resolution: null,
      }),
    ).toBe(
      "[Error Explainer] 3rd Missing dependency in this session; no known resolution yet",
    );
    expect(
      p.lessonLine({ count: 11, type: "X", command: "c", resolution: null }),
    ).toBe("[Error Explainer] 11th X in this session; no known resolution yet");
  });

  it("threshold 1 yields lessons from the first occurrence at POLICY level (the option treats 1 as off, wired in index.ts)", () => {
    const p = createLessonPolicy(1);
    expect(
      p.lessonLine({ count: 1, type: "X", command: "c", resolution: null }),
    ).toMatch(/^\[Error Explainer\] 1st X in this session/);
  });
});

describe("createLessonPolicy — resolutions", () => {
  it("markSuccess feeds resolutionFor for the same command and session", () => {
    const p = createLessonPolicy(2);
    p.markSuccess("s1", "npm test");
    expect(p.resolutionFor("s1", "npm test")).toBe(
      "re-running npm test succeeded",
    );
    expect(p.resolutionFor("s2", "npm test")).toBeNull();
    expect(p.resolutionFor("s1", "npm run build")).toBeNull();
  });
});
