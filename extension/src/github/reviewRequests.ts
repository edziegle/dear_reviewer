// When a pull request last asked the Reviewer for a review, from its review
// requests on the timeline, so the Dashboard can say how long it has waited
// on them, and whether their Review answered it while the search still lists
// it.

import {
  requestedViaTeam,
  type MyTeam,
  type RequestedReviewer,
} from "./teamReviews";

/** A review request on a pull request's timeline. */
export interface ReviewRequest {
  createdAt: string;
  /** Whom it asked: a person by login, or a team; absent when GitHub hides it. */
  reviewer?: { kind: "user"; login: string } | { kind: "team" };
}

/**
 * When the review was last requested of the Reviewer: personally if it
 * ever was, or else from a team (a Team request), since a search for
 * reviews requested of the Reviewer lists only the teams they're on. A
 * request made again starts the wait again. Undefined when none is listed.
 */
export function requestedOfReviewerAt(
  requests: readonly ReviewRequest[],
  login: string
): string | undefined {
  const latest = (wanted: (request: ReviewRequest) => boolean) =>
    requests
      .filter(wanted)
      .map((request) => request.createdAt)
      .sort()
      .at(-1);
  return (
    latest(
      (r) =>
        r.reviewer?.kind === "user" &&
        r.reviewer.login.toLowerCase() === login.toLowerCase()
    ) ?? latest((r) => r.reviewer?.kind === "team")
  );
}

/**
 * Whether the Reviewer answered the review request that a search for
 * requests of them still finds, since GitHub's search index lags behind a
 * submitted Review for a while. The pull request itself is current: it no
 * longer asks them, personally or through a team they're on, and their last
 * Review came after it last asked them. A request made again asks anew.
 */
export function requestAnswered({
  pending,
  myTeams,
  login,
  requestedAt,
  reviewedAt,
}: {
  /** Whom the pull request asks for a review now. */
  pending: readonly RequestedReviewer[];
  myTeams: readonly MyTeam[];
  login: string;
  /** When it last asked them, as `requestedOfReviewerAt` gives it. */
  requestedAt: string | undefined;
  /** When they submitted their last Review. */
  reviewedAt: string | undefined;
}): boolean {
  const askedPersonally = pending.some(
    (r) => r.kind === "user" && r.login.toLowerCase() === login.toLowerCase()
  );
  if (askedPersonally || requestedViaTeam(pending, myTeams, login))
    return false;
  return (
    !!requestedAt &&
    !!reviewedAt &&
    Date.parse(reviewedAt) > Date.parse(requestedAt)
  );
}
