/**
 * Build the human/AI-facing explanation block appended to a tool's output.
 *
 * Two formats:
 *  - `concise`: type, suggestion, location — 2-3 lines. Default.
 *  - `detailed`: concise + matched lines + numbered next steps.
 *
 * Output is intentionally plain markdown so it renders in the opencode TUI and
 * is cheap in tokens for the model.
 */

import type { Classification } from "../classify/types.js";
import type { Verbosity } from "../config.js";

const HEADER = "── Error Explainer (by @zademy/opencode-error-explainer) ──";

export function buildExplanation(
  c: Classification,
  verbosity: Verbosity,
): string {
  const lines: string[] = [
    "",
    HEADER,
    `**${c.type}** (${c.stack}/${c.severity})`,
  ];

  lines.push(`Likely cause: ${c.suggestion}`);

  if (c.file || c.line) {
    const loc = c.file
      ? `${c.file}${c.line ? `:${c.line}` : ""}`
      : `line ${c.line}`;
    lines.push(`Probable location: ${loc}`);
  }

  if (verbosity === "detailed") {
    if (c.nextSteps.length > 0) {
      lines.push("Next steps:");
      for (let i = 0; i < c.nextSteps.length; i++) {
        lines.push(`  ${i + 1}. ${c.nextSteps[i]}`);
      }
    }
    if (c.matchedLines.length > 0) {
      lines.push("Relevant output lines:");
      const preview = c.matchedLines.slice(0, 5);
      for (const line of preview) {
        lines.push(`  ${truncate(line, 240)}`);
      }
    }
  }

  return lines.join("\n");
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/**
 * Build the full Markdown artifact written to `last-error.md`.
 * Standalone (includes the original command and a fuller matched-lines dump).
 */
export function buildMarkdownReport(c: Classification): string {
  const lines: string[] = [
    `# Error Explainer — ${c.type}`,
    "",
    `- **Stack:** ${c.stack}`,
    `- **Severity:** ${c.severity}`,
    `- **Classification id:** \`${c.id}\``,
    `- **Command:** \`\`\`${c.command}\`\`\``,
    `- **Time:** ${c.timestamp || "(unknown)"}`,
  ];

  if (c.file || c.line) {
    const loc = c.file
      ? `${c.file}${c.line ? `:${c.line}` : ""}`
      : `line ${c.line}`;
    lines.push(`- **Probable location:** ${loc}`);
  }

  lines.push("", "## Suggestion", "", c.suggestion);

  if (c.nextSteps.length > 0) {
    lines.push("", "## Next steps", "");
    for (let i = 0; i < c.nextSteps.length; i++) {
      lines.push(`${i + 1}. ${c.nextSteps[i]}`);
    }
  }

  if (c.matchedLines.length > 0) {
    lines.push(
      "",
      "## Relevant output lines",
      "",
      "```",
      ...c.matchedLines.slice(0, 20),
      "```",
    );
  }

  return lines.join("\n") + "\n";
}
