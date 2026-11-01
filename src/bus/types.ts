/**
 * Internal signal shape for errors captured from sources other than the
 * terminal tool — the OpenCode v2 event bus (model/agent layer).
 *
 * Bus signals flow through the same classify → explain → persist pipeline
 * as terminal-tool failures; `extra.source: "event-bus"` distinguishes them
 * in persisted events.
 */

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
