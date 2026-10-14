// The clone the first launch of the openFolders suite had open, for the
// second launch, a window without it, like the review window.

import * as fs from "fs";
import * as path from "path";

export interface Handoff {
  /** owner/name */
  repository: string;
  clone: string;
  number: number;
  /** Another git repository, which isn't a clone of `repository`. */
  otherRepository: string;
}

function file(): string {
  return path.join(process.env.DEAR_REVIEWER_FIXTURES!, "handoff.json");
}

export function leaveForElsewhere(handoff: Handoff): void {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(handoff, null, 2));
}

export function pickUpElsewhere(): Handoff {
  return JSON.parse(fs.readFileSync(file(), "utf8")) as Handoff;
}
