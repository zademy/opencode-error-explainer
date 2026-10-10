import { describe, expect, it } from "vitest";

import {
  argsOf,
  commandOf,
  resultText,
  withAppended,
} from "../src/util/tool-event.js";
import { createTrail, type ToolCallEntry } from "../src/breadcrumbs/trail.js";

describe("v2 tool event adapter", () => {
  it("narrows untyped input defensively", () => {
    expect(argsOf(null)).toEqual({});
    expect(argsOf("oops")).toEqual({});
    expect(argsOf({ command: "ls" })).toEqual({ command: "ls" });
  });

  it("reads the command out of a tool input", () => {
    expect(commandOf({ command: "npm test" })).toBe("npm test");
    expect(commandOf({ command: 42 })).toBe("");
    expect(commandOf({})).toBe("");
  });

  it("reads result text from whichever slot the tool used", () => {
    expect(resultText({ output: "boom" })).toBe("boom");
    expect(resultText({ content: "boom" })).toBe("boom");
    expect(resultText({ output: "a", content: "b" })).toBe("a");
    expect(
      resultText({
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ],
      }),
    ).toBe("a\nb");
    expect(resultText({ output: { exitCode: 1 } })).toBe('{"exitCode":1}');
    expect(resultText({})).toBe("");
  });

  it("survives a circular output value", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(resultText({ output: circular })).toBe("");
  });

  it("appends to the slot the result already uses", () => {
    expect(withAppended({ output: "out" }, "+x")).toEqual({ output: "out+x" });
    expect(withAppended({ content: "c" }, "+x")).toEqual({ content: "c+x" });
    expect(withAppended({ output: "o", content: "c" }, "+x")).toEqual({
      output: "o+x",
      content: "c",
    });
  });

  it("keeps structured content structured when appending", () => {
    const out = withAppended({ content: [{ type: "text", text: "a" }] }, "+x");
    expect(out.content).toEqual([{ type: "text", text: "a+x" }]);

    const noText = withAppended(
      { content: [{ type: "file", text: undefined }] },
      "+x",
    );
    expect(noText.content).toHaveLength(2);
    const parts = noText.content as readonly { type: string; text?: string }[];
    expect(parts[1]).toEqual({
      type: "text",
      text: "+x",
    });
  });

  it("never mutates the result it was given", () => {
    const original = { output: "out" };
    withAppended(original, "+x");
    expect(original.output).toBe("out");
  });

  it("falls back to content when a result carries no text", () => {
    expect(withAppended({}, "+x")).toEqual({ content: "+x" });
  });
});

function entry(over: Partial<ToolCallEntry> = {}): ToolCallEntry {
  return {
    callID: "c1",
    sessionID: "s1",
    tool: "bash",
    command: "ls",
    status: "completed",
    timestamp: "2026-01-01T00:00:00.000Z",
    message: "ls",
    ...over,
  };
}

describe("breadcrumb trail", () => {
  it("returns recent calls oldest-first, excluding the current one", () => {
    const trail = createTrail();
    trail.record(entry({ callID: "a" }));
    trail.record(entry({ callID: "b" }));
    const crumbs = trail.snapshot("s1", "b", 10);
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0]?.data.tool).toBe("bash");
    expect(crumbs[0]?.category).toBe("tool");
  });

  it("updates a call in place instead of duplicating it", () => {
    const trail = createTrail();
    trail.record(entry({ callID: "a", status: "running" }));
    trail.record(entry({ callID: "a", status: "error", message: "boom" }));
    const crumbs = trail.snapshot("s1", undefined, 10);
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0]?.level).toBe("error");
    expect(crumbs[0]?.message).toBe("boom");
  });

  it("maps status to level", () => {
    const trail = createTrail();
    trail.record(entry({ callID: "r", status: "running" }));
    trail.record(entry({ callID: "c", status: "completed" }));
    const crumbs = trail.snapshot("s1", undefined, 10);
    expect(crumbs.find((b) => b.data.status === "running")?.level).toBe(
      "warning",
    );
    expect(crumbs.find((b) => b.data.status === "completed")?.level).toBe(
      "info",
    );
  });

  it("keeps sessions isolated", () => {
    const trail = createTrail();
    trail.record(entry({ callID: "a", sessionID: "s1" }));
    trail.record(entry({ callID: "b", sessionID: "s2" }));
    expect(trail.snapshot("s1", undefined, 10)).toHaveLength(1);
    expect(trail.snapshot("s2", undefined, 10)[0]?.data.status).toBe(
      "completed",
    );
    expect(trail.snapshot("s3", undefined, 10)).toHaveLength(0);
  });

  it("respects the limit and evicts the oldest entries", () => {
    const trail = createTrail();
    for (let i = 0; i < 60; i++) {
      trail.record(entry({ callID: `c${i}`, message: `m${i}` }));
    }
    const all = trail.snapshot("s1", undefined, 100);
    expect(all).toHaveLength(50);
    expect(all[0]?.message).toBe("m10");
    expect(trail.snapshot("s1", undefined, 2).map((b) => b.message)).toEqual([
      "m58",
      "m59",
    ]);
  });

  it("returns nothing when the limit is zero", () => {
    const trail = createTrail();
    trail.record(entry());
    expect(trail.snapshot("s1", undefined, 0)).toEqual([]);
  });
});
