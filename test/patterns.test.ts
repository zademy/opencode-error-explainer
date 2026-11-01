import { describe, expect, it } from "vitest";

import {
  BUILT_IN_PATTERNS,
  mergeCustomPatterns,
} from "../src/classify/patterns.js";
import { classifyError } from "../src/classify/engine.js";

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

  // ── Stateful flag stripping (g/y) ─────────────────────────────────────────
  it("strips g/y flags from RegExp-source patterns to prevent stateful .test()", () => {
    const customs = [
      {
        id: "stateful_regex",
        type: "t",
        suggestion: "s",
        pattern: /SIG/giy,
        stack: "generic",
      },
    ];
    const merged = mergeCustomPatterns(BUILT_IN_PATTERNS, customs);
    const p = merged.find((x) => x.id === "stateful_regex");
    expect(p).toBeDefined();
    expect(p!.pattern.flags).not.toContain("g");
    expect(p!.pattern.flags).not.toContain("y");
    // Repeated .test() must match every time (no lastIndex drift).
    for (let i = 0; i < 5; i++) {
      expect(p!.pattern.test("line with SIG here")).toBe(true);
    }
  });

  it("strips g/y from string-sourced patterns with explicit flags", () => {
    const customs = [
      {
        id: "stateful_str",
        type: "t",
        suggestion: "s",
        pattern: "MY_SIG",
        flags: "gi",
        stack: "generic",
      },
    ];
    const merged = mergeCustomPatterns(BUILT_IN_PATTERNS, customs);
    const p = merged.find((x) => x.id === "stateful_str");
    expect(p!.pattern.flags).toBe("i"); // g stripped, i preserved
  });
});

// ── v0.5 provider / agent-layer families ─────────────────────────────────────

describe("provider and agent-layer pattern families", () => {
  const classify = (output: string) =>
    classifyError(output, "npm test", BUILT_IN_PATTERNS);

  it("matches provider_rate_limited on 429 / rate limit text", () => {
    for (const out of [
      "Error: 429 too many requests",
      "API returned rate limit exceeded, retry after 60s",
    ]) {
      const c = classify(out);
      expect(c?.id).toBe("provider_rate_limited");
      expect(c?.severity).toBe("warning");
      expect(c?.suggestion.toLowerCase()).toContain("retry");
    }
  });

  it("matches provider_auth_failed on unauthorized/forbidden/invalid key", () => {
    for (const out of [
      "401 Unauthorized calling the model endpoint",
      "invalid api key provided",
    ]) {
      const c = classify(out);
      expect(c?.id).toBe("provider_auth_failed");
      expect(c?.severity).toBe("error");
      expect(c?.suggestion.toLowerCase()).toContain("credential");
    }
  });

  it("does NOT trip provider_auth_failed on a bare 403 inside a URL", () => {
    const c = classify("fetch failed: https://api.example.com/403/not-found");
    expect(c?.id).not.toBe("provider_auth_failed");
  });

  it("matches provider_context_overflow", () => {
    const c = classify(
      "Request failed: this model's maximum context length is 8192 tokens",
    );
    expect(c?.id).toBe("provider_context_overflow");
    expect(c?.severity).toBe("error");
  });

  it("matches provider_overloaded on 529 / 503", () => {
    for (const out of [
      "Provider overloaded (529), try again",
      "503 Service Unavailable",
    ]) {
      const c = classify(out);
      expect(c?.id).toBe("provider_overloaded");
      expect(c?.severity).toBe("warning");
    }
  });

  it("matches compaction_failed", () => {
    const c = classify("session compaction failed: could not summarize");
    expect(c?.id).toBe("compaction_failed");
    expect(c?.severity).toBe("error");
  });

  it("matches permission_denied on the mapper's 'permission denied:' format", () => {
    const c = classify("permission denied: bash(write) /etc/hosts");
    expect(c?.id).toBe("permission_denied");
    expect(c?.severity).toBe("warning");
  });

  it("keeps OS 'permission denied' (no colon) on node_eacces, not the new pattern", () => {
    const c = classify("EACCES: permission denied, open '/var/root/x'");
    expect(c?.id).toBe("node_eacces");
  });
});
