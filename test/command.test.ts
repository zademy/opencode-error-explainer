import { describe, expect, it, vi } from "vitest";

import type { Plugin } from "@opencode/plugin";
import { registerExplainCommand } from "../src/command/explain.js";

type CommandDef = Parameters<
  Parameters<Plugin.Context["command"]["transform"]>[0]
>[0]["add"] extends (def: infer D) => void
  ? D
  : never;

function harness() {
  const added: CommandDef[] = [];
  const ctx = {
    command: {
      transform: (cb: (e: { add: (d: CommandDef) => void }) => void) => {
        cb({ add: (d: CommandDef) => added.push(d) });
        return Promise.resolve({ dispose: () => Promise.resolve() });
      },
    },
  } as unknown as Plugin.Context;

  const prompt = vi.fn().mockResolvedValue(undefined);
  const log = vi.fn();
  return { added, ctx, prompt, log };
}

describe("/explain command", () => {
  it("registers a command named explain", async () => {
    const h = harness();
    await registerExplainCommand(h.ctx, { prompt: h.prompt, log: h.log });

    expect(h.added).toHaveLength(1);
    expect(h.added[0]!.name).toBe("explain");
    expect(h.added[0]!.description).toBeTruthy();
  });

  it("asks the model to recall the last error through the tool", async () => {
    const h = harness();
    await registerExplainCommand(h.ctx, { prompt: h.prompt, log: h.log });

    await h.added[0]!.execute({
      sessionID: "ses_1",
      prompt: { text: "" },
      delivery: "steer",
    } as Parameters<CommandDef["execute"]>[0]);

    expect(h.prompt).toHaveBeenCalledOnce();
    const [sessionID, text, delivery] = h.prompt.mock.calls[0]!;
    expect(sessionID).toBe("ses_1");
    expect(text).toContain("explain_error");
    expect(delivery).toBe("steer");
  });

  it("logs instead of throwing when the session prompt fails", async () => {
    const h = harness();
    h.prompt.mockRejectedValue(new Error("session gone"));
    await registerExplainCommand(h.ctx, { prompt: h.prompt, log: h.log });

    await expect(
      h.added[0]!.execute({
        sessionID: "ses_1",
        prompt: { text: "" },
        delivery: "queue",
      } as Parameters<CommandDef["execute"]>[0]),
    ).resolves.toBeUndefined();

    expect(h.log).toHaveBeenCalledOnce();
    expect(h.log.mock.calls[0]![0]).toContain("session gone");
  });
});
