/**
 * Reading v2 tool events.
 *
 * v2 types a tool event as one mutable object: `input` is `unknown`, and a
 * completed call carries its text in either `result.output` or `result.content`
 * depending on the tool. These helpers are the single place that knows those
 * shapes, so the entry point stays pure wiring.
 */

/** One block of a structured tool result. */
export interface ContentPart {
  type: string;
  text?: string;
}

/** `Array.isArray` widens a readonly array to `any[]`; this keeps the element type. */
function isContentArray(value: unknown): value is readonly ContentPart[] {
  return Array.isArray(value);
}

/** Structural subset of v2 tool results. */
export interface ToolResultLike {
  output?: unknown;
  content?: string | readonly ContentPart[];
  metadata?: Record<string, unknown>;
}

/** Narrow an untyped tool input to an args object. */
export function argsOf(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null
    ? (input as Record<string, unknown>)
    : {};
}

/** The shell command a tool was asked to run, or "" for non-shell tools. */
export function commandOf(input: unknown): string {
  const command = argsOf(input).command;
  return typeof command === "string" ? command : "";
}

/** Human-readable text of a tool result, whatever slot the tool used. */
export function resultText(result: ToolResultLike): string {
  if (typeof result.output === "string") return result.output;
  if (typeof result.content === "string") return result.content;
  if (Array.isArray(result.content)) return contentText(result.content);
  if (result.output != null) {
    try {
      return JSON.stringify(result.output);
    } catch {
      /* circular — fall through to empty */
    }
  }
  return "";
}

/** Append text without disturbing whichever slot the result already uses. */
export function withAppended(
  result: ToolResultLike,
  appended: string,
): ToolResultLike {
  if (typeof result.output === "string") {
    return { ...result, output: result.output + appended };
  }
  if (typeof result.content === "string") {
    return { ...result, content: result.content + appended };
  }
  if (isContentArray(result.content)) {
    const parts: ContentPart[] = [...result.content];
    const last = parts[parts.length - 1];
    if (last && typeof last.text === "string") {
      parts[parts.length - 1] = { ...last, text: last.text + appended };
    } else {
      parts.push({ type: "text", text: appended });
    }
    return { ...result, content: parts };
  }
  // Fall back to content, never output: v2 rejects an `output` the tool did
  // not declare a schema for.
  return { ...result, content: appended.trim() };
}

function contentText(
  parts: readonly { type: string; text?: string }[],
): string {
  return parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}
