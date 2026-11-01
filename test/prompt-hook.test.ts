import { describe, expect, it } from "vitest";

import { createPromptHook } from "../src/hooks/prompt.js";
import { DEFAULT_OPTIONS } from "../src/config.js";
import { createPendingNotes } from "../src/bus/pending.js";

const baseDeps = {
  options: { ...DEFAULT_OPTIONS },
  pending: createPendingNotes(),
  digest: () => Promise.resolve(null as string | null),
  isMainSession: () => Promise.resolve(true),
};

function promptWith(text: string): {
  sessionID: string;
  prompt: { text: string };
} {
  return { sessionID: "s1", prompt: { text } };
}

describe("createPromptHook", () => {
  it("prepends drained pending notes to the prompt text", async () => {
    const pending = createPendingNotes();
    pending.enqueue(
      "s1",
      "[Error Explainer] 2nd Missing dependency in this session; ...",
    );
    const hook = createPromptHook({ ...baseDeps, pending });
    const input = promptWith("run the tests");
    await hook(input);
    expect(input.prompt.text).toContain(
      "[Error Explainer] 2nd Missing dependency",
    );
    expect(input.prompt.text.endsWith("run the tests")).toBe(true);
  });

  it("does not modify the prompt when nothing is pending and sessionMemory is off", async () => {
    const hook = createPromptHook({
      ...baseDeps,
      options: { ...DEFAULT_OPTIONS, sessionMemory: false },
      digest: () => Promise.resolve("Missing dependency (3×)"),
    });
    const input = promptWith("plain");
    await hook(input);
    expect(input.prompt.text).toBe("plain");
  });

  it("injects the digest once per session, not on the second prompt", async () => {
    const digest = () => Promise.resolve("Missing dependency (3×)");
    const hook = createPromptHook({ ...baseDeps, digest });
    const first = promptWith("a");
    const second = promptWith("b");
    await hook(first);
    await hook(second);
    expect(first.prompt.text).toContain("Prior errors in this worktree");
    expect(first.prompt.text).toContain("Missing dependency (3×)");
    expect(second.prompt.text).toBe("b");
  });

  it("skips the digest when sessionMemory is false but still delivers notes", async () => {
    const pending = createPendingNotes();
    pending.enqueue("s1", "note line");
    let digestCalled = 0;
    const hook = createPromptHook({
      ...baseDeps,
      options: { ...DEFAULT_OPTIONS, sessionMemory: false },
      pending,
      digest: () => {
        digestCalled++;
        return Promise.resolve("x");
      },
    });
    const input = promptWith("q");
    await hook(input);
    expect(digestCalled).toBe(0);
    expect(input.prompt.text).toContain("note line");
  });

  it("skips the digest for non-main sessions but delivers notes", async () => {
    const pending = createPendingNotes();
    pending.enqueue("s1", "note line");
    const hook = createPromptHook({
      ...baseDeps,
      pending,
      digest: () => Promise.resolve("d"),
      isMainSession: () => Promise.resolve(false),
    });
    const input = promptWith("q");
    await hook(input);
    expect(input.prompt.text).not.toContain("Prior errors");
    expect(input.prompt.text).toContain("note line");
  });

  it("never throws on an unexpected prompt shape", async () => {
    const hook = createPromptHook(baseDeps);
    await expect(
      hook({ sessionID: "s1", prompt: {} }),
    ).resolves.toBeUndefined();
    await expect(
      hook(null as unknown as Parameters<typeof hook>[0]),
    ).resolves.toBeUndefined();
  });

  it("does not prepend anything when the digest is null and no notes exist", async () => {
    const hook = createPromptHook({
      ...baseDeps,
      digest: () => Promise.resolve(null),
    });
    const input = promptWith("only me");
    await hook(input);
    expect(input.prompt.text).toBe("only me");
  });
});
