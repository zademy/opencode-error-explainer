/**
 * Built-in error signature registry.
 *
 * This is a plain data table — adding a new pattern never requires touching the
 * engine. Users can ship a `.error-patterns.json` in their worktree root to
 * augment or override entries by `id` (see {@link mergeCustomPatterns}).
 *
 * Conventions:
 *  - `pattern` is tested against the FULL merged output (stdout + stderr).
 *    Flags should be `i` for case-insensitive matching unless the casing is
 *    semantically meaningful (e.g. hex env values).
 *  - `suggestion` is a single actionable English sentence. Imperative mood.
 *  - `nextSteps` are concrete shell/IDE actions, optional.
 *  - `extractors.file`/`line` run on the matched substring to recover a
 *    probable source location; capture group 1 is the value.
 */

import type { ErrorPattern, Stack } from "./types.js";

export const BUILT_IN_PATTERNS: readonly ErrorPattern[] = [
  // ── Node / npm / JavaScript runtime ───────────────────────────────────────
  {
    id: "node_missing_module",
    stack: "node",
    type: "Missing dependency",
    severity: "error",
    pattern: /Cannot find (?:module|package) ['"]([^'"]+)['"]/i,
    suggestion:
      "A required module is not installed. Install it or fix the import path.",
    nextSteps: [
      "If it's an external package, run `npm install <name>` (or pnpm/yarn equivalent).",
      "If it's a local file, check the relative path and file extension.",
    ],
    extractors: { file: /['"]([^'"]+)['"]/ },
  },
  {
    id: "node_eaddrinuse",
    stack: "network",
    type: "Port already in use",
    severity: "error",
    pattern: /EADDRINUSE|address already in use/i,
    suggestion:
      "Another process holds the port. Free it or bind a different port.",
    nextSteps: [
      "Find the process: `lsof -i :<PORT>` (macOS/Linux).",
      "Stop it or change the server's listen port.",
    ],
  },
  {
    id: "node_eacces",
    stack: "os",
    type: "Permission denied",
    severity: "error",
    pattern: /EACCES|permission denied/i,
    suggestion: "The process lacks permission for that path or operation.",
    nextSteps: [
      "Check file ownership/permissions (`ls -l`).",
      "Avoid system-protected paths; fix with `chmod`/`chown` only when you understand the impact.",
    ],
  },
  {
    id: "node_econnrefused",
    stack: "network",
    type: "Connection refused",
    severity: "error",
    pattern: /ECONNREFUSED|connection refused/i,
    suggestion:
      "Nothing is listening at the target host/port. Verify the service is running.",
    nextSteps: [
      "Confirm the database/API/server process is up.",
      "Check host and port values in your config.",
    ],
  },
  {
    id: "node_enoent",
    stack: "os",
    type: "File not found (ENOENT)",
    severity: "error",
    pattern: /ENOENT|no such file or directory/i,
    suggestion: "A referenced path does not exist.",
    nextSteps: ["Check spelling and that the file/dir was created."],
    extractors: {
      file: /(?:no such file or directory,?\s*(?:open|stat|spawn|access(?:for)?)?\s*)['"]?([^'"\n]+)['"]?/i,
    },
  },
  {
    id: "npm_eresolve",
    stack: "node",
    type: "Dependency resolution conflict",
    severity: "warning",
    pattern: /npm error\s+ERESOLVE|Unable to resolve dependency tree/i,
    suggestion:
      "Peer-dependency conflict during install. Review the reported version conflicts.",
    nextSteps: [
      "Read the conflicting packages in the message.",
      "Use `npm install --legacy-peer-deps` only as a temporary workaround.",
    ],
  },

  // ── TypeScript ─────────────────────────────────────────────────────────────
  {
    id: "ts_compile_error",
    stack: "typescript",
    type: "TypeScript compiler error",
    severity: "error",
    pattern: /error TS\d{4}:/i,
    suggestion:
      "The TypeScript compiler rejected the code. Open the file:line shown.",
    nextSteps: [
      "Open the first reported location — later errors often cascade from it.",
      "Run `tsc --noEmit` to get the full list without emitting files.",
    ],
    extractors: {
      file: /([\w./-]+\.ts)\(\d/i,
      line: /[\w./-]+\.ts\((\d+)/i,
    },
  },

  // ── Python ─────────────────────────────────────────────────────────────────
  {
    id: "python_traceback",
    stack: "python",
    type: "Python traceback",
    severity: "error",
    pattern: /Traceback \(most recent call last\):/i,
    suggestion:
      "A Python exception was raised. The real failure is the LAST line of the traceback.",
    nextSteps: [
      "Read from the bottom up: the final `ExceptionType: message` is the cause.",
      "The frame above it shows where it was raised.",
    ],
  },
  {
    id: "python_module_not_found",
    stack: "python",
    type: "Module not found",
    severity: "error",
    pattern: /ModuleNotFoundError: No module named ['"]([^'"]+)['"]/i,
    suggestion: "A Python package is not installed in the active environment.",
    nextSteps: [
      "Install it: `pip install <name>` (or `poetry add` / `uv add`).",
      "Confirm you're using the intended virtualenv/interpreter.",
    ],
    extractors: { file: /named ['"]([^'"]+)['"]/ },
  },
  {
    id: "python_syntax_error",
    stack: "python",
    type: "Python syntax error",
    severity: "error",
    pattern: /SyntaxError:/i,
    suggestion:
      "The Python code is malformed. The caret points at the bad token.",
    extractors: {
      file: /File "([^"]+)"/i,
      line: /File "[^"]+", line (\d+)/i,
    },
  },

  // ── Java / Maven / Gradle ──────────────────────────────────────────────────
  {
    id: "maven_build_failure",
    stack: "java",
    type: "Maven build failure",
    severity: "error",
    pattern: /\[ERROR\]\s+BUILD FAILURE|Failed to execute goal/i,
    suggestion:
      "Maven's summary hides the real cause. Open the first ERROR/Caused by above it.",
    nextSteps: [
      "Search the log upward for the first `[ERROR]` or `Caused by:`.",
      "Re-run with `-X` (debug) or `-e` for a fuller stack trace if needed.",
    ],
  },
  {
    id: "gradle_build_failure",
    stack: "java",
    type: "Gradle build failure",
    severity: "error",
    pattern: /BUILD FAILED|What went wrong:/i,
    suggestion:
      "Gradle failed. Read the 'What went wrong:' section for the root cause.",
    nextSteps: ["Run with `--stacktrace` for a full trace."],
  },
  {
    id: "java_exception",
    stack: "java",
    type: "Java exception",
    severity: "error",
    pattern: /Exception in thread|Caused by:\s+\w+/,
    suggestion:
      "An exception was thrown. The deepest `Caused by:` is the root cause.",
    nextSteps: [
      "Read the stacktrace downward to the final `Caused by:`.",
      "Match the exception class name to the failing component.",
    ],
    extractors: {
      file: /at [\w.$]+\(([\w./]+\.java):\d+\)/,
      line: /at [\w.$]+\([\w./]+\.java:(\d+)\)/,
    },
  },

  // ── Rust ───────────────────────────────────────────────────────────────────
  {
    id: "rust_compile_error",
    stack: "rust",
    type: "Rust compiler error",
    severity: "error",
    pattern: /error\[E\d{4}\]:/i,
    suggestion:
      "The Rust compiler rejected the code. Each error code links to a detailed explanation.",
    nextSteps: [
      "Run `rustc --explain E####` for guidance on the specific code.",
      "Fix the first error first; later ones may be cascades.",
    ],
    extractors: {
      file: /-->\s+([^:]+\.rs):/i,
      line: /-->\s+[^:]+\.rs:(\d+)/i,
    },
  },
  {
    id: "rust_panic",
    stack: "rust",
    type: "Rust panic",
    severity: "critical",
    pattern: /thread '[^']+' panicked at/i,
    suggestion:
      "The program panicked. The location and message indicate the failing assertion/indexing.",
    nextSteps: [
      "Look at `src/main.rs:LINE` in the panic message.",
      "Common cause: indexing out of bounds or calling `.unwrap()` on None/Err.",
    ],
  },

  // ── Go ─────────────────────────────────────────────────────────────────────
  {
    id: "go_panic",
    stack: "go",
    type: "Go panic",
    severity: "critical",
    pattern: /panic:|goroutine \d+ \[/,
    suggestion:
      "A Go panic occurred. The stacktrace shows the panicking function.",
    nextSteps: [
      "Find the first frame in YOUR package in the goroutine stack.",
      "Common cause: nil pointer dereference or index out of range.",
    ],
  },
  {
    id: "go_build_error",
    stack: "go",
    type: "Go build error",
    severity: "error",
    pattern: /\.go:\d+:\d+:/,
    suggestion:
      "The Go toolchain reported a compile error at the file:line shown.",
    extractors: {
      file: /([^\s]+\.(?:go|s)):\d+:\d+:/,
      line: /[^\s]+\.(?:go|s):(\d+):\d+:/,
    },
  },

  // ── Docker / containers ────────────────────────────────────────────────────
  {
    id: "docker_image_not_found",
    stack: "docker",
    type: "Image not found",
    severity: "error",
    pattern:
      /manifest (?:for\s+)?[\w./:@-]+\s+(?:not found|unknown)|pull access denied/i,
    suggestion:
      "The image or tag does not exist or you lack access to the registry.",
    nextSteps: [
      "Verify the tag spelling and that it was pushed.",
      "Run `docker login <registry>` if the image is private.",
    ],
  },
  {
    id: "docker_exit_code",
    stack: "docker",
    type: "Container exited non-zero",
    severity: "error",
    pattern: /exited with code\s+\d+/i,
    suggestion:
      "The container process exited non-zero. Inspect its logs for the underlying error.",
    nextSteps: ["Run `docker logs <container>` to see the process output."],
  },
  {
    id: "docker_daemon_unreachable",
    stack: "docker",
    type: "Docker daemon unreachable",
    severity: "error",
    pattern:
      /Cannot connect to the Docker daemon|Is the docker daemon running\??/i,
    suggestion:
      "Docker is not running or the current user cannot reach its socket.",
    nextSteps: ["Start Docker Desktop or the `docker` service."],
  },

  // ── Kubernetes / kubectl ───────────────────────────────────────────────────
  {
    id: "k8s_not_found",
    stack: "kubernetes",
    type: "Kubernetes resource not found",
    severity: "error",
    pattern:
      /(?:the server could not find the requested resource|no resources found|not found)\b/i,
    suggestion: "The resource does not exist in the current context/namespace.",
    nextSteps: [
      "Check context: `kubectl config current-context`.",
      "Try with `-n <namespace>` or `--all-namespaces`.",
    ],
  },
  {
    id: "k8s_crashloop",
    stack: "kubernetes",
    type: "Pod in CrashLoopBackOff",
    severity: "critical",
    pattern: /CrashLoopBackOff/i,
    suggestion: "The pod's container is crashing and restarting repeatedly.",
    nextSteps: [
      "Inspect logs: `kubectl logs <pod> --previous`.",
      "Check `kubectl describe pod <pod>` for events and probe failures.",
    ],
  },
  {
    id: "k8s_image_pull",
    stack: "kubernetes",
    type: "ImagePullBackOff / ErrImagePull",
    severity: "error",
    pattern: /ImagePullBackOff|ErrImagePull/i,
    suggestion:
      "Kubernetes cannot pull the container image. Verify the image name, tag, and registry credentials.",
    nextSteps: [
      "Check the image reference spelling and tag.",
      "Ensure an `imagePullSecret` is configured for private registries.",
    ],
  },

  // ── Git ────────────────────────────────────────────────────────────────────
  {
    id: "git_merge_conflict",
    stack: "git",
    type: "Unresolved merge conflict",
    severity: "error",
    pattern:
      /CONFLICT \((?:content|modify\/delete|add\/add)\):|merge conflict/i,
    suggestion:
      "There are unresolved merge conflicts. Edit the conflicted files, then continue.",
    nextSteps: [
      "Resolve `<<<<<<<` / `=======` / `>>>>>>>` markers in the files.",
      "Then `git add <files>` and `git commit` (or `git rebase --continue`).",
    ],
  },
  {
    id: "git_push_rejected",
    stack: "git",
    type: "Push rejected (non-fast-forward)",
    severity: "warning",
    pattern:
      /Updates were rejected because the remote contains work|non-fast-forward/i,
    suggestion:
      "The remote has commits you don't have. Integrate them before pushing.",
    nextSteps: ["Run `git pull --rebase` then push again."],
  },
  {
    id: "git_auth_failed",
    stack: "git",
    type: "Git authentication failed",
    severity: "error",
    pattern:
      /Authentication failed|Permission .* denied|could not read Username/i,
    suggestion: "Git could not authenticate to the remote.",
    nextSteps: [
      "Check your token/SSH key and the remote URL (`git remote -v`).",
      "For HTTPS, use a PAT or credential helper; for SSH, verify `ssh -T git@github.com`.",
    ],
  },

  // ── SQL ────────────────────────────────────────────────────────────────────
  {
    id: "sql_syntax_error",
    stack: "sql",
    type: "SQL syntax error",
    severity: "error",
    pattern: /syntax error at or near|You have an error in your SQL syntax/i,
    suggestion: "The SQL statement is malformed near the indicated token.",
    nextSteps: ["Inspect the quoted token in the message."],
  },
  {
    id: "sql_relation_missing",
    stack: "sql",
    type: "Table/relation does not exist",
    severity: "error",
    pattern:
      /relation "[^"]+" does not exist|Table '[^']+' doesn't exist|no such table:/i,
    suggestion: "The referenced table does not exist in this database/schema.",
    nextSteps: [
      "Check table name spelling and casing.",
      "Confirm you're connected to the right database and schema/search_path.",
    ],
    extractors: {
      file: /(?:relation|"|')[\s"]*([^"\s']+)(?:[\s"]*'?)\s*(?:does not exist|doesn't exist)/i,
    },
  },

  // ── Shell / OS ─────────────────────────────────────────────────────────────
  {
    id: "shell_command_not_found",
    stack: "shell",
    type: "Command not found",
    severity: "error",
    pattern:
      /command not found|zsh: command not found|no such file or directory.*(?:command|executable)/i,
    suggestion: "The shell could not find the command you tried to run.",
    nextSteps: [
      "Check the spelling of the command.",
      "Install the tool or add it to your PATH.",
    ],
  },
  {
    id: "disk_no_space",
    stack: "os",
    type: "Disk full",
    severity: "critical",
    pattern: /No space left on device|disk full|ENOSPC/i,
    suggestion: "The target filesystem is out of space.",
    nextSteps: ["Free space or move the build/cache output elsewhere."],
  },

  // ── Generic fallbacks (lowest priority) ─────────────────────────────────────
  {
    id: "generic_stack_trace",
    stack: "generic",
    type: "Unhandled exception/stack trace",
    severity: "error",
    pattern: /^\s*at\s+.+\((?:.+:\d+:\d+)\)$/m,
    suggestion:
      "A stack trace was printed. The deepest frame in your own code is the likely origin.",
    nextSteps: ["Read the stack bottom-up to your first-party code."],
  },
];

