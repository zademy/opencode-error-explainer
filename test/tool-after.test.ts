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
    log: () => {},
  });
}

function fakeInput(command: string): ToolAfterInput {
  return { tool: "bash", sessionID: "s1", callID: "c1", args: { command } };
}

function fakeOutput(text: string): ToolAfterOutput {
  return { title: "bash", output: text, metadata: {} };
}

describe("tool.execute.after handler", () => {
  it("appends an explanation and sets structured metadata for a real error", async () => {
    const handler = makeHandler(dir);
    const out = fakeOutput("node:internal Error: Cannot find module 'express'");
    await handler(fakeInput("node server.js"), out);

    expect(out.metadata.errorExplainer).toBeDefined();
    expect((out.metadata.errorExplainer as Record<string, unknown>).id).toBe(
      "node_missing_module",
    );
    expect(out.output).toContain("Error Explainer");
    expect(out.output).toContain("Missing dependency");
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

    // Structured metadata is present.
    expect(json.id).toBe("node_econnrefused");
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
    await expect(
      handler(fakeInput("node app.js"), out),
    ).resolves.toBeUndefined();
    expect(out.metadata.errorExplainer).toBeDefined();
  });

  it("does nothing when disabled", async () => {
    const handler = makeHandler(dir, { enabled: false });
    const out = fakeOutput("Error: Cannot find module 'lodash'");
    await handler(fakeInput("node app.js"), out);
    expect(out.metadata.errorExplainer).toBeUndefined();
    expect(await readdir(dir)).toHaveLength(0);
  });
});
