// A pull request Review's Comments, kept in the Reviewer's pending review on
// GitHub until they submit it (see ADR 0007).

import type {
  GitHubClient,
  PendingThread,
  ReviewEvent,
  ThreadPlace,
} from "./github/client";
import type { PullRequestRef } from "./openChanges";

export class PendingReviews {
  /** Each pull request's pending review id, once known or being created. */
  private readonly reviewIds = new Map<string, Promise<string>>();
  private viewerLogin?: string;

  constructor(private readonly github: GitHubClient) {}

  /** The signed-in Reviewer's login, once GitHub has been asked. */
  get viewer(): string | undefined {
    return this.viewerLogin;
  }

  /** The threads in the Reviewer's pending review of the pull request. */
  async threads(pullRequest: PullRequestRef): Promise<PendingThread[]> {
    const found = await this.github.pendingReview(
      pullRequest.repository,
      pullRequest.number
    );
    this.viewerLogin = found.viewer.login;
    const key = keyOf(pullRequest);
    if (found.review) this.reviewIds.set(key, Promise.resolve(found.review.id));
    else this.reviewIds.delete(key);
    return found.review?.threads ?? [];
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
        const found = await this.github.pendingReview(
          pullRequest.repository,
          pullRequest.number
        );
        this.viewerLogin = found.viewer.login;
        return (
          found.review?.id ??
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
