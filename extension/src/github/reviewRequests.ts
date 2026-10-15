// When a pull request last asked the Reviewer for a review, from its review
// requests on the timeline, so Home can say how long it has waited on them.

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
