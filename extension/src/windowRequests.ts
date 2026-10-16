// What the Reviewer's own window asks the review window to do with a Change
// open there, since the Dashboard shows them but only the review window can
// act on them (ADR 0032): bring one to the front, or start finishing its
// Review. The requests are kept in a file in the extension's storage, which
// the review window watches and reads again as it starts, so a request made
// while it was closed waits for it. A request too old to still be wanted is
// dropped, never carried out late.

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

/** Resume brings the Change to the front; finish also starts Submit Review… or Write Brief…. */
export type WindowAction = "resume" | "finish";

export interface WindowRequest {
  id: string;
  /** The id of the open Change it acts on. */
  change: string;
  action: WindowAction;
  /** When it was asked, as milliseconds since the epoch. */
  at: number;
}

/** How long a request waits for the review window before it's dropped. */
export const requestLifetime = 2 * 60_000;

/** The requests in a file's text that are well formed, ignoring anything else. */
export function parseRequests(text: string): WindowRequest[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (r): r is WindowRequest =>
      typeof r === "object" &&
      r !== null &&
      typeof r.id === "string" &&
      typeof r.change === "string" &&
      (r.action === "resume" || r.action === "finish") &&
      typeof r.at === "number"
  );
}

/** The requests still wanted at `now`: none older than their lifetime, nor from the future. */
export function current(
  requests: readonly WindowRequest[],
  now: number
): WindowRequest[] {
  return requests.filter((r) => r.at <= now && now - r.at < requestLifetime);
}

/**
 * The requests with a new one added. A newer request for a Change replaces
 * any earlier one for it, so the review window does only what was asked
 * last.
 */
export function withRequest(
  requests: readonly WindowRequest[],
  request: WindowRequest,
  now: number
): WindowRequest[] {
  return [
    ...current(requests, now).filter((r) => r.change !== request.change),
    request,
  ];
}

export class WindowRequests {
  /** The file every window reads and writes the requests in. */
  readonly file: string;

  constructor(storageDir: string) {
    this.file = path.join(storageDir, "review-window-requests.json");
  }

  /** The requests still wanted, oldest first. */
  all(now = Date.now()): WindowRequest[] {
    try {
      return current(parseRequests(fs.readFileSync(this.file, "utf8")), now);
    } catch {
      return [];
    }
  }

  /** Asks the review window to act on the Change. */
  ask(change: string, action: WindowAction, now = Date.now()): WindowRequest {
    const request = { id: crypto.randomUUID(), change, action, at: now };
    this.write(withRequest(this.all(now), request, now));
    return request;
  }

  /** Drops the requests carried out, keeping any asked since. */
  done(ids: ReadonlySet<string>, now = Date.now()): void {
    const left = this.all(now).filter((r) => !ids.has(r.id));
    this.write(left);
  }

  private write(requests: WindowRequest[]): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(requests, null, 2));
  }
}
