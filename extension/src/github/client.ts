// Talks to GitHub: GraphQL where it covers the operation, REST elsewhere,
// against a configurable API base URL.

import { GitHubAuth, trustedOrigin } from "./auth";

export type CheckStatus = "passed" | "failed" | "running";

export interface PullRequestSummary {
  /** owner/name */
  repository: string;
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  author: { login: string; avatarUrl: string };
  headRefName: string;
  headSha: string;
  baseRefName: string;
  /** The latest commit's combined checks; undefined when it has none. */
  checks?: CheckStatus;
}

export interface InboxPullRequests {
  awaitingMyReview: PullRequestSummary[];
  authoredByMe: PullRequestSummary[];
}

export interface PullRequestFiles {
  /** The pull request's node id, which mutations name it by. */
  id: string;
  files: { path: string; viewed: boolean }[];
}

/** GitHub's name for a side of a pull request's diff: LEFT is the base, RIGHT the head. */
export type PullRequestState = "OPEN" | "MERGED" | "CLOSED";

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

export interface PendingThread extends ThreadPlace {
  id: string;
  comments: { id: string; body: string }[];
}

export interface PendingReview {
  /** The pull request's node id. */
  pullRequestId: string;
  viewer: { login: string; avatarUrl: string };
  /** The viewer's pending review and the threads started in it, if there is one. */
  review?: { id: string; threads: PendingThread[] };
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

export class GitHubClient {
  constructor(
    private readonly auth: GitHubAuth,
    private readonly apiUrl: () => string
  ) {}

