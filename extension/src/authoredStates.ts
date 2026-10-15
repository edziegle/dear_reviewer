// Whether a pull request the Reviewer authored needs their attention or is
// ready to merge, for its row in the Inbox's Authored by me group.

import type { LatestReview, PullRequestSummary } from "./github/client";

/** The states a pull request can be in at once, in the order its icon picks one. */
export const authoredStateOrder = [
  "checksFailed",
  "mergeConflicts",
  "changesRequested",
  "commented",
  "readyToMerge",
] as const;

export type AuthoredState = (typeof authoredStateOrder)[number];

/** Every state that applies to the pull request, in `authoredStateOrder`. */
export function authoredStates(pr: PullRequestSummary): AuthoredState[] {
  const reviews = reviewersLatest(pr);
  const holds: Record<AuthoredState, boolean> = {
    checksFailed: pr.checks === "failed",
    mergeConflicts: pr.mergeable === "conflicting",
    changesRequested: reviews.some((r) => r.verdict === "changesRequested"),
    commented: commentedAtHead(pr, reviews).length > 0,
    readyToMerge:
      !pr.isDraft &&
      approved(pr, reviews) &&
      (pr.checks === "passed" || pr.checks === undefined) &&
      pr.mergeable === "mergeable",
  };
  return authoredStateOrder.filter((state) => holds[state]);
}

/** A state's codicon, its theme colour, and how a row's description and tooltip name it. */
export interface AuthoredStateLook {
  icon: string;
  color: string;
  description: string;
  tooltip: string;
}

/** The codicon a row shows when no state applies. */
export const noStateIcon = "git-pull-request";

export function authoredStateLook(
  state: AuthoredState,
  pr: PullRequestSummary
): AuthoredStateLook {
  const reviews = reviewersLatest(pr);
  switch (state) {
    case "checksFailed":
      return {
        icon: "error",
        color: "testing.iconFailed",
        description: "checks failed",
        tooltip: "Checks failed",
      };
    case "mergeConflicts":
      return {
        icon: "git-merge",
        color: "list.errorForeground",
        description: "merge conflicts",
        tooltip: `Merge conflicts with ${pr.baseRefName}`,
      };
    case "changesRequested":
      return {
        icon: "request-changes",
        color: "list.warningForeground",
        description: "changes requested",
        tooltip: `Changes requested by ${logins(
          reviews.filter((r) => r.verdict === "changesRequested")
        )}`,
      };
    case "commented":
      return {
        icon: "comment",
        color: "editorInfo.foreground",
        description: "commented",
        tooltip: `Commented on the latest commit by ${logins(
          commentedAtHead(pr, reviews)
        )}`,
      };
    case "readyToMerge":
      return {
        icon: "pass-filled",
        color: "testing.iconPassed",
        description: "ready to merge",
        tooltip: "Ready to merge: approved, checks passed, and no conflicts",
      };
  }
}

/** The latest submitted review of everyone but the pull request's author. */
function reviewersLatest(pr: PullRequestSummary): LatestReview[] {
  const author = pr.author.login.toLowerCase();
  return pr.latestReviews.filter((r) => r.author.toLowerCase() !== author);
}

function commentedAtHead(
  pr: PullRequestSummary,
  reviews: LatestReview[]
): LatestReview[] {
  return reviews.filter(
    (r) => r.verdict === "commented" && r.commit === pr.headSha
  );
}

/**
 * GitHub's review decision; where the repository requires no reviews and so
 * has none, some reviewer's approval and no request for changes.
 */
function approved(pr: PullRequestSummary, reviews: LatestReview[]): boolean {
  if (pr.reviewDecision) return pr.reviewDecision === "approved";
  return (
    reviews.some((r) => r.verdict === "approved") &&
    !reviews.some((r) => r.verdict === "changesRequested")
  );
}

function logins(reviews: LatestReview[]): string {
  return reviews.map((r) => r.author).join(", ");
}
