import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BUILT_IN_PATTERNS } from "../src/classify/patterns.js";
import { DEFAULT_OPTIONS } from "../src/config.js";
import { createToolAfterHandler } from "../src/hooks/tool-after.js";

import type {
  ToolAfterInput,
  ToolAfterOutput,
} from "../src/hooks/tool-after.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ee-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeHandler(
  outputDir: string,
  extra: Partial<typeof DEFAULT_OPTIONS> = {},
) {
  return createToolAfterHandler({
    patterns: BUILT_IN_PATTERNS,
    options: { ...DEFAULT_OPTIONS, ...extra },
    outputDir,
    version: "0.0.0-test",
    sdkVersion: "2.0.0-test",
    worktree: null,
    trail: null,
    log: () => {},
  });
}

function fakeInput(command: string): ToolAfterInput {
  return { tool: "bash", sessionID: "s1", id: "c1", input: { command } };
}

function fakeOutput(text: string): ToolAfterOutput {
  return { title: "bash", output: text, metadata: {} };
}

describe("tool.execute.after handler", () => {
  it("appends an explanation and sets structured metadata for a real error", async () => {
    const handler = makeHandler(dir);
    const out = fakeOutput("node:internal Error: Cannot find module 'express'");
    const appended = await handler(fakeInput("node server.js"), out);

    expect(out.metadata.errorExplainer).toBeDefined();
    expect((out.metadata.errorExplainer as Record<string, unknown>).id).toBe(
      "node_missing_module",
    );
    expect(appended).toContain("Error Explainer");
    expect(appended).toContain("Missing dependency");
    // v2 hands back the text to append; the raw output is never mutated.
    expect(out.output).toBe(
      "node:internal Error: Cannot find module 'express'",
    );
  });

  it("does not pollute successful command output", async () => {
    const handler = makeHandler(dir);
    const out = fakeOutput("✓ built in 1.2s\nAll tests passed.");
    await handler(fakeInput("npm run build"), out);
    expect(out.metadata.errorExplainer).toBeUndefined();
    expect(out.output).toBe("✓ built in 1.2s\nAll tests passed.");
  });

  it("ignores non-terminal tools", async () => {
    const handler = makeHandler(dir);
    const out = fakeOutput("Error: ECONNREFUSED boom");
    await handler({ ...fakeInput("rm"), tool: "edit" }, out);
    expect(out.metadata.errorExplainer).toBeUndefined();
  });

  it("writes last-error.md and last-error.json, redacting secrets", async () => {
    const handler = makeHandler(dir);
    const secret = "password=supersecretvalue";
    const out = fakeOutput(`Error: ECONNREFUSED\n${secret}\nfailed to connect`);
    await handler(fakeInput("node app.js"), out);

    const json = JSON.parse(
      await readFile(join(dir, "last-error.json"), "utf8"),
    ) as Record<string, unknown>;
    const md = await readFile(join(dir, "last-error.md"), "utf8");

    // v0.2 persists a full Sentry-grade event: classification.id is nested.
    const classification = json.classification as
      Record<string, unknown> | undefined;
    expect(classification?.id).toBe("node_econnrefused");
    expect(json.event_id).toEqual(expect.any(String));
    expect(json.exception).toBeDefined();
    // Secrets redacted in BOTH persisted artifacts.
    const jsonText = JSON.stringify(json);
    expect(jsonText).not.toContain("supersecretvalue");
    expect(md).not.toContain("supersecretvalue");
    expect(jsonText).toContain("[REDACTED]");
  });

  it("appends to history and prunes to the configured limit", async () => {
    const handler = makeHandler(dir, { historyLimit: 2 });
    for (let i = 0; i < 5; i++) {
      const out = fakeOutput("Error: listen EADDRINUSE :::3000");
      await handler(fakeInput("node app.js"), out);
    }
    const historyFiles = (await readdir(join(dir, "history"))).filter((f) =>
      f.endsWith(".json"),
    );
    expect(historyFiles.length).toBe(2);
  });

  it("never throws when the output dir is null", async () => {
    const handler = makeHandler(null as unknown as string); // persistence disabled
    const out = fakeOutput("Error: Cannot find module 'lodash'");
    await expect(handler(fakeInput("node app.js"), out)).resolves.toBeTypeOf(
      "string",
    );
    expect(out.metadata.errorExplainer).toBeDefined();
  });

  it("does nothing when disabled", async () => {
    const handler = makeHandler(dir, { enabled: false });
    const out = fakeOutput("Error: Cannot find module 'lodash'");
    await handler(fakeInput("node app.js"), out);
    expect(out.metadata.errorExplainer).toBeUndefined();
    expect(await readdir(dir)).toHaveLength(0);
  });

  // ── Redaction coverage (security) ─────────────────────────────────────────
  it("redacts secrets in history files, not just the main event", async () => {
    const handler = makeHandler(dir, { historyLimit: 5 });
    const out = fakeOutput("Error: ECONNREFUSED\nfailed to connect");
    // Secret travels via the command field, which IS serialized to history.
    await handler(fakeInput("node app.js --password=supersecretvalue"), out);

    const historyDir = join(dir, "history");
    const files = (await readdir(historyDir)).filter((f) =>
      f.endsWith(".json"),
    );
    expect(files.length).toBe(1);
    const historyText = await readFile(join(historyDir, files[0]!), "utf8");
    expect(historyText).not.toContain("supersecretvalue");
    expect(historyText).toContain("[REDACTED]");
  });

  it("redacts secrets embedded in the command string", async () => {
    const handler = makeHandler(dir);
    const out = fakeOutput(
      "Error: ECONNREFUSED 127.0.0.1:5432\nfailed to connect",
    );
    // Command carries a labeled secret that must be scrubbed from the artifact.
    await handler(
      fakeInput(
        "curl -H 'Authorization: Bearer tok_abcdef1234567890' https://x",
      ),
      out,
    );

    const jsonText = await readFile(join(dir, "last-error.json"), "utf8");
    expect(jsonText).not.toContain("tok_abcdef1234567890");
    // The command (logger + extra.command) should be redacted.
    const event = JSON.parse(jsonText) as Record<string, unknown>;
    expect(String(event.logger)).toContain("[REDACTED]");
    const extra = event.extra as Record<string, unknown>;
    expect(String(extra.command)).toContain("[REDACTED]");
  });

  // ── runtimeContext option (privacy: skip subprocess probes) ───────────────
  it("does not gather OS/runtime context when runtimeContext is false", async () => {
    const handler = makeHandler(dir, { runtimeContext: false });
    const out = fakeOutput("Error: listen EADDRINUSE :::3000");
    await handler(fakeInput("node app.js"), out);

    const json = JSON.parse(
      await readFile(join(dir, "last-error.json"), "utf8"),
    ) as Record<string, unknown>;
    const contexts = json.contexts as Record<
      string,
      Record<string, unknown> | undefined
    >;
    // With runtimeContext disabled, OS name should be the fallback "unknown",
    // not the real OS name returned by gatherOs().
    expect(contexts.os!.name).toBe("unknown");
    expect(contexts.runtime!.version).toBeNull();
  });

  // ── times_seen metadata (bug fix) ─────────────────────────────────────────
  it("populates times_seen from frequency in metadata", async () => {
    const handler = makeHandler(dir, { fingerprint: true });
    const out = fakeOutput("Error: listen EADDRINUSE :::3000");
    await handler(fakeInput("node app.js"), out);

    const meta = out.metadata.errorExplainer as Record<string, unknown>;
    expect(meta.times_seen).toBe(1);
  });

  it("reports times_seen=2 on the second identical error", async () => {
    const handler = makeHandler(dir, { fingerprint: true });
    for (let i = 0; i < 2; i++) {
      const out = fakeOutput("Error: listen EADDRINUSE :::3000");
      await handler(fakeInput("node app.js"), out);
      if (i === 1) {
        const meta = out.metadata.errorExplainer as Record<string, unknown>;
        expect(meta.times_seen).toBe(2);
      }
    }
  });
});