  /** Open pull requests in these repositories that await my review or that I authored. */
  async inbox(repositories: string[]): Promise<InboxPullRequests> {
    if (repositories.length === 0)
      return { awaitingMyReview: [], authoredByMe: [] };
    const searches = repositories.flatMap((repository, i) => [
      {
        alias: `awaiting${i}`,
        query: `is:pr is:open archived:false repo:${repository} review-requested:@me`,
      },
      {
        alias: `authored${i}`,
        query: `is:pr is:open archived:false repo:${repository} author:@me`,
      },
    ]);
    const query = `query Inbox(${searches.map((s) => `$${s.alias}: String!`).join(", ")}) {
${searches
  .map(
    (s) =>
      `  ${s.alias}: search(query: $${s.alias}, type: ISSUE, first: 100) { nodes { ...InboxPullRequest } }`
  )
  .join("\n")}
}
${INBOX_PULL_REQUEST}`;
    const data = await this.graphql<
      Record<string, { nodes: PullRequestNode[] }>
    >(query, Object.fromEntries(searches.map((s) => [s.alias, s.query])));
    const collect = (prefix: string) =>
      searches
        .filter((s) => s.alias.startsWith(prefix))
        .flatMap((s) => data[s.alias]?.nodes ?? [])
        .filter((node) => node.__typename === "PullRequest")
        .map(summaryOf)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return {
      awaitingMyReview: collect("awaiting"),
      authoredByMe: collect("authored"),
    };
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
   * The viewer's pending review of the pull request, with the threads they
   * started in it. GitHub allows one pending review per person and pull
   * request, and only its author can see it.
   */
  async pendingReview(
    repository: string,
    number: number
  ): Promise<PendingReview> {
    const [owner, name] = repository.split("/");
    let found: PendingReview | undefined;
    const threads: PendingReviewThreadNode[] = [];
    let after: string | null = null;
    do {
      const data: PendingReviewData = await this.graphql<PendingReviewData>(
        PENDING_REVIEW,
        { owner, name, number, after }
      );
      const pullRequest = data.repository?.pullRequest;
      if (!pullRequest)
        throw new GitHubError(`No pull request ${repository}#${number}`);
      const review = pullRequest.reviews.nodes.find((r) => r.viewerDidAuthor);
      found ??= {
        pullRequestId: pullRequest.id,
        viewer: data.viewer,
        ...(review && { review: { id: review.id, threads: [] } }),
      };
      threads.push(...pullRequest.reviewThreads.nodes);
      const page = pullRequest.reviewThreads.pageInfo;
      after = page.hasNextPage ? page.endCursor : null;
    } while (after);
    const review = found.review;
    if (review) {
      for (const thread of threads) {
        const comments = thread.comments.nodes.filter(
          (c) => c.pullRequestReview?.id === review.id
        );
        if (thread.comments.nodes[0]?.pullRequestReview?.id !== review.id)
          continue;
        const line = thread.line ?? thread.originalLine;
        const startLine = thread.startLine ?? thread.originalStartLine;
        if (line === null) continue;
        review.threads.push({
          id: thread.id,
          path: thread.path,
          side: thread.diffSide,
          line,
          ...(startLine !== null && startLine < line && { startLine }),
          comments: comments.map((c) => ({ id: c.id, body: c.body })),
        });
      }
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

  /** Starts the viewer's pending review of the pull request, giving its id. */
  async startReview(pullRequestId: string): Promise<string> {
    const data = await this.graphql<{
      addPullRequestReview: { pullRequestReview: { id: string } };
    }>(
      `mutation StartReview($input: AddPullRequestReviewInput!) {
  addPullRequestReview(input: $input) { pullRequestReview { id } }
}`,
      { input: { pullRequestId } }
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

  /** Submits the pending review with a verdict and a summary, which publishes its Comments. */
  async submitReview(
    reviewId: string,
    event: ReviewEvent,
    body: string
  ): Promise<void> {
    await this.graphql(
      `mutation SubmitReview($input: SubmitPullRequestReviewInput!) {
  submitPullRequestReview(input: $input) { pullRequestReview { id } }
}`,
      { input: { pullRequestReviewId: reviewId, event, body } }
    );
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
    const res = await fetch(url, { headers });
    if (!res.ok) throw new GitHubError(`${url}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  private async graphql<T>(
    query: string,
    variables: Record<string, unknown>
  ): Promise<T> {
    const apiUrl = this.apiUrl();
    trustedOrigin(apiUrl);
    const token = await this.auth.token(apiUrl);
    if (!token) throw new NotSignedInError();
    const res = await fetch(graphqlUrl(apiUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 401)
      throw new GitHubError(
        "GitHub rejected the sign-in (401 Bad credentials)"
      );
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

const PULL_REQUEST_STATE = `query PullRequestState($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { state }
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

const PENDING_REVIEW = `query PendingReview($owner: String!, $name: String!, $number: Int!, $after: String) {
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
          comments(first: 100) { nodes { id body pullRequestReview { id } } }
        }
      }
    }
  }
}`;

interface PendingReviewThreadNode {
  id: string;
  path: string;
  diffSide: DiffSide;
  line: number | null;
  startLine: number | null;
  originalLine: number | null;
  originalStartLine: number | null;
  comments: {
    nodes: {
      id: string;
      body: string;
      pullRequestReview: { id: string } | null;
    }[];
  };
}

interface PendingReviewData {
  viewer: { login: string; avatarUrl: string };
  repository: {
    pullRequest: {
      id: string;
      reviews: { nodes: { id: string; viewerDidAuthor: boolean }[] };
      reviewThreads: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: PendingReviewThreadNode[];
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
  headRefName
  headRefOid
  baseRefName
  repository { nameWithOwner }
  author { login avatarUrl }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`;

interface PullRequestNode {
  __typename: string;
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  repository: { nameWithOwner: string };
  author: { login: string; avatarUrl: string } | null;
  commits: {
    nodes: { commit: { statusCheckRollup: { state: string } | null } }[];
  };
}

function summaryOf(node: PullRequestNode): PullRequestSummary {
  return {
    repository: node.repository.nameWithOwner,
    number: node.number,
    title: node.title,
    url: node.url,
    updatedAt: node.updatedAt,
    // A deleted account shows as "ghost" on github.com.
    author: node.author ?? { login: "ghost", avatarUrl: "" },
    headRefName: node.headRefName,
    headSha: node.headRefOid,
    baseRefName: node.baseRefName,
    checks: checkStatus(node.commits.nodes[0]?.commit.statusCheckRollup?.state),
  };
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
