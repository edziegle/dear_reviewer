// Talks to GitHub: GraphQL where it covers the operation, REST elsewhere,
// against a configurable API base URL.

import { isCommitId, isSafeBranchName } from "../refreshGate";
import { GitHubAuth, trustedOrigin } from "./auth";
import {
  requestAnswered,
  requestedOfReviewerAt,
  type ReviewRequest,
} from "./reviewRequests";
import { fetchWithin, REQUEST_TIMEOUT_MS } from "./request";
import {
  answeredByTeam,
  requestedViaTeam,
  type MyTeam,
  type RequestChange,
  type RequestedReviewer,
  type SubmittedReview,
  type TeamAnswer,
} from "./teamReviews";

export type CheckStatus = "passed" | "failed" | "running";

export interface PullRequestSummary {
  /** owner/name */
  repository: string;
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  createdAt: string;
  /** When it last asked me for a review, personally or through a team; undefined when it never did. */
  reviewRequestedAt?: string;
  /** `org/slug` of the team a pending Team request to me came through; undefined when it asks me personally too, or asks no team I'm on. */
  requestedViaTeam?: string;
  /** For a pull request in Reviewed by my team: the teammate's review that answered the Team request. */
  reviewedByTeam?: TeamAnswer;
  /** How big it is: its changed files and lines. */
  size: { files: number; additions: number; deletions: number };
  author: { login: string; avatarUrl: string };
  headRefName: string;
  headSha: string;
  baseRefName: string;
  /** The latest commit's combined checks; undefined when it has none. */
  checks?: CheckStatus;
  /** The head commit my last submitted Review covered; undefined if I haven't reviewed it. */
  lastReviewedSha?: string;
  isDraft: boolean;
  /** Whether it merges into its base cleanly; unknown while GitHub works it out. */
  mergeable: Mergeability;
  /** GitHub's review decision; undefined where the base branch requires no reviews. */
  reviewDecision?: ReviewDecision;
  /**
   * Each reviewer's latest submitted review, whatever its verdict, so a reply
   * in a thread replaces an approval. GitHub leaves out the author's own, and
   * a reviewer whose review was requested again.
   */
  latestReviews: LatestReview[];
  /**
   * Each reviewer's latest review that approved or requested changes. GitHub
   * leaves out a reviewer whose latest such review was dismissed.
   */
  latestOpinionatedReviews: LatestReview[];
}

export type Mergeability = "mergeable" | "conflicting" | "unknown";

export type ReviewDecision = "approved" | "changesRequested" | "reviewRequired";

/** One reviewer's latest submitted review of a pull request. */
export interface LatestReview {
  /** The reviewer's login. */
  author: string;
  verdict: ReviewVerdict;
  /** The head commit it covered. */
  commit?: string;
}

/** The Reviewer's last submitted review of a pull request. */
export interface LastReview {
  /** The head commit it covered. */
  commit: string;
  verdict?: ReviewVerdict;
  submittedAt?: string;
  /** Its page on GitHub. */
  url?: string;
  /** How many Comments on the diff it published. */
  comments?: number;
  /** Whether it ended with a copied Brief, for a local Change, not a verdict. */
  brief?: boolean;
}

export interface InboxPullRequests {
  awaitingMyReview: PullRequestSummary[];
  authoredByMe: PullRequestSummary[];
  /** Ones I reviewed and didn't author, leaving out any awaiting my review again. */
  reviewedByMe: PullRequestSummary[];
  /** Open ones whose Team request to a team I'm on a teammate's review answered, in none of the other lists. */
  reviewedByMyTeam: PullRequestSummary[];
}

export interface PullRequestFiles {
  /** The pull request's node id, which mutations name it by. */
  id: string;
  files: { path: string; viewed: boolean }[];
}

/** GitHub's name for a side of a pull request's diff: LEFT is the base, RIGHT the head. */
export type PullRequestState = "OPEN" | "MERGED" | "CLOSED";

/** A pull request's state, head commit and base branch on GitHub. */
export interface PullRequestHead {
  state: PullRequestState;
  headRefOid: string;
  baseRefName: string;
}

export type DiffSide = "LEFT" | "RIGHT";

export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

/** Where a review thread sits: a line, or a range of lines, of one side of a file's diff. */
export interface ThreadPlace {
  path: string;
  side: DiffSide;
  /** The last line, counted from 1. */
  line: number;
  /** The first line of a multi-line range. */
  startLine?: number;
}

export interface ReviewThreadComment {
  id: string;
  body: string;
  author: GitHubUser;
  createdAt: string;
  /** Written in the viewer's pending review, so only they can see it yet. */
  pending: boolean;
}

/**
 * A review thread on the pull request's diff. An outdated thread's lines are
 * gone from the head, and its place is where it was written.
 */
export interface ReviewThread extends ThreadPlace {
  id: string;
  /** Started in the viewer's pending review. */
  pending: boolean;
  resolved: boolean;
  outdated: boolean;
  /** The lines it was written on, when GitHub has since moved it to `line`. */
  original?: { line: number; startLine?: number };
  comments: ReviewThreadComment[];
}

export interface PullRequestReviewThreads {
  /** The pull request's node id. */
  pullRequestId: string;
  viewer: GitHubUser;
  /** The viewer's pending review, if there is one. */
  pendingReviewId?: string;
  /** Every thread the viewer can see: published ones, and those in their pending review. */
  threads: ReviewThread[];
}

/** What the pull request's author wrote about it. */
export interface PullRequestDescription {
  title: string;
  /** Markdown; empty when the author wrote none. */
  body: string;
}

export interface GitHubUser {
  login: string;
  avatarUrl: string;
}

