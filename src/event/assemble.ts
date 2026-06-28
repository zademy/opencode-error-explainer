/**
 * Assemble the Sentry-grade event from gathered inputs.
 *
 * Pure: every side effect (fs reads, shell probes, client calls, uuid/time) is
 * the caller's responsibility. This function only shapes data — so it is
 * deterministic and trivially unit-testable (the caller injects timestamps,
 * uuids, contexts, enriched frames, breadcrumbs, and frequency).
 */

import { randomUUID } from "node:crypto";

import type { Classification } from "../classify/types.js";
import type {
  Breadcrumb,
  Contexts,
  ExceptionValue,
  Frame,
  Frequency,
  SentryGradeEvent,
} from "./types.js";
import type { Severity } from "../classify/types.js";

export interface AssembleInput {
  classification: Classification;
  frames: readonly Frame[];
  contexts: Contexts;
  breadcrumbs: readonly Breadcrumb[];
  fingerprint: string;
  frequency: Frequency | null;
  sdkVersion: string;
  /** Override event_id/timestamp in tests; default = new uuid / now. */
  eventId?: string;
  timestamp?: string;
}

/** Map our severity onto a Sentry-ish level (fatal reserved for crashes). */
function severityToLevel(severity: Severity): SentryGradeEvent["level"] {
  switch (severity) {
    case "critical":
    case "error":
      return "error";
    case "warning":
      return "warning";
    case "info":
      return "info";
    default:
      return "error";
  }
}

function buildException(
  c: Classification,
  frames: readonly Frame[],
): ExceptionValue {
  const value = c.matchedLines[0] ?? c.type;
  return {
    type: c.type,
    value: value.length > 500 ? `${value.slice(0, 499)}…` : value,
    mechanism: { type: "opencode-tool", handled: false },
    stacktrace: { frames },
  };
}

/**
 * Build the full event. Frames are kept in document order (oldest → newest);
 * Sentry convention is newest-first, so callers may reverse if they prefer.
 */
export function assembleEvent(input: AssembleInput): SentryGradeEvent {
  const { classification: c, contexts, breadcrumbs, fingerprint } = input;
  return {
    event_id: input.eventId ?? randomUUID(),
    timestamp: input.timestamp ?? new Date().toISOString(),
    platform: contexts.runtime.name || "other",
    language: c.stack,
    level: severityToLevel(c.severity),
    sdk: {
      name: "@zademy/opencode-error-explainer",
      version: input.sdkVersion,
    },
    release: contexts.app.git_commit,
    environment: contexts.app.git_branch,
    logger: c.command,
    classification: {
      id: c.id,
      stack: c.stack,
      severity: c.severity,
      suggestion: c.suggestion,
      nextSteps: c.nextSteps,
    },
    exception: { values: [buildException(c, input.frames)] },
    contexts,
    breadcrumbs,
    tags: {
      stack: c.stack,
      severity: c.severity,
      tool: "bash",
      agent: contexts.opencode.agent ?? "",
    },
    fingerprint,
    frequency: input.frequency,
    extra: {
      command: c.command,
      matched_lines: c.matchedLines.slice(0, 8),
      raw_output_excerpts: [c.raw.slice(0, 2048)],
    },
  };
}
