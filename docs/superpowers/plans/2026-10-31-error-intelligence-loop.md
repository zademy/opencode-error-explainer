# Implementation Plan — Error Intelligence Loop (v0.5.0)

- **Date:** 2026-10-31
- **PRD:** `docs/superpowers/specs/2026-10-31-error-intelligence-loop-design.md` (approved)
- **Target version:** 0.5.0 (package.json + src/version.ts)
- **Branch:** work from `develop`

## For the implementer

You have not seen this codebase. It is an OpenCode v2 plugin (TypeScript,
ESM, Node ≥22, zero runtime deps, vitest). Everything you need about intent
and constraints is in the PRD above; this plan gives you the decisions you
cannot make alone: files, names, signatures, and the test that proves each
task. Where a signature is shown, use it verbatim.

**Naming note:** the PRD says the new module is `src/events/`. It is actually
`src/bus/` — `src/event/` already exists (Sentry-event building: assemble,
fingerprint, render, types). Do not touch `src/event/` except where a task
says so.

## Global constraints (apply to every task)

- ESM project: relative imports end in `.js` (see any existing file).
- **Never throw from a hook or bus handler.** Catch, log, return. A broken
  plugin must never break the host session.
- **100% local.** Nothing leaves the machine. Secret redaction
  (`redactSecrets` from `src/enrich/redact.ts`) applies to every string
  persisted from a new source.
- **Noise contract (PRD §Noise):** one brief injection per error event; lesson
  lines only from `lessonThreshold`; digest ≤ 8 lines once per session; no
  `session.prompt()` calls from the bus path, ever.
- Every new behavior is independently switchable via config.
- Style: `readonly` interface fields, header doc comments, no `any` in new
  exported types (mirror existing files).
- Commits: one per task, conventional style, English.
- Verify each task with: `npm run typecheck:all && npm test` (suite is fast;
  run it fully every task). Lint at the end of each task: `npm run lint`.
- Bus payload field names: defensive access everywhere. The event bus
  payloads are versioned (`@opencode/schema`); treat every field as optional
  and drop malformed events silently. Read
  `node_modules/@opencode/schema/dist/*.d.ts` when you need the real shapes —
  but never depend on a field existing.

## Existing interfaces you will reuse (do not change)

```ts
// src/classify/engine.ts
classifyError(output: string, command: string, patterns: readonly ErrorPattern[],
              ctxStack?: string, stacks?: readonly Stack[] | null): Classification | null
looksLikeError(output: string): boolean

// src/classify/types.ts
interface ErrorPattern { id; stack: Stack; type; severity; pattern: RegExp;
                         suggestion: string; nextSteps?; extractors? }
interface Classification { id; stack; type; severity; suggestion; nextSteps;
                           command; matchedLines; raw; timestamp }

// src/breadcrumbs/trail.ts
interface BreadcrumbTrail { record(entry: ToolCallEntry): void;
  snapshot(sessionID, excludeCallID, limit): readonly Breadcrumb[] }
createTrail(): BreadcrumbTrail

// src/persist/frequency.ts   — index.json maps fingerprint → { first_seen, last_seen, times_seen }
readIndex(dir: string): Promise<FrequencyIndex>
recordFrequency(dir, fingerprint, timestamp, onError?): Promise<Frequency>

// src/persist/history.ts — appendHistory(...) ring buffer (see file for exact args)
// src/persist/writer.ts  — writeEvent(...) writes last-error.{md,json} (see file)
// src/event/assemble.ts  — assembleEvent(...) builds the SentryGradeEvent (see file)
// src/event/fingerprint.ts — fingerprintOf(...)
// src/hooks/tool-after.ts — createToolAfterHandler(deps: HookDeps)
// src/config.ts — PluginOptions, DEFAULT_OPTIONS, resolveOptions(raw)
```

The host plugin context (`src/index.ts` `setup(ctx)`) exposes, among others:
`ctx.event.subscribe(cb)` (unfiltered event stream, read-only),
`ctx.session.hook("prompt", cb)` (session prompts; the `PromptInput.Prompt`
object is mutable — verified in `@opencode/plugin` 2.0.26,
`dist/effect/session.d.ts` `SessionHooks`), `ctx.tool`, `ctx.command`.