/** Something that happened on a pull request, as its timeline shows it. */
export type TimelineEvent =
  | { kind: "description"; author: GitHubUser; date: string; body: string }
  | {
      kind: "commit";
      /** The commit's author: a GitHub user, or their git name and avatar. */
      author: GitHubUser;
      date: string;
      sha: string;
      headline: string;
    }
  | { kind: "comment"; author: GitHubUser; date: string; body: string }
  | {
      kind: "review";
      author: GitHubUser;
      date: string;
      verdict: ReviewVerdict;
      body: string;
      /** How many Comments on the diff the review holds. */
      comments: number;
    };

export type ReviewVerdict =
  "approved" | "changesRequested" | "commented" | "dismissed";

export type CheckRunStatus =
  "passed" | "failed" | "running" | "skipped" | "neutral";

export interface CheckRun {
  name: string;
  status: CheckRunStatus;
  /** The check's details page. */
  url?: string;
}

export interface PullRequestTimeline {
  title: string;
  url: string;
  /** The branch the pull request merges into. */
  baseRef: string;
  /** The description first, then commits, Comments and submitted reviews in GitHub's order. */
  events: TimelineEvent[];
  /** The latest commit's checks; undefined when it has none. */
  checks?: { commit: string; status?: CheckStatus; runs: CheckRun[] };
}

export class NotSignedInError extends Error {
  constructor() {
    super("Not signed in to GitHub");
  }
}

export class GitHubError extends Error {}

/** GitHub turned the token down: signing in again is the way out. */
export class SignInRejectedError extends GitHubError {
  constructor() {
    super("GitHub rejected the sign-in (401 Bad credentials)");
  }
}

export class GitHubClient {
  /** How long a request waits for GitHub to start answering; tests shorten it. */
  requestTimeoutMs = REQUEST_TIMEOUT_MS;
  /** The signed-in user's login, by API URL and token, once asked. */
  private signedIn?: { key: string; login: Promise<string> };

  constructor(
    private readonly auth: GitHubAuth,
    private readonly apiUrl: () => string
  ) {}

  /**
   * Open pull requests in these repositories that await my review, that I
   * authored, or that I reviewed, and ones whose Team request a teammate's
   * review answered. The last are read from the review history of the open
   * pull requests in none of the other lists, and only for repositories of
   * an organization with a team I'm on.
   */
  async inbox(repositories: string[]): Promise<InboxPullRequests> {
    if (repositories.length === 0)
      return {
        awaitingMyReview: [],
        authoredByMe: [],
        reviewedByMe: [],
        reviewedByMyTeam: [],
      };
    const reviewer = await this.viewerLogin();
    const myTeams = await this.myTeams(reviewer, repositories);
    const teamOrganizations = new Set(
      myTeams.map((team) => team.name.split("/")[0].toLowerCase())
    );
    const searches = repositories.flatMap((repository, i) => [
      {
        alias: `awaiting${i}`,
        query: `is:pr is:open archived:false repo:${repository} review-requested:@me`,
      },
      {
        alias: `authored${i}`,
        query: `is:pr is:open archived:false repo:${repository} author:@me`,
      },
      {
        alias: `reviewed${i}`,
        query: `is:pr is:open archived:false repo:${repository} reviewed-by:@me -author:@me`,
      },
      ...(teamOrganizations.has(repository.split("/")[0].toLowerCase())
        ? [
            {
              alias: `team${i}`,
              query: `is:pr is:open archived:false repo:${repository} -author:@me -reviewed-by:@me -review-requested:@me sort:updated-desc`,
            },
          ]
        : []),
    ]);
    const withHistory = searches.some((s) => s.alias.startsWith("team"));
    const query = `query Inbox($reviewer: String!, ${searches.map((s) => `$${s.alias}: String!`).join(", ")}) {
${searches
  .map(
    (s) =>
      `  ${s.alias}: search(query: $${s.alias}, type: ISSUE, first: 100) { nodes { ...InboxPullRequest${s.alias.startsWith("team") ? " ...TeamHistory" : ""} } }`
  )
  .join("\n")}
}
${INBOX_PULL_REQUEST}${withHistory ? `\n${TEAM_HISTORY}` : ""}`;
    const data = await this.graphql<
      Record<string, { nodes: PullRequestNode[] }>
    >(query, {
      reviewer,
      ...Object.fromEntries(searches.map((s) => [s.alias, s.query])),
    });
    const nodesOf = (prefix: string) =>
      searches
        .filter((s) => s.alias.startsWith(prefix))
        .flatMap((s) => data[s.alias]?.nodes ?? [])
        .filter((node) => node.__typename === "PullRequest");
    const byUpdated = (a: PullRequestSummary, b: PullRequestSummary) =>
      b.updatedAt.localeCompare(a.updatedAt);
    const summariesOf = (nodes: PullRequestNode[]) =>
      nodes.map((node) => summaryOf(node, reviewer, myTeams)).sort(byUpdated);
    const collect = (prefix: string) => summariesOf(nodesOf(prefix));
    const keyOf = (pr: PullRequestSummary) => `${pr.repository}#${pr.number}`;
    // The search lists a pull request as awaiting my review for a while after my Review answered it.
    const answered = (node: PullRequestNode) =>
      requestAnswered({
        pending: pendingReviewersOf(node.pendingRequests),
        myTeams,
        login: reviewer,
        requestedAt: requestedOfReviewerAt(
          reviewRequestsOf(node.reviewRequests),
          reviewer
        ),
        reviewedAt: node.reviews.nodes.at(-1)?.submittedAt ?? undefined,
      });
    const awaitingNodes = nodesOf("awaiting");
    const awaitingMyReview = summariesOf(
      awaitingNodes.filter((node) => !answered(node))
    );
    const awaiting = new Set(awaitingMyReview.map(keyOf));
    const authoredByMe = collect("authored");
    const reviewedFound = collect("reviewed");
    const reviewedListed = new Set(reviewedFound.map(keyOf));
    const reviewedByMe = [
      ...reviewedFound,
      ...summariesOf(awaitingNodes.filter(answered)).filter(
        (pr) => !reviewedListed.has(keyOf(pr))
      ),
    ]
      .filter((pr) => !awaiting.has(keyOf(pr)))
      .sort(byUpdated);
    const elsewhere = new Set(
      [...awaitingMyReview, ...authoredByMe, ...reviewedByMe].map(keyOf)
    );
    const reviewedByMyTeam = nodesOf("team").flatMap((node) => {
      const summary = summaryOf(node, reviewer, myTeams);
      const reviewedByTeam = answeredByTeam({
        changes: requestChangesOf(node.requestChanges),
        pending: pendingReviewersOf(node.pendingRequests),
        reviews: submittedReviewsOf(node.submittedReviews),
        myTeams,
        author: summary.author.login,
      });
      return reviewedByTeam && !elsewhere.has(keyOf(summary))
        ? [{ ...summary, reviewedByTeam }]
        : [];
    });
    return {
      awaitingMyReview,
      authoredByMe,
      reviewedByMe,
      reviewedByMyTeam: reviewedByMyTeam.sort(byUpdated),
    };
  }

