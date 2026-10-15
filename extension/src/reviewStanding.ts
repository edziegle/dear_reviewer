// The words for the Reviewer's last Review that open the overview's standing
// line, such as "You approved at 14:32 · 3 Comments published". Kept apart
// from `vscode` so the unit tests can run it under plain Node.

import type { LastReview } from "./github/client";
import type { ReviewStanding } from "./timeline/panel";

/** The last Review as the overview's standing line opens with it, for the verdicts it names. */
export function reviewStanding(
  review: LastReview,
  now = new Date()
): ReviewStanding | undefined {
  const { verdict } = review;
  if (
    verdict !== "approved" &&
    verdict !== "changesRequested" &&
    verdict !== "commented"
  )
    return;
  const did = {
    approved: "You approved",
    changesRequested: "You requested changes",
    commented: "You commented",
  }[verdict];
  const time = review.submittedAt && timeOf(review.submittedAt, now);
  const at = time ? ` ${time}` : "";
  const published = review.comments
    ? ` · ${countOf(review.comments, "Comment")} published`
    : "";
  return { verdict, text: `${did}${at}${published}` };
}

/** "at 14:32" today, or "on 3 Oct 2026, 14:32" before. */
function timeOf(iso: string, now: Date): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "";
  if (date.toDateString() === now.toDateString())
    return `at ${date.toLocaleTimeString(undefined, { timeStyle: "short" })}`;
  return `on ${date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
}

/** Such as "no Comments", "1 Comment" or "3 Comments". */
export function countOf(count: number, noun: string): string {
  if (count === 0) return `no ${noun}s`;
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
