/**
 * Git context gathered from the worktree.
 *
 * All shell access is wrapped so a missing git binary or a non-repo directory
 * yields `null` fields instead of throwing — gathering context must NEVER break
 * the user's opencode session.
 *
 * Local & synchronous: uses `child_process.execSync` (no BunShell quirks) so
 * behaviour is identical across opencode runtimes.
 */

import { execSync } from "node:child_process";
import { isAbsolute, resolve } from "node:path";

export interface GitContext {
  branch: string | null;
  commit: string | null;
  dirty: boolean | null;
  remote: string | null;
}

function run(cwd: string, cmd: string): string | null {
  try {
    const out = execSync(cmd, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500,
      maxBuffer: 1024 * 64,
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Whether tracked files differ from HEAD, ignoring untracked files. This avoids
 * the plugin's own artifact directory (`.opencode/error-explainer/`) making the
 * tree look perpetually dirty. Returns null when git/the commit is unavailable.
 */
function diffDirty(cwd: string): boolean | null {
  try {
    execSync("git diff --quiet HEAD", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500,
    });
    return false; // exit 0 → no tracked differences
  } catch (err) {
    // `git diff --quiet` exits 1 when differences exist (not a real error).
    const code = (err as { status?: number })?.status;
    return typeof code === "number" ? code !== 0 : null;
  }
}

/**
 * Read git metadata for `worktree`. Returns an all-null record if git is
 * unavailable or the directory is not a repository.
 */
export function gatherGit(worktree: string | null | undefined): GitContext {
  const empty: GitContext = {
    branch: null,
    commit: null,
    dirty: null,
    remote: null,
  };
  if (!worktree) return empty;
  const cwd = isAbsolute(worktree) ? worktree : resolve(worktree);
  const branch = run(cwd, "git rev-parse --abbrev-ref HEAD");
  if (!branch) return empty; // not a git repo
  const commit = run(cwd, "git rev-parse HEAD");
  const remote = run(cwd, "git config --get remote.origin.url");
  return {
    branch,
    commit,
    // diff needs at least one commit; without HEAD we can't tell.
    dirty: commit ? diffDirty(cwd) : null,
    remote,
  };
}
