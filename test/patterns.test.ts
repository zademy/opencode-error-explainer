import { describe, expect, it } from "vitest";

import {
  BUILT_IN_PATTERNS,
  mergeCustomPatterns,
} from "../src/classify/patterns.js";

describe("BUILT_IN_PATTERNS integrity", () => {
  it("every pattern has a unique id", () => {
    const ids = BUILT_IN_PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every pattern has a non-empty type and suggestion", () => {
    for (const p of BUILT_IN_PATTERNS) {
      expect(p.type.length).toBeGreaterThan(0);
      expect(p.suggestion.length).toBeGreaterThan(0);
    }
  });

  it("every pattern regex is a RegExp instance", () => {
    for (const p of BUILT_IN_PATTERNS) {
      expect(p.pattern).toBeInstanceOf(RegExp);
    }
  });
});

describe("mergeCustomPatterns", () => {
  it("returns built-ins unchanged when customs is not an array", () => {
    expect(mergeCustomPatterns(BUILT_IN_PATTERNS, null)).toBe(
      BUILT_IN_PATTERNS,
    );
    expect(mergeCustomPatterns(BUILT_IN_PATTERNS, undefined)).toBe(
      BUILT_IN_PATTERNS,
    );
    expect(mergeCustomPatterns(BUILT_IN_PATTERNS, {})).toBe(BUILT_IN_PATTERNS);
    expect(mergeCustomPatterns(BUILT_IN_PATTERNS, [])).toBe(BUILT_IN_PATTERNS);
  });

  it("overrides a built-in by id and appends new ones", () => {
    const customs = [
      {
        id: "node_eaddrinuse",
        stack: "network",
        type: "Overridden port error",
        severity: "critical",
        pattern: "EADDRINUSE",
        suggestion: "OVERRIDDEN SUGGESTION",
      },
      {
        id: "my_custom_error",
        stack: "generic",
        type: "My custom error",
        severity: "warning",
        pattern: "MY_CUSTOM_SIG",
        suggestion: "Do the thing",
      },
    ];
    const merged = mergeCustomPatterns(BUILT_IN_PATTERNS, customs);
    const overridden = merged.find((p) => p.id === "node_eaddrinuse");
    const custom = merged.find((p) => p.id === "my_custom_error");
    expect(overridden?.suggestion).toBe("OVERRIDDEN SUGGESTION");
    expect(overridden?.severity).toBe("critical");
    expect(custom).toBeDefined();
    expect(merged.length).toBe(BUILT_IN_PATTERNS.length + 1);
  });

  it("drops malformed entries silently", () => {
    const customs = [
      { id: "", type: "x", suggestion: "y", pattern: "z" }, // missing id
      { id: "good", type: "x", suggestion: "y", pattern: "z" },
      { id: "bad_regex", type: "x", suggestion: "y", pattern: "(" }, // bad regex
      "not-an-object",
      { id: "no_pattern", type: "x", suggestion: "y" }, // no pattern
    ];
    const merged = mergeCustomPatterns(BUILT_IN_PATTERNS, customs);
    expect(merged.find((p) => p.id === "good")).toBeDefined();
    expect(merged.find((p) => p.id === "bad_regex")).toBeUndefined();
    expect(merged.find((p) => p.id === "no_pattern")).toBeUndefined();
  });

  it("accepts regex objects and string patterns with custom flags", () => {
    const customs = [
      {
        id: "regex_obj",
        type: "t",
        suggestion: "s",
        pattern: /FOO/g,
        stack: "generic",
      },
      {
        id: "string_pat",
        type: "t",
        suggestion: "s",
        pattern: "bar baz",
        flags: "i",
        stack: "generic",
      },
    ];
    const merged = mergeCustomPatterns(BUILT_IN_PATTERNS, customs);
    expect(merged.find((p) => p.id === "regex_obj")).toBeDefined();
    expect(merged.find((p) => p.id === "string_pat")?.pattern.flags).toBe("i");
  });
});
