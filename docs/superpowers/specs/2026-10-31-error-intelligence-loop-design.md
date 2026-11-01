# Error Intelligence Loop — Design

- **Date:** 2026-10-31
- **Status:** Approved by partner — 2026-10-31
- **Scope:** opencode-error-explainer v0.5.0 (target)

## Intent and why

Today the plugin is reactive and terminal-scoped: a terminal command fails →
it is classified → a one-shot explanation is appended for the model → a
Sentry-style event is persisted locally. The accumulated knowledge (history,
frequency index) is never fed back into anything.

The partner's vision: **errors become an asset that improves the running
loop** — the model, the agent, and the task in progress — delivered live
in-session so the agent can act on it autonomously. The governing principle,
stated verbatim by the partner: the help must be **relevant to the agent and
must not slow it down** ("relevante y no entorpecer").

OpenCode v2's event bus makes model/agent-layer errors observable through a
read-only subscription (`ctx.event.subscribe`) with zero added latency on the
model-call path. That is the enabling fact for this design.

## Goals

1. **Repeated errors teach.** From the 2nd occurrence of the same error
   fingerprint within a session, the injection becomes a one-line lesson:
   what failed, how many times, and what worked the last time a fix succeeded.
2. **Model/agent-layer errors are captured and explained.** Subscribe to the
   event bus: `session.execution.failed`, `session.retry.scheduled`,
   `session.compaction.failed`, `permission.replied` (deny outcome),
   `session.shell.ended` (non-zero exit). Each flows through the existing
   classify → explain → persist pipeline.
3. **Shell commands outside tools become visible.** `session.shell.started` /
   `session.shell.ended` are recorded as breadcrumbs; failed ones classified.
4. **Cross-session task memory.** On session creation in a known worktree,
   inject a compact digest of that worktree's recent error history (capped).
5. **One pipeline for everything.** New sources emit the same internal signal
   shape the terminal path already uses; classifier, redaction, persistence,
   and the `explain_error` tool work on them unchanged.
6. **Still 100% local.** Nothing is ever transmitted. Redaction covers every
   new field.

## Non-goals

- No SDK wrapping via the `aisdk` domain (rejected: touches every model call;
  latency and failure risk contradicts the governing principle).
- No raw PTY reading via `experimental.terminal` (fragile, experimental).
- No migration to the `storage` domain (adds nothing for the agent).
- No dashboards or human-facing reports — all value is agent-facing.
- No auto-executing fixes. Advice only; the agent decides.

## Anti-goals (failure even if it technically works)

- **Noise.** More than a brief line per error; lessons on every occurrence;
  an uncapped session-start digest; duplicate injections of the same event.
- **Latency** anywhere on the model-call path.
- **Any data leaving the machine.**

## Constraints

- `@opencode/plugin` >=2.0.0 <3; Node >=22; ESM; no new runtime dependencies.
- The event bus is read-only: we can observe but not modify events.
- Injection surfaces available to a plugin: (a) mutation of tool results in
  `tool.execute.after` (existing mechanism), (b) the session prompt hook
  (`PromptInput.Prompt` is mutable in the SDK's hook types — verify exact
  registration name against the installed SDK), (c) `session.prompt(...)` to
  send a message into the session (used today by `/explain`).
- A bus-only error (e.g. provider retry) happens outside any tool call, so its
  guidance cannot be injected at that instant; it must be delivered deferred
  (see Delivery below).
- Config must stay backward compatible; every new behavior has an off switch.

## Approaches considered

**A — Deepen the loop on what is already captured (terminal only).**
Escalation policy + lessons + session-start memory. Cheapest, zero new risk,
but leaves the model level blind — the partner explicitly named that level.

**B — A + model/agent-layer errors via the event bus. (CHOSEN)**
Everything in A plus a read-only subscription capturing execution failures,
retries, compaction failures, permission denials, and session shell commands,
all feeding the existing pipeline. Covers model, agent, and task levels with
one new mechanism that cannot add latency to model calls. Cost: more event
volume that must be filtered with discipline (hence the hard noise rules).

**C — Full suite (B + `aisdk` wrapping + PTY reading + `storage` migration).**
Rejected: `aisdk` wrapping touches the model-call path; `experimental.terminal`
is fragile; `storage` migration is agent-value-neutral. All three work against
the governing principle or add maintenance for no agent benefit.

Partner picked **B** on 2026-10-31.

## Design

### 1. Event subscription layer — new `src/events/`

A single module owns the bus wiring:

- `subscribeBus(ctx, deps)` registers one `ctx.event.subscribe(...)` handler.
- Maps each subscribed event type to the internal signal shape already
  consumed by the pipeline (tool, command, text, sessionID, source).
- Unknown or malformed payloads are dropped silently with a debug log —
  never throw from a bus handler.
- Subscribed types: `session.execution.failed`, `session.retry.scheduled`,
  `session.compaction.failed`, `permission.asked`, `permission.replied`,
  `session.shell.started`, `session.shell.ended`, `session.created`.
- `permission.replied` alone carries only `{sessionID, requestID, reply}` —
  nothing to classify. The handler buffers `permission.asked` (full request)
  by `requestID` and joins on reply; only deny outcomes (`"reject"`) proceed
  to classification.
- **Correlation/dedup (mandatory):** the shell service's own metadata suggests
  the agent's terminal tool may route through it, in which case a failed agent
  command emits BOTH `tool.execute.after` and `session.shell.ended`. The
  handler dedups bus shell signals against recently-seen tool signals keyed on
  (command, exit code, time window), tool source taking precedence. If the
  events never overlap, the dedup layer is a harmless no-op.

### 2. New pattern families — extend `src/classify/patterns.ts`

