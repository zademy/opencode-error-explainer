# Security Policy

## Reporting a vulnerability

We take security reports seriously. **Please do not open a public GitHub issue
for security problems.** Instead, use one of these private channels:

- **GitHub Security Advisories** (preferred): go to
  [the repository](https://github.com/zademy/opencode-error-explainer) →
  _Security_ → _Report a vulnerability_. This keeps the report private to
  maintainers.
- If you cannot use Advisories, open a **regular issue** flagged
  `security` and we will handle it confidentially.

Please include: a description of the issue, steps to reproduce, the affected
version, and any proposed fix. We aim to acknowledge reports within 72 hours and
to publish a fix within 30 days for high-severity issues, coordinated with a
CVE when applicable.

## Supported versions

Only the **latest minor release** receives security fixes. Upgrade to the
newest published version before reporting.

| Version | Supported |
| ------- | --------- |
| 0.2.x   | ✅        |
| < 0.2   | ❌        |

## Security posture

This plugin is designed to run inside an OpenCode session and process your
**terminal output and source files**. The relevant guarantees and limitations:

### 100% local — no telemetry, no network

The plugin performs **no outbound network requests** and sends nothing
anywhere. Error events, breadcrumbs, and frequency data are written only to
your worktree (default `.opencode/error-explainer/`). Context gathering uses
local processes (`git`, `node --version`, etc.) and the in-process opencode
client only.

### Best-effort secret redaction

Before any artifact is written to disk, output and source-preview lines are
passed through a redaction layer that replaces likely secrets with
`[REDACTED]`. The current rules cover:

- AWS access key IDs (`AKIA…`) and labeled AWS secret keys
- PEM private-key blocks (including GCP service-account keys)
- GitHub tokens (`ghp_`/`gho_`/`ghs_`/`ghu_`/`ghr_` and `github_pat_`)
- Slack tokens (`xox[abp]-…`)
- JSON Web Tokens
- `Bearer …` authorization values
- Labeled secrets: `password=`, `passwd=`, `secret=`, `token=`, `api_key=`,
  `apikey=`, `access_token=`, `private_key=`
- `Authorization:` / `X-Api-Key:` header values

> ⚠️ **Redaction is best-effort, not a guarantee.** It targets well-known
> formats to reduce accidental leakage; it will not catch arbitrary custom
> tokens. Treat the artifacts as potentially sensitive and do not share them
> without review.

### Live output is not redacted

The in-session `output` the model reads is **left intact** so the model can
reason about the real command. Redaction applies only to **persisted** files
(write-to-disk). If a command prints a secret to stdout, the model sees it
during the session — this is by design, not a leak to disk.

### Supply chain

-- Unscoped package (`opencode-error-explainer`) published with
`--access public` and `publishConfig`.

- **No `postinstall` or other install scripts.**
- Runtime dependencies are externalized as peer dependencies
  (`@opencode-ai/plugin`, `zod`), provided by the OpenCode host at runtime; the
  published tarball contains only `dist/` + documentation.
- The CI workflow publishes with **npm provenance** from tag pushes.

### Permissions surface

The plugin itself registers one hook (`tool.execute.after`) and one custom tool
(`explain_error`). It reads files from the worktree (for source preview) and
runs local `git`/runtime-version probes with a short timeout. It does not
modify, delete, or execute project files.
