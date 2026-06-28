/**
 * Breadcrumbs: the most recent tool calls in the current session.
 *
 * Gathered from the opencode client (`client.session.messages`). Done
 * DEFENSIVELY: the host client surface isn't guaranteed across opencode
 * versions, so every access uses optional chaining and the whole call is
 * wrapped in try/catch. If anything is unavailable, breadcrumbs are simply
 * omitted — the event still builds without them.
 *
 * Local only: no network; the client talks to the in-process opencode server.
 */

import type { Breadcrumb } from "../event/types.js";

/** Loose structural view of an opencode SDK client (v1/v2 compatible). */
interface ClientLike {
  session?: {
    messages?: (params: {
      sessionID: string;
      limit?: number;
    }) => Promise<unknown>;
  };
}

interface ToolPartLike {
  type?: string;
  tool?: string;
  callID?: string;
  state?: {
    status?: string;
    input?: Record<string, unknown>;
    title?: string;
    error?: string;
    output?: string;
    time?: { start?: number; end?: number };
  };
  metadata?: Record<string, unknown>;
}

interface MessageLike {
  parts?: ToolPartLike[];
}

function toLevel(status: string | undefined): Breadcrumb["level"] {
  switch (status) {
    case "error":
      return "error";
    case "running":
      return "warning";
    default:
      return "info";
  }
}

function asIso(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms))
    return new Date(0).toISOString();
  return new Date(ms).toISOString();
}

function toBreadcrumb(part: ToolPartLike): Breadcrumb | null {
  if (part.type !== "tool") return null;
  const state = part.state ?? {};
  const command =
    typeof state.input?.command === "string" ? state.input.command : "";
  const status = state.status ?? "completed";
  const title = state.title ?? state.error ?? part.tool ?? "tool";
  return {
    timestamp: asIso(state.time?.end ?? state.time?.start),
    type: "default",
    category: "tool",
    level: toLevel(status),
    message: truncate(title, 160),
    data: {
      tool: part.tool ?? "?",
      command: truncate(command, 240),
      status,
    },
  };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * Collect up to `limit` breadcrumbs from the session, EXCLUDING the current tool
 * call (`excludeCallID`) so we only show what happened BEFORE this error.
 */
export async function gatherBreadcrumbs(
  client: unknown,
  sessionID: string,
  excludeCallID: string | undefined,
  limit: number,
): Promise<readonly Breadcrumb[]> {
  if (!client || limit <= 0) return [];
  const c = client as ClientLike;
  const messagesFn = c.session?.messages;
  if (typeof messagesFn !== "function") return [];

  let raw: unknown;
  try {
    raw = await messagesFn({ sessionID, limit: limit * 4 });
  } catch {
    return [];
  }

  const messages = normalizeMessages(raw);
  const parts: ToolPartLike[] = [];
  for (const msg of messages) {
    if (msg?.parts) parts.push(...msg.parts);
  }
  const filtered = parts
    .filter((p) => p.type === "tool" && p.callID !== excludeCallID)
    .map(toBreadcrumb)
    .filter((b): b is Breadcrumb => b !== null);
  return filtered.slice(-limit);
}

function normalizeMessages(raw: unknown): MessageLike[] {
  if (Array.isArray(raw))
    return raw.filter((x) => x && typeof x === "object") as MessageLike[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.data))
      return obj.data.filter(
        (x) => x && typeof x === "object",
      ) as MessageLike[];
    if (Array.isArray(obj.messages))
      return obj.messages.filter(
        (x) => x && typeof x === "object",
      ) as MessageLike[];
  }
  return [];
}
