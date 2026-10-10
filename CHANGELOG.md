# Changelog

All notable changes to **opencode-error-explainer** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-10-10

### Added

--- **`/explain` command**, registered by the plugin through
`ctx.command.transform`. It routes through the same `explain_error`
tool, so the answer is identical to asking by hand. The previous README
told users to copy a markdown file into their own project because it
claimed a plugin could not register a command — the v2 SDK exposes a
`CommandDomain`, so that is no longer true and the manual step is gone.
--- **Tarball asset on every GitHub Release**, so the published artifact can
be downloaded and compared against npm.

### Changed

--- **`peerDependencies` is now `>=2.0.0 <3`.** An open upper bound let a
breaking v3 of the SDK install silently and break the plugin at load.
--- **CI runs once per push instead of twice.** The `pull_request`
trigger fired a duplicate run for the same commit on top of the push
run, doubling the jobs. Checks attach to the commit SHA either way, so
`main`'s required status checks are unaffected.
--- **Release is cut by merging the PR into `main`**, not by pushing a tag
by hand: `main` is protected, so a push to it is a merge.

### Fixed

--- **`release.yml` could not tag.** `git tag -a` needs an identity and the
runner has none (`fatal: empty ident name ... not allowed`). The
workflow now sets `user.name` / `user.email` before tagging.
--- **Release notes could be silently empty.** `gh release create` with an
empty body exits 0, prints a URL, and creates nothing; notes are built
before the create call and passed with `--notes-file`.
--- **README documented four things that were false:** Node `>= 20` (it is
`>= 22`), 77 tests (107), `@opencode-ai/plugin` (the package is
`@opencode/plugin`), and a `zod` peer dependency that never existed.

## [0.3.0] - 2026-10-10

### Added

-- **`explain_error` tool**: ask the model to classify an arbitrary error
string on demand, or to recall the last captured error even after the
inline `tool.execute.after` enrichment has scrolled out of context.
-- **ESLint 9 + Prettier**: type-aware lint rules (`no-floating-promises`,
`no-misused-promises`) catch what `tsc` does not report. Both run in CI.
-- **Cross-OS CI**: the plugin shells out to `git` and resolves OS context at
runtime, so it is now verified on Linux, macOS and Windows.
-- **`release.yml`**: a GitHub Release is cut from a `v*` tag, and the tag is
verified against `package.json` so a release cannot exist for an untagged
commit.

### Changed

-- **OpenCode v2 plugin API.** Hooks are registered on the v2 tool domain
(`tool.hook("execute.before"/"execute.after")`) and the tool via
`tool.transform`. The worktree now comes from `ctx.location.directory`.
-- **Breadcrumbs are recorded locally** in a per-session ring buffer
(`src/breadcrumbs/trail.ts`). v2's plugin context has no message-reading
API, so the old `client.session.messages` round-trip is gone.
-- **A failed tool no longer gets output appended.** v2 has no writable
result for a failed call, so its explanation lands in the persisted
artifact instead.
-- **Minimum Node is now 22.** CI tests only 22.
-- **Package renamed** from the scoped `@zademy/opencode-error-explainer` to
unscoped `opencode-error-explainer`. Nothing was ever published under the
old name.
-- **CI no longer publishes to npm** and no longer caches dependencies.
Verification runs on `develop` only; `main` is the release branch.

### Fixed

-- **Error history never worked on Windows.** Timestamps kept their ISO
colons and `:` is illegal in Windows filenames, so every write threw and
was swallowed. That also silently voided the secret-redaction guarantee
for history files on Windows. Filenames are now valid on every OS.
-- **`explain_error` could render `[object Object]`** when a field in an older
artifact was not a string; it now falls back cleanly.
-- **`withAppended` lost element types** because `Array.isArray()` widens a
readonly array to `any[]`. Replaced with a type predicate.
-- **Prettier flagged all 53 files on Windows** while Linux and macOS passed,
because `core.autocrlf` checks files out with CRLF. Added `.gitattributes`
pinning `eol=lf`.
-- A test assumed POSIX: it forced a write failure via `/dev/null/cant`, which
is creatable on Windows, so the expected error never fired.

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

[0.3.0]: https://github.com/zademy/opencode-error-explainer/releases/tag/v0.3.0
[0.2.1]: https://github.com/zademy/opencode-error-explainer/releases/tag/v0.2.1
[0.1.0]: https://github.com/zademy/opencode-error-explainer/releases/tag/v0.1.0