---

## Task 1 — Config: three new options

**What:** `captureEvents`, `lessonThreshold`, `sessionMemory` in
`PluginOptions` + `resolveOptions`, with defaults `true`, `2`, `true`.

**Files:** `src/config.ts`; tests in `test/config.test.ts` (create if absent).

**Interfaces:**

```ts
// add to PluginOptions (group under a "── v0.5 event bus ──" comment, mirroring v0.2's)
/** Subscribe to the OpenCode event bus (model/agent-layer errors, shell, permissions). */
readonly captureEvents: boolean;
/** Occurrence count that turns a diagnosis line into a lesson line. 1 disables lessons. */
readonly lessonThreshold: number;
/** Inject a capped digest of the worktree's prior errors at session start (main sessions only). */
readonly sessionMemory: boolean;
```

Resolve with the existing `asBool` / `asPositiveInt` helpers. `lessonThreshold`
uses `asPositiveInt(raw.lessonThreshold, 2)`; clamp `1` stays `1` (means off).

**Tests:** defaults when raw empty; explicit values accepted; `lessonThreshold:
0` → falls back to `2` (asPositiveInt rejects 0); invalid types fall back
silently.

**Commit:** `feat(config): add captureEvents, lessonThreshold, sessionMemory options`

---

## Task 2 — Pattern families: provider, compaction, permission-denied

**What:** extend `BUILT_IN_PATTERNS` in `src/classify/patterns.ts`. The
classifier is text-based; these fire on bus error text AND on any terminal
output containing the same signatures.

**Patterns (exact ids):**

- `provider_rate_limited` (stack `generic`, severity `warning`): matches
  `429`, `rate limit` / `rate limited` / `too many requests`. Suggestion: back
  off and retry; the provider is throttling.
- `provider_auth_failed` (severity `error`): `401` / `403` + `api key` /
  `unauthorized` / `forbidden` context. Suggestion: check credentials.
- `provider_context_overflow` (severity `error`): `context length` /
  `context window` / `maximum context`. Suggestion: compact the session or
  split the task.
- `provider_overloaded` (severity `warning`): `529` / `overloaded` /
  `503`. Suggestion: retry shortly or switch model.
- `compaction_failed` (severity `error`): `compaction failed` /
  `compact.*failed`. Suggestion: free tokens by starting a new session.
- `permission_denied` (severity `warning`): `permission` + `denied|rejected`.
  Suggestion: the action was outside what the agent may do; check path
  confinement or ask the user.

Each follows the existing `ErrorPattern` shape (`nextSteps: 2 short items`).
Keep regexes anchored to whole phrases, case-insensitive flags like existing
entries.

**Files:** `src/classify/patterns.ts`; tests appended to
`test/patterns.test.ts`.

**Tests:** one case per pattern (positive match + expected suggestion
substrings); a negative case (e.g. `403` in a URL must not trip
`provider_auth_failed` — use a word-boundary or context requirement).

**Commit:** `feat(classify): provider, compaction, and permission-denied pattern families`

---

## Task 3 — Bus types, state, and mapper

**What:** pure mapping from raw bus events to internal effects. No I/O.

**Files (new):** `src/bus/types.ts`, `src/bus/mapper.ts`; test
`test/bus-mapper.test.ts`.

**Interfaces:**

```ts
// src/bus/types.ts
export type BusSignalKind =
  | "execution-failed"
  | "retry-scheduled"
  | "compaction-failed"
  | "permission-denied"
  | "shell-failed";

export interface BusSignal {
  readonly sessionID: string;
  readonly kind: BusSignalKind;
  /** Command involved, "" when not applicable. */
  readonly command: string;
  /** Error text to classify. */
  readonly text: string;
  /** Shell exit code when known. */
  readonly exitCode: number | null;
}

// src/bus/mapper.ts
export type BusEffect =
  | { readonly type: "signal"; readonly signal: BusSignal }
  | {
      readonly type: "breadcrumb";
      readonly sessionID: string;
      readonly tool: string;
      readonly command: string;
      readonly status: string;
      readonly message: string;
    }
  | { readonly type: "digest-pending"; readonly sessionID: string };

export interface BusState {
  /** permission.asked buffered by requestID until permission.replied arrives. */
  readonly permissionAsks: Map<
    string,
    { sessionID: string; action: string; resources: readonly string[] }
  >;
  /** Sessions already digest-marked (session.created fires once; guard anyway). */
  readonly digestDone: Set<string>;
}
export function createBusState(): BusState;
export function mapBusEvent(
  event: unknown,
  state: BusState,
): readonly BusEffect[];
```

