/**
 * Language-aware stacktrace parser.
 *
 * Pure: takes the raw merged output + the detected stack and returns a list of
 * {@link Frame}s with NO source context (that is added later by the filesystem
 * pass). `in_app` is computed here from path heuristics so it is deterministic
 * and unit-testable.
 *
 * Best-effort by design: if no language frame pattern matches, a single
 * synthetic frame is derived from any file:line already on the classification.
 */

import type { Stack } from "../classify/types.js";
import type { Frame } from "../event/types.js";

/** Vendor/dependency path markers → the frame is NOT first-party. */
const EXTERNAL_MARKERS = [
  "node_modules",
  ".venv",
  "venv/",
  "/lib/python",
  "site-packages",
  "/vendor/",
  "vendor/",
  "/usr/lib",
  "/usr/local/lib",
  "go/pkg/mod",
  "registry/src",
  "/dist/",
  "/build/Release/",
  "<node:internals>",
  "node:internal",
] as const;

/** Determine whether a printed path is a first-party (in-app) frame. */
export function isInApp(filename: string): boolean {
  if (!filename) return false;
  const lower = filename.toLowerCase();
  if (lower.startsWith("node:")) return false;
  return !EXTERNAL_MARKERS.some((m) => lower.includes(m));
}

/** Best-effort npm/package name from a path containing `node_modules`. */
export function packageOf(filename: string): string | null {
  const idx = filename.lastIndexOf("node_modules/");
  if (idx < 0) return null;
  const rest = filename.slice(idx + "node_modules/".length);
  // Scoped: @scope/name, else first segment.
  if (rest.startsWith("@")) {
    const m = rest.match(/^(@[^/]+\/[^/]+)/);
    return m ? (m[1] ?? null) : null;
  }
  const m = rest.match(/^([^/]+)/);
  return m ? (m[1] ?? null) : null;
}

function makeFrame(
  filename: string | null | undefined,
  fn: string | null,
  lineno: number | null,
  colno: number | null,
): Frame {
  const file = filename && filename.length > 0 ? filename : "(unknown)";
  return {
    filename: file,
    function: fn,
    lineno,
    colno,
    in_app: isInApp(file),
    context: null,
    module: packageOf(file),
  };
}

const JS_FRAME = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+)(?::(\d+))?\)?\s*$/;
const PY_FRAME = /^\s*File\s+"([^"]+)",\s+line\s+(\d+),\s+in\s+(.+)$/;
const JAVA_FRAME = /^\s*at\s+([\w.$]+)\.([\w$<>]+)\(([^:)]+?)(?::(\d+))?\)\s*$/;
const RUST_AT = /^\s+at\s+([^:]+):(\d+):(\d+)\s*$/;
const RUST_PANIC = /panicked at\s+(?:'[^']*',\s+)?([^:\s]+):(\d+):(\d+)/;
const GO_FILE = /^\t?([^\s:()]+):(\d+)\s*(?:\+0x[0-9a-f]+)?\s*$/;
const GO_FUNC = /^\t?(?:([\w.{}/()*\s-]+))?\(?/;

/** Map a plugin stack to a parser language. */
export function stackToLanguage(
  stack: Stack,
): "javascript" | "python" | "java" | "rust" | "go" | null {
  switch (stack) {
    case "node":
    case "typescript":
      return "javascript";
    case "python":
      return "python";
    case "java":
      return "java";
    case "rust":
      return "rust";
    case "go":
      return "go";
    default:
      return null;
  }
}

/**
 * Parse a stacktrace out of the merged output for the given language.
 * Returns frames oldest→newest is NOT guaranteed; Sentry convention is
 * newest-first, so callers may reverse if needed. We return in document order.
 */
export function parseStacktrace(
  output: string,
  language: "javascript" | "python" | "java" | "rust" | "go" | null,
): readonly Frame[] {
  if (!language || !output) return [];
  switch (language) {
    case "javascript":
      return parseJavascript(output);
    case "python":
      return parsePython(output);
    case "java":
      return parseJava(output);
    case "rust":
      return parseRust(output);
    case "go":
      return parseGo(output);
    default:
      return [];
  }
}

function parseJavascript(output: string): Frame[] {
  const frames: Frame[] = [];
  for (const line of output.split("\n")) {
    const m = line.match(JS_FRAME);
    if (!m) continue;
    const fn = m[1] ? m[1].trim() : null;
    const file = m[2];
    const lineno = m[3] ? Number.parseInt(m[3], 10) : null;
    const colno = m[4] ? Number.parseInt(m[4], 10) : null;
    frames.push(makeFrame(file, fn, lineno, colno));
  }
  return frames;
}

function parsePython(output: string): Frame[] {
  const frames: Frame[] = [];
  for (const line of output.split("\n")) {
    const m = line.match(PY_FRAME);
    if (!m) continue;
    const file = m[1];
    const lineno = m[2] ? Number.parseInt(m[2], 10) : null;
    frames.push(makeFrame(file, m[3] ?? null, lineno, null));
  }
  return frames;
}

function parseJava(output: string): Frame[] {
  const frames: Frame[] = [];
  for (const line of output.split("\n")) {
    const m = line.match(JAVA_FRAME);
    if (!m) continue;
    const cls = m[1] ?? "";
    const method = m[2] ?? "";
    const file = m[3] ?? "";
    const lineno = m[4] ? Number.parseInt(m[4], 10) : null;
    frames.push(makeFrame(file, `${cls}.${method}`, lineno, null));
  }
  return frames;
}

function parseRust(output: string): Frame[] {
  const frames: Frame[] = [];
  const panic = output.match(RUST_PANIC);
  if (panic) {
    frames.push(
      makeFrame(
        panic[1],
        "panic",
        panic[2] ? Number.parseInt(panic[2], 10) : null,
        panic[3] ? Number.parseInt(panic[3], 10) : null,
      ),
    );
  }
  for (const line of output.split("\n")) {
    const m = line.match(RUST_AT);
    if (!m) continue;
    frames.push(
      makeFrame(
        m[1],
        null,
        m[2] ? Number.parseInt(m[2], 10) : null,
        m[3] ? Number.parseInt(m[3], 10) : null,
      ),
    );
  }
  return frames;
}

function parseGo(output: string): Frame[] {
  const frames: Frame[] = [];
  const lines = output.split("\n");
  let pendingFn: string | null = null;
  for (const line of lines) {
    const fm = line.match(GO_FUNC);
    if (fm && line.includes("(") && !line.match(GO_FILE)) {
      pendingFn = line.trim().replace(/\(.*$/, "");
    }
    const m = line.match(GO_FILE);
    if (!m) continue;
    const file = m[1];
    const lineno = m[2] ? Number.parseInt(m[2], 10) : null;
    frames.push(makeFrame(file, pendingFn, lineno, null));
    pendingFn = null;
  }
  return frames;
}

/**
 * Build a single synthetic frame when no language parser matched but the
 * classifier still recovered a file:line. Keeps the event shape consistent.
 */
export function syntheticFrame(
  file: string | undefined,
  line: number | undefined,
): Frame | null {
  if (!file && line == null) return null;
  return makeFrame(file ?? "(unknown)", null, line ?? null, null);
}
