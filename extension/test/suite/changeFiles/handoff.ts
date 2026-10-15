// The Changes the first launch of the changeFiles suite leaves open for the
// second launch, which checks what survived the reload: one in front, and
// one behind it.

import * as fs from "fs";
import * as path from "path";

export interface Handoff {
  repository: string;
  base: string;
  head: string;
  /** The Change's label in the files view. */
  title: string;
  /** A Change of the same repository, open behind the one in front. */
  behind: { repository: string; base: string; head: string };
}

function file(): string {
  return path.join(process.env.DEAR_REVIEWER_FIXTURES!, "handoff.json");
}

export function leaveForReload(handoff: Handoff): void {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(handoff, null, 2));
}

export function pickUpAfterReload(): Handoff {
  return JSON.parse(fs.readFileSync(file(), "utf8")) as Handoff;
}