**Mapping rules:**

- `session.execution.failed` / `session.retry.scheduled` /
  `session.compaction.failed` → `signal` with the event's error message text
  (defensive: any missing field → drop, return `[]`).
- `permission.asked` → buffer into `state.permissionAsks`; no effect.
- `permission.replied` with a deny reply (`"reject"` or falsy-accept — verify
  the literal against `@opencode/schema` permission schema; only proceeds on
  deny) → join with the buffer → `signal` kind `permission-denied`, text =
  `permission denied: ${action} ${resources.join(" ")}`. Buffer miss → `[]`.
- `session.shell.started` → `breadcrumb` (status `"running"`).
- `session.shell.ended` with non-zero exit → `signal` kind `shell-failed`
  (text = tail of output, last 50 lines) AND `breadcrumb` status `"error"`;
  zero exit → `breadcrumb` status `"ok"` only.
- `session.created` → `digest-pending` (mapper does NOT filter subagents;
  the prompt hook does — see Task 9).
- Every other event type → `[]`. The raw event shape: assume
  `{ type: string, properties: {...} }` — confirm against
  `@opencode/client` event types at build time and access fields defensively.
- Never access `state` beyond the documented fields; never mutate anything
  else.

**Tests:** one fixture per event type (hand-written minimal payloads);
malformed payload (missing `properties`, wrong types) → `[]` and no throw;
`permission.replied` without prior `permission.asked` → `[]`; shell
zero-exit → breadcrumb only; unknown type → `[]`; duplicate
`session.created` for same session → single `digest-pending`.

**Commit:** `feat(bus): event-to-signal mapper with permission join and defensive parsing`

---

## Task 4 — Deduper (tool vs shell double-capture)

**What:** guards against a failed agent command arriving twice (terminal tool
`execute.after` AND `session.shell.ended`) — PRD §1 correlation layer.

**Files (new):** `src/bus/dedupe.ts`; test `test/bus-dedupe.test.ts`.

**Interface:**

```ts
export interface Deduper {
  /** Called by the terminal-tool path whenever it classifies an error. */
  recordToolError(command: string): void;
  /** True when a bus shell signal repeats a recently recorded tool error. */
  isDuplicate(command: string): boolean;
}
export function createDeduper(windowMs?: number): Deduper; // default 5000
```

In-memory `Map<string, number>` (command → last-seen ms), pruned lazily on
each call. Same command twice inside the window from the SAME source is NOT a
duplicate concern here — only bus-vs-tool overlap uses `isDuplicate`.

**Tests:** record then check inside window → `true`; after window expires
(use `windowMs: 20` and a real 25 ms sleep — vitest fake timers also fine) →
`false`; different commands never collide; empty command string is never
deduped.

**Commit:** `feat(bus): tool/shell double-capture deduper`

---

## Task 5 — Lesson policy

**What:** per-session occurrence counting + lesson-line building (PRD §3).
In-session only for 0.5.0.

**Files (new):** `src/enrich/lessons.ts`; test `test/lessons.test.ts`.

**Interface:**

```ts
export interface LessonPolicy {
  /** Record an occurrence; returns the count INCLUDING this one. */
  count(sessionID: string, fingerprint: string): number;
  /** Record that `command` later completed successfully (resolution source). */
  markSuccess(sessionID: string, command: string): void;
  /** "re-running <command> succeeded" when a success was recorded, else null. */
  resolutionFor(sessionID: string, command: string): string | null;
  /**
   * Lesson line for repeat occurrences; null when count < threshold.
   * Format: `[Error Explainer] 3rd <type> in this session; last resolved by: <resolution>`
   * or `... ; no known resolution yet` when resolution is null.
   */
  lessonLine(input: {
    count: number;
    type: string;
    command: string;
    resolution: string | null;
  }): string | null;
}
export function createLessonPolicy(threshold: number): LessonPolicy;
```

