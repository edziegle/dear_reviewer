// The Reviews of each Change: which head commit the Reviewer's last Review
// covered, and what changed since. For a pull request, GitHub records the
// commit with each submitted review (see ADR 0015). What changed since opens
// as a multi-file diff from that commit to the Change's head, whose old side
// Dear Reviewer reads from git, since no worktree is at that commit.

import * as path from "path";
import * as vscode from "vscode";
import { Change, filesChangedBetween, remoteFor } from "./changeWorkspace";
import { git, gitOutput } from "./git";
import type { GitHubClient } from "./github/client";

/** Gives a file's text at a commit, for the old side of what changed since a Review. */
export const commitFileScheme = "dear-reviewer-commit";

export class Reviews {
  constructor(private readonly github: GitHubClient) {}

  /**
   * The head commit the Reviewer's last Review of the Change covered, if
   * one has ended, fetched into the Change's repository if it isn't there.
   * Only a pull request's Reviews are known for now.
   */
  async lastReviewed(change: Change): Promise<string | undefined> {
    const pullRequest = change.pullRequest;
    if (!pullRequest) return;
    const commit = await this.github.lastReviewedCommit(
      pullRequest.repository,
      pullRequest.number
    );
    if (!commit) return;
    const present = await git(
      change.repository,
      "cat-file",
      "-e",
      `${commit}^{commit}`
    ).then(
      () => true,
      () => false
    );
    if (!present) {
      // Such as a Review submitted from another machine, before a force push.
      const remote = await remoteFor(change.repository, pullRequest.repository);
      await git(change.repository, "fetch", "--no-tags", "--", remote, commit);
    }
    return commit;
  }
}

/** The title of the diff of what changed in the Change since this commit. */
export function sinceTitle(change: Change, from: string): string {
  const repo = path.basename(change.repository);
  return `${repo} ${from.slice(0, 7)}..${change.headSha.slice(0, 7)} since my last Review`;
}

/**
 * Opens the multi-file diff of what changed from the commit to the Change's
 * head. The new side is the head worktree's file, where navigation and
 * Comments work as in the Change's own diff.
 */
export async function showChangesSince(
  change: Change,
  from: string
): Promise<void> {
  const files = await filesChangedBetween(
    change.repository,
    from,
    change.headSha
  );
  // Each resource is [label, original (absent if added), modified (absent if deleted)].
  const resources = files.map((file) => {
    const original =
      file.status === "added"
        ? undefined
        : commitFileUri(change.repository, from, file.path);
    const modified =
      file.status === "deleted"
        ? undefined
        : vscode.Uri.file(path.join(change.headDir, file.path));
    return [(modified ?? original)!, original, modified];
  });
  await vscode.commands.executeCommand(
    "vscode.changes",
    sinceTitle(change, from),
    resources
  );
}

function commitFileUri(
  repository: string,
  commit: string,
  file: string
): vscode.Uri {
  return vscode.Uri.from({
    scheme: commitFileScheme,
    path: `/${file}`,
    query: new URLSearchParams({ repository, commit }).toString(),
  });
}

/** A file's text at a commit, read with `git show`, for files of open Changes' repositories only. */
export class CommitFiles implements vscode.TextDocumentContentProvider {
  constructor(private readonly repositories: () => string[]) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const query = new URLSearchParams(uri.query);
    const repository = query.get("repository") ?? "";
    const commit = query.get("commit") ?? "";
    // Any URI can name any folder: git only runs in a Change's repository.
    if (
      !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(commit) ||
      !this.repositories().includes(repository)
    )
      return "";
    return gitOutput(repository, "show", `${commit}:${uri.path.slice(1)}`);
  }
}
