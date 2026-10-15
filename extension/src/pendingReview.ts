// A Review's Comments until the Review ends, and the threads they sit among.
// A pull request's are in the Reviewer's pending review on GitHub until they
// submit it (see ADR 0007), among the review threads they reply to and
// resolve (see ADR 0014). A pending review Dear Reviewer starts covers the
// head of the Change the Reviewer is reading, which GitHub records with the
// Review (see ADR 0015). A local Change's are kept in the extension's
// storage until a Brief ends the Review (see ADR 0016).

import type { Change } from "./changeWorkspace";
import type {
  GitHubClient,
  GitHubUser,
  ReviewEvent,
  ReviewThread,
  ThreadPlace,
} from "./github/client";
import type { LocalPendingReviews } from "./localReviews";
import type { PullRequestRef } from "./openChanges";

/** Where a Change's Comments are kept while its Review is under way. */
export interface PendingReviews {
  /** The signed-in Reviewer, once GitHub has been asked. */
  readonly viewer: GitHubUser | undefined;
  /** The Change's threads, including those of the Review under way. */
  threads(change: Change): Promise<ReviewThread[]>;
  /** Starts a thread with this Comment, in the Review under way. */
  addThread(
    change: Change,
    place: ThreadPlace,
    body: string
  ): Promise<{ threadId: string; commentId: string }>;
  /** Replies to a thread. Gives the reply's id and whether it is pending. */
  reply(
    change: Change,
    threadId: string,
    body: string
  ): Promise<{ commentId: string; pending: boolean }>;
  setResolved(
    change: Change,
    threadId: string,
    resolved: boolean
  ): Promise<void>;
  editComment(change: Change, commentId: string, body: string): Promise<void>;
  deleteComment(change: Change, commentId: string): Promise<void>;
}

/** Keeps each Change's Comments where its source does: GitHub for pull requests. */
export class PendingReviewsBySource implements PendingReviews {
  constructor(
    private readonly local: LocalPendingReviews,
    private readonly github: GitHubPendingReviews
  ) {}

  get viewer(): GitHubUser | undefined {
    return this.github.viewer;
  }

  threads(change: Change): Promise<ReviewThread[]> {
    return this.of(change).threads(change);
  }

  addThread(change: Change, place: ThreadPlace, body: string) {
    return this.of(change).addThread(change, place, body);
  }

  reply(change: Change, threadId: string, body: string) {
    return this.of(change).reply(change, threadId, body);
  }

  setResolved(
    change: Change,
    threadId: string,
    resolved: boolean
  ): Promise<void> {
    return this.of(change).setResolved(change, threadId, resolved);
  }

  editComment(change: Change, commentId: string, body: string): Promise<void> {
    return this.of(change).editComment(change, commentId, body);
  }

  deleteComment(change: Change, commentId: string): Promise<void> {
    return this.of(change).deleteComment(change, commentId);
  }

  /**
   * Drops the Review under way with its Comments, unpublished: a pull
   * request's pending review, or a local Change's kept Comments.
   */
  discard(change: Change): Promise<void> {
    return change.pullRequest
      ? this.github.discard(change)
      : this.local.discard(change).then(() => undefined);
  }

  /** Submits a pull request's pending review; see `GitHubPendingReviews.submit`. */
  submit(
    change: Change,
    event: ReviewEvent,
    summary: string
  ): Promise<{ url?: string }> {
    return this.github.submit(change, event, summary);
  }

  private of(change: Change): PendingReviews {
    return change.pullRequest ? this.github : this.local;
  }
}

/** A pull request's pending review and review threads, on GitHub. */
export class GitHubPendingReviews implements PendingReviews {
  /** Each pull request's pending review id, once known or being created. */
  private readonly reviewIds = new Map<string, Promise<string>>();
  private signedIn?: GitHubUser;

  constructor(private readonly github: GitHubClient) {}

  /** The signed-in Reviewer, once GitHub has been asked. */
  get viewer(): GitHubUser | undefined {
    return this.signedIn;
  }

  /** The pull request's review threads, including those in the Reviewer's pending review. */
  async threads(change: Change): Promise<ReviewThread[]> {
    const pullRequest = pullRequestOf(change);
    const found = await this.github.reviewThreads(
      pullRequest.repository,
      pullRequest.number
    );
    this.signedIn = found.viewer;
    const key = keyOf(pullRequest);
    if (found.pendingReviewId)
      this.reviewIds.set(key, Promise.resolve(found.pendingReviewId));
    else this.reviewIds.delete(key);
    return found.threads;
  }

