// The Change the first launch of the assistant suite leaves open, with a
// conversation, for the second launch to pick up after the reload.

import * as fs from "fs";
import * as path from "path";
import type { ChangeRequest } from "../reviewer";

export interface Handoff {
  change: ChangeRequest;
  /** The Assistant panel's title. */
  title: string;
  /** The Claude session the conversation ran in. */
  sessionId: string;
}

function file(): string {
  return path.join(
    process.env.DEAR_REVIEWER_FIXTURES!,
    "assistant-handoff.json"
  );
}

export function leaveForReload(handoff: Handoff): void {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(handoff, null, 2));
}

export function pickUpAfterReload(): Handoff {
  return JSON.parse(fs.readFileSync(file(), "utf8")) as Handoff;
}