  /**
   * The teams I'm on in the organizations of these repositories, and the
   * teams above them, with every member of each: a request to a parent team
   * reaches me through a child team. None when GitHub won't say, such as for
   * a token without `read:org`, so the Inbox still loads.
   */
  private async myTeams(
    login: string,
    repositories: string[]
  ): Promise<MyTeam[]> {
    const owners = new Set(
      repositories.map((repository) => repository.split("/")[0].toLowerCase())
    );
    let data: ViewerTeamsData;
    try {
      data = await this.graphql<ViewerTeamsData>(VIEWER_TEAMS, {
        reviewer: login,
      });
    } catch (err) {
      if (err instanceof GitHubError && !(err instanceof SignInRejectedError))
        return [];
      throw err;
    }
    const teams = new Map<
      string,
      { organization: string; slug: string; members: TeamMembersNode }
    >();
    for (const organization of data.viewer?.organizations.nodes ?? []) {
      if (!owners.has(organization.login.toLowerCase())) continue;
      for (const team of organization.teams.nodes)
        for (const t of [team, ...team.ancestors.nodes])
          teams.set(`${organization.login}/${t.slug}`.toLowerCase(), {
            organization: organization.login,
            slug: t.slug,
            members: t.members,
          });
    }
    return Promise.all(
      [...teams.values()].map(async ({ organization, slug, members }) => ({
        name: `${organization}/${slug}`,
        members: await this.allMembers(organization, slug, members),
      }))
    );
  }

  /** Every member's login: the first page, then the pages after it. */
  private async allMembers(
    organization: string,
    slug: string,
    first: TeamMembersNode
  ): Promise<string[]> {
    const logins = first.nodes.map((member) => member.login);
    let page = first.pageInfo;
    // A team of more than a thousand members is read no further.
    for (let i = 0; page.hasNextPage && i < 9; i++) {
      try {
        const data: TeamMembersData = await this.graphql<TeamMembersData>(
          TEAM_MEMBERS,
          { organization, slug, after: page.endCursor }
        );
        const more = data.organization?.team?.members;
        if (!more) break;
        logins.push(...more.nodes.map((member) => member.login));
        page = more.pageInfo;
      } catch (err) {
        if (err instanceof GitHubError && !(err instanceof SignInRejectedError))
          break;
        throw err;
      }
    }
    return logins;
  }

  /**
   * The pull request's changed files and whether I've marked each viewed. A
   * file viewed before a later commit changed it counts as not viewed, as on
   * github.com.
   */
  async pullRequestFiles(
    repository: string,
    number: number
  ): Promise<PullRequestFiles> {
    const [owner, name] = repository.split("/");
    const files: PullRequestFiles["files"] = [];
    let id = "";
    let after: string | null = null;
    do {
      const data: PullRequestFilesData =
        await this.graphql<PullRequestFilesData>(PULL_REQUEST_FILES, {
          owner,
          name,
          number,
          after,
        });
      const pullRequest = data.repository?.pullRequest;
      if (!pullRequest)
        throw new GitHubError(`No pull request ${repository}#${number}`);
      id = pullRequest.id;
      for (const node of pullRequest.files?.nodes ?? [])
        files.push({
          path: node.path,
          viewed: node.viewerViewedState === "VIEWED",
        });
      const page = pullRequest.files?.pageInfo;
      after = page?.hasNextPage ? page.endCursor : null;
    } while (after);
    return { id, files };
  }

  /**
   * The signed-in user's last submitted review of the pull request, with the
   * head commit GitHub records it covered. Undefined if they haven't
   * submitted one.
   */
  async lastReview(
    repository: string,
    number: number
  ): Promise<LastReview | undefined> {
    const [owner, name] = repository.split("/");
    const reviewer = await this.viewerLogin();
    const data = await this.graphql<{
      repository: { pullRequest: { reviews: ReviewsNode } | null } | null;
    }>(LAST_REVIEW, { owner, name, number, reviewer });
    const review = data.repository?.pullRequest?.reviews.nodes.at(-1);
    const commit = lastReviewedSha(data.repository?.pullRequest?.reviews);
    if (!review || !commit) return;
    return {
      commit,
      verdict: verdicts[review.state ?? ""],
      submittedAt: review.submittedAt ?? undefined,
      url: review.url,
      comments: review.comments?.totalCount,
    };
  }

  /** Whether the pull request is open, merged or closed; undefined if GitHub has no such pull request. */
  async pullRequestState(
    repository: string,
    number: number
  ): Promise<PullRequestState | undefined> {
    const [owner, name] = repository.split("/");
    const data = await this.graphql<{
      repository: { pullRequest: { state: PullRequestState } | null } | null;
    }>(PULL_REQUEST_STATE, { owner, name, number });
    return data.repository?.pullRequest?.state;
  }

