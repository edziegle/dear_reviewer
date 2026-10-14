// Ends what outlives a Change once it is over (ADR 0013). A pull request's
// Change is over when GitHub says the pull request was merged or closed: its
// worktrees and folders go, and so does its Assistant conversation, even if
// the Reviewer had already closed the Change. Any Change is over when its
// worktrees or its repository were deleted outside Dear Reviewer.

import { Change, ChangeWorkspace, PullRequestRef } from "./changeWorkspace";
import { parseConversationName } from "./conversationName";
import { Conversations } from "./assistant/conversations";
import { GitHubClient } from "./github/client";

export class Lifecycle {
  private running?: Promise<void>;

  /** `ended` lets the rest of Dear Reviewer let go of a Change it closed. */
  constructor(
    private readonly changes: ChangeWorkspace,
    private readonly github: GitHubClient,
    private readonly conversations: Conversations,
    private readonly ended: (change: Change) => Promise<void>
  ) {}

  /** Closes the Changes that are over, and forgets their conversations. Never fails. */
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
    for (const name of finished) this.conversations.forget(name);
  }

  /**
   * The conversation names of the pull requests, open as Changes or with a
   * saved conversation, that GitHub says were merged or closed. A pull
   * request GitHub can't answer for, such as when signed out, isn't over.
   */
  private async finishedConversations(): Promise<Set<string>> {
    const pullRequests = new Map<string, PullRequestRef>();
    for (const change of this.changes.list())
      if (change.pullRequest)
        pullRequests.set(change.conversation, change.pullRequest);
    for (const name of this.conversations.names()) {
      const id = parseConversationName(name);
      if (id?.kind === "pullRequest") pullRequests.set(name, id.pullRequest);
    }
    const finished = new Set<string>();
    await Promise.all(
      [...pullRequests].map(async ([name, pullRequest]) => {
        const state = await this.github
          .pullRequestState(pullRequest.repository, pullRequest.number)
          .catch(() => undefined);
        if (state === "MERGED" || state === "CLOSED") finished.add(name);
      })
    );
    return finished;
  }
}
