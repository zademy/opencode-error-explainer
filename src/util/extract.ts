/**
 * Serialization helpers for persisting a {@link Classification}.
 *
 * The raw output can be large; we cap it in the JSON artifact so history files
 * stay small and readable while the live `.md` report keeps a fuller excerpt.
 */

import type { Classification } from "../classify/types.js";

/** A plain (JSON-serializable) representation of a classification. */
export interface SerializableClassification {
  readonly plugin: "@zademy/opencode-error-explainer";
  readonly version: string;
  readonly id: string;
  readonly stack: string;
  readonly type: string;
  readonly severity: string;
  readonly suggestion: string;
  readonly nextSteps: readonly string[];
  readonly command: string;
  readonly matchedLines: readonly string[];
  readonly file: string | null;
  readonly line: number | null;
  readonly timestamp: string;
}

/** Max bytes of raw output retained inside the JSON artifact. */
const RAW_MAX_BYTES = 16_384;

/** Convert a Classification to a JSON-serializable object. */
export function toSerializable(
  c: Classification,
  version: string,
): SerializableClassification {
  return {
    plugin: "@zademy/opencode-error-explainer",
    version,
    id: c.id,
    stack: c.stack,
    type: c.type,
    severity: c.severity,
    suggestion: c.suggestion,
    nextSteps: c.nextSteps,
    command: c.command,
    matchedLines: c.matchedLines,
    file: c.file ?? null,
    line: c.line ?? null,
    timestamp: c.timestamp,
  };
}

/** Cap a blob of text to approximately `max` bytes on a UTF-8 boundary. */
export function cap(text: string, max: number = RAW_MAX_BYTES): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
