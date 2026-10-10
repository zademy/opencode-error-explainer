/**
 * The `/explain` command.
 *
 * Registered through `ctx.command.transform`. The command carries no logic of
 * its own: it asks the model, in the current session, to call `explain_error`
 * and report the root cause. That keeps the recall path identical whether the
 * user types `/explain` or the model reaches for the tool on its own.
 */

import type { Plugin } from "@opencode/plugin";

const ASK = [
  "Use the `explain_error` tool with no arguments to recall the last captured error.",
  "Then give a one-paragraph root-cause analysis and a concrete fix.",
  "If there is no recent error, say so instead of guessing.",
].join(" ");

export interface ExplainCommandDeps {
  /** Narrowed to the one session method this command uses, so tests can stub it. */
  readonly prompt: (
    sessionID: string,
    text: string,
    delivery: "steer" | "queue",
  ) => Promise<unknown>;
  readonly log: (msg: string) => void;
}

export async function registerExplainCommand(
  ctx: Plugin.Context,
  deps: ExplainCommandDeps,
): Promise<void> {
  await ctx.command.transform((editor) => {
    editor.add({
      name: "explain",
      description: "Explain the most recent terminal error.",
      execute: async ({ sessionID, delivery }) => {
        try {
          await deps.prompt(sessionID, ASK, delivery);
        } catch (err) {
          // Never break the session over a convenience command.
          deps.log(
            `explain command failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    });
  });
}
