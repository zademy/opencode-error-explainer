import { describe, expect, it } from "vitest";

import { createDeduper } from "../src/bus/dedupe.js";

describe("createDeduper", () => {
  it("flags a bus signal repeating a tool error inside the window", () => {
    const d = createDeduper(5000);
    d.recordToolError("npm test");
    expect(d.isDuplicate("npm test")).toBe(true);
  });

  it("does not flag after the window expires", async () => {
    const d = createDeduper(20);
    d.recordToolError("npm test");
    await new Promise((r) => setTimeout(r, 30));
    expect(d.isDuplicate("npm test")).toBe(false);
  });

  it("different commands never collide", () => {
    const d = createDeduper(5000);
    d.recordToolError("npm test");
    expect(d.isDuplicate("npm run build")).toBe(false);
  });

  it("empty command is never deduped", () => {
    const d = createDeduper(5000);
    d.recordToolError("");
    expect(d.isDuplicate("")).toBe(false);
  });

  it("records expire lazily and do not grow unbounded", async () => {
    const d = createDeduper(10);
    for (let i = 0; i < 100; i++) d.recordToolError(`cmd-${i}`);
    await new Promise((r) => setTimeout(r, 20));
    // touching one command prunes all expired entries
    expect(d.isDuplicate("cmd-1")).toBe(false);
  });
});