  /**
   * Starts a thread with this Comment, starting the pending review at the
   * Change's head first if there is none.
   */
  async addThread(
    change: Change,
    place: ThreadPlace,
    body: string
  ): Promise<{ threadId: string; commentId: string }> {
    const pullRequest = pullRequestOf(change);
    const reviewId = await this.reviewId(pullRequest, change.headSha);
    try {
      return await this.github.addReviewThread(reviewId, place, body);
    } catch (err) {
      // The review may have been submitted or deleted on github.com.
      this.reviewIds.delete(keyOf(pullRequest));
      throw err;
    }
  }

  /**
   * Replies to a thread: into the pending review if one is open, or else
   * published at once. Gives the reply's id and whether it is pending.
   */
  async reply(
    change: Change,
    threadId: string,
    body: string
  ): Promise<{ commentId: string; pending: boolean }> {
    const pullRequest = pullRequestOf(change);
    const key = keyOf(pullRequest);
    let reviewId = await this.reviewIds.get(key);
    if (reviewId === undefined) {
      // One may have been started on github.com since.
      const found = await this.github.reviewThreads(
        pullRequest.repository,
        pullRequest.number
      );
      this.signedIn = found.viewer;
      reviewId = found.pendingReviewId;
      if (reviewId) this.reviewIds.set(key, Promise.resolve(reviewId));
    }
    try {
      const commentId = await this.github.replyToThread(
        threadId,
        body,
        reviewId
      );
      return { commentId, pending: reviewId !== undefined };
    } catch (err) {
      // The review may have been submitted or deleted on github.com.
      this.reviewIds.delete(key);
      throw err;
    }
  }

  setResolved(
    _change: Change,
    threadId: string,
    resolved: boolean
  ): Promise<void> {
    return this.github.setThreadResolved(threadId, resolved);
  }

  editComment(_change: Change, commentId: string, body: string): Promise<void> {
    return this.github.editReviewComment(commentId, body);
  }

  deleteComment(_change: Change, commentId: string): Promise<void> {
    return this.github.deleteReviewComment(commentId);
  }

  /** Deletes the Reviewer's pending review of the pull request, if there is one. */
  async discard(change: Change): Promise<void> {
    const pullRequest = pullRequestOf(change);
    const key = keyOf(pullRequest);
    try {
      const found = await this.github.reviewThreads(
        pullRequest.repository,
        pullRequest.number
      );
      this.signedIn = found.viewer;
      if (found.pendingReviewId)
        await this.github.deleteReview(found.pendingReviewId);
    } finally {
      this.reviewIds.delete(key);
    }
  }

  /**
   * Submits the pending review, starting an empty one at the Change's head
   * if there is none, which ends the Review. Gives the review's page on
   * GitHub.
   */
  async submit(
    change: Change,
    event: ReviewEvent,
    summary: string
  ): Promise<{ url?: string }> {
    const pullRequest = pullRequestOf(change);
    const key = keyOf(pullRequest);
    try {
      return await this.github.submitReview(
        await this.reviewId(pullRequest, change.headSha),
        event,
        summary
      );
    } finally {
      this.reviewIds.delete(key);
    }
  }

  private reviewId(
    pullRequest: PullRequestRef,
    headSha: string
  ): Promise<string> {
    const key = keyOf(pullRequest);
    let id = this.reviewIds.get(key);
    if (!id) {
      id = (async () => {
        const found = await this.github.reviewThreads(
          pullRequest.repository,
          pullRequest.number
        );
        this.signedIn = found.viewer;
        return (
          found.pendingReviewId ??
          (await this.github.startReview(found.pullRequestId, headSha))
        );
      })();
      const started = id;
      started.catch(() => {
        if (this.reviewIds.get(key) === started) this.reviewIds.delete(key);
      });
      this.reviewIds.set(key, started);
    }
    return id;
  }
}

function pullRequestOf(change: Change): PullRequestRef {
  if (!change.pullRequest) throw new Error("Not a pull request's Change");
  return change.pullRequest;
}

function keyOf(pullRequest: PullRequestRef): string {
  return `${pullRequest.repository.toLowerCase()}#${pullRequest.number}`;
}
