import { describe, expect, it } from "vitest";

import type { Classification } from "../src/classify/types.js";
import {
  buildExplanation,
  buildMarkdownReport,
} from "../src/enrich/explainer.js";

function sample(overrides: Partial<Classification> = {}): Classification {
  return {
    id: "node_missing_module",
    stack: "node",
    type: "Missing dependency",
    severity: "error",
    suggestion: "A required module is not installed.",
    nextSteps: ["Run `npm install <name>`.", "Check the import path."],
    command: "node server.js",
    matchedLines: ["Error: Cannot find module 'express'"],
    file: "express",
    line: undefined,
    raw: "Error: Cannot find module 'express'",
    timestamp: "",
    ...overrides,
  };
}

describe("buildExplanation", () => {
  it("concise format has type, cause, no next-steps", () => {
    const out = buildExplanation(sample(), "concise");
    expect(out).toContain("Missing dependency");
    expect(out).toContain("A required module is not installed.");
    expect(out).toContain("express");
    expect(out).not.toContain("Next steps");
  });

  it("detailed format includes numbered next steps and matched lines", () => {
    const out = buildExplanation(sample(), "detailed");
    expect(out).toContain("Next steps:");
    expect(out).toMatch(/1\. Run `npm install <name>`\./);
    expect(out).toMatch(/2\. Check the import path\./);
    expect(out).toContain("Relevant output lines:");
    expect(out).toContain("Cannot find module 'express'");
  });

  it("includes location when present", () => {
    const out = buildExplanation(
      sample({ file: "src/app.ts", line: 42 }),
      "concise",
    );
    expect(out).toContain("src/app.ts:42");
  });

  it("omits location line when neither file nor line is present", () => {
    const out = buildExplanation(
      sample({ file: undefined, line: undefined }),
      "concise",
    );
    expect(out).not.toContain("Probable location");
  });
});

describe("buildMarkdownReport", () => {
  it("produces a standalone markdown document", () => {
    const md = buildMarkdownReport(
      sample({
        file: "src/app.ts",
        line: 42,
        timestamp: "2024-01-01T00:00:00.000Z",
      }),
    );
    expect(md).toContain("# Error Explainer — Missing dependency");
    expect(md).toContain("**Stack:** node");
    expect(md).toContain("`node server.js`");
    expect(md).toContain("**Time:** 2024-01-01T00:00:00.000Z");
    expect(md).toContain("## Suggestion");
    expect(md).toContain("## Next steps");
    expect(md).toContain("src/app.ts:42");
  });
});
