// What the Dashboard says about the Reviewer's Changes, worked out from the
// Inbox's pull requests and branches and the open Changes' standing: how
// long each pull request has waited, the order they wait in, the facts line,
// and the one next step the Dashboard offers (the Next Step Rule in
// DESIGN.md).

/** A Change open in the review window, as the Dashboard weighs it. */
export interface InProgress {
  id: string;
  /** Such as `acme/api #7`, or a local branch's name. */
  name: string;
  /** Whether the Reviewer's last Review covers its head, so nothing is new since. */
  reviewed: boolean;
  pending: number;
  /** Undefined while unknown, such as while GitHub hasn't said. */
  viewed?: number;
  total: number;
  /** How its Review ends: a pull request's is submitted, a local Change's ends with a Brief. */
  finish: "submit" | "brief";
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
  | { kind: "resume"; id: string; label: string }
  | { kind: "finish"; id: string; label: string }
  | { kind: "close"; id: string; label: string }
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
 * The pull requests that still wait on the Reviewer, apart from the ones
 * they set aside. A set-aside one keeps its own `since`, so restoring it
 * gives back the wait it had.
 */
export function setAside<T extends { id: string }>(
  waiting: readonly T[],
  ignored: ReadonlySet<string>
): { waiting: T[]; ignored: T[] } {
  return {
    waiting: waiting.filter((w) => !ignored.has(w.id)),
    ignored: waiting.filter((w) => ignored.has(w.id)),
  };
}

/**
 * The facts line: how many pull requests wait on the Reviewer and for how
 * long the oldest has, such as "5 waiting on you · oldest 6 days". In
 * progress, right below it, counts the Changes itself. `waiting` is
 * undefined while the Dashboard can't tell, such as before GitHub sign-in,
 * and so is the line.
 */
export function dashboardFacts(
  waiting: readonly { since: string }[] | undefined,
  now: number
): string | undefined {
  if (!waiting) return undefined;
  const oldest = byLongestWait(waiting)[0];
  return oldest
    ? `${waiting.length} waiting on you · oldest ${waitedFor(oldest.since, now)}`
    : "Nothing waiting on you";
}

/**
 * What comes next, which the Dashboard fills the one button for. Only a pull
 * request not yet open says why it is next, in `place`, since nothing else
 * on the Dashboard does: the Change in
 * progress shown last that still needs the Reviewer, to resume, or to
 * finish once every file is viewed; or else the pull request that has
 * waited longest and isn't open yet. A Change whose last Review covers its
 * head, with no Comments pending, needs nothing more, nor does one with no
 * files to review. `inProgress` is in
 * the order the Changes were shown, the one shown last last.
 */
export function nextStep(
  inProgress: readonly InProgress[],
  waiting: readonly Waiting[],
  now: number
): NextStep | undefined {
  const change = inProgress
    .filter((c) => c.total > 0 && !(c.reviewed && c.pending === 0))
    .at(-1);
  if (change) {
    // The button names the Change, and its row below says where the Reviewer
    // stands on it, so neither is said a third time.
    const viewedAll =
      change.viewed !== undefined && change.viewed >= change.total;
    // A local Change with every file viewed and no Comments has no Brief to
    // write: nothing needs changing, so stopping is the next step.
    if (viewedAll && change.finish === "brief" && change.pending === 0)
      return {
        kind: "close",
        id: change.id,
        label: `Stop Reviewing ${change.name}`,
      };
    if (viewedAll)
      return {
        kind: "finish",
        id: change.id,
        label:
          change.finish === "submit"
            ? `Submit Review of ${change.name}…`
            : `Write Brief for ${change.name}…`,
      };
    return {
      kind: "resume",
      id: change.id,
      label: `Resume ${change.name}`,
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
