// What the first launch of the lifecycle suite leaves for the second: a
// local Change whose worktrees it deleted, and a pull request's Change whose
// pull request it merged, both with their folders still in the window.

import * as fs from "fs";
import * as path from "path";
import type { ChangeRequest } from "../reviewer";

export interface Handoff {
  /** The window's folders before either Change opened. */
  before: { name: string; path: string }[];
  deleted: { change: ChangeRequest; folders: string[] };
  merged: { change: ChangeRequest; folders: string[] };
}

function file(): string {
  return path.join(
    process.env.DEAR_REVIEWER_FIXTURES!,
    "lifecycle-handoff.json"
  );
}

export function leaveForReload(handoff: Handoff): void {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(handoff, null, 2));
}

export function pickUpAfterReload(): Handoff {
  return JSON.parse(fs.readFileSync(file(), "utf8")) as Handoff;
}
