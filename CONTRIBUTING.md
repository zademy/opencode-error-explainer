# Contributing to @zademy/opencode-error-explainer

Thanks for considering a contribution! This guide describes how to set up the
project locally, where things live, and the conventions to follow so your change
lands smoothly.

## Prerequisites

- **Node.js >= 20** (declared in `package.json#engines`)
- npm (a lockfile is committed; use `npm ci` for reproducible installs)

## Setup

```bash
git clone https://github.com/zademy/opencode-error-explainer.git
cd opencode-error-explainer
npm ci
```

## Common tasks

| Task | Command |
| --- | --- |
| Build (tsup → `dist/`) | `npm run build` |
| Type-check (`tsc --noEmit`) | `npm run typecheck` |
| Run the test suite (Vitest) | `npm test` |
| Watch tests | `npm run test:watch` |
| Dev build (watch) | `npm run dev` |
| Inspect the published tarball | `npm pack --dry-run` |

Before opening a PR, please run **all three**:

```bash
npm run typecheck && npm test && npm run build
```

## Project layout

The codebase keeps **pure, side-effect-free logic** separated from I/O so it is
trivial to unit-test:

```
src/
  index.ts            Plugin entry — wires hooks + the custom tool
  config.ts           Typed options + validation (never throws)
  version.ts          Single source of truth for the version
  classify/           types, built-in patterns, pure engine, custom-pattern loader, read-only skip
  enrich/             explanation builder + secret redaction (both pure)
  trace/              language-aware stacktrace parser (pure)
  context/            source preview, git context, runtime/OS context (side-effects isolated)
  breadcrumbs/        session breadcrumb gathering (defensive client access)
  event/              Sentry-grade event types, assembler, renderer, fingerprint (pure)
  persist/            crash-safe artifact writer, rotating history, frequency index
  hooks/              thin tool.execute.after orchestrator
  tools/              explain_error custom tool
  util/               path resolution + JSON serialization
test/                 Vitest suite (one file per module)
```

**Rule of thumb:** if a function derives an answer from inputs (classify,
parse, redact, fingerprint, assemble), it must be pure and live outside the
`hooks/`/`context/`/`persist/` layers. Side effects (filesystem, shell, the
opencode client) are isolated and always wrapped so they can never break a
user's opencode session.

## Adding an error pattern

Patterns are **data-driven** — you usually do not need to touch the engine.

### Option A — built-in (edit `src/classify/patterns.ts`)

Add an entry to `BUILT_IN_PATTERNS`:

```ts
{
  id: "my_thing_failure",            // unique, snake_case
  stack: "node",                      // one of the Stack union members
  type: "My thing failed",            // human-readable category
  severity: "error",                  // critical | error | warning | info
  pattern: /my signature/i,           // RegExp tested against the merged output
  suggestion: "Do X to fix it.",      // one actionable English sentence
  nextSteps: ["Step 1.", "Step 2."],  // optional, shown in detailed verbosity
  extractors: {                       // optional — capture group 1 = value
    file: /([\w./-]+\.ts)\(\d/i,
    line: /[\w./-]+\.ts\((\d+)/i,
  },
}
```

Then add a test in `test/engine.test.ts` (or `test/patterns.test.ts`) that feeds
a sample output and asserts the `id`.

### Option B — project-local, no code change

Users can drop a `.error-patterns.json` in their worktree root (path
configurable via `customPatternsPath`). Entries override built-ins by `id` and
append otherwise. See the README for the schema.

## Commit messages

This repository uses **Conventional Commits** (e.g. `feat:`, `fix:`, `docs:`,
`test:`, `chore:`, `refactor:`). Keep the subject line short and imperative.

Examples already in the tree: `feat: ...`, `fix(v0.1.1): ...`,
`feat(v0.2): ...`.

## Versioning & releases

Versions follow [Semantic Versioning](https://semver.org/):

- Bump `package.json#version` **and** `src/version.ts` together (the version is
  a literal so the bundled plugin doesn't depend on its install layout).
- Add a `## [x.y.z]` entry to `CHANGELOG.md`.
- The CI workflow (`.github/workflows/ci.yml`) publishes on `v*` tags.

## Opening a pull request

1. Fork and branch from `develop`.
2. Make focused changes; add or update tests for any behavior change.
3. Ensure `npm run typecheck && npm test && npm run build` all pass.
4. Reference any relevant issue in the PR description.

## License

By contributing you agree that your contributions will be licensed under the
[MIT License](./LICENSE).
