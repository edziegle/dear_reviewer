// A fake GitHub API on localhost for the tests. It serves pull requests from
// fixtures through the GraphQL `search` the Inbox uses, serves a pull
// request's state and its files with their viewed state, marks files viewed
// and unviewed, keeps reviews (a pending review, its threads and Comments,
// and submitting it), serves every review thread the viewer can see, takes
// replies to them and resolves and unresolves them, serves a pull request's
// timeline and its latest commit's checks, serves the commit each review
// covered, serves avatars, and records every request it receives.
//
// Tests control it over HTTP:
//   PUT /_fake/state        replaces the fixtures and clears what was recorded
//   GET /_fake/requests     returns the recorded requests
//   GET /_fake/mutations    returns the viewed marks received, oldest first
//   GET /_fake/resolutions  returns the resolves and unresolves received, oldest first
//   GET /_fake/reviews      returns every pull request's reviews as they are now

import * as http from "http";
import { AddressInfo } from "net";
import * as zlib from "zlib";

export type CheckState =
  "SUCCESS" | "FAILURE" | "ERROR" | "PENDING" | "EXPECTED";

export interface FakePullRequest {
  /** owner/name */
  repository: string;
  number: number;
  title: string;
  /** The author's login. */
  author: string;
  state?: "OPEN" | "CLOSED" | "MERGED";
  /** Logins whose review is requested. */
  reviewRequested?: string[];
  /** The latest commit's combined check status; absent when it has no checks. */
  checks?: CheckState;
  headRefName?: string;
  baseRefName?: string;
  updatedAt?: string;
  /** The changed files, as GitHub lists them, with the viewer's viewed state. */
  files?: FakePullRequestFile[];
  /** Reviews, pending or submitted. Only its author sees a pending review. */
  reviews?: FakeReview[];
  /** The description. */
  body?: string;
  createdAt?: string;
  /** The latest commit. */
  headSha?: string;
  /**
   * Commits and Comments on the timeline. The timeline also shows the
   * reviews, and the fake sorts them all by date.
   */
  timeline?: FakeTimelineItem[];
  /** The latest commit's check runs and commit statuses, in order. */
  checkRuns?: FakeCheck[];
}

export type FakeTimelineItem =
  | {
      type: "commit";
      sha: string;
      /** The whole commit message; its first line is the headline. */
      message: string;
      /** The author's login, or their git name when `noAccount` is set. */
      author: string;
      /** Set when the commit's author has no GitHub account. */
      noAccount?: boolean;
      date: string;
    }
  | { type: "comment"; author: string; body: string; date: string };

export type FakeCheck =
  | {
      type: "checkRun";
      name: string;
      status: "QUEUED" | "IN_PROGRESS" | "COMPLETED";
      conclusion?:
        | "SUCCESS"
        | "FAILURE"
        | "NEUTRAL"
        | "CANCELLED"
        | "SKIPPED"
        | "TIMED_OUT"
        | "ACTION_REQUIRED"
        | "STALE"
        | "STARTUP_FAILURE";
      detailsUrl?: string;
    }
  | { type: "status"; context: string; state: CheckState; targetUrl?: string };

export type ReviewState =
  "PENDING" | "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED";

export type DiffSide = "LEFT" | "RIGHT";

export interface FakeReview {
  id: string;
  /** The author's login. */
  author: string;
  state: ReviewState;
  /** The summary given when it was submitted. */
  body?: string;
  /** When it was submitted; the fake sets it when a review is submitted. */
  submittedAt?: string;
  /**
   * The commit the review covers: the one it was started at, which the fake
   * takes from `commitOID`, or else the pull request's head.
   */
  commit?: string;
  threads: FakeReviewThread[];
}

/** A thread started in a review, on a line or range of one side of the diff. */
export interface FakeReviewThread {
  id: string;
  path: string;
  side: DiffSide;
  /** The last line of the range, counted from 1. */
  line: number;
  /** The first line of a multi-line range. */
  startLine?: number;
  /**
   * Set when the lines are gone from the head: GitHub then has no `line`,
   * and `line` and `startLine` are where the thread was written.
   */
  outdated?: boolean;
  resolved?: boolean;
  comments: FakeReviewComment[];
}

