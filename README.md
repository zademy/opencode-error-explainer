# @zademy/opencode-error-explainer

> An [OpenCode](https://opencode.ai) plugin that detects failed terminal commands, **explains them to the AI in real time**, and writes a **private, Sentry-style event** for every error — stack frames with source preview, OS/runtime/git context, breadcrumbs, and grouping frequency. **100% local. Nothing is ever transmitted.**

[![npm](https://img.shields.io/npm/v/@zademy/opencode-error-explainer.svg)](https://www.npmjs.com/package/@zademy/opencode-error-explainer)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![tests](https://github.com/zademy/opencode-error-explainer/actions/workflows/ci.yml/badge.svg)](https://github.com/zademy/opencode-error-explainer/actions/workflows/ci.yml)

---

## Why

When a command fails, OpenCode's model usually has to read the whole output and
guess the cause. This plugin does that reasoning for it the instant a tool
returns: it matches the output against a multi-stack signature library, appends
a **concise, actionable explanation** the model sees directly, and writes a
**redacted, machine-readable** artifact so the diagnosis is never lost.

The result: the model fixes errors faster, with fewer follow-up questions, and
your debugging history is auditable.

## How it works

1. **Detects** failures by content. OpenCode does not expose exit codes to
   plugins, so the plugin reads the merged `output` string and applies a
   pattern + signal-density heuristic — it never pollutes successful commands.
2. **Classifies** against a data-driven registry covering Node, TypeScript,
   Python, Java/Maven/Gradle, Rust, Go, Docker, Kubernetes, Git, SQL, shell,
   network, and OS errors.
3. **Enriches** two channels:
   - appends a short explanation to the tool `output` the model reads, and
   - injects a structured classification into `output.metadata`.
4. **Persists** a **private, Sentry-style event** to `last-error.{md,json}`
   (and a rotating history), with **secrets redacted** before anything is
   written to disk. No telemetry, no network — everything stays in your worktree.

## Sentry-grade events (private, local)

Every captured error becomes an event that mirrors Sentry's ingest shape — but
**on your machine only**:

- **Structured stacktrace** — language-aware frames (`filename`, `function`,
  `lineno`, `colno`, `in_app`, `module`) for JavaScript/TypeScript, Python, Java,
  Rust, and Go.
- **Source preview** — `±N` lines read from the worktree around each in-app
  frame (binary/minified/external files skipped), with the error line marked.
- **Contexts** — OS (name/version/arch), runtime (node/python/go…), and
  application (worktree, cwd, git branch, git commit SHA, dirty flag).
- **Breadcrumbs** — the prior tool calls of the session (command + status +
  timing), gathered defensively from the opencode client.
- **Fingerprint & frequency** — a normalized signature is SHA-1 hashed for
  grouping; `index.json` tracks `first_seen`, `last_seen`, and `times_seen` per
  fingerprint.
- **Read-only skip** — `cat`/`grep`/`less`/`head`/`tail`/`rg`/`find`/`ls` are
  skipped so inspecting a log that contains the word "error" isn't misflagged.

Inspect the last event any time:

```bash
cat .opencode/error-explainer/last-error.md   # sectioned report
cat .opencode/error-explainer/last-error.json # full Sentry-shaped event
```

Or ask the model to run the `explain_error` tool, which renders the full report.

## Install

Add the plugin to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [["@zademy/opencode-error-explainer", { "verbosity": "concise" }]]
}
```

Then **restart OpenCode** (config is loaded once at startup; it is not
hot-reloaded).

> The plugin is also auto-discovered if you drop the built `index.js` as
> `.opencode/plugin/error-explainer.js` in a project.

## Configuration

All options are optional and passed via the tuple form shown above. Defaults
are safe; invalid values silently fall back so a bad config never breaks your
session.

| Option              | Type                          | Default                          | Description                                                                 |
| ------------------- | ----------------------------- | -------------------------------- | --------------------------------------------------------------------------- |
| `enabled`           | `boolean`                     | `true`                           | Master switch.                                                              |
| `outputDir`         | `string`                      | `<worktree>/.opencode/error-explainer` | Where artifacts are written (relative to worktree, or absolute).        |
| `historyLimit`      | `number`                      | `10`                             | How many recent errors to keep. `0` disables history.                      |
| `stacks`            | `Stack[]`                     | all                              | Restrict activation to these stacks (e.g. `["java","typescript"]`).        |
| `verbosity`         | `"concise" \| "detailed"`     | `"concise"`                      | Detail of the full report (artifact + `explain_error`).                    |
| `redact`            | `boolean`                     | `true`                           | Strip likely secrets from persisted output and source previews.            |
| `appendMode`        | `"minimal" \| "full" \| "off"`| `"minimal"`                      | What to append inline to the tool output the AI sees. The full report always lives in the artifact + `explain_error`. |
| `sourcePreview`     | `boolean`                     | `true`                           | Read `±sourceContextLines` around each in-app frame from the worktree.     |
| `sourceContextLines`| `number`                      | `5`                              | Lines of source captured on each side of the error line.                   |
| `breadcrumbs`       | `boolean`                     | `true`                           | Gather prior tool calls of the session as breadcrumbs.                     |
| `breadcrumbLimit`   | `number`                      | `15`                             | How many breadcrumbs to retain.                                            |
| `gitContext`        | `boolean`                     | `true`                           | Capture git branch/commit/dirty.                                           |
| `runtimeContext`    | `boolean`                     | `true`                           | Capture OS + runtime versions.                                             |
| `fingerprint`       | `boolean`                     | `true`                           | Compute a grouping fingerprint + per-fingerprint frequency.                |
| `skipReadOnlyCommands` | `boolean`                 | `true`                           | Skip read-only commands (cat/grep/less…) so inspecting a log isn't flagged. |
| `readOnlyCommands`  | `string[]`                    | built-in list                    | Override the set of read-only command prefixes.                            |
| `customPatternsPath`| `string`                      | `.error-patterns.json`           | Path (relative to worktree) to your custom patterns file. `null` disables. |

## Custom patterns

Drop a `.error-patterns.json` in your worktree root to add team-specific
signatures or override built-ins (by `id`):

```json
{
  "patterns": [
    {
      "id": "my_service_503",
      "stack": "network",
      "type": "Internal service unavailable",
      "severity": "error",
      "pattern": "SERVICE_X returned 503",
      "flags": "i",
      "suggestion": "Service X is down. Check its health endpoint and retry.",
      "nextSteps": ["Run `make svc-x-logs`.", "Page the on-call if it persists."]
    }
  ]
}
```

| Field        | Required | Notes                                                                                    |
| ------------ | -------- | ---------------------------------------------------------------------------------------- |
| `id`         | yes      | Unique; matches override a built-in.                                                     |
| `type`       | yes      | Human-readable category.                                                                 |
| `suggestion` | yes      | One actionable English sentence.                                                         |
| `pattern`    | yes      | String (with optional `flags`) **or** a regex object. Malformed entries are dropped.     |
| `stack`      | no       | Defaults to `generic`. One of the stacks in the config table.                            |
| `severity`   | no       | `critical \| error \| warning \| info` (default `error`).                                |
| `nextSteps`  | no       | Array of strings; shown in `detailed` verbosity.                                         |
| `extractors` | no       | `{ "file": <regex>, "line": <regex> }` — capture group 1 becomes the location.           |

## The `explain_error` tool

The plugin registers an `explain_error` tool the model can call on demand:

- **`explain_error({ text: "..." })`** — classify arbitrary error text right now.
- **`explain_error()`** — recall the most recently captured error.

This is how the model recovers an explanation even after the inline enrichment
has scrolled out of context.

## Optional: a `/explain` command

OpenCode commands are file-based and ship with the **user's** project (a plugin
cannot register one), so copy this snippet into
`.opencode/command/explain.md` if you want a one-keystroke `/explain`:

```markdown
---
description: Explain the most recent terminal error.
agent: build
---

Use the `explain_error` tool with no arguments to recall the last captured
error, then give me a one-paragraph root-cause analysis and a concrete fix.
If there is no recent error, tell me so.
```

## Security & privacy

- Secrets are **redacted before any artifact is written to disk** — AWS/GCP
  keys, PEM blocks, JWTs, GitHub tokens, and labeled `password=`/`token=`/
  `api_key=` values are replaced with `[REDACTED]`.
- The **live** output the model sees in-session is left untouched so it can
  still reason about the real command; redaction is a write-to-disk concern only.
- The plugin performs **no telemetry, no network calls, and no remote
  reporting**. Everything stays in your worktree.

## Enterprise

- **MIT licensed**, fully auditable TypeScript. No native modules, no
  postinstall scripts, no telemetry.
- **Scoped package** (`@zademy/...`) with `publishConfig.access: "public"` for
  clean private-registry mirroring.
- **Extensible without code**: ship a `.error-patterns.json` per repository to
  encode your team's known failure modes.
- Zademy offers **commercial support, integration, and custom pattern packs** —
  see [https://zademy.com](https://zademy.com).

## Development

```bash
npm install        # install dev deps
npm test           # run the Vitest suite (45 unit + hook tests)
npm run typecheck  # tsc --noEmit
npm run build      # tsup → dist/
```

Project layout (pure functions are isolated from side effects so everything is
trivially unit-testable):

```
src/
  index.ts            plugin entry — wires hooks + tool
  config.ts           typed options + validation
  version.ts          single source of truth for the version
  classify/           types, built-in patterns, pure engine, custom-pattern loader
  enrich/             explanation builder + secret redaction (both pure)
  persist/            crash-safe artifact writer + rotating history
  hooks/              thin tool.execute.after orchestrator
  tools/              explain_error custom tool
  util/               path resolution + JSON serialization
test/                 Vitest suite
```

## Supported signatures (v0.1)

Node `Cannot find module`, `EADDRINUSE`, `EACCES`, `ECONNREFUSED`, `ENOENT`,
npm `ERESOLVE`; TypeScript `TS####`; Python `Traceback`, `ModuleNotFoundError`,
`SyntaxError`; Maven `BUILD FAILURE`, Gradle `BUILD FAILED`, Java exceptions;
Rust `E####` + panics; Go panics + compile errors; Docker image-not-found /
non-zero exit / daemon unreachable; Kubernetes `NotFound`, `CrashLoopBackOff`,
`ImagePullBackOff`; Git merge conflicts, rejected pushes, auth failures; SQL
syntax + missing-relation; shell `command not found`; disk-full; and a generic
fallback for unrecognised errors carrying two or more signals.

## License

[MIT](./LICENSE) © Zademy
