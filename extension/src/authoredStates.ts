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
  const holds: Record<AuthoredState, boolean> = {
    checksFailed: pr.checks === "failed",
    mergeConflicts: pr.mergeable === "conflicting",
    changesRequested:
      pr.reviewDecision === "changesRequested" ||
      requestingChanges(pr).length > 0,
    commented: commentedAtHead(pr).length > 0,
    readyToMerge:
      !pr.isDraft &&
      approved(pr) &&
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
        tooltip: byReviewers("Changes requested", requestingChanges(pr)),
      };
    case "commented":
      return {
        icon: "comment",
        color: "editorInfo.foreground",
        description: "commented",
        tooltip: byReviewers(
          "Commented on the latest commit",
          commentedAtHead(pr)
        ),
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

/**
 * Leaves out the pull request's author, whose reviews don't count. GitHub
 * leaves them out already; this keeps the rules from relying on it.
 */
function byOthers(
  pr: PullRequestSummary,
  reviews: LatestReview[]
): LatestReview[] {
  const author = pr.author.login.toLowerCase();
  return reviews.filter((r) => r.author.toLowerCase() !== author);
}

/**
 * The reviewers whose latest approval or request for changes requests
 * changes. A later reply in a thread is a comment-only review, which
 * doesn't take the request back.
 */
function requestingChanges(pr: PullRequestSummary): LatestReview[] {
  return byOthers(pr, pr.latestOpinionatedReviews).filter(
    (r) => r.verdict === "changesRequested"
  );
}

/** The reviewers whose latest review only commented, at the current head. */
function commentedAtHead(pr: PullRequestSummary): LatestReview[] {
  return byOthers(pr, pr.latestReviews).filter(
    (r) => r.verdict === "commented" && r.commit === pr.headSha
  );
}

/**
 * GitHub's review decision; where the repository requires no reviews and so
 * has none, some reviewer's approval and no request for changes.
 */
function approved(pr: PullRequestSummary): boolean {
  if (pr.reviewDecision) return pr.reviewDecision === "approved";
  const opinions = byOthers(pr, pr.latestOpinionatedReviews);
  return (
    opinions.some((r) => r.verdict === "approved") &&
    !opinions.some((r) => r.verdict === "changesRequested")
  );
}

/** "What by alice, bob", or just "What" when GitHub names no one. */
function byReviewers(what: string, reviews: LatestReview[]): string {
  if (reviews.length === 0) return what;
  return `${what} by ${reviews.map((r) => r.author).join(", ")}`;
}