Ordinals: 2nd, 3rd, 4th… (`${n}th` beyond 3 is fine). Cap stored resolutions
per session (Map, ≤ 50 entries — prune oldest).

**Tests:** first occurrence → `lessonLine` null with threshold 2; second →
line with correct ordinal; resolution flows through `markSuccess` →
`resolutionFor`; `resolutionFor` without success → null → line says "no known
resolution yet"; threshold 1 → line on first occurrence; sessions isolated.

**Commit:** `feat(enrich): per-session lesson policy for repeat errors`

---

## Task 6 — Pending-note queue

**What:** per-session deduped queue of one-liners awaiting delivery (PRD §4).

**Files (new):** `src/bus/pending.ts`; test `test/bus-pending.test.ts`.

**Interface:**

```ts
export interface PendingNotes {
  /** Returns false when an identical line is already queued for the session. */
  enqueue(sessionID: string, line: string): boolean;
  /** Removes and returns all lines for the session (oldest first). */
  drain(sessionID: string): readonly string[];
}
export function createPendingNotes(): PendingNotes;
```

Cap: 10 lines per session (drop newest beyond cap, log via injected
`log?` — add it to the factory args).

**Tests:** enqueue/drain; duplicate line not re-queued; drain empties;
independent sessions; cap drops beyond 10.

**Commit:** `feat(bus): per-session pending-note queue`

---

## Task 7 — Bus pipeline (classify → persist → pending note)

**What:** runs a `BusSignal` through the same persist path the terminal
handler uses, then enqueues the delivery note.

**Files (new):** `src/bus/pipeline.ts`; test `test/bus-pipeline.test.ts`.

**Interface:**

```ts
export interface BusPipelineDeps {
  readonly patterns: readonly ErrorPattern[];
  readonly options: PluginOptions;
  readonly outputDir: string | null;
  readonly version: string;
  readonly worktree: string | null;
  readonly sdkVersion: string | null;
  readonly lessons: LessonPolicy;
  readonly pending: PendingNotes;
  readonly log?: (msg: string) => void;
}
export function createBusPipeline(
  deps: BusPipelineDeps,
): (signal: BusSignal) => Promise<void>;
```