  /**
   * Where the pull request stands on GitHub now: its state, head commit and
   * base branch; undefined if GitHub has no such pull request.
   */
  async pullRequestHead(
    repository: string,
    number: number
  ): Promise<PullRequestHead | undefined> {
    const [owner, name] = repository.split("/");
    const data = await this.graphql<{
      repository: { pullRequest: PullRequestHead | null } | null;
    }>(PULL_REQUEST_HEAD, { owner, name, number });
    const head = data.repository?.pullRequest;
    if (!head) return;
    // Both are handed to git, so they must be what they claim to be.
    if (!isCommitId(head.headRefOid) || !isSafeBranchName(head.baseRefName))
      throw new GitHubError(
        `GitHub gave an unusable head or base for ${repository}#${number}`
      );
    return head;
  }

  /** The pull request's title and description; undefined if GitHub has no such pull request. */
  async pullRequestDescription(
    repository: string,
    number: number
  ): Promise<PullRequestDescription | undefined> {
    const [owner, name] = repository.split("/");
    const data = await this.graphql<{
      repository: { pullRequest: PullRequestDescription | null } | null;
    }>(PULL_REQUEST_DESCRIPTION, { owner, name, number });
    return data.repository?.pullRequest ?? undefined;
  }

  /** Marks these files of the pull request viewed, or not viewed, in one request. */
  async setFilesViewed(
    pullRequestId: string,
    paths: string[],
    viewed: boolean
  ): Promise<void> {
    if (paths.length === 0) return;
    const mutation = viewed ? "markFileAsViewed" : "unmarkFileAsViewed";
    const query = `mutation SetFilesViewed($pullRequestId: ID!, ${paths
      .map((_, i) => `$path${i}: String!`)
      .join(", ")}) {
${paths
  .map(
    (_, i) =>
      `  file${i}: ${mutation}(input: {pullRequestId: $pullRequestId, path: $path${i}}) { clientMutationId }`
  )
  .join("\n")}
}`;
    await this.graphql(query, {
      pullRequestId,
      ...Object.fromEntries(paths.map((p, i) => [`path${i}`, p])),
    });
  }

  /**
   * The pull request's review threads, and the viewer's pending review, if
   * any. GitHub allows one pending review per person and pull request, and
   * only its author can see it or the Comments in it.
   */
  async reviewThreads(
    repository: string,
    number: number
  ): Promise<PullRequestReviewThreads> {
    const [owner, name] = repository.split("/");
    let found: PullRequestReviewThreads | undefined;
    const threads: ReviewThreadNode[] = [];
    let after: string | null = null;
    do {
      const data: ReviewThreadsData = await this.graphql<ReviewThreadsData>(
        REVIEW_THREADS,
        { owner, name, number, after }
      );
      const pullRequest = data.repository?.pullRequest;
      if (!pullRequest)
        throw new GitHubError(`No pull request ${repository}#${number}`);
      const review = pullRequest.reviews.nodes.find((r) => r.viewerDidAuthor);
      found ??= {
        pullRequestId: pullRequest.id,
        viewer: data.viewer,
        ...(review && { pendingReviewId: review.id }),
        threads: [],
      };
      threads.push(...pullRequest.reviewThreads.nodes);
      const page = pullRequest.reviewThreads.pageInfo;
      after = page.hasNextPage ? page.endCursor : null;
    } while (after);
    const pendingId = found.pendingReviewId;
    for (const thread of threads) {
      // A thread on a whole file has no line.
      const line = thread.line ?? thread.originalLine;
      if (line === null) continue;
      const startLine =
        thread.line === null ? thread.originalStartLine : thread.startLine;
      const comments = thread.comments.nodes.map((c) => ({
        id: c.id,
        body: c.body,
        author: userOf(c.author),
        createdAt: c.createdAt,
        pending:
          pendingId !== undefined && c.pullRequestReview?.id === pendingId,
      }));
      found.threads.push({
        id: thread.id,
        path: thread.path,
        side: thread.diffSide,
        line,
        ...(startLine !== null && startLine < line && { startLine }),
        ...(thread.line !== null &&
          thread.originalLine !== null &&
          thread.originalLine !== thread.line && {
            original: {
              line: thread.originalLine,
              ...(thread.originalStartLine !== null &&
                thread.originalStartLine < thread.originalLine && {
                  startLine: thread.originalStartLine,
                }),
            },
          }),
        pending: comments[0]?.pending ?? false,
        resolved: thread.isResolved,
        outdated: thread.isOutdated || thread.line === null,
        comments,
      });
    }
    return found;
  }

  /**
   * The pull request's description, commits, Comments and submitted reviews,
   * in order, and its latest commit's checks. Pending reviews are left out:
   * the viewer's own is in the gutter, and nobody else's is visible.
   */
  async timeline(
    repository: string,
    number: number
  ): Promise<PullRequestTimeline> {
    const [owner, name] = repository.split("/");
    let found: PullRequestTimeline | undefined;
    let after: string | null = null;
    do {
      const data: TimelineData = await this.graphql<TimelineData>(
        PULL_REQUEST_TIMELINE,
        { owner, name, number, after }
      );
      const pullRequest = data.repository?.pullRequest;
      if (!pullRequest)
        throw new GitHubError(`No pull request ${repository}#${number}`);
      found ??= {
        title: pullRequest.title,
        url: pullRequest.url,
        baseRef: pullRequest.baseRefName,
        events: [
          {
            kind: "description",
            author: userOf(pullRequest.author),
            date: pullRequest.createdAt,
            body: pullRequest.body,
          },
        ],
        checks: checksOf(pullRequest.commits.nodes[0]?.commit),
      };
      for (const node of pullRequest.timelineItems.nodes) {
        const event = timelineEventOf(node);
        if (event) found.events.push(event);
      }
      const page = pullRequest.timelineItems.pageInfo;
      after = page.hasNextPage ? page.endCursor : null;
    } while (after);
    return found;
  }