export interface FakeReviewComment {
  id: string;
  body: string;
  /** The review the Comment was written in, when it isn't the thread's, as for a reply. */
  reviewId?: string;
  createdAt?: string;
}

/** A pull request's review, as GET /_fake/reviews reports it. */
export interface RecordedReview extends FakeReview {
  pullRequestId: string;
}

export type ViewedState = "VIEWED" | "UNVIEWED" | "DISMISSED";

export interface FakePullRequestFile {
  path: string;
  /** Defaults to UNVIEWED. */
  viewed?: ViewedState;
}

/** A markFileAsViewed or unmarkFileAsViewed the fake received. */
export interface RecordedMutation {
  mutation: "markFileAsViewed" | "unmarkFileAsViewed";
  pullRequestId: string;
  path: string;
}

/** A resolveReviewThread or unresolveReviewThread the fake received. */
export interface RecordedResolution {
  mutation: "resolveReviewThread" | "unresolveReviewThread";
  threadId: string;
}

/** The node id the fake gives a pull request. */
export function fakePullRequestId(pr: {
  repository: string;
  number: number;
}): string {
  return `PR_${pr.repository}#${pr.number}`;
}

export interface FakeGitHubState {
  /** The signed-in user, and the token that authenticates as them. */
  viewer: { login: string; token: string };
  pullRequests: FakePullRequest[];
  /**
   * Where avatar URLs point, such as `http://localhost:<port>` to put them on
   * another origin than the API. Defaults to the server's own URL.
   */
  avatarOrigin?: string;
}

export interface RecordedRequest {
  method: string;
  /** The Host header, which tells apart origins that reach this server. */
  host?: string;
  path: string;
  authorization?: string;
  body?: unknown;
}

