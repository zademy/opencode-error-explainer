/**
 * Render a {@link SentryGradeEvent} as a sectioned Markdown report.
 *
 * Pure: data in, string out. Used by the artifact writer AND the explain_error
 * tool response, so both stay in sync with one renderer.
 */

import type { SentryGradeEvent, Frame } from "./types.js";

const SEP = "\n\n---\n\n";

export function buildEventMarkdown(e: SentryGradeEvent): string {
  const out: string[] = [];
  out.push(`# ${e.exception.values[0]?.type ?? "Error"}`);
  out.push("");
  out.push(`- **Level:** ${e.level} · **Stack:** ${e.language}`);
  out.push(`- **Event ID:** \`${e.event_id}\``);
  out.push(`- **Time:** ${e.timestamp}`);
  if (e.release) out.push(`- **Release (git):** \`${shortSha(e.release)}\``);
  if (e.environment) out.push(`- **Environment (branch):** ${e.environment}`);
  out.push(`- **Command:** \`${truncate(e.logger, 120)}\``);

  out.push(`${SEP}## Summary`, "", e.classification.suggestion);
  if (e.classification.nextSteps.length > 0) {
    out.push("");
    for (let i = 0; i < e.classification.nextSteps.length; i++) {
      out.push(`${i + 1}. ${e.classification.nextSteps[i]}`);
    }
  }

  // Exception + stacktrace
  const frames = e.exception.values[0]?.stacktrace.frames ?? [];
  if (frames.length > 0) {
    out.push(`${SEP}## Exception & stacktrace`, "");
    for (const f of frames) {
      out.push(renderFrame(f));
    }
  }

  // Contexts
  out.push(`${SEP}## Context`, "");
  out.push(
    `- **OS:** ${e.contexts.os.name} ${e.contexts.os.version ?? ""} (${e.contexts.os.arch ?? "?"})`,
  );
  out.push(
    `- **Runtime:** ${e.contexts.runtime.name} ${e.contexts.runtime.version ?? "?"}`,
  );
  const app = e.contexts.app;
  out.push(`- **Worktree:** ${app.worktree ?? "?"}`);
  out.push(`- **cwd:** ${app.cwd ?? "?"}`);
  out.push(
    `- **Git:** ${app.git_branch ?? "-"} @ ${shortSha(app.git_commit) ?? "-"}${app.git_dirty ? " (dirty)" : ""}`,
  );
  out.push(
    `- **opencode:** ${e.contexts.opencode.version ?? "?"} · agent=${e.contexts.opencode.agent ?? "?"}`,
  );

  // Breadcrumbs
  if (e.breadcrumbs.length > 0) {
    out.push(`${SEP}## Breadcrumbs`, "");
    out.push("| time | tool | status | command |");
    out.push("| --- | --- | --- | --- |");
    for (const b of e.breadcrumbs.slice(-12)) {
      out.push(
        `| ${b.timestamp.slice(11, 19)} | ${b.data.tool} | ${b.data.status} | \`${truncate(b.data.command, 60)}\` |`,
      );
    }
  }

  // Frequency
  if (e.frequency) {
    out.push(`${SEP}## Frequency`, "");
    out.push(`- **Occurrences:** ${e.frequency.times_seen}`);
    out.push(`- **First seen:** ${e.frequency.first_seen}`);
    out.push(`- **Last seen:** ${e.frequency.last_seen}`);
    out.push(`- **Fingerprint:** \`${e.fingerprint.slice(0, 16)}…\``);
  }

  return `${out.join("\n")}\n`;
}

function renderFrame(f: Frame): string {
  const tag = f.in_app ? "app" : "lib";
  const loc = `${f.filename}${f.lineno ? `:${f.lineno}` : ""}${f.colno ? `:${f.colno}` : ""}`;
  const fn = f.function ? ` — **${f.function}**` : "";
  const mod = f.module ? ` (${f.module})` : "";
  let block = `- \`${loc}\`${fn}${mod}  *[${tag}]*`;
  if (f.context && f.context.length > 0) {
    const code = f.context
      .map((c) => {
        const mark = c.line === f.lineno ? " ▶" : "  ";
        return `  ${mark} ${c.line} │ ${c.source}`;
      })
      .join("\n");
    block += `\n\n\`\`\`\n${code}\n\`\`\``;
  }
  return block;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function shortSha(sha: string | null | undefined): string | null {
  if (!sha) return null;
  return sha.length > 12 ? sha.slice(0, 12) : sha;
}