  /**
   * Starts the viewer's pending review of the pull request at the commit it
   * covers, giving its id.
   */
  async startReview(pullRequestId: string, commit: string): Promise<string> {
    const data = await this.graphql<{
      addPullRequestReview: { pullRequestReview: { id: string } };
    }>(
      `mutation StartReview($input: AddPullRequestReviewInput!) {
  addPullRequestReview(input: $input) { pullRequestReview { id } }
}`,
      { input: { pullRequestId, commitOID: commit } }
    );
    return data.addPullRequestReview.pullRequestReview.id;
  }

  /** Starts a thread in the pending review, with its first Comment. */
  async addReviewThread(
    reviewId: string,
    place: ThreadPlace,
    body: string
  ): Promise<{ threadId: string; commentId: string }> {
    const data = await this.graphql<{
      addPullRequestReviewThread: {
        thread: { id: string; comments: { nodes: { id: string }[] } };
      };
    }>(
      `mutation AddReviewThread($input: AddPullRequestReviewThreadInput!) {
  addPullRequestReviewThread(input: $input) { thread { id comments(first: 1) { nodes { id } } } }
}`,
      {
        input: {
          pullRequestReviewId: reviewId,
          path: place.path,
          body,
          side: place.side,
          line: place.line,
          ...(place.startLine !== undefined && {
            startLine: place.startLine,
            startSide: place.side,
          }),
        },
      }
    );
    const thread = data.addPullRequestReviewThread.thread;
    return { threadId: thread.id, commentId: thread.comments.nodes[0].id };
  }

  /**
   * Replies to a review thread: in the pending review, if one is given, or
   * else published at once.
   */
  async replyToThread(
    threadId: string,
    body: string,
    pendingReviewId?: string
  ): Promise<string> {
    const data = await this.graphql<{
      addPullRequestReviewThreadReply: { comment: { id: string } };
    }>(
      `mutation ReplyToThread($input: AddPullRequestReviewThreadReplyInput!) {
  addPullRequestReviewThreadReply(input: $input) { comment { id } }
}`,
      {
        input: {
          pullRequestReviewThreadId: threadId,
          body,
          ...(pendingReviewId !== undefined && {
            pullRequestReviewId: pendingReviewId,
          }),
        },
      }
    );
    return data.addPullRequestReviewThreadReply.comment.id;
  }

  async setThreadResolved(threadId: string, resolved: boolean): Promise<void> {
    const mutation = resolved ? "resolveReviewThread" : "unresolveReviewThread";
    const input = resolved
      ? "ResolveReviewThreadInput"
      : "UnresolveReviewThreadInput";
    await this.graphql(
      `mutation SetThreadResolved($input: ${input}!) {
  ${mutation}(input: $input) { thread { id isResolved } }
}`,
      { input: { threadId } }
    );
  }

  async editReviewComment(commentId: string, body: string): Promise<void> {
    await this.graphql(
      `mutation EditReviewComment($input: UpdatePullRequestReviewCommentInput!) {
  updatePullRequestReviewComment(input: $input) { pullRequestReviewComment { id } }
}`,
      { input: { pullRequestReviewCommentId: commentId, body } }
    );
  }

  /** Deletes a pending Comment; GitHub drops its thread when it was the only one. */
  async deleteReviewComment(commentId: string): Promise<void> {
    await this.graphql(
      `mutation DeleteReviewComment($input: DeletePullRequestReviewCommentInput!) {
  deletePullRequestReviewComment(input: $input) { pullRequestReview { id } }
}`,
      { input: { id: commentId } }
    );
  }

  /** Deletes the pending review, with its Comments, unpublished. */
  async deleteReview(reviewId: string): Promise<void> {
    await this.graphql(
      `mutation DeleteReview($input: DeletePullRequestReviewInput!) {
  deletePullRequestReview(input: $input) { pullRequestReview { id } }
}`,
      { input: { pullRequestReviewId: reviewId } }
    );
  }

  /**
   * Submits the pending review with a verdict and a summary, which publishes
   * its Comments. Gives the submitted review's page on GitHub.
   */
  async submitReview(
    reviewId: string,
    event: ReviewEvent,
    body: string
  ): Promise<{ url?: string }> {
    const data = await this.graphql<{
      submitPullRequestReview: { pullRequestReview: { url?: string } | null };
    }>(
      `mutation SubmitReview($input: SubmitPullRequestReviewInput!) {
  submitPullRequestReview(input: $input) { pullRequestReview { id url } }
}`,
      { input: { pullRequestReviewId: reviewId, event, body } }
    );
    return { url: data.submitPullRequestReview.pullRequestReview?.url };
  }

