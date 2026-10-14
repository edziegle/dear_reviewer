// Ends what outlives a Change once it is over (ADR 0013). A pull request's
// Change is over when GitHub says the pull request was merged or closed, and
// a local branch's when the branch was deleted or main has all its commits:
// its worktrees and folders go, and so do its Assistant conversation and,
// for a branch, its local Review and Briefs, even if the Reviewer had
// already closed the Change. Any Change is over when its worktrees or its
// repository were deleted outside Dear Reviewer, but that keeps what it
// leaves in the extension's storage.

import { Briefs } from "./briefs";
import { Change, ChangeWorkspace } from "./changeWorkspace";
import { ConversationId, parseConversationName } from "./conversationName";
import { Conversations } from "./assistant/conversations";
import { GitHubClient } from "./github/client";
import { branchIsOver } from "./localBranches";
import { LocalPendingReviews } from "./localReviews";

/** What a Change leaves in the extension's storage, under its conversation name. */
export interface Kept {
  conversations: Conversations;
  localReviews: LocalPendingReviews;
  briefs: Briefs;
}

export class Lifecycle {
  private running?: Promise<void>;

  /**
   * `repositoryOf` gives the GitHub repository a clone is of, if known, to
   * find its main branch as the Inbox does. `ended` lets the rest of Dear
   * Reviewer let go of a Change it closed.
   */
  constructor(
    private readonly changes: ChangeWorkspace,
    private readonly github: GitHubClient,
    private readonly kept: Kept,
    private readonly repositoryOf: (
      clone: string
    ) => Promise<string | undefined>,
    private readonly ended: (change: Change) => Promise<void>
  ) {}

  /** Closes the Changes that are over, and forgets what they leave. Never fails. */
  tidy(): Promise<void> {
    this.running ??= this.tidyNow().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async tidyNow(): Promise<void> {
    const finished = await this.finishedConversations();
    const closed = await this.changes
      .tidy((change) => finished.has(change.conversation))
      .catch(() => []);
    for (const change of closed) await this.ended(change).catch(() => {});
    for (const name of finished) {
      this.kept.conversations.forget(name);
      this.kept.localReviews.forget(name);
      this.kept.briefs.forget(name);
    }
  }

  /**
   * The conversation names of the pull requests and local branches, open as
   * Changes or with something kept, that are over. One whose state can't be
   * told, such as a pull request while signed out, or a branch whose clone
   * is gone, isn't over. A commit range never is.
   */
  private async finishedConversations(): Promise<Set<string>> {
    const named = new Map<string, ConversationId>();
    for (const change of this.changes.list()) {
      const id: ConversationId | undefined = change.pullRequest
        ? { kind: "pullRequest", pullRequest: change.pullRequest }
        : parseConversationName(change.conversation);
      if (id) named.set(change.conversation, id);
    }
    for (const name of [
      ...this.kept.conversations.names(),
      ...this.kept.localReviews.names(),
    ]) {
      const id = parseConversationName(name);
      if (id && !named.has(name)) named.set(name, id);
    }
    const finished = new Set<string>();
    await Promise.all(
      [...named].map(async ([name, id]) => {
        if (await this.isOver(id).catch(() => false)) finished.add(name);
      })
    );
    return finished;
  }

  private async isOver(id: ConversationId): Promise<boolean> {
    if (id.kind === "pullRequest") {
      const state = await this.github.pullRequestState(
        id.pullRequest.repository,
        id.pullRequest.number
      );
      return state === "MERGED" || state === "CLOSED";
    }
    if (id.kind === "branch")
      return branchIsOver(
        id.repository,
        id.branch,
        await this.repositoryOf(id.repository)
      );
    return false;
  }
}
