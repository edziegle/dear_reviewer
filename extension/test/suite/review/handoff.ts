// The pull request Change the first launch of the review suite leaves open,
// with Comments in its pending review, for the second launch to pick up.

import * as fs from "fs";
import * as path from "path";
import type { ChangeRequest } from "../reviewer";

export interface Handoff {
  change: ChangeRequest;
  baseDir: string;
  headDir: string;
}

function file(): string {
  return path.join(process.env.DEAR_REVIEWER_FIXTURES!, "review-handoff.json");
}

export function leaveForReload(handoff: Handoff): void {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(handoff, null, 2));
}

export function pickUpAfterReload(): Handoff {
  return JSON.parse(fs.readFileSync(file(), "utf8")) as Handoff;
}
