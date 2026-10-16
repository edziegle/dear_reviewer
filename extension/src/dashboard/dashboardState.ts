// What the Dashboard says about the Reviewer's Changes, worked out from the
// Inbox's pull requests and branches and the open Changes' standing: how
// long each pull request has waited, the order they wait in, the facts line,
// and the one next step the Dashboard offers (the Next Step Rule in
// DESIGN.md).

import { countOf } from "../reviewStanding";

/** A Change open in the review window, as the Dashboard weighs it. */
export interface InProgress {
  id: string;
  /** Such as `acme/api #7`, or a local branch's name. */
  name: string;
  /** Whether the Reviewer's last Review covers its head, so nothing is new since. */
  reviewed: boolean;
  pending: number;
  viewed: number;
  total: number;
  /** "Submit Review…" or "Write Brief…". */
  finish: string;
}

/** A pull request waiting on the Reviewer, as the Dashboard weighs it. */
export interface Waiting {
  id: string;
  name: string;
  /** When it started waiting on the Reviewer. */
  since: string;
  /** Whether it is open as a Change, or opening. */
  open: boolean;
}

export type NextStep =
  | { kind: "resume"; id: string; label: string; place: string }
  | { kind: "finish"; id: string; label: string; place: string }
  | { kind: "open"; id: string; label: string; place: string };

/**
 * How long a pull request has waited, from `since` to `now`, in the
 * largest whole unit: "under a minute", "40 minutes", "5 hours", "6 days".
 */
export function waitedFor(since: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(since)) / 60_000);
  if (!(minutes >= 1)) return "under a minute";
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, "hour");
  return plural(Math.floor(hours / 24), "day");
}

/** The pull requests, the one that has waited longest first. */
export function byLongestWait<T extends { since: string }>(
  waiting: readonly T[]
): T[] {
  return [...waiting].sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
}

/**
 * The facts line: how many Changes are in progress, how many pull requests
 * wait on the Reviewer and for how long the oldest has, such as
 * "2 in progress · 5 waiting on you · oldest 6 days". `waiting` is
 * undefined while the Dashboard can't tell, such as before GitHub sign-in.
 */
export function dashboardFacts(
  inProgress: number,
  waiting: readonly { since: string }[] | undefined,
  now: number
): string {
  const parts = [
    inProgress ? `${inProgress} in progress` : "nothing in progress",
  ];
  if (waiting) {
    const oldest = byLongestWait(waiting)[0];
    parts.push(
      oldest
        ? `${waiting.length} waiting on you · oldest ${waitedFor(oldest.since, now)}`
        : "nothing waiting on you"
    );
  }
  const line = parts.join(" · ");
  return line[0].toUpperCase() + line.slice(1);
}

/**
 * What comes next, which the Dashboard fills the one button for: the Change in
 * progress shown last that still needs the Reviewer, to resume, or to
 * finish once every file is viewed; or else the pull request that has
 * waited longest and isn't open yet. A Change whose last Review covers its
 * head, with no Comments pending, needs nothing more. `inProgress` is in
 * the order the Changes were shown, the one shown last last.
 */
export function nextStep(
  inProgress: readonly InProgress[],
  waiting: readonly Waiting[],
  now: number
): NextStep | undefined {
  const change = inProgress
    .filter((c) => !(c.reviewed && c.pending === 0))
    .at(-1);
  if (change) {
    const pending = change.pending
      ? [countOf(change.pending, "pending Comment")]
      : [];
    if (change.total > 0 && change.viewed >= change.total)
      return {
        kind: "finish",
        id: change.id,
        label: change.finish,
        place: [`You've viewed every file of ${change.name}`, ...pending].join(
          " · "
        ),
      };
    return {
      kind: "resume",
      id: change.id,
      label: `Resume ${change.name}`,
      place: [
        `You were last in ${change.name}`,
        `${change.viewed} of ${change.total} viewed`,
        ...pending,
      ].join(" · "),
    };
  }
  const longest = byLongestWait(waiting.filter((w) => !w.open))[0];
  if (longest)
    return {
      kind: "open",
      id: longest.id,
      label: `Review ${longest.name}`,
      place: `${longest.name} has waited longest on you: ${waitedFor(longest.since, now)}`,
    };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
