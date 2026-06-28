/**
 * @zademy/opencode-error-explainer — plugin entry point.
 *
 * Detects failed terminal commands, classifies the error, explains it to the AI,
 * and persists a redacted, structured record for later recall. Wired together
 * here from pure, unit-tested modules.
 *
 * Activation (opencode.json):
 *
 * ```json
 * {
 *   "$schema": "https://opencode.ai/config.json",
 *   "plugin": [["@zademy/opencode-error-explainer", { "verbosity": "concise" }]]
 * }
 * ```
 */

import type { Plugin, PluginModule } from "@opencode-ai/plugin";

import { resolveOptions } from "./config.js";
import { loadPatterns } from "./classify/loader.js";
import { createToolAfterHandler } from "./hooks/tool-after.js";
import { createExplainTool } from "./tools/explain-tool.js";
import { resolveCustomPatternsPath, resolveOutputDir } from "./util/env.js";
import { VERSION } from "./version.js";

const log = (msg: string): void => {
  // Best-effort, non-fatal diagnostics. Goes to stderr; never throws.
  // eslint-disable-next-line no-console
  console.warn(msg);
};

const plugin: Plugin = async (input, options) => {
  const { worktree } = input;
  const opts = resolveOptions(options);

  // Disabled entirely — register nothing.
  if (!opts.enabled) {
    return {};
  }

  const outputDir = resolveOutputDir(worktree, opts);
  const customPatternsPath = resolveCustomPatternsPath(worktree, opts);
  const patterns = await loadPatterns(customPatternsPath, log);

  const toolExecuteAfter = createToolAfterHandler({
    patterns,
    options: opts,
    outputDir,
    version: VERSION,
    worktree: worktree ?? null,
    client: input.client,
    log,
  });

  const explainError = createExplainTool({
    patterns,
    outputDir,
    verbosity: opts.verbosity,
    version: VERSION,
    log,
  });

  return {
    "tool.execute.after": toolExecuteAfter,
    tool: { explain_error: explainError },
  };
};

/**
 * V1 plugin module format (recommended by opencode).
 *
 * opencode's loader first tries the V1 shape (`{ id, server }`); only if that
 * fails does it fall back to the "legacy" path that requires EVERY named export
 * to be a function. We export several non-function values (VERSION string,
 * BUILT_IN_PATTERNS array) for programmatic use, so we MUST use V1 to avoid the
 * legacy path throwing "Plugin export is not a function".
 */
const pluginModule: PluginModule = {
  id: "@zademy/opencode-error-explainer",
  server: plugin,
};

export default pluginModule;
export { VERSION } from "./version.js";
export type { PluginOptions } from "./config.js";
export type {
  Classification,
  ErrorPattern,
  Severity,
  Stack,
} from "./classify/types.js";
export {
  classifyError,
  inferStackFromCommand,
  looksLikeError,
} from "./classify/engine.js";
export { BUILT_IN_PATTERNS, mergeCustomPatterns } from "./classify/patterns.js";
export { redactSecrets } from "./enrich/redact.js";
export { buildExplanation, buildMarkdownReport } from "./enrich/explainer.js";