Behavior: classify with `classifyError(signal.text, signal.command, deps.patterns)`;
`null` → return. Fingerprint via `fingerprintOf`. `lessons.count(...)`;
`lessonLine` (resolution from `lessons.resolutionFor(sessionID, command)`); if
non-null `pending.enqueue(sessionID, line)`. Persist when `outputDir`:
`assembleEvent` (minimal — command/text, `extra.source: "event-bus"`,
breadcrumbs none, git/os context may be omitted; check `assemble.ts`'s input
type and pass what it requires), redact with `redactSecrets` when
`options.redact` (every string you set), then `writeEvent`,
`recordFrequency`, `appendHistory` (mirror `tool-after.ts`'s call shapes).
The whole body is one try/catch → log, never rethrow.

**Tests:** (tmp dir via `fs.mkdtemp` in the system temp dir, cleaned in
`afterEach`) error signal → files written + note enqueued;
`lessonThreshold: 1` off → no note; non-error text → nothing persisted;
pipeline never throws even when `outputDir` is an unwritable path.

**Commit:** `feat(bus): persist pipeline for bus signals with lesson notes`

---

## Task 8 — Session-start digest

**What:** capped digest of the worktree's recurring errors (PRD §5).

**Files (new):** `src/bus/digest.ts`; test `test/bus-digest.test.ts`.

**Interface:**

```ts
/**
 * Top recurring fingerprints (max `cap` lines, default 8), sorted by
 * times_seen desc, then last_seen desc. Labels come from joining the
 * frequency index with the history ring (fingerprint → event type/command).
 * Returns null when there is no usable history.
 */
export async function buildDigest(
  dir: string,
  cap?: number,
): Promise<string | null>;
```

Implementation: `readIndex(dir)` for counts; read the history file for labels
(check `src/persist/history.ts` for its filename and entry shape; parse
defensively exactly like `readIndex` does — corrupt → empty). A fingerprint
without a label renders as `unclassified error (fingerprint <first 8 chars>)`.
Line format: `<label> (<times_seen>×)`.

**Tests:** seeded index + history → correct order and cap; empty dir → null;
corrupt index file → null (no throw); cap respected.

**Commit:** `feat(bus): worktree error-history digest for session start`

---

## Task 9 — Prompt-hook delivery

**What:** primary delivery for pending notes and the digest — prepended to a
prompt already being submitted (PRD §4). Nothing is ever sent on its own.

**Files (new):** `src/hooks/prompt.ts`; test `test/prompt-hook.test.ts`.

**Interface:**

```ts
export interface PromptHookDeps {
  readonly options: PluginOptions;
  readonly pending: PendingNotes;
  /** Build the digest for this worktree (injected: () => buildDigest(outputDir)). */
  readonly digest: () => Promise<string | null>;
  /** True when the session should receive the digest (main sessions only). */
  readonly isMainSession: (sessionID: string) => Promise<boolean>;
  readonly log?: (msg: string) => void;
}
export function createPromptHook(
  deps: PromptHookDeps,
): (input: { sessionID: string; prompt: unknown }) => Promise<void>;
```

Behavior: drain `pending` lines for the session → prepend to the prompt.
Digest: only on the first prompt per session (own `Set`), only when
`options.sessionMemory` and `isMainSession(sessionID)` resolve true; prepend
as a block:

```
[Error Explainer] Prior errors in this worktree:
<line 1>
<line 2>
```

Mutating the prompt: `PromptInput.Prompt` (see
`node_modules/@opencode/schema/dist/prompt-input.d.ts`) — find its text-
bearing part (e.g. `parts[]` entries with `text`), and prepend to the FIRST
text-bearing part. If the shape does not match expectations at runtime, log
and skip (never throw). Whole body try/catch.

`isMainSession` is injected so tests stay pure; in Task 11 it is wired as
`ctx.session.get(sessionID)` → session without a parent/subagent field (read
`@opencode/schema/dist/session.d.ts` for the exact field name; sessions with
no such field → treat as main).

**Tests:** pending lines prepended; digest once per session, not on second
prompt; `sessionMemory: false` → no digest block; `isMainSession` false → no
digest but pending lines still delivered; unexpected prompt shape → no throw.

**Commit:** `feat(hooks): prompt-hook delivery for pending notes and session digest`

---

## Task 10 — Terminal-tool path: lessons + dedup record + ride-along

**What:** wire the existing `createToolAfterHandler` into the new systems
without changing default output (PRD §3, §4 fallback).

**Files:** `src/hooks/tool-after.ts`; `src/index.ts` (pass new deps); tests
`test/tool-after.test.ts`.

Changes, all behind the existing options:

1. `HookDeps` gains `readonly lessons: LessonPolicy | null`,
   `readonly deduper: Deduper | null`,
   `readonly pending: PendingNotes | null` (null = feature off — keep unit
   tests constructing `HookDeps` compiling by updating them).
2. On a classified error: `deduper?.recordToolError(command)`; `count =
lessons?.count(sessionID, fingerprint)`; if `lessonLine(...) !== null`,
   the appended block's first line becomes the lesson line (keep the rest of
   the existing append format unchanged below it).
3. On a terminal command that does NOT look like an error:
   `lessons?.markSuccess(sessionID, command)` (cheap; before the existing
   early return).
4. Ride-along fallback: if `pending` has lines for the session, prepend them
   above the existing diagnosis block (they are one-liners; cap at 3).

Default behavior with `lessonThreshold: 2` and no repeats is byte-identical
to today (regression: existing tests must pass untouched except for the
`HookDeps` constructor additions).

**Tests:** repeat error (call handler twice with same failing output) →
second append contains the lesson line and ordinal; success command then
error → resolution appears; pending lines ride along above diagnosis;
`lessons: null` → output unchanged.

**Commit:** `feat(hooks): lesson escalation, dedup recording, and pending ride-along in terminal path`

---