- **Provider:** 429/rate limit, 401/403 auth, context-length exceeded,
  overloaded (529/503), generic provider abort.
- **Compaction:** `session.compaction.failed` payloads.
- **Permission denied:** deny outcome on `permission.replied` — explain what
  was denied and the likely cause (path outside worktree, untrusted command).
- **Shell (non-tool):** reuse the shell pattern family (`command not found`,
  etc.) — the classifier is already text-based and domain-agnostic.

### 3. Escalation & lessons policy — extend the injection path

- **1st occurrence** of a fingerprint in a session: current concise diagnosis
  (unchanged behavior).
- **2nd+ occurrence:** diagnosis line becomes a lesson line —
  `[Error Explainer] 3rd ENOENT in this session; last resolved by: <one line>`
  where the resolution is taken from the most recent event of the same
  fingerprint followed by a successful run. **Resolution scope (settled):**
  in-session only for v0.5.0 — derived from the in-memory trail (same command
  later completed); no new persistence. Cross-session resolution memory is a
  documented future extension, not in this release. No known resolution →
  say so in the same line; never fabricate.
- **Hard caps:** one injection per error event; lessons never repeat the
  full explanation; max one lesson line per tool result.

### 4. Delivery for bus-only errors — pending-note queue

- On a bus-only error signal: classify, persist, and enqueue a pending note
  (per session, deduped by fingerprint).
- **Primary delivery: the session prompt hook** (`ctx.session.hook("prompt")`
  — verified present in @opencode/plugin 2.0.26; `PromptInput.Prompt` is
  mutable). The note is prepended to the next prompt already being submitted —
  nothing new is sent, nothing is interrupted. Ride-along on the next terminal
  injection remains the fallback if the hook is unavailable.
- This ordering matters because failed tool calls return `status: "error"`
  and have no writable result — ride-along alone would almost never surface.
- A pending note never spawns its own session message: no `session.prompt()`
  calls from the bus path — that would interrupt the agent.

### 5. Session-start digest — worktree memory

- On `session.created` for a worktree with persisted history: inject a digest
  of the top recurring fingerprints (max 8 lines), e.g.
  `Prior errors in this worktree: npm test failing on 2 files (12×), tsc enum error (3×)`.
- **Subagent sessions (settled): main sessions only.** `session.created`
  fires for subagent sessions too; the digest is delivered only to
  root/parentless sessions so parallel subagents stay noise-free.
- Digest is capped, sorted by frequency × recency, and only present when there
  is history. Delivered through the prompt hook (§4), so session creation is
  never blocked.

### 6. Breadcrumbs enrichment

- `session.shell.started/ended` and `permission.replied` are recorded into the
  existing trail (`createTrail`), giving the persisted Sentry-style events
  context the plugin could not see before (commands run outside tools,
  denied actions).
- The stale code comment in `src/index.ts` ("V2 has no message-read API…")
  is updated to reflect the new sources.

### 7. Config additions — `src/config.ts`

| Option            | Default | Effect                                                             |
| ----------------- | ------- | ------------------------------------------------------------------ |
| `captureEvents`   | `true`  | Master switch for the bus subscription                             |
| `lessonThreshold` | `2`     | Occurrence count that triggers lesson lines (`1` disables lessons) |
| `sessionMemory`   | `true`  | Session-start digest on/off                                        |

All documented in README with the V2 `plugins` options form.

### 8. Persistence impact

- Each captured bus event becomes a full Sentry-grade event, with a new
  `extra.source` value (`"event-bus"`, alongside today's `"tool"`).
- Fingerprinting, grouping, history ring, and the frequency index work
  unchanged; `explain_error` recall and `/explain` see the new events too.
- Secret redaction applies to every new field (permission metadata, shell
  commands, provider error text).

## Noise contract (binding rules)

1. One brief injection per error event. No full outputs, no raw dumps.
2. Lesson lines only from the configured threshold, one per tool result.
3. Session digest ≤ 8 lines, once per session.
4. Nothing is ever sent into the session on the plugin's own initiative: all
   injections either ride an existing tool result or are prepended to a prompt
   already being submitted (prompt hook). No `session.prompt()` calls, ever.
5. Every behavior above is independently switchable.

## Testing sketch

- Unit: event → signal mapper (per event type, malformed payloads); lesson
  escalation policy (1st/2nd/3rd, no-known-resolution path); pending-note
  dedup and delivery; digest builder (cap, sort, empty history).
- Integration: bus subscription wiring against a fake `ctx.event`; a failed
  shell event producing a persisted event with `source: "event-bus"`.
- Existing suite must stay green; no behavior change when all new options are
  off except the trail gaining shell/permission breadcrumbs.

## What's left to the builder

- Exact payload shapes of each bus event (read `@opencode/schema` at build
  time; the manifest is versioned — code defensively against optionals).
- Regex details for each new pattern family; follow CONTRIBUTING conventions.
- Wiring order in `setup()` (subscription after trail creation).
- Changelog + README updates; version bump to 0.5.0.

## Decisions made by the assistant (corrigible by the partner)

- Digest and events ON by default (value must be visible; each has an off
  switch) rather than opt-in.
- Lesson threshold 2; digest cap 8 lines.
- Pending notes never interrupt the session on their own; prompt hook is the
  primary delivery (verified present in SDK 2.0.26), ride-along the fallback.
- Lesson resolution: in-session only for 0.5.0; cross-session store is a
  future extension.
- Session digest: main (root/parentless) sessions only.
- Dedup layer for shell events vs. terminal tool events (assumes overlap;
  no-op if none) — settled defensively rather than empirically.
- `permission.asked` + `permission.replied` joined by `requestID`; only
  deny outcomes are classified.
- Per-worktree memory only (no cross-worktree correlation).
- Target version 0.5.0.
