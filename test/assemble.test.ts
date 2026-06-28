import { describe, expect, it } from "vitest";

import { assembleEvent } from "../src/event/assemble.js";
import { buildEventMarkdown } from "../src/event/render.js";
import type { Classification } from "../src/classify/types.js";
import type { Contexts } from "../src/event/types.js";

function sample(overrides: Partial<Classification> = {}): Classification {
  return {
    id: "node_missing_module",
    stack: "node",
    type: "Missing dependency",
    severity: "error",
    suggestion: "A required module is not installed.",
    nextSteps: ["Run `npm install <name>`."],
    command: "node server.js",
    matchedLines: ["Error: Cannot find module 'express'"],
    raw: "Error: Cannot find module 'express'",
    timestamp: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function contexts(): Contexts {
  return {
    os: { name: "Darwin", version: "24.0", arch: "arm64" },
    runtime: { name: "node", version: "20.0.0" },
    app: {
      worktree: "/app",
      cwd: "/app",
      git_branch: "main",
      git_commit: "abc123def456",
      git_dirty: true,
    },
    opencode: {
      version: "1.17.11",
      session_id: "s1",
      agent: "build",
      model: null,
    },
  };
}

describe("assembleEvent", () => {
  it("builds a Sentry-grade event with stable shape", () => {
    const e = assembleEvent({
      classification: sample(),
      frames: [
        {
          filename: "/app/src/index.js",
          function: "foo",
          lineno: 12,
          colno: 3,
          in_app: true,
          context: null,
          module: null,
        },
      ],
      contexts: contexts(),
      breadcrumbs: [],
      fingerprint: "fp",
      frequency: { first_seen: "t1", last_seen: "t2", times_seen: 3 },
      sdkVersion: "0.2.0",
      eventId: "fixed-id",
      timestamp: "2024-01-01T00:00:00.000Z",
    });
    expect(e.event_id).toBe("fixed-id");
    expect(e.platform).toBe("node");
    expect(e.level).toBe("error");
    expect(e.release).toBe("abc123def456");
    expect(e.environment).toBe("main");
    expect(e.exception.values[0]?.type).toBe("Missing dependency");
    expect(e.exception.values[0]?.stacktrace.frames[0]?.lineno).toBe(12);
    expect(e.frequency?.times_seen).toBe(3);
    expect(e.sdk.name).toBe("@zademy/opencode-error-explainer");
  });
});

describe("buildEventMarkdown", () => {
  it("renders sectioned markdown with summary, stacktrace, context, frequency", () => {
    const e = assembleEvent({
      classification: sample(),
      frames: [],
      contexts: contexts(),
      breadcrumbs: [
        {
          timestamp: "2024-01-01T00:00:00.000Z",
          type: "default",
          category: "tool",
          level: "info",
          message: "prev",
          data: { tool: "bash", command: "ls", status: "completed" },
        },
      ],
      fingerprint: "fp123",
      frequency: { first_seen: "t1", last_seen: "t2", times_seen: 2 },
      sdkVersion: "0.2.0",
      eventId: "id",
      timestamp: "2024-01-01T00:00:00.000Z",
    });
    const md = buildEventMarkdown(e);
    expect(md).toContain("# Missing dependency");
    expect(md).toContain("## Summary");
    expect(md).toContain("## Context");
    expect(md).toContain("Release (git)");
    expect(md).toContain("(dirty)");
    expect(md).toContain("## Breadcrumbs");
    expect(md).toContain("## Frequency");
    expect(md).toContain("**Occurrences:** 2");
  });
});
