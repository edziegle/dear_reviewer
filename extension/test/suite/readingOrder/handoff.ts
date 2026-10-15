// What the first launch of the readingOrder suite leaves open, and how it
// showed, for the second launch to compare after the reload.

import * as fs from "fs";
import * as path from "path";
import type { ChangeRequest } from "../reviewer";
import type { ShownReadingOrder } from "../timeline";

export interface Handoff {
  /** The branch's Change, and its overview's title. */
  branch: ChangeRequest;
  overview: string;
  readingOrder: ShownReadingOrder;
  /** Change Files, rendered, before the reload. */
  changeFiles: string[];
}

function file(): string {
  return path.join(
    process.env.DEAR_REVIEWER_FIXTURES!,
    "reading-order-handoff.json"
  );
}

export function leaveForReload(handoff: Handoff): void {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(handoff, null, 2));
}

export function pickUpAfterReload(): Handoff {
  return JSON.parse(fs.readFileSync(file(), "utf8")) as Handoff;
}
