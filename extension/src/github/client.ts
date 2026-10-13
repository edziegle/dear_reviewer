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