  /**
   * Downloads an image such as an avatar. The token is only sent when the
   * image lives on the API's own host (GitHub Enterprise).
   */
  async image(url: string): Promise<Uint8Array> {
    const headers: Record<string, string> = {};
    const apiUrl = this.apiUrl();
    if (new URL(url).origin === new URL(apiUrl).origin) {
      const token = await this.auth.token(apiUrl);
      if (token) headers.authorization = `Bearer ${token}`;
    }
    const res = await fetchWithin(url, { headers }, this.requestTimeoutMs);
    if (!res.ok) throw new GitHubError(`${url}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  /** The signed-in user's login. */
  viewer(): Promise<string> {
    return this.viewerLogin();
  }

  /** The signed-in user's login, asked once for each API URL and token. */
  private async viewerLogin(): Promise<string> {
    const apiUrl = this.apiUrl();
    trustedOrigin(apiUrl);
    const token = await this.auth.token(apiUrl);
    if (!token) throw new NotSignedInError();
    const key = `${apiUrl}\0${token}`;
    if (this.signedIn?.key !== key) {
      const login = this.graphql<{ viewer: { login: string } }>(
        `query Viewer { viewer { login } }`,
        {}
      ).then((data) => data.viewer.login);
      const asked = { key, login };
      login.catch(() => {
        if (this.signedIn === asked) this.signedIn = undefined;
      });
      this.signedIn = asked;
    }
    return this.signedIn.login;
  }

  private async graphql<T>(
    query: string,
    variables: Record<string, unknown>
  ): Promise<T> {
    const apiUrl = this.apiUrl();
    trustedOrigin(apiUrl);
    const token = await this.auth.token(apiUrl);
    if (!token) throw new NotSignedInError();
    const res = await fetchWithin(
      graphqlUrl(apiUrl),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
      },
      this.requestTimeoutMs
    );
    if (res.status === 401) throw new SignInRejectedError();
    if (!res.ok) throw new GitHubError(`GitHub answered ${res.status}`);
    const body = (await res.json()) as {
      data?: T;
      errors?: { message: string }[];
    };
    if (body.errors?.length)
      throw new GitHubError(body.errors.map((e) => e.message).join("; "));
    return body.data as T;
  }
}

/** api.github.com/graphql, or <host>/api/graphql for GitHub Enterprise. */
function graphqlUrl(apiUrl: string): string {
  const base = apiUrl.replace(/\/+$/, "");
  return base.endsWith("/api/v3")
    ? `${base.slice(0, -"/v3".length)}/graphql`
    : `${base}/graphql`;
}

/** The states of a submitted review: one that ended a Review. */
const SUBMITTED_REVIEWS = "[APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]";

const LAST_REVIEW = `query LastReview($owner: String!, $name: String!, $number: Int!, $reviewer: String!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviews(last: 1, author: $reviewer, states: ${SUBMITTED_REVIEWS}) {
        nodes { commit { oid } state submittedAt url comments { totalCount } }
      }
    }
  }
}`;

interface ReviewsNode {
  nodes: ({
    commit: { oid: string } | null;
    state?: string;
    submittedAt?: string | null;
    url?: string;
    comments?: { totalCount: number };
  } | null)[];
}

function lastReviewedSha(reviews: ReviewsNode | undefined): string | undefined {
  const oid = reviews?.nodes.at(-1)?.commit?.oid;
  // It is handed to git, so it must be a commit id and nothing else.
  return oid && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(oid) ? oid : undefined;
}

const PULL_REQUEST_STATE = `query PullRequestState($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { state }
  }
}`;

const PULL_REQUEST_HEAD = `query PullRequestHead($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { state headRefOid baseRefName }
  }
}`;

const PULL_REQUEST_DESCRIPTION = `query PullRequestDescription($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { title body }
  }
}`;

const PULL_REQUEST_FILES = `query PullRequestFiles($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id
      files(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { path viewerViewedState }
      }
    }
  }
}`;

interface PullRequestFilesData {
  repository: {
    pullRequest: {
      id: string;
      files: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: { path: string; viewerViewedState: string }[];
      } | null;
    } | null;
  } | null;
}

const REVIEW_THREADS = `query ReviewThreads($owner: String!, $name: String!, $number: Int!, $after: String) {
  viewer { login avatarUrl }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id
      reviews(states: [PENDING], first: 10) { nodes { id viewerDidAuthor } }
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          path
          diffSide
          line
          startLine
          originalLine
          originalStartLine
          isOutdated
          isResolved
          comments(first: 100) {
            nodes { id body createdAt author { login avatarUrl } pullRequestReview { id } }
          }
        }
      }
    }
  }
}`;

interface ReviewThreadNode {
  id: string;
  path: string;
  diffSide: DiffSide;
  line: number | null;
  startLine: number | null;
  originalLine: number | null;
  originalStartLine: number | null;
  isOutdated: boolean;
  isResolved: boolean;
  comments: {
    nodes: {
      id: string;
      body: string;
      createdAt: string;
      author: GitHubUser | null;
      pullRequestReview: { id: string } | null;
    }[];
  };
}

interface ReviewThreadsData {
  viewer: { login: string; avatarUrl: string };
  repository: {
    pullRequest: {
      id: string;
      reviews: { nodes: { id: string; viewerDidAuthor: boolean }[] };
      reviewThreads: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: ReviewThreadNode[];
      };
    } | null;
  } | null;
}

const PULL_REQUEST_TIMELINE = `query PullRequestTimeline($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      title
      url
      body
      createdAt
      baseRefName
      author { login avatarUrl }
      commits(last: 1) {
        nodes {
          commit {
            oid
            statusCheckRollup {
              state
              contexts(first: 100) {
                nodes {
                  __typename
                  ... on CheckRun { name status conclusion detailsUrl }
                  ... on StatusContext { context state targetUrl }
                }
              }
            }
          }
        }
      }
      timelineItems(first: 100, after: $after, itemTypes: [PULL_REQUEST_COMMIT, ISSUE_COMMENT, PULL_REQUEST_REVIEW]) {
        pageInfo { hasNextPage endCursor }
        nodes {
          __typename
          ... on PullRequestCommit {
            commit {
              abbreviatedOid
              messageHeadline
              committedDate
              author { name avatarUrl user { login avatarUrl } }
            }
          }
          ... on IssueComment { body createdAt author { login avatarUrl } }
          ... on PullRequestReview {
            state
            body
            submittedAt
            createdAt
            author { login avatarUrl }
            comments { totalCount }
          }
        }
      }
    }
  }
}`;

type CheckContextNode =
  | {
      __typename: "CheckRun";
      name: string;
      status: string;
      conclusion: string | null;
      detailsUrl: string | null;
    }
  | {
      __typename: "StatusContext";
      context: string;
      state: string;
      targetUrl: string | null;
    };

interface LatestCommitNode {
  oid: string;
  statusCheckRollup: {
    state: string;
    contexts: { nodes: (CheckContextNode | null)[] };
  } | null;
}

type TimelineItemNode =
  | {
      __typename: "PullRequestCommit";
      commit: {
        abbreviatedOid: string;
        messageHeadline: string;
        committedDate: string;
        author: {
          name: string | null;
          avatarUrl: string;
          user: GitHubUser | null;
        } | null;
      };
    }
  | {
      __typename: "IssueComment";
      body: string;
      createdAt: string;
      author: GitHubUser | null;
    }
  | {
      __typename: "PullRequestReview";
      state: string;
      body: string;
      submittedAt: string | null;
      createdAt: string;
      author: GitHubUser | null;
      comments: { totalCount: number };
    }
  | { __typename: string };

interface TimelineData {
  repository: {
    pullRequest: {
      title: string;
      url: string;
      body: string;
      createdAt: string;
      baseRefName: string;
      author: GitHubUser | null;
      commits: { nodes: { commit: LatestCommitNode }[] };
      timelineItems: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: (TimelineItemNode | null)[];
      };
    } | null;
  } | null;
}

/** A deleted account shows as "ghost" on github.com. */
function userOf(user: GitHubUser | null): GitHubUser {
  return user ?? { login: "ghost", avatarUrl: "" };
}

const verdicts: Record<string, ReviewVerdict> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changesRequested",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
};

function timelineEventOf(
  node: TimelineItemNode | null
): TimelineEvent | undefined {
  if (!node) return;
  if (node.__typename === "PullRequestCommit" && "commit" in node) {
    const { commit } = node;
    const author = commit.author;
    return {
      kind: "commit",
      author: author?.user ?? {
        login: author?.name || "unknown",
        avatarUrl: author?.avatarUrl ?? "",
      },
      date: commit.committedDate,
      sha: commit.abbreviatedOid,
      headline: commit.messageHeadline,
    };
  }
  if (node.__typename === "IssueComment" && "createdAt" in node)
    return {
      kind: "comment",
      author: userOf(node.author),
      date: node.createdAt,
      body: node.body,
    };
  if (node.__typename === "PullRequestReview" && "state" in node) {
    const verdict = verdicts[node.state];
    if (!verdict) return;
    return {
      kind: "review",
      author: userOf(node.author),
      date: node.submittedAt ?? node.createdAt,
      verdict,
      body: node.body,
      comments: node.comments.totalCount,
    };
  }
}

function checksOf(
  commit: LatestCommitNode | undefined
): PullRequestTimeline["checks"] {
  const rollup = commit?.statusCheckRollup;
  if (!commit || !rollup) return;
  const runs: CheckRun[] = [];
  for (const node of rollup.contexts.nodes) {
    if (node?.__typename === "CheckRun")
      runs.push({
        name: node.name,
        status: checkRunStatus(node.status, node.conclusion),
        ...(node.detailsUrl && { url: node.detailsUrl }),
      });
    else if (node?.__typename === "StatusContext")
      runs.push({
        name: node.context,
        status: checkStatus(node.state) ?? "neutral",
        ...(node.targetUrl && { url: node.targetUrl }),
      });
  }
  return {
    commit: commit.oid.slice(0, 7),
    status: checkStatus(rollup.state),
    runs,
  };
}

function checkRunStatus(
  status: string,
  conclusion: string | null
): CheckRunStatus {
  if (status !== "COMPLETED") return "running";
  switch (conclusion) {
    case "SUCCESS":
      return "passed";
    case "SKIPPED":
      return "skipped";
    case "NEUTRAL":
    case "STALE":
    case null:
      return "neutral";
    default:
      return "failed";
  }
}

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
  author { login avatarUrl }
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

const TEAM_MEMBERS_FIELDS = `members(first: 100) { nodes { login } pageInfo { hasNextPage endCursor } }`;

/** The teams the viewer is on, in the organizations they are in, with the teams above them. */
const VIEWER_TEAMS = `query ViewerTeams($reviewer: String!) {
  viewer {
    login
    organizations(first: 100) {
      nodes {
        login
        teams(first: 100, userLogins: [$reviewer]) {
          nodes {
            slug
            ${TEAM_MEMBERS_FIELDS}
            ancestors(first: 10) { nodes { slug ${TEAM_MEMBERS_FIELDS} } }
          }
        }
      }
    }
  }
}`;

const TEAM_MEMBERS = `query TeamMembers($organization: String!, $slug: String!, $after: String) {
  organization(login: $organization) {
    team(slug: $slug) {
      members(first: 100, after: $after) { nodes { login } pageInfo { hasNextPage endCursor } }
    }
  }
}`;

interface TeamMembersNode {
  nodes: { login: string }[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

interface ViewerTeamsData {
  viewer: {
    organizations: {
      nodes: {
        login: string;
        teams: {
          nodes: {
            slug: string;
            members: TeamMembersNode;
            ancestors: { nodes: { slug: string; members: TeamMembersNode }[] };
          }[];
        };
      }[];
    };
  } | null;
}

interface TeamMembersData {
  organization: { team: { members: TeamMembersNode } | null } | null;
}

interface PullRequestNode {
  __typename: string;
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  createdAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  repository: { nameWithOwner: string };
  author: { login: string; avatarUrl: string } | null;
  reviewRequests: { nodes: (ReviewRequestedNode | null)[] };
  /** The review requests pending now. */
  pendingRequests?: {
    nodes: ({ requestedReviewer: RequestedReviewerNode | null } | null)[];
  };
  /** Review requests made and taken away; for pull requests whose Team requests are read. */
  requestChanges?: { nodes: (RequestChangeNode | null)[] };
  /** Submitted reviews, whatever their verdict; for the same. */
  submittedReviews?: {
    nodes: (SubmittedReviewNode | null)[];
  };
  commits: {
    nodes: { commit: { statusCheckRollup: { state: string } | null } }[];
  };
  reviews: ReviewsNode;
  isDraft: boolean;
  mergeable: string;
  reviewDecision: string | null;
  latestReviews: { nodes: (InboxReviewNode | null)[] };
  latestOpinionatedReviews: { nodes: (InboxReviewNode | null)[] };
}

interface RequestedReviewerNode {
  __typename: string;
  login?: string;
  slug?: string;
  organization?: { login: string };
}

interface ReviewRequestedNode {
  createdAt?: string;
  requestedReviewer: RequestedReviewerNode | null;
}

interface RequestChangeNode extends ReviewRequestedNode {
  __typename: string;
}

interface SubmittedReviewNode {
  author: { login: string } | null;
  state: string;
  submittedAt: string | null;
}

interface InboxReviewNode {
  state: string;
  author: { login: string } | null;
  commit: { oid: string } | null;
}

function summaryOf(
  node: PullRequestNode,
  viewer: string,
  myTeams: readonly MyTeam[]
): PullRequestSummary {
  const reviewRequestedAt = requestedOfReviewerAt(
    reviewRequestsOf(node.reviewRequests),
    viewer
  );
  const viaTeam = requestedViaTeam(
    pendingReviewersOf(node.pendingRequests),
    myTeams,
    viewer
  );
  return {
    repository: node.repository.nameWithOwner,
    number: node.number,
    title: node.title,
    url: node.url,
    updatedAt: node.updatedAt,
    createdAt: node.createdAt,
    ...(reviewRequestedAt && { reviewRequestedAt }),
    ...(viaTeam && { requestedViaTeam: viaTeam }),
    size: {
      files: node.changedFiles,
      additions: node.additions,
      deletions: node.deletions,
    },
    // A deleted account shows as "ghost" on github.com.
    author: node.author ?? { login: "ghost", avatarUrl: "" },
    headRefName: node.headRefName,
    headSha: node.headRefOid,
    baseRefName: node.baseRefName,
    checks: checkStatus(node.commits.nodes[0]?.commit.statusCheckRollup?.state),
    lastReviewedSha: lastReviewedSha(node.reviews),
    isDraft: node.isDraft,
    mergeable: mergeabilities[node.mergeable] ?? "unknown",
    reviewDecision: reviewDecisions[node.reviewDecision ?? ""],
    latestReviews: latestReviewsOf(node.latestReviews),
    latestOpinionatedReviews: latestReviewsOf(node.latestOpinionatedReviews),
  };
}

const mergeabilities: Record<string, Mergeability> = {
  MERGEABLE: "mergeable",
  CONFLICTING: "conflicting",
  UNKNOWN: "unknown",
};

const reviewDecisions: Record<string, ReviewDecision> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changesRequested",
  REVIEW_REQUIRED: "reviewRequired",
};

/** The review requests on the timeline, with whom each asked where GitHub says. */
function reviewRequestsOf(
  requests: { nodes: (ReviewRequestedNode | null)[] } | undefined
): ReviewRequest[] {
  return (requests?.nodes ?? []).flatMap((node) => {
    if (!node?.createdAt) return [];
    const reviewer = node.requestedReviewer;
    return [
      {
        createdAt: node.createdAt,
        ...(reviewer?.__typename === "User" && reviewer.login
          ? { reviewer: { kind: "user" as const, login: reviewer.login } }
          : reviewer?.__typename === "Team"
            ? { reviewer: { kind: "team" as const } }
            : {}),
      },
    ];
  });
}

/** Who a review was requested of, where GitHub says: a person or a team. */
function reviewerOf(
  reviewer: RequestedReviewerNode | null | undefined
): RequestedReviewer | undefined {
  if (reviewer?.__typename === "User" && reviewer.login)
    return { kind: "user", login: reviewer.login };
  if (reviewer?.__typename === "Team" && reviewer.slug && reviewer.organization)
    return {
      kind: "team",
      team: `${reviewer.organization.login}/${reviewer.slug}`,
    };
}

function pendingReviewersOf(
  pending: PullRequestNode["pendingRequests"]
): RequestedReviewer[] {
  return (pending?.nodes ?? []).flatMap((node) => {
    const reviewer = reviewerOf(node?.requestedReviewer);
    return reviewer ? [reviewer] : [];
  });
}

function requestChangesOf(
  changes: PullRequestNode["requestChanges"]
): RequestChange[] {
  return (changes?.nodes ?? []).flatMap((node) => {
    const reviewer = reviewerOf(node?.requestedReviewer);
    if (!node?.createdAt || !reviewer) return [];
    const kind =
      node.__typename === "ReviewRequestedEvent"
        ? "requested"
        : node.__typename === "ReviewRequestRemovedEvent"
          ? "removed"
          : undefined;
    return kind ? [{ kind, at: node.createdAt, reviewer }] : [];
  });
}

function submittedReviewsOf(
  reviews: PullRequestNode["submittedReviews"]
): SubmittedReview[] {
  return (reviews?.nodes ?? []).flatMap((review) => {
    const verdict = review && verdicts[review.state];
    if (!review?.submittedAt || !verdict) return [];
    return [
      {
        author: review.author?.login ?? "ghost",
        verdict,
        at: review.submittedAt,
      },
    ];
  });
}

/** The submitted ones of the latest reviews; a pending review has no verdict. */
function latestReviewsOf(
  reviews: { nodes: (InboxReviewNode | null)[] } | undefined
): LatestReview[] {
  return (reviews?.nodes ?? []).flatMap((review) => {
    const verdict = review && verdicts[review.state];
    if (!review || !verdict) return [];
    return [
      {
        author: review.author?.login ?? "ghost",
        verdict,
        ...(review.commit && { commit: review.commit.oid }),
      },
    ];
  });
}

function checkStatus(state: string | undefined): CheckStatus | undefined {
  switch (state) {
    case "SUCCESS":
      return "passed";
    case "FAILURE":
    case "ERROR":
      return "failed";
    case "PENDING":
    case "EXPECTED":
      return "running";
    default:
      return undefined;
  }
}
