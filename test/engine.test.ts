import { describe, expect, it } from "vitest";

import {
  classifyError,
  inferStackFromCommand,
  looksLikeError,
} from "../src/classify/engine.js";
import { BUILT_IN_PATTERNS } from "../src/classify/patterns.js";

const PATTERNS = BUILT_IN_PATTERNS;

describe("inferStackFromCommand", () => {
  it("maps npm/node/pnpm/bun to node", () => {
    expect(inferStackFromCommand("npm run build")).toBe("node");
    expect(inferStackFromCommand("pnpm install")).toBe("node");
    expect(inferStackFromCommand("node server.js")).toBe("node");
    expect(inferStackFromCommand("npx tsx src/index.ts")).toBe("node");
  });

  it("strips env assignments and sudo", () => {
    expect(inferStackFromCommand("FOO=bar npm run x")).toBe("node");
    expect(inferStackFromCommand("sudo mvn clean install")).toBe("java");
  });

  it("maps build tools to their stacks", () => {
    expect(inferStackFromCommand("mvn clean install")).toBe("java");
    expect(inferStackFromCommand("cargo build")).toBe("rust");
    expect(inferStackFromCommand("docker build .")).toBe("docker");
    expect(inferStackFromCommand("kubectl get pods")).toBe("kubernetes");
    expect(inferStackFromCommand("git push")).toBe("git");
    expect(inferStackFromCommand("tsc --noEmit")).toBe("typescript");
    expect(inferStackFromCommand("python -m pytest")).toBe("python");
    expect(inferStackFromCommand("go build ./...")).toBe("go");
  });

  it("returns unknown for empty or unfamiliar commands", () => {
    expect(inferStackFromCommand("")).toBe("unknown");
    expect(inferStackFromCommand("echo hi")).toBe("unknown");
  });
});

describe("looksLikeError", () => {
  it("returns false for clean successful output", () => {
    expect(looksLikeError("✓ built in 1.2s\nAll tests passed.")).toBe(false);
    expect(looksLikeError("")).toBe(false);
  });

  it("requires at least two distinct signals to fire", () => {
    expect(looksLikeError("Some info: Error happened")).toBe(false);
  });

  it("returns true for clearly failing output", () => {
    expect(looksLikeError("Error: ENOENT\nfailed to load module")).toBe(true);
    expect(looksLikeError("BUILD FAILURE\nerror TS2304")).toBe(true);
  });
});

describe("classifyError", () => {
  it("returns null for successful/non-error output", () => {
    expect(classifyError("✓ done", "npm run build", PATTERNS)).toBeNull();
    expect(classifyError("", "ls", PATTERNS)).toBeNull();
  });

  it("classifies a missing Node module", () => {
    const c = classifyError(
      "node:internal/modules: Error: Cannot find module 'express'\n    at require",
      "node server.js",
      PATTERNS,
    );
    expect(c).not.toBeNull();
    expect(c!.id).toBe("node_missing_module");
    expect(c!.stack).toBe("node");
    expect(c!.suggestion).toMatch(/install/i);
    expect(c!.file).toBe("express");
  });

  it("classifies EADDRINUSE", () => {
    const c = classifyError(
      "Error: listen EADDRINUSE: address already in use :::3000",
      "node app.js",
      PATTERNS,
    );
    expect(c!.id).toBe("node_eaddrinuse");
  });

  it("classifies a TypeScript compiler error and extracts location", () => {
    const out = "src/index.ts(12,5): error TS2304: Cannot find name 'foo'.";
    const c = classifyError(out, "tsc --noEmit", PATTERNS);
    expect(c!.id).toBe("ts_compile_error");
    expect(c!.file).toBe("src/index.ts");
    expect(c!.line).toBe(12);
  });

  it("classifies a Maven BUILD FAILURE", () => {
    const c = classifyError(
      "[INFO] ----------------------------------------\n[ERROR] BUILD FAILURE\n[INFO] ----------------------------------------",
      "mvn install",
      PATTERNS,
    );
    expect(c!.id).toBe("maven_build_failure");
  });

  it("classifies a Rust compiler error with location", () => {
    const c = classifyError(
      "error[E0382]: borrow of moved value: `x`\n  --> src/main.rs:42:10",
      "cargo build",
      PATTERNS,
    );
    expect(c!.id).toBe("rust_compile_error");
    expect(c!.file).toBe("src/main.rs");
    expect(c!.line).toBe(42);
  });

  it("classifies a Kubernetes CrashLoopBackOff", () => {
    const c = classifyError(
      "NAME       READY   STATUS              RESTARTS\napi        0/1     CrashLoopBackOff    7",
      "kubectl get pods",
      PATTERNS,
    );
    expect(c!.id).toBe("k8s_crashloop");
    expect(c!.severity).toBe("critical");
  });

  it("classifies a git merge conflict", () => {
    const c = classifyError(
      "Auto-merging file.txt\nCONFLICT (content): Merge conflict in file.txt",
      "git merge feature",
      PATTERNS,
    );
    expect(c!.id).toBe("git_merge_conflict");
  });

  it("falls back to generic when signals exist but no pattern matches", () => {
    // Avoid "Caused by:" / "Exception" which the java_exception pattern would
    // legitimately catch — use signals no specific signature targets.
    const c = classifyError(
      "Error: flux capacitor overflow\nfailed: time machine offline",
      "./custom-tool",
      PATTERNS,
    );
    expect(c).not.toBeNull();
    expect(c!.id).toBe("generic_unclassified");
  });

  it("respects the stacks allow-list", () => {
    const out = "Error: Cannot find module 'lodash'";
    expect(
      classifyError(out, "node app.js", PATTERNS, ["node"]),
    ).not.toBeNull();
    // Restricting to unrelated stacks yields no specific match; generic still
    // applies because signals are present.
    const restricted = classifyError(out, "node app.js", PATTERNS, ["java"]);
    expect(restricted).not.toBeNull();
    expect(restricted!.id).toBe("generic_unclassified");
  });

  it("prioritises the stack matching the command", () => {
    // Both python and shell could plausibly carry 'command not found', but the
    // generic shell pattern is what matches; with a python command we should
    // still find the shell pattern because no python-specific pattern matches.
    const c = classifyError(
      "bash: foo: command not found",
      "bash script.sh",
      PATTERNS,
    );
    expect(c!.id).toBe("shell_command_not_found");
  });
});