/**
 * Merge a user-supplied patterns array over the built-ins.
 *
 * User entries override built-ins by `id` and are appended otherwise. The input
 * is untrusted (from a JSON file), so every field is validated/coerced: a
 * malformed entry is dropped rather than crashing the session.
 */
export function mergeCustomPatterns(
  builtIns: readonly ErrorPattern[],
  customs: unknown,
): readonly ErrorPattern[] {
  if (!Array.isArray(customs)) return builtIns;

  const validated = customs
    .map((entry, index): ErrorPattern | null => coercePattern(entry, index))
    .filter((p): p is ErrorPattern => p !== null);

  if (validated.length === 0) return builtIns;

  const overrideIds = new Set(validated.map((p) => p.id));
  const kept = builtIns.filter((p) => !overrideIds.has(p.id));
  return [...kept, ...validated];
}

function coercePattern(entry: unknown, index: number): ErrorPattern | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;

  const id = typeof e.id === "string" && e.id.trim() ? e.id.trim() : null;
  const type = typeof e.type === "string" ? e.type : null;
  const suggestion = typeof e.suggestion === "string" ? e.suggestion : null;
  if (!id || !type || !suggestion) return null;

  const stack = isValidStack(e.stack) ? (e.stack as Stack) : "generic";
  const severity = isValidSeverity(e.severity)
    ? (e.severity as ErrorPattern["severity"])
    : "error";

  let pattern: RegExp;
  try {
    if (e.pattern instanceof RegExp) {
      pattern = e.pattern;
    } else if (typeof e.pattern === "string") {
      const flags = typeof e.flags === "string" ? e.flags : "i";
      pattern = new RegExp(e.pattern, flags);
    } else {
      return null;
    }
  } catch {
    return null; // bad regex literal — drop, don't crash
  }

  const nextSteps =
    Array.isArray(e.nextSteps) &&
    e.nextSteps.every((s) => typeof s === "string")
      ? (e.nextSteps as string[])
      : undefined;

  const extractors = coerceExtractors(e.extractors);

  void index; // index available for diagnostics if needed later
  return {
    id,
    stack,
    type,
    severity,
    pattern,
    suggestion,
    nextSteps,
    extractors,
  };
}

function coerceExtractors(
  raw: unknown,
): ErrorPattern["extractors"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const e = raw as Record<string, unknown>;
  const file = toRegex(e.file);
  const line = toRegex(e.line);
  if (!file && !line) return undefined;
  return { file: file ?? undefined, line: line ?? undefined };
}

function toRegex(value: unknown): RegExp | undefined {
  if (value instanceof RegExp) return value;
  if (typeof value === "string") {
    try {
      return new RegExp(value, "i");
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function isValidStack(value: unknown): boolean {
  return (
    typeof value === "string" &&
    [
      "node",
      "typescript",
      "python",
      "java",
      "go",
      "rust",
      "docker",
      "kubernetes",
      "git",
      "sql",
      "shell",
      "network",
      "os",
      "generic",
    ].includes(value)
  );
}

function isValidSeverity(value: unknown): boolean {
  return (
    typeof value === "string" &&
    ["critical", "error", "warning", "info"].includes(value)
  );
}
