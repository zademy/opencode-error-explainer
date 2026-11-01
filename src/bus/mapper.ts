/**
 * Pure mapping from raw OpenCode event-bus events to internal effects.
 *
 * No I/O, no throwing: malformed or unknown events are dropped silently and
 * the caller never sees an exception. Payload field access is defensive —
 * the bus schema is versioned, so every field is treated as optional.
 *
 * Real events (@opencode/plugin 2.2.5 V2Event) are envelopes:
 *   `{ id, created, metadata?, type, durable?, location?, data: { … } }`
 * with payload fields under `data`, `permission.asked` keyed by `data.id`
 * (replies carry `data.requestID`), and shell info nested under
 * `data.shell` (+ `data.output.output` on `session.shell.ended`). Older and
 * flat shapes (`properties` wrapper, or fields inline) are tolerated
 * defensively via {@link normalize}.
 */

import type { BusSignal, BusSignalKind } from "./types.js";

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
  /** permission.asked buffered by permission id until permission.replied arrives. */
  readonly permissionAsks: Map<
    string,
    { sessionID: string; action: string; resources: readonly string[] }
  >;
  /** Sessions already digest-marked (session.created fires once; guard anyway). */
  readonly digestDone: Set<string>;
}

const MAX_PERMISSION_ASKS = 50;

export function createBusState(): BusState {
  return { permissionAsks: new Map(), digestDone: new Set() };
}

interface NormalizedEvent {
  readonly kind: string;
  readonly props: Readonly<Record<string, unknown>>;
}

/** Accept `data` (real), `properties` (legacy assumption), or flat payloads. */
function normalize(event: unknown): NormalizedEvent | null {
  if (!event || typeof event !== "object") return null;
  const e = event as Record<string, unknown>;
  const rawType =
    typeof e.type === "string"
      ? e.type
      : e.properties &&
          typeof (e.properties as Record<string, unknown>).type === "string"
        ? ((e.properties as Record<string, unknown>).type as string)
        : null;
  if (!rawType) return null;
  for (const key of ["data", "properties"] as const) {
    const carrier = e[key];
    if (carrier && typeof carrier === "object") {
      return { kind: rawType, props: carrier as Record<string, unknown> };
    }
  }
  return { kind: rawType, props: e };
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function errMessage(props: Readonly<Record<string, unknown>>): string | null {
  const err = props.error;
  if (err && typeof err === "object") {
    const msg = str((err as Record<string, unknown>).message);
    if (msg) return msg;
  }
  return str(props.error);
}

function lastLines(text: string, max: number): string {
  const lines = text.split("\n");
  return lines.length <= max ? text : lines.slice(-max).join("\n");
}

const SHELL_OUTPUT_TAIL_LINES = 50;

/** Map one raw bus event to zero or more effects. Never throws. */
export function mapBusEvent(
  event: unknown,
  state: BusState,
): readonly BusEffect[] {
  const norm = normalize(event);
  if (!norm) return [];
  const { kind, props } = norm;
  const sessionID = str(props.sessionID);

  try {
    switch (kind) {
      case "session.execution.failed":
      case "session.retry.scheduled":
      case "session.compaction.failed": {
        const text = errMessage(props);
        if (!sessionID || !text) return [];
        const busKind: BusSignalKind =
          kind === "session.execution.failed"
            ? "execution-failed"
            : kind === "session.retry.scheduled"
              ? "retry-scheduled"
              : "compaction-failed";
        return [
          {
            type: "signal",
            signal: {
              sessionID,
              kind: busKind,
              command: "",
              text,
              exitCode: null,
            },
          },
        ];
      }

      case "permission.asked": {
        // asked carries the permission id as `data.id`.
        const permID = str(props.id) ?? str(props.requestID);
        const action = str(props.action);
        if (!sessionID || !permID || !action) return [];
        const resources = Array.isArray(props.resources)
          ? props.resources.filter((r): r is string => typeof r === "string")
          : [];
        if (state.permissionAsks.size >= MAX_PERMISSION_ASKS) {
          // Drop the oldest unanswered ask — stale entries only waste memory.
          const oldest = state.permissionAsks.keys().next().value;
          if (oldest !== undefined) state.permissionAsks.delete(oldest);
        }
        state.permissionAsks.set(permID, { sessionID, action, resources });
        return [];
      }

      case "permission.replied": {
        // Reply literals per @opencode/schema: "once" | "always" | "reject".
        const permID = str(props.requestID) ?? str(props.id);
        if (
          props.reply !== "reject" &&
          props.reply !== "once" &&
          props.reply !== "always"
        ) {
          return []; // unknown reply literal — leave the buffer alone
        }
        if (!permID) return [];
        const asked = state.permissionAsks.get(permID);
        state.permissionAsks.delete(permID); // any reply consumes the ask
        if (props.reply !== "reject" || !asked) return [];
        return [
          {
            type: "signal",
            signal: {
              sessionID: asked.sessionID,
              kind: "permission-denied",
              command: asked.action,
              text: `permission denied: ${asked.action} ${asked.resources.join(" ")}`.trim(),
              exitCode: null,
            },
          },
        ];
      }

      case "session.shell.started":
      case "session.shell.ended": {
        const shell =
          props.shell && typeof props.shell === "object"
            ? (props.shell as Record<string, unknown>)
            : null;
        const command = shell ? str(shell.command) : null;
        if (!sessionID || !shell || !command) return [];
        const status = str(shell.status);
        const exit = typeof shell.exit === "number" ? shell.exit : null;

        if (kind === "session.shell.started") {
          return [
            {
              type: "breadcrumb",
              sessionID,
              tool: "session.shell",
              command,
              status: "running",
              message: "",
            },
          ];
        }

        // Failure = timeout/killed status, or a non-zero exit.
        const failed =
          status === "timeout" ||
          status === "killed" ||
          (exit !== null && exit !== 0);
        const effects: BusEffect[] = [
          {
            type: "breadcrumb",
            sessionID,
            tool: "session.shell",
            command,
            status: failed ? "error" : "ok",
            message: failed
              ? status && status !== "exited"
                ? status
                : `exit ${exit}`
              : "",
          },
        ];
        if (failed) {
          const output =
            props.output && typeof props.output === "object"
              ? (str((props.output as Record<string, unknown>).output) ?? "")
              : "";
          effects.push({
            type: "signal",
            signal: {
              sessionID,
              kind: "shell-failed",
              command,
              text: lastLines(output, SHELL_OUTPUT_TAIL_LINES),
              exitCode: exit,
            },
          });
        }
        return effects;
      }

      case "session.created": {
        if (!sessionID || state.digestDone.has(sessionID)) return [];
        state.digestDone.add(sessionID);
        return [{ type: "digest-pending", sessionID }];
      }

      default:
        return [];
    }
  } catch {
    return [];
  }
}