export async function startFakeGitHub(): Promise<{
  url: string;
  close(): Promise<void>;
}> {
  let state: FakeGitHubState = {
    viewer: { login: "reviewer", token: "" },
    pullRequests: [],
  };
  let requests: RecordedRequest[] = [];
  let mutations: RecordedMutation[] = [];
  let resolutions: RecordedResolution[] = [];
  let lastId = 0;
  const newId = (prefix: string) => `${prefix}_${++lastId}`;

  const server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const path = req.url ?? "/";
    const send = (status: number, value: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };

    if (path === "/_fake/state" && req.method === "PUT") {
      state = JSON.parse(body) as FakeGitHubState;
      requests = [];
      mutations = [];
      resolutions = [];
      return send(204, null);
    }
    if (path === "/_fake/requests" && req.method === "GET") {
      return send(200, requests);
    }
    if (path === "/_fake/mutations" && req.method === "GET") {
      return send(200, mutations);
    }
    if (path === "/_fake/resolutions" && req.method === "GET") {
      return send(200, resolutions);
    }
    if (path === "/_fake/reviews" && req.method === "GET") {
      return send(
        200,
        state.pullRequests.flatMap((pr) =>
          (pr.reviews ?? []).map((review) => ({
            pullRequestId: fakePullRequestId(pr),
            ...review,
          }))
        )
      );
    }

    requests.push({
      method: req.method ?? "GET",
      host: req.headers.host,
      path,
      authorization: req.headers.authorization,
      body: body ? JSON.parse(body) : undefined,
    });

    const avatar = /^\/avatars\/([^/?]+)/.exec(path);
    if (avatar && req.method === "GET") {
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(avatarPng(decodeURIComponent(avatar[1])));
    }

    if (req.headers.authorization !== `Bearer ${state.viewer.token}`) {
      return send(401, { message: "Bad credentials" });
    }
    if (path === "/graphql" && req.method === "POST") {
      const { query, variables } = JSON.parse(body) as {
        query: string;
        variables: Record<string, unknown>;
      };
      try {
        return send(200, { data: graphql(query, variables) });
      } catch (err) {
        return send(200, { errors: [{ message: (err as Error).message }] });
      }
    }
    send(404, { message: "Not Found" });
  });

  function graphql(query: string, vars: Record<string, unknown>) {
    const variables = vars as Record<string, string>;
    const data: Record<string, unknown> = {};
    if (/^\s*mutation\b/.test(query)) return mutate(query, vars);
    if (/\bpullRequest\(\s*number:\s*\$number\s*\)/.test(query))
      data.repository = { pullRequest: pullRequest(query, vars) };
    if (/\bviewer\s*\{/.test(query))
      data.viewer = {
        login: state.viewer.login,
        avatarUrl: `${state.avatarOrigin ?? url}/avatars/${encodeURIComponent(state.viewer.login)}?v=4`,
      };
    for (const [, alias, variable] of query.matchAll(
      /(\w+)\s*:\s*search\(\s*query:\s*\$(\w+)/g
    )) {
      data[alias] = {
        nodes: search(variables[variable]).map((pr) =>
          pullRequestNode(pr, query, vars)
        ),
      };
    }
    return data;
  }

  function findPullRequest(
    repository: string,
    number: number
  ): FakePullRequest | undefined {
    return state.pullRequests.find(
      (pr) =>
        pr.repository.toLowerCase() === repository.toLowerCase() &&
        pr.number === number
    );
  }

  /**
   * A pull request's id and state, its files in pages of 100 after the
   * cursor, the viewer's pending review, and the review threads the viewer
   * can see.
   */
  function pullRequest(query: string, vars: Record<string, unknown>) {
    const pr = findPullRequest(
      `${vars.owner}/${vars.name}`,
      Number(vars.number)
    );
    if (!pr) return null;
    const files = pr.files ?? [];
    const start = vars.after ? Number(vars.after) : 0;
    const page = files.slice(start, start + 100);
    const me = state.viewer.login;
    const visible = (pr.reviews ?? []).filter(
      (r) => r.state !== "PENDING" || r.author === me
    );
    return {
      id: fakePullRequestId(pr),
      state: pr.state ?? "OPEN",
      ...(/\btimelineItems\(/.test(query) &&
        timelineFields(pr, visible, vars.after)),
      reviews: reviewsField(pr, query, vars),
      reviewThreads: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: visible.flatMap((review) =>
          review.threads.map((thread) => ({
            id: thread.id,
            path: thread.path,
            diffSide: thread.side,
            line: thread.outdated ? null : thread.line,
            startLine: thread.outdated ? null : (thread.startLine ?? null),
            startDiffSide: thread.startLine ? thread.side : null,
            originalLine: thread.line,
            originalStartLine: thread.startLine ?? null,
            isOutdated: thread.outdated ?? false,
            isResolved: thread.resolved ?? false,
            comments: {
              nodes: thread.comments
                .map((comment) => ({
                  comment,
                  written: reviewOf(pr, comment.reviewId) ?? review,
                }))
                .filter(({ written }) => visible.includes(written))
                .map(({ comment, written }) => ({
                  id: comment.id,
                  body: comment.body,
                  createdAt:
                    comment.createdAt ??
                    written.submittedAt ??
                    "2026-10-01T00:00:00Z",
                  author: actor(written.author),
                  pullRequestReview: { id: written.id },
                })),
            },
          }))
        ),
      },
      files: {
        pageInfo: {
          hasNextPage: start + 100 < files.length,
          endCursor: String(start + page.length),
        },
        nodes: page.map((f) => ({
          path: f.path,
          viewerViewedState: f.viewed ?? "UNVIEWED",
        })),
      },
    };
  }

  /**
   * A pull request's `reviews` that the viewer can see, filtered by the
   * `states`, `author` and `last` the query gives them.
   */
  function reviewsField(
    pr: FakePullRequest,
    query: string,
    vars: Record<string, unknown>
  ) {
    const me = state.viewer.login;
    const args = /\breviews\(([^)]*)\)/.exec(query)?.[1] ?? "";
    const states = /\bstates:\s*\[([^\]]*)\]/
      .exec(args)?.[1]
      .split(/[\s,]+/)
      .filter(Boolean);
    const authorVariable = /\bauthor:\s*\$(\w+)/.exec(args)?.[1];
    const last = /\blast:\s*(\d+)/.exec(args)?.[1];
    let reviews = (pr.reviews ?? [])
      .filter((r) => r.state !== "PENDING" || r.author === me)
      .filter((r) => !states || states.includes(r.state))
      .filter(
        (r) => !authorVariable || r.author === String(vars[authorVariable])
      );
    if (last) reviews = reviews.slice(-Number(last));
    return {
      nodes: reviews.map((r) => ({
        id: r.id,
        state: r.state,
        viewerDidAuthor: r.author === me,
        commit: r.commit ? { oid: r.commit } : null,
        submittedAt: r.submittedAt ?? null,
        url: reviewUrl(pr, r),
        comments: { totalCount: commentsIn(pr, r) },
      })),
    };
  }

  /** How many Comments on the diff the review holds, of those in these reviews' threads. */
  function commentsIn(
    pr: FakePullRequest,
    review: FakeReview,
    reviews = pr.reviews ?? []
  ): number {
    return reviews
      .flatMap((r) => r.threads)
      .flatMap((t) =>
        t.comments.filter(
          (c) => (c.reviewId ?? reviewOfThread(pr, t)?.id) === review.id
        )
      ).length;
  }

  function reviewUrl(pr: FakePullRequest, review: FakeReview): string {
    return `https://github.com/${pr.repository}/pull/${pr.number}#pullrequestreview-${review.id}`;
  }

  function reviewOfThread(
    pr: FakePullRequest,
    thread: FakeReviewThread
  ): FakeReview | undefined {
    return pr.reviews?.find((review) => review.threads.includes(thread));
  }

  function reviewOf(
    pr: FakePullRequest,
    id: string | undefined
  ): FakeReview | undefined {
    return id === undefined
      ? undefined
      : pr.reviews?.find((review) => review.id === id);
  }

  /** The review thread with this id, and its pull request. */
  function findThread(id: unknown) {
    for (const pr of state.pullRequests)
      for (const review of pr.reviews ?? [])
        for (const thread of review.threads)
          if (thread.id === id) return { pr, thread };
    throw new Error(
      `Could not resolve to a node with the global id of '${id}'`
    );
  }

  function avatarUrl(login: string): string {
    return `${state.avatarOrigin ?? url}/avatars/${encodeURIComponent(login)}?v=4`;
  }

  function actor(login: string) {
    return { login, avatarUrl: avatarUrl(login) };
  }

  /**
   * A pull request's description, its latest commit's checks, and its
   * timeline of commits, Comments and the reviews the viewer can see, sorted
   * by date, in pages of 100 after the cursor.
   */
  function timelineFields(
    pr: FakePullRequest,
    reviews: FakeReview[],
    after: unknown
  ) {
    const dated: { date: string; node: unknown }[] = [];
    for (const item of pr.timeline ?? []) {
      if (item.type === "commit") {
        dated.push({
          date: item.date,
          node: {
            __typename: "PullRequestCommit",
            commit: {
              oid: item.sha,
              abbreviatedOid: item.sha.slice(0, 7),
              messageHeadline: item.message.split("\n")[0],
              committedDate: item.date,
              author: {
                name: item.author,
                avatarUrl: avatarUrl(item.author),
                user: item.noAccount ? null : actor(item.author),
              },
            },
          },
        });
      } else {
        dated.push({
          date: item.date,
          node: {
            __typename: "IssueComment",
            body: item.body,
            createdAt: item.date,
            author: actor(item.author),
          },
        });
      }
    }
    for (const review of reviews) {
      // A pending review has no submittedAt; GitHub lists it where it was started.
      const date = review.submittedAt ?? new Date().toISOString();
      dated.push({
        date,
        node: {
          __typename: "PullRequestReview",
          state: review.state,
          body: review.body ?? "",
          submittedAt: review.submittedAt ?? null,
          createdAt: date,
          author: actor(review.author),
          comments: { totalCount: commentsIn(pr, review, reviews) },
        },
      });
    }
    dated.sort((a, b) => a.date.localeCompare(b.date));
    const start = after ? Number(after) : 0;
    const page = dated.slice(start, start + 100);
    const checks = pr.checkRuns ?? [];
    return {
      title: pr.title,
      url: `https://github.com/${pr.repository}/pull/${pr.number}`,
      body: pr.body ?? "",
      createdAt: pr.createdAt ?? "2026-10-01T00:00:00Z",
      baseRefName: pr.baseRefName ?? "main",
      author: actor(pr.author),
      commits: {
        nodes: [
          {
            commit: {
              oid: pr.headSha ?? "0".repeat(40),
              statusCheckRollup:
                pr.checks || checks.length > 0
                  ? {
                      state: pr.checks ?? "PENDING",
                      contexts: {
                        nodes: checks.map((check) =>
                          check.type === "checkRun"
                            ? {
                                __typename: "CheckRun",
                                name: check.name,
                                status: check.status,
                                conclusion: check.conclusion ?? null,
                                detailsUrl: check.detailsUrl ?? null,
                              }
                            : {
                                __typename: "StatusContext",
                                context: check.context,
                                state: check.state,
                                targetUrl: check.targetUrl ?? null,
                              }
                        ),
                      },
                    }
                  : null,
            },
          },
        ],
      },
      timelineItems: {
        pageInfo: {
          hasNextPage: start + 100 < dated.length,
          endCursor: String(start + page.length),
        },
        nodes: page.map((d) => d.node),
      },
    };
  }

  /**
   * A review mutation taking `input: $input`, or aliased markFileAsViewed and
   * unmarkFileAsViewed mutations, in order.
   */
  function mutate(query: string, vars: Record<string, unknown>) {
    const review =
      /\b(addPullRequestReview|addPullRequestReviewThread|addPullRequestReviewThreadReply|updatePullRequestReviewComment|deletePullRequestReviewComment|deletePullRequestReview|submitPullRequestReview|resolveReviewThread|unresolveReviewThread)\(\s*input:\s*\$input\s*\)/.exec(
        query
      );
    if (review)
      return {
        [review[1]]: reviewMutation(
          review[1],
          vars.input as Record<string, unknown>
        ),
      };
    const data: Record<string, unknown> = {};
    const fields = [
      ...query.matchAll(
        /(\w+)\s*:\s*(markFileAsViewed|unmarkFileAsViewed)\(\s*input:\s*\{\s*pullRequestId:\s*\$(\w+)\s*,\s*path:\s*\$(\w+)\s*\}\s*\)/g
      ),
    ];
    if (fields.length === 0)
      throw new Error(`The fake GitHub does not know this mutation: ${query}`);
    for (const [, alias, mutation, idVar, pathVar] of fields) {
      const pullRequestId = String(vars[idVar]);
      const path = String(vars[pathVar]);
      const pr = state.pullRequests.find(
        (p) => fakePullRequestId(p) === pullRequestId
      );
      const file = pr?.files?.find((f) => f.path === path);
      if (!file)
        throw new Error(`No file ${path} in pull request ${pullRequestId}`);
      file.viewed = mutation === "markFileAsViewed" ? "VIEWED" : "UNVIEWED";
      mutations.push({
        mutation: mutation as RecordedMutation["mutation"],
        pullRequestId,
        path,
      });
      data[alias] = { clientMutationId: null };
    }
    return data;
  }

  /** The viewer's pending review with this id, and its pull request. */
  function myPendingReview(id: unknown) {
    for (const pr of state.pullRequests) {
      const review = pr.reviews?.find((r) => r.id === id);
      if (review) {
        if (review.author !== state.viewer.login || review.state !== "PENDING")
          throw new Error(`Review ${id} is not your pending review`);
        return { pr, review };
      }
    }
    throw new Error(
      `Could not resolve to a node with the global id of '${id}'`
    );
  }

  /** The viewer's pending Comment with this id, and its thread and review. */
  function myPendingComment(id: unknown) {
    for (const pr of state.pullRequests) {
      for (const review of pr.reviews ?? []) {
        for (const thread of review.threads) {
          const comment = thread.comments.find((c) => c.id === id);
          if (!comment) continue;
          myPendingReview(comment.reviewId ?? review.id);
          return { review, thread, comment };
        }
      }
    }
    throw new Error(
      `Could not resolve to a node with the global id of '${id}'`
    );
  }

  /** The pending review mutations, checked as strictly as GitHub checks them. */
  function reviewMutation(mutation: string, input: Record<string, unknown>) {
    switch (mutation) {
      case "addPullRequestReview": {
        const pr = state.pullRequests.find(
          (p) => fakePullRequestId(p) === input.pullRequestId
        );
        if (!pr)
          throw new Error(`No pull request ${String(input.pullRequestId)}`);
        if (input.event !== undefined || input.threads !== undefined)
          throw new Error("The fake only starts empty pending reviews");
        if (
          input.commitOID !== undefined &&
          !/^[0-9a-f]{40}$/.test(String(input.commitOID))
        )
          throw new Error(`Bad commitOID ${String(input.commitOID)}`);
        const me = state.viewer.login;
        if (
          (pr.reviews ?? []).some(
            (r) => r.author === me && r.state === "PENDING"
          )
        )
          throw new Error(
            "User can only have one pending review per pull request"
          );
        const commit =
          typeof input.commitOID === "string" ? input.commitOID : pr.headSha;
        const review: FakeReview = {
          id: newId("PRR"),
          author: me,
          state: "PENDING",
          ...(commit && { commit }),
          threads: [],
        };
        (pr.reviews ??= []).push(review);
        return { pullRequestReview: { id: review.id } };
      }
      case "addPullRequestReviewThread": {
        const { pr, review } = myPendingReview(input.pullRequestReviewId);
        const path = String(input.path);
        if (!(pr.files ?? []).some((f) => f.path === path))
          throw new Error(`Path ${path} is not part of the pull request`);
        const side = input.side;
        if (side !== "LEFT" && side !== "RIGHT")
          throw new Error(`Unknown side ${String(side)}`);
        const line = input.line;
        if (!Number.isInteger(line) || (line as number) < 1)
          throw new Error(`Bad line ${String(line)}`);
        const startLine = input.startLine;
        if (startLine !== undefined && startLine !== null) {
          if (
            !Number.isInteger(startLine) ||
            (startLine as number) < 1 ||
            (startLine as number) >= (line as number)
          )
            throw new Error("startLine must precede line");
          if (input.startSide !== side)
            throw new Error("startSide must match side");
        }
        if (typeof input.body !== "string" || input.body === "")
          throw new Error("Body can't be blank");
        const thread: FakeReviewThread = {
          id: newId("PRRT"),
          path,
          side,
          line: line as number,
          ...(typeof startLine === "number" && { startLine }),
          comments: [{ id: newId("PRRC"), body: input.body }],
        };
        review.threads.push(thread);
        return {
          thread: {
            id: thread.id,
            comments: { nodes: [{ id: thread.comments[0].id }] },
          },
        };
      }
      case "addPullRequestReviewThreadReply": {
        const { pr, thread } = findThread(input.pullRequestReviewThreadId);
        if (typeof input.body !== "string" || input.body === "")
          throw new Error("Body can't be blank");
        let review: FakeReview;
        if (
          input.pullRequestReviewId !== undefined &&
          input.pullRequestReviewId !== null
        ) {
          const pending = myPendingReview(input.pullRequestReviewId);
          if (pending.pr !== pr)
            throw new Error("The review is on another pull request");
          review = pending.review;
        } else {
          // Without a pending review, the reply is published at once, in a
          // review of its own.
          review = {
            id: newId("PRR"),
            author: state.viewer.login,
            state: "COMMENTED",
            submittedAt: new Date().toISOString(),
            ...(pr.headSha && { commit: pr.headSha }),
            threads: [],
          };
          (pr.reviews ??= []).push(review);
        }
        const comment: FakeReviewComment = {
          id: newId("PRRC"),
          body: input.body,
          reviewId: review.id,
        };
        thread.comments.push(comment);
        return { comment: { id: comment.id } };
      }
      case "resolveReviewThread":
      case "unresolveReviewThread": {
        const { thread } = findThread(input.threadId);
        thread.resolved = mutation === "resolveReviewThread";
        resolutions.push({
          mutation: mutation as RecordedResolution["mutation"],
          threadId: thread.id,
        });
        return { thread: { id: thread.id, isResolved: thread.resolved } };
      }
      case "updatePullRequestReviewComment": {
        const { comment } = myPendingComment(input.pullRequestReviewCommentId);
        if (typeof input.body !== "string" || input.body === "")
          throw new Error("Body can't be blank");
        comment.body = input.body;
        return { pullRequestReviewComment: { id: comment.id } };
      }
      case "deletePullRequestReviewComment": {
        const { review, thread, comment } = myPendingComment(input.id);
        thread.comments = thread.comments.filter((c) => c !== comment);
        if (thread.comments.length === 0)
          review.threads = review.threads.filter((t) => t !== thread);
        return { pullRequestReview: { id: review.id } };
      }
      case "deletePullRequestReview": {
        const { pr, review } = myPendingReview(input.pullRequestReviewId);
        pr.reviews = (pr.reviews ?? []).filter((r) => r !== review);
        return { pullRequestReview: { id: review.id } };
      }
      case "submitPullRequestReview": {
        const { pr, review } = myPendingReview(input.pullRequestReviewId);
        const states: Record<string, ReviewState> = {
          APPROVE: "APPROVED",
          REQUEST_CHANGES: "CHANGES_REQUESTED",
          COMMENT: "COMMENTED",
        };
        const submitted = states[String(input.event)];
        if (!submitted) throw new Error(`Unknown event ${String(input.event)}`);
        review.state = submitted;
        review.submittedAt = new Date().toISOString();
        if (typeof input.body === "string" && input.body)
          review.body = input.body;
        return {
          pullRequestReview: {
            id: review.id,
            state: submitted,
            url: reviewUrl(pr, review),
          },
        };
      }
    }
    throw new Error(`The fake GitHub does not know ${mutation}`);
  }

  /** GitHub's issue search, for the qualifiers the Inbox uses. */
  function search(q: string): FakePullRequest[] {
    const me = state.viewer.login;
    const filters: ((pr: FakePullRequest) => boolean)[] = [];
    for (const term of q.split(/\s+/).filter(Boolean)) {
      const [key, value] = term.split(":");
      const user = value === "@me" ? me : value;
      if (term === "is:pr" || term === "archived:false") continue;
      else if (term === "is:open")
        filters.push((pr) => (pr.state ?? "OPEN") === "OPEN");
      else if (key === "repo")
        filters.push(
          (pr) => pr.repository.toLowerCase() === value.toLowerCase()
        );
      else if (key === "author") filters.push((pr) => pr.author === user);
      else if (key === "-author") filters.push((pr) => pr.author !== user);
      else if (key === "reviewed-by")
        filters.push((pr) =>
          (pr.reviews ?? []).some(
            (review) => review.author === user && review.state !== "PENDING"
          )
        );
      else if (key === "review-requested")
        filters.push((pr) => (pr.reviewRequested ?? []).includes(user));
      else throw new Error(`The fake GitHub does not know "${term}"`);
    }
    return state.pullRequests.filter((pr) => filters.every((f) => f(pr)));
  }

  function pullRequestNode(
    pr: FakePullRequest,
    query: string,
    vars: Record<string, unknown>
  ) {
    const [owner, name] = pr.repository.split("/");
    return {
      __typename: "PullRequest",
      number: pr.number,
      title: pr.title,
      url: `https://github.com/${pr.repository}/pull/${pr.number}`,
      updatedAt: pr.updatedAt ?? "2026-10-01T00:00:00Z",
      isDraft: false,
      headRefName: pr.headRefName ?? `feature-${pr.number}`,
      headRefOid: pr.headSha ?? "0".repeat(40),
      baseRefName: pr.baseRefName ?? "main",
      repository: { nameWithOwner: `${owner}/${name}` },
      author: {
        login: pr.author,
        avatarUrl: `${state.avatarOrigin ?? url}/avatars/${encodeURIComponent(pr.author)}?v=4`,
      },
      commits: {
        nodes: [
          {
            commit: {
              statusCheckRollup: pr.checks ? { state: pr.checks } : null,
            },
          },
        ],
      },
      ...(/\breviews\(/.test(query) && {
        reviews: reviewsField(pr, query, vars),
      }),
    };
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** A 1x1 PNG whose colour depends on the login, so avatars can be told apart. */
export function avatarPng(login: string): Buffer {
  let hash = 0;
  for (const c of login) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const pixel = Buffer.from([
    0,
    hash & 255,
    (hash >> 8) & 255,
    (hash >> 16) & 255,
  ]);
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(pixel)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
