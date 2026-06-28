/**
 * OS + runtime context.
 *
 * Pure metadata gathering — no filesystem writes, all failures yield `null`.
 * Runtime versions are probed with `--version` calls (best-effort, short
 * timeout) so an absent binary never throws.
 */

import { execSync } from "node:child_process";
import { arch, release, type } from "node:os";

import type { OsContext, RuntimeContext } from "../event/types.js";
import type { Stack } from "../classify/types.js";

function probe(cmd: string): string | null {
  try {
    const out = execSync(cmd, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500,
      maxBuffer: 1024 * 16,
    });
    return out.trim().split("\n")[0] || null;
  } catch {
    return null;
  }
}

/** OS context derived from Node's `os` module (always available). */
export function gatherOs(): OsContext {
  return {
    name: type(),
    version: release(),
    arch: arch(),
  };
}

/** The runtime we infer for the failing command, plus its version if installed. */
export function gatherRuntime(stack: Stack): RuntimeContext {
  switch (stack) {
    case "node":
    case "typescript":
      return {
        name: "node",
        version: process.versions.node || probe("node --version"),
      };
    case "python":
      return {
        name: "python",
        version: probe("python3 --version") || probe("python --version"),
      };
    case "java":
      return { name: "java", version: probe("java -version") };
    case "rust":
      return { name: "rustc", version: probe("rustc --version") };
    case "go":
      return { name: "go", version: probe("go version") };
    default:
      return { name: "node", version: process.versions.node || null };
  }
}

/** Node's own version, for the opencode/app context. */
export function nodeVersion(): string | null {
  return process.versions.node || null;
}
