// A Change's names, its Assistant's folder and its changed files: what
// needs only the Change and git, not the window. Kept apart from `vscode`
// so the unit tests can run it under plain Node.

import * as path from "path";
import { branchOfConversation } from "./conversationName";
import { git } from "./git";
import type { Change, PullRequestRef } from "./openChanges";

export type { Change, PullRequestRef } from "./openChanges";

/**
 * The Change's folder of what Dear Reviewer writes for its Assistant to
 * read, beside its worktrees. The Assistant may read this folder, and not
 * the rest of the Change's.
 */
export function assistantDir(change: Change): string {
  return path.join(path.dirname(change.headDir), "assistant");
}

export function changeTitle(change: Change): string {
  const repo = path.basename(change.repository);
  return `${repo} ${change.mergeBase.slice(0, 7)}..${change.headSha.slice(0, 7)}`;
}

/**
 * The Change as the Reviewer knows it: its pull request, or else the local
 * branch it was opened at, or else its commits.
 */
export function changeName(change: Change): string {
  if (change.pullRequest) return pullRequestName(change.pullRequest);
  return branchOfConversation(change.conversation) ?? changeTitle(change);
}

/**
 * What names the Change where there is room: its pull request's title once
 * that has loaded, until then `changeName`.
 */
export function changeHeading(change: Change, title?: string): string {
  return title ?? changeName(change);
}

/**
 * Where the Change comes from, under its heading: its pull request or
 * branch and its commits, such as `acme/api #7 · f8e077e..00bb329`.
 */
export function changeSource(change: Change): string {
  const range = `${change.mergeBase.slice(0, 7)}..${change.headSha.slice(0, 7)}`;
  return `${changeName(change)} · ${range}`;
}

/** The pull request as the Reviewer knows it, such as `acme/api #7`. */
export function pullRequestName(pullRequest: PullRequestRef): string {
  return `${pullRequest.repository} #${pullRequest.number}`;
}

export type FileStatus = "added" | "modified" | "deleted";

export interface ChangedFile {
  /** Relative to the repository root, with forward slashes. */
  path: string;
  status: FileStatus;
}

/** The Change's files, sorted by path. */
export function changedFiles(change: Change): Promise<ChangedFile[]> {
  return filesChangedBetween(
    change.repository,
    change.mergeBase,
    change.headSha
  );
}

/** The files that differ between two commits of the repository, sorted by path. */
export async function filesChangedBetween(
  repository: string,
  from: string,
  to: string
): Promise<ChangedFile[]> {
  const nameStatus = await git(
    repository,
    "diff",
    "--name-status",
    "--no-renames",
    "-z",
    from,
    to
  );
  const fields = nameStatus.split("\0").filter(Boolean);
  const files: ChangedFile[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const [status, file] = [fields[i], fields[i + 1]];
    files.push({
      path: file,
      status:
        status === "A" ? "added" : status === "D" ? "deleted" : "modified",
    });
  }
  return files;
}
