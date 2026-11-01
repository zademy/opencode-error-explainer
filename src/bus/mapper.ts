/**
 * Pure mapping from raw OpenCode event-bus events to internal effects.
 *
 * No I/O, no throwing: malformed or unknown events are dropped silently and
 * the caller never sees an exception. Payload field access is defensive —
 * the bus schema is versioned, so every field is treated as optional.
 *
 * Handles both `{ type, properties }` envelopes and flat `{ type, ... }`
 * payloads (see {@link normalize}).
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
  /** permission.asked buffered by requestID until permission.replied arrives. */
  readonly permissionAsks: Map<
    string,
    { sessionID: string; action: string; resources: readonly string[] }
  >;
  /** Sessions already digest-marked (session.created fires once; guard anyway). */
  readonly digestDone: Set<string>;
}

export function createBusState(): BusState {
  return { permissionAsks: new Map(), digestDone: new Set() };
}

interface NormalizedEvent {
  readonly kind: string;
  readonly props: Readonly<Record<string, unknown>>;
}

/** Accept `{ type, properties }` envelopes and flat `{ type, ...payload }`. */
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
  const props =
    e.properties && typeof e.properties === "object"
      ? (e.properties as Record<string, unknown>)
      : e;
  return { kind: rawType, props };
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
        const requestID = str(props.requestID);
        const action = str(props.action);
        if (!sessionID || !requestID || !action) return [];
        const resources = Array.isArray(props.resources)
          ? props.resources.filter((r): r is string => typeof r === "string")
          : [];
        state.permissionAsks.set(requestID, { sessionID, action, resources });
        return [];
      }

      case "permission.replied": {
        const requestID = str(props.requestID);
        // Reply literals per @opencode/schema: "once" | "always" | "reject".
        if (props.reply !== "reject" || !requestID) return [];
        const asked = state.permissionAsks.get(requestID);
        state.permissionAsks.delete(requestID);
        if (!asked) return [];
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

      case "session.shell.started": {
        const command = str(props.command);
        if (!sessionID || !command) return [];
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

      case "session.shell.ended": {
        const command = str(props.command);
        if (!sessionID || !command) return [];
        const exit = typeof props.exitCode === "number" ? props.exitCode : null;
        const output = str(props.output) ?? "";
        const failed = exit !== null && exit !== 0;
        const effects: BusEffect[] = [
          {
            type: "breadcrumb",
            sessionID,
            tool: "session.shell",
            command,
            status: failed ? "error" : "ok",
            message: failed ? `exit ${exit}` : "",
          },
        ];
        if (failed) {
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
