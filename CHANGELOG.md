# Changelog

All notable changes to **@zademy/opencode-error-explainer** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-06-28

### Security
- **Path confinement**: source-preview now confines every resolved path to the
  worktree root. Absolute paths (`/etc/passwd`) and `../` traversals that would
  escape the worktree are rejected, so a crafted stack frame can never read
  arbitrary files.
- **Complete secret redaction**: persisted events now redact secrets across ALL
  string-bearing fields — `logger`, `extra.command`, `extra.matched_lines`,
  exception `value`, breadcrumb messages and commands, and the history ring
  buffer. Previously only `raw_output_excerpts` and source context were covered.

### Fixed
- `times_seen` in structured metadata was always `null` even after frequency was
  computed. Now reports the real count (`frequency?.times_seen`).
- Compound commands like `grep x && npm test` were incorrectly skipped as
  read-only because only the first segment was checked. Now ALL segments must
  be read-only for the skip to apply.
- Custom patterns with `g`/`y` regex flags were stateful — `.test()` in loops
  silently missed matches due to `lastIndex` drift. Flags are now stripped at
  load time.
- `runtimeContext: false` option existed but was ignored — `gatherOs()` and
  `gatherRuntime()` spawned subprocess probes regardless. Now respected.

### Changed
- Migrated `explain_error` tool args from direct `zod` import to
  `tool.schema` (re-exported by `@opencode-ai/plugin`). `zod` is no longer a
  peer dependency — it arrives transitively at runtime.
- Test files are now typechecked (`npm run typecheck:tests`) via
  `tsconfig.test.json`.

## [0.2.0] - 2026-06-28

### Added — Sentry-grade local events
The persisted artifact is now a rich, Sentry-style event. **100% local and
private**: nothing is sent anywhere; source previews, git context, and
breadcrumbs are read from the worktree only.

- **Structured stacktraces**: language-aware parser (JavaScript/TypeScript,
  Python, Java, Rust, Go) extracts `Frame[]` (`filename`, `function`, `lineno`,
  `colno`, `in_app`, source context).
- **Source preview**: reads `±N` lines around each in-app frame from the
  worktree (binary/minified files skipped). `in_app` marks `node_modules`,
  `.venv`, `vendor`, etc. as external.
- **Contexts**: OS (name/version/arch), runtime (node/python/go version),
  application (worktree, cwd, git branch, git commit SHA, dirty flag), and the
  opencode session (version, sessionID, agent).
- **Breadcrumbs**: the most recent tool calls in the session (command + status +
  timing) gathered from the opencode client. Gathered defensively — omitted
  silently if the host client does not expose session messages.
- **Fingerprint & frequency**: a normalized signature is SHA-1 hashed for
  grouping; `index.json` tracks `first_seen`, `last_seen`, and `times_seen` per
  fingerprint.
- **Sentry-compatible event schema** in `last-error.json` (event_id, timestamp,
  platform, level, sdk, release, environment, exception, contexts,
  breadcrumbs, tags, fingerprint, frequency) and a sectioned Markdown report.
- Configurable via new options: `sourcePreview`, `sourceContextLines`,
  `breadcrumbs`, `breadcrumbLimit`, `gitContext`, `runtimeContext`,
  `fingerprint`, `skipReadOnlyCommands`, and `appendMode`.

### Fixed
- Skip read-only commands (`cat`, `grep`, `less`, `head`, `tail`, `rg`, `find`,
  `ls`) so inspecting a log that contains the word "error" no longer triggers a
  spurious explanation.
- The inline `output.output` append is now minimal by default
  (`appendMode: "minimal"`) — the full report lives in the artifact and the
  `explain_error` tool response, which the opencode TUI renders reliably.

## [0.1.1] - 2026-06-28

### Fixed
- Plugin failed to load in opencode with `"Plugin export is not a function"`.
  Root cause: opencode's loader falls back to a "legacy" path that requires
  every named export to be a function, but this package also exports `VERSION`
  (string) and `BUILT_IN_PATTERNS` (array) for programmatic use. Switched the
  default export to the recommended **V1 plugin module** shape
  (`{ id, server }`), which the loader detects first and which isolates the
  plugin entry point from the other public exports.

## [0.1.0] - 2026-06-28

### Added
- First public release.
- `tool.execute.after` hook that detects failed `bash` commands by content
  (opencode exposes no exit code to plugins), classifies them against a
  multi-stack pattern registry, and:
  - appends a concise explanation to `output.output` so the model sees it,
  - injects a structured classification into `output.metadata`,
  - persists redacted `last-error.md` + `last-error.json` artifacts.
- Built-in error signatures for Node/npm, TypeScript, Python, Java/Maven/Gradle,
  Rust, Go, Docker, Kubernetes, Git, SQL, shell/OS, and network errors.
- `explain_error` custom tool: classify arbitrary text or recall the last
  captured error on demand.
- Rotating history ring buffer (configurable size).
- Best-effort secret redaction (AWS/GCP keys, JWT, GitHub tokens, labeled
  `password=`/`token=` values) applied to all persisted artifacts.
- Data-driven custom patterns via a `.error-patterns.json` file in the worktree
  root (overrides built-ins by `id`, appends otherwise).
- Full type-safety (TypeScript strict), Vitest unit tests, and a CI workflow.

[0.2.1]: https://github.com/zademy/opencode-error-explainer/releases/tag/v0.2.1
[0.1.0]: https://github.com/zademy/opencode-error-explainer/releases/tag/v0.1.0
