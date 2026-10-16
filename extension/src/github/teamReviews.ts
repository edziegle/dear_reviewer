// Team requests (see GLOSSARY.md), worked out from a pull request's review
// requests and reviews: which team a pending request came through, and
// whether a teammate's review answered one, so the pull request belongs in
// Reviewed by my team. Nothing is remembered: the Inbox reads these from
// GitHub on each refresh.

import type { ReviewVerdict } from "./client";

/** A team the Reviewer is on, directly or through a child team, and its members' logins. */
export interface MyTeam {
  /** `org/slug`. */
  name: string;
  members: readonly string[];
}

export type RequestedReviewer =
  { kind: "user"; login: string } | { kind: "team"; team: string };

/** A review requested of someone on the timeline, or the request taken away. */
export interface RequestChange {
  kind: "requested" | "removed";
  at: string;
  reviewer: RequestedReviewer;
}

/** A submitted review, whatever its verdict. */
export interface SubmittedReview {
  author: string;
  verdict: ReviewVerdict;
  at: string;
}

/** A teammate's review that answered a Team request. */
export interface TeamAnswer {
  team: string;
  reviewer: string;
  verdict: ReviewVerdict;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * The team a pending review request came through, when it is a Team request
 * to a team the Reviewer is on and the Reviewer wasn't also asked
 * personally, which counts as a personal request. Undefined otherwise.
 */
export function requestedViaTeam(
  pending: readonly RequestedReviewer[],
  myTeams: readonly MyTeam[],
  login: string
): string | undefined {
  if (pending.some((r) => r.kind === "user" && same(r.login, login))) return;
  for (const request of pending)
    if (
      request.kind === "team" &&
      myTeams.some((team) => same(team.name, request.team))
    )
      return request.team;
}

/**
 * The teammate's review that answered a Team request to a team the Reviewer
 * is on: the team isn't asked now, its latest request wasn't taken away
 * (which GitHub's automatic review assignment does), and a member of the
 * team, other than the author, has reviewed since. Of several answers, the
 * latest review. Undefined when no Team request was answered.
 */
export function answeredByTeam({
  changes,
  pending,
  reviews,
  myTeams,
  author,
}: {
  changes: readonly RequestChange[];
  pending: readonly RequestedReviewer[];
  reviews: readonly SubmittedReview[];
  myTeams: readonly MyTeam[];
  author: string;
}): TeamAnswer | undefined {
  let latest: { answer: TeamAnswer; at: string } | undefined;
  for (const team of myTeams) {
    if (pending.some((r) => r.kind === "team" && same(r.team, team.name)))
      continue;
    const events = changes
      .filter(
        (c) => c.reviewer.kind === "team" && same(c.reviewer.team, team.name)
      )
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const last = events.at(-1);
    if (last?.kind !== "requested") continue;
    const answering = reviews
      .filter(
        (r) =>
          r.verdict !== "dismissed" &&
          !same(r.author, author) &&
          team.members.some((m) => same(m, r.author)) &&
          Date.parse(r.at) >= Date.parse(last.at)
      )
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
      .at(-1);
    if (
      answering &&
      (!latest || Date.parse(answering.at) > Date.parse(latest.at))
    )
      latest = {
        at: answering.at,
        answer: {
          team: team.name,
          reviewer: answering.author,
          verdict: answering.verdict,
        },
      };
  }
  return latest?.answer;
}

const verdictWords: Record<ReviewVerdict, string> = {
  approved: "Approved",
  changesRequested: "Changes requested",
  commented: "Commented",
  dismissed: "Dismissed",
};

/** Such as `Approved by @octocat`. */
export function reviewedByLabel(answer: TeamAnswer): string {
  return `${verdictWords[answer.verdict]} by @${answer.reviewer}`;
}

/** Such as `via @acme/api-owners`. */
export function viaLabel(team: string): string {
  return `via @${team}`;
}

/**
 * What a row says of a Team request: who reviewed and how, then the team
 * asked, for a pull request a teammate answered; or the team of a pending
 * request. Nothing for a pull request with neither.
 */
export function teamNotes(pr: {
  reviewedByTeam?: TeamAnswer;
  requestedViaTeam?: string;
}): string[] {
  if (pr.reviewedByTeam)
    return [
      reviewedByLabel(pr.reviewedByTeam),
      viaLabel(pr.reviewedByTeam.team),
    ];
  return pr.requestedViaTeam ? [viaLabel(pr.requestedViaTeam)] : [];
}
