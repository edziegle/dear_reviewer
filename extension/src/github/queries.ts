// The GraphQL queries that read the Inbox and the Reviewer's teams. They sit
// apart from the client so a unit test can weigh what the client sends
// without loading `vscode`, which the client reaches through `GitHubAuth`.
//
// GitHub counts a query's worst case before running it and refuses one over
// 500,000 nodes, so every query here is built to stay well under that; see
// `test/unit/nodeLimit.test.ts`, which weighs each of them.

const TEAM_MEMBERS_FIELDS = `members(first: 100) { nodes { login } pageInfo { hasNextPage endCursor } }`;

/**
 * The teams the viewer is on in one repository owner's organization, the
 * teams above them, and the first page of each team's members.
 *
 * It asks for the owner rather than for an organization so that a person's
 * account answers as a `User` with no teams, which is no failure and needs
 * no second request to tell from one; only a login that is no owner at all
 * comes back as an error. The owner's own `login` is what names a team, so
 * the Inbox shows GitHub's spelling rather than the Reviewer's.
 *
 * Asking one owner at a time is what keeps this under GitHub's limit of
 * 500,000 nodes: its worst case is about 111,000. Wrapping the same
 * selection in `organizations(first: 100)` multiplied that by a hundred and
 * GitHub refused the query outright (#221).
 */
export const ORGANIZATION_TEAMS = `query OrganizationTeams($organization: String!, $login: String!) {
  repositoryOwner(login: $organization) {
    __typename
    login
    ... on Organization {
      teams(first: 100, userLogins: [$login]) {
        nodes {
          slug
          ${TEAM_MEMBERS_FIELDS}
          ancestors(first: 10) { nodes { slug ${TEAM_MEMBERS_FIELDS} } }
        }
      }
    }
  }
}`;

/** The members after the first page, for a team of more than a hundred. */
export const TEAM_MEMBERS = `query TeamMembers($organization: String!, $slug: String!, $after: String) {
  organization(login: $organization) {
    team(slug: $slug) {
      members(first: 100, after: $after) { nodes { login } pageInfo { hasNextPage endCursor } }
    }
  }
}`;

/** The states of a submitted review: one that ended a Review. */
export const SUBMITTED_REVIEWS =
  "[APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]";

const INBOX_PULL_REQUEST = `fragment InboxPullRequest on PullRequest {
  __typename
  number
  title
  url
  updatedAt
  createdAt
  additions
  deletions
  changedFiles
  headRefName
  headRefOid
  baseRefName
  repository { nameWithOwner }
  author { __typename login avatarUrl }
  isDraft
  mergeable
  reviewDecision
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  reviews(last: 1, author: $reviewer, states: ${SUBMITTED_REVIEWS}) { nodes { commit { oid } submittedAt } }
  latestReviews(first: 100) { nodes { ...InboxReview } }
  latestOpinionatedReviews(first: 100) { nodes { ...InboxReview } }
  reviewRequests: timelineItems(last: 50, itemTypes: [REVIEW_REQUESTED_EVENT]) {
    nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer { ...Requested } } }
  }
  pendingRequests: reviewRequests(first: 30) { nodes { requestedReviewer { ...Requested } } }
}

fragment Requested on RequestedReviewer {
  __typename
  ... on User { login }
  ... on Team { slug organization { login } }
}

fragment InboxReview on PullRequestReview {
  state
  author { login }
  commit { oid }
}`;

/** What it takes to tell whether a teammate's review answered a Team request. */
const TEAM_HISTORY = `fragment TeamHistory on PullRequest {
  requestChanges: timelineItems(last: 100, itemTypes: [REVIEW_REQUESTED_EVENT, REVIEW_REQUEST_REMOVED_EVENT]) {
    nodes {
      __typename
      ... on ReviewRequestedEvent { createdAt requestedReviewer { ...Requested } }
      ... on ReviewRequestRemovedEvent { createdAt requestedReviewer { ...Requested } }
    }
  }
  submittedReviews: reviews(last: 100, states: [APPROVED, CHANGES_REQUESTED, COMMENTED]) {
    nodes { author { login } state submittedAt }
  }
}`;

/** One of the Inbox's searches, under the alias that reads its results back. */
export interface InboxSearch {
  alias: string;
  query: string;
}

/**
 * The searches that read one repository: the pull requests awaiting the
 * Reviewer's review, the ones they authored, and the ones they reviewed.
 * `withTeam` adds the open ones in none of those, for a repository whose
 * organization has a team the Reviewer is on, so a Team request a teammate
 * answered can be told from the review history.
 *
 * The aliases carry `index` to keep them apart once the repositories'
 * answers are read together.
 */
export function inboxSearches(
  repository: string,
  index: number,
  withTeam: boolean
): InboxSearch[] {
  const inside = `is:pr is:open archived:false repo:${repository}`;
  return [
    { alias: `awaiting${index}`, query: `${inside} review-requested:@me` },
    { alias: `authored${index}`, query: `${inside} author:@me` },
    {
      alias: `reviewed${index}`,
      query: `${inside} reviewed-by:@me -author:@me`,
    },
    ...(withTeam
      ? [
          {
            alias: `team${index}`,
            query: `${inside} -author:@me -reviewed-by:@me -review-requested:@me sort:updated-desc`,
          },
        ]
      : []),
  ];
}

/**
 * The query for one repository's searches.
 *
 * One repository to a query is what keeps the Inbox under GitHub's node
 * limit: about 85,000 without the review history and 133,000 with it,
 * whatever the number of repositories listed. Every repository's searches in
 * one query grew by that much each, crossed 500,000 at four repositories, and
 * GitHub then refused the whole Inbox (#223).
 */
export function inboxQuery(searches: InboxSearch[]): string {
  const withHistory = searches.some((s) => s.alias.startsWith("team"));
  return `query Inbox($reviewer: String!, ${searches.map((s) => `$${s.alias}: String!`).join(", ")}) {
${searches
  .map(
    (s) =>
      `  ${s.alias}: search(query: $${s.alias}, type: ISSUE, first: 100) { nodes { ...InboxPullRequest${s.alias.startsWith("team") ? " ...TeamHistory" : ""} } }`
  )
  .join("\n")}
}
${INBOX_PULL_REQUEST}${withHistory ? `\n${TEAM_HISTORY}` : ""}`;
}

/**
 * A page of a pull request's commits, with what decides whether Dear
 * Reviewer reads a commit's message: who GitHub says wrote it, and whether
 * GitHub verified the signature (ADR 0051). `message` is the whole message,
 * which is where Dependabot writes its `updated-dependencies:` block.
 *
 * One connection under two single nodes, so its worst case is 100.
 */
export const PULL_REQUEST_COMMITS = `query PullRequestCommits($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      commits(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          commit {
            oid
            message
            author { name email user { login } }
            signature { isValid wasSignedByGitHub signer { login } }
          }
        }
      }
    }
  }
}`;
