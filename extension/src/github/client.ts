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
