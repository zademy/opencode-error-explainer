# Changelog

All notable changes to **@zademy/opencode-error-explainer** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/zademy/opencode-error-explainer/releases/tag/v0.1.0
