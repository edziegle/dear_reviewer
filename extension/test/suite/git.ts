// Runs real git for the tests, in fixture repositories and in the worktrees
// Dear Reviewer makes.

import * as cp from "child_process";

/** Runs git in the folder, and gives what it printed, trimmed. */
export function gitIn(cwd: string, ...args: string[]): string {
  return cp.execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}
