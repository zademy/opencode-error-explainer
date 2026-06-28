import { describe, expect, it } from "vitest";

import { fingerprintOf, normalizeSignature } from "../src/event/fingerprint.js";
import type { Classification } from "../src/classify/types.js";

function sample(overrides: Partial<Classification> = {}): Classification {
  return {
    id: "node_missing_module",
    stack: "node",
    type: "Missing dependency",
    severity: "error",
    suggestion: "A required module is not installed.",
    nextSteps: [],
    command: "node server.js",
    matchedLines: ["Error: Cannot find module 'express'"],
    raw: "Error: Cannot find module 'express'",
    timestamp: "",
    ...overrides,
  };
}

describe("normalizeSignature", () => {
  it("strips paths, numbers, and quoted values", () => {
    expect(normalizeSignature("Error at /a/b/c/app.ts:12 'express'")).toBe(
      "error at app.ts:n '…'",
    );
  });
  it("collapses hashes and hex", () => {
    expect(normalizeSignature("commit deadbeefcafebabe12345678")).toBe(
      "commit h",
    );
  });
  it("ignores timestamps", () => {
    expect(normalizeSignature("2024-01-01T10:00:00 boom")).toContain("boom");
  });
});

describe("fingerprintOf", () => {
  it("is deterministic for the same logical error", () => {
    const a = fingerprintOf(sample());
    const b = fingerprintOf(sample());
    expect(a).toBe(b);
    expect(a).toHaveLength(40); // sha1 hex
  });
  it("changes when the classification id differs", () => {
    expect(fingerprintOf(sample())).not.toBe(
      fingerprintOf(sample({ id: "node_eaddrinuse" })),
    );
  });
  it("stays stable across line numbers / paths / values", () => {
    const a = fingerprintOf(
      sample({ matchedLines: ["/x/y/app.ts:12 Cannot find module 'express'"] }),
    );
    const b = fingerprintOf(
      sample({
        matchedLines: ["/other/app.ts:99 Cannot find module 'lodash'"],
      }),
    );
    expect(a).toBe(b);
  });
});
