// A pull request Review's Comments, kept in the Reviewer's pending review on
// GitHub until they submit it (see ADR 0007), and the review threads they
// sit among, which the Reviewer replies to and resolves (see ADR 0014).

import type {
  GitHubClient,
  GitHubUser,
  ReviewEvent,
  ReviewThread,
  ThreadPlace,
} from "./github/client";
import type { PullRequestRef } from "./openChanges";

export class PendingReviews {
  /** Each pull request's pending review id, once known or being created. */
  private readonly reviewIds = new Map<string, Promise<string>>();
  private signedIn?: GitHubUser;

  constructor(private readonly github: GitHubClient) {}

  /** The signed-in Reviewer, once GitHub has been asked. */
  get viewer(): GitHubUser | undefined {
    return this.signedIn;
  }

  /** The pull request's review threads, including those in the Reviewer's pending review. */
  async threads(pullRequest: PullRequestRef): Promise<ReviewThread[]> {
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

  /** Starts a thread with this Comment, starting the pending review first if there is none. */
  async addThread(
    pullRequest: PullRequestRef,
    place: ThreadPlace,
    body: string
  ): Promise<{ threadId: string; commentId: string }> {
    const reviewId = await this.reviewId(pullRequest);
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
    pullRequest: PullRequestRef,
    threadId: string,
    body: string
  ): Promise<{ commentId: string; pending: boolean }> {
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

  setResolved(threadId: string, resolved: boolean): Promise<void> {
    return this.github.setThreadResolved(threadId, resolved);
  }

  editComment(commentId: string, body: string): Promise<void> {
    return this.github.editReviewComment(commentId, body);
  }

  deleteComment(commentId: string): Promise<void> {
    return this.github.deleteReviewComment(commentId);
  }

  /** Submits the pending review, starting an empty one if there is none, which ends the Review. */
  async submit(
    pullRequest: PullRequestRef,
    event: ReviewEvent,
    summary: string
  ): Promise<void> {
    const key = keyOf(pullRequest);
    try {
      await this.github.submitReview(
        await this.reviewId(pullRequest),
        event,
        summary
      );
    } finally {
      this.reviewIds.delete(key);
    }
  }

  private reviewId(pullRequest: PullRequestRef): Promise<string> {
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
          (await this.github.startReview(found.pullRequestId))
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

function keyOf(pullRequest: PullRequestRef): string {
  return `${pullRequest.repository.toLowerCase()}#${pullRequest.number}`;
}