## Task 11 — Subscription wiring

**What:** the single bus entry point; consumes everything built so far.

**Files (new):** `src/bus/subscribe.ts`; `src/index.ts`; test
`test/bus-subscribe.test.ts`.

**Interface:**

```ts
export interface SubscribeDeps {
  readonly ctx: {
    readonly event: { readonly subscribe: (cb: (e: unknown) => void) => unknown };
    readonly session: { readonly hook: (name: "prompt", cb: (i: unknown) => Promise<void>) => unknown };
    readonly get?: ...
  };
  readonly patterns: readonly ErrorPattern[];
  readonly options: PluginOptions;
  readonly outputDir: string | null;
  readonly version: string;
  readonly worktree: string | null;
  readonly sdkVersion: string | null;
  readonly trail: BreadcrumbTrail | null;
  readonly lessons: LessonPolicy;
  readonly pending: PendingNotes;
  readonly deduper: Deduper;
  readonly log?: (msg: string) => void;
}
export function subscribeBus(deps: SubscribeDeps): void;
```

(Shape `ctx` narrowly as shown — it is what `src/index.ts` receives; type it
structurally so tests pass a fake.)

Behavior: build `BusState`, pipeline, prompt hook (with `isMainSession` from
`ctx.session.get` when present, else `async () => true`). Register
`ctx.session.hook("prompt", promptHook)`. Register one
`ctx.event.subscribe(handler)`; inside: try/catch EVERYTHING; `mapBusEvent`;
effects → breadcrumb: `trail?.record(...)` (adapt fields to `ToolCallEntry`:
synthetic `callID` via `crypto.randomUUID()`, `tool: "session.shell"`);
digest-pending: enqueue nothing here (the prompt hook builds the digest on
first prompt — `session.created` only needs to NOT error); signal:
shell-failed → `deduper.isDuplicate(command)` skip when true, else run
pipeline. Log at debug level, never rethrow.

`src/index.ts` wiring (inside `setup`, after trail creation, gated by
`options.enabled && options.captureEvents`): construct `lessons =
createLessonPolicy(options.lessonThreshold)`, `pending`, `deduper`; pass them
into `createToolAfterHandler` (Task 10 deps); call `subscribeBus`. Update the
stale `src/breadcrumbs/trail.ts` + `src/index.ts` header comments claiming
"V2 has no message-read API" to mention the bus sources.

**Tests:** fake `ctx` recording registrations → both registered once;
`session.shell.ended` fixture → breadcrumb recorded + pipeline called unless
duplicate; handler survives a pipeline rejection (no rethrow);
`captureEvents: false` path never subscribes (test via index-level unit or
exported guard `shouldSubscribe(options)` — add that tiny pure helper).

**Commit:** `feat(bus): subscribe to OpenCode event bus and wire prompt delivery`

---

## Task 12 — Docs and release prep

**What:** user-facing docs + version.

**Files:** `README.md`, `CHANGELOG.md`, `package.json` (0.5.0),
`src/version.ts`.

- README: add the three options to the configuration table; new section
  "Event bus capture" (what is captured, the noise contract, how to disable).
  Update the intro sentence to mention model/agent-layer errors.
- CHANGELOG: `## [0.5.0] - <date>` with Added entries mirroring PRD goals.
- Verify no other version constant drifts (`grep -rn "0\.4\.1" src README.md`).

**Verify (full):**
`npm run typecheck:all && npm test && npm run lint && npm run format:check`.

**Commit:** `docs: document event-bus capture and release 0.5.0`

---

## Review focus (input classes the tests must cover)

1. Malformed bus events (missing fields, wrong types) — Task 3, 7.
2. Exceptions inside bus/hook handlers never reaching the host — Tasks 7, 9, 11.
3. The double-capture overlap (tool + shell event, same command, ≤ 5 s) — Task 4, 11.
4. `permission.replied` arriving without a buffered `permission.asked` — Task 3.
5. Corrupt or empty persistence state (index/history) — Tasks 7, 8.

## Out of scope (do not build)

Cross-session resolution store, subagent digests, `aisdk` wrapping, PTY
reading, `storage` migration, dashboards — all per PRD non-goals.
