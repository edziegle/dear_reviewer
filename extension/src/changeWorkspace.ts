// Owns each open Change's pair of worktrees: creates detached base and head
// worktrees in the extension's storage, puts them in a window as workspace
// folders, opens the multi-file diff between them, and cleans up when the
// Change is closed.

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { git } from "./git";
import { Change, OpenChanges, PullRequestRef } from "./openChanges";
import {
  appendFolders,
  Folder,
  hasFolder,
  removeFolders,
  ReviewWindow,
} from "./reviewWindow";

export type { Change, PullRequestRef } from "./openChanges";

export interface ChangeRequest {
  repository: string;
  base: string;
  head: string;
  /** Set when the Change comes from this pull request. */
  pullRequest?: PullRequestRef;
}

export class ChangeWorkspace {
  private readonly openChanges: OpenChanges;
  private readonly reviewWindow: ReviewWindow;
  private readonly shown = new vscode.EventEmitter<Change>();
  /** Fires when this window shows a Change's diff. */
  readonly onDidShowChange = this.shown.event;

  constructor(private readonly storageDir: string) {
    this.openChanges = new OpenChanges(storageDir);
    this.reviewWindow = new ReviewWindow(storageDir);
  }

  async open(request: ChangeRequest): Promise<Change> {
    const change = await this.resolve(request);
    await createWorktrees(change);
    if (ReviewWindow.canAddFoldersHere()) {
      this.openChanges.put({
        ...change,
        inReviewWindow: this.reviewWindow.isThisWindow(),
      });
      await appendFolders(changeFolders(change));
      await showDiff(change);
      this.shown.fire(change);
    } else {
      this.openChanges.put({
        ...change,
        inReviewWindow: true,
        diffPending: true,
      });
      this.syncReviewWindow();
      await this.reviewWindow.open();
    }
    return change;
  }

  async close(request: ChangeRequest): Promise<Change> {
    const change = await this.resolve(request);
    const wasInReviewWindow = this.openChanges.get(change.id)?.inReviewWindow;
    await removeFolders([change.headDir, change.baseDir]);
    this.openChanges.remove(change.id);
    if (wasInReviewWindow && !this.reviewWindow.isThisWindow()) {
      this.syncReviewWindow();
    }
    for (const dir of [change.baseDir, change.headDir]) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    await git(change.repository, "worktree", "prune");
    return change;
  }

  /** The Change the request names, if it is open in this window. */
  async find(request: ChangeRequest): Promise<Change | undefined> {
    const change = await this.resolve(request);
    if (hasFolder(change.baseDir) && hasFolder(change.headDir)) return change;
  }

  list(): Change[] {
    return this.openChanges.all();
  }

  /**
   * In the review window, shows the diff of each Change sent here from
   * another window, once its folders have arrived.
   */
  async showPendingDiffs(): Promise<void> {
    if (!this.reviewWindow.isThisWindow()) return;
    for (const change of this.openChanges.all()) {
      if (!change.diffPending) continue;
      if (!hasFolder(change.baseDir) || !hasFolder(change.headDir)) continue;
      this.openChanges.put({ ...change, diffPending: false });
      await showDiff(change);
      this.shown.fire(change);
    }
  }

  /** Lists in the review window's workspace file exactly the Changes it holds. */
  private syncReviewWindow(): void {
    this.reviewWindow.setFolders(
      this.openChanges
        .all()
        .filter((c) => c.inReviewWindow)
        .flatMap(changeFolders)
    );
  }

  private async resolve(request: ChangeRequest): Promise<Change> {
    const repository = path.resolve(request.repository);
    const mergeBase = await git(
      repository,
      "merge-base",
      request.base,
      request.head
    );
    const headSha = await git(
      repository,
      "rev-parse",
      `${request.head}^{commit}`
    );
    const pullRequest = request.pullRequest && {
      repository: request.pullRequest.repository,
      number: request.pullRequest.number,
    };
    const id = crypto
      .createHash("sha256")
      .update(`${repository}\0${mergeBase}\0${headSha}`)
      .update(
        pullRequest ? `\0${pullRequest.repository}#${pullRequest.number}` : ""
      )
      .digest("hex")
      .slice(0, 12);
    const dir = path.join(this.storageDir, "changes", id);
    return {
      id,
      repository,
      mergeBase,
      headSha,
      baseDir: path.join(dir, "base"),
      headDir: path.join(dir, "head"),
      ...(pullRequest && { pullRequest }),
    };
  }
}

/**
 * Fetches a pull request's head and its base branch into the local clone of
 * its repository, and gives the Change to open. It fetches from the clone's
 * remote for the pull request's repository (see ADR 0005), so a fork in
 * `origin` doesn't stop it.
 */
export async function fetchPullRequest(
  clone: string,
  pullRequest: PullRequestRef & { baseRefName: string }
): Promise<ChangeRequest> {
  const remote = await remoteFor(clone, pullRequest.repository);
  const baseRef = `refs/remotes/${remote}/${pullRequest.baseRefName}`;
  // The pull request's head comes first, so FETCH_HEAD names it.
  await git(
    clone,
    "fetch",
    "--no-tags",
    "--",
    remote,
    `refs/pull/${pullRequest.number}/head`,
    `+refs/heads/${pullRequest.baseRefName}:${baseRef}`
  );
  const head = await git(clone, "rev-parse", "--verify", "FETCH_HEAD^{commit}");
  return {
    repository: clone,
    base: baseRef,
    head,
    pullRequest: {
      repository: pullRequest.repository,
      number: pullRequest.number,
    },
  };
}

/** The clone's remote whose URL names the repository, or else `origin`. */
async function remoteFor(clone: string, repository: string): Promise<string> {
  const remotes = (await git(clone, "remote")).split("\n").filter(Boolean);
  const wanted = repository.toLowerCase();
  for (const remote of remotes) {
    const url = (await git(clone, "remote", "get-url", remote)).toLowerCase();
    const named = url.replace(/\/+$/, "").replace(/\.git$/, "");
    if (named.endsWith(`/${wanted}`) || named.endsWith(`:${wanted}`))
      return remote;
  }
  if (remotes.includes("origin")) return "origin";
  throw new Error(
    `No remote of ${clone} points at ${repository}, and it has no origin`
  );
}

async function createWorktrees(change: Change): Promise<void> {
  // Prune rather than `worktree add --force`, so worktrees deleted outside
  // git can be recreated.
  await git(change.repository, "worktree", "prune");
  for (const [dir, rev] of [
    [change.baseDir, change.mergeBase],
    [change.headDir, change.headSha],
  ]) {
    if (fs.existsSync(dir)) continue;
    await git(change.repository, "worktree", "add", "--detach", dir, rev);
  }
}

function changeFolders(change: Change): Folder[] {
  const repo = path.basename(change.repository);
  return [
    {
      path: change.baseDir,
      name: `${repo} base ${change.mergeBase.slice(0, 7)}`,
    },
    {
      path: change.headDir,
      name: `${repo} head ${change.headSha.slice(0, 7)}`,
    },
  ];
}

export function changeTitle(change: Change): string {
  const repo = path.basename(change.repository);
  return `${repo} ${change.mergeBase.slice(0, 7)}..${change.headSha.slice(0, 7)}`;
}

export type FileStatus = "added" | "modified" | "deleted";

export interface ChangedFile {
  /** Relative to the repository root, with forward slashes. */
  path: string;
  status: FileStatus;
}

/** The Change's files, sorted by path. */
export async function changedFiles(change: Change): Promise<ChangedFile[]> {
  const nameStatus = await git(
    change.repository,
    "diff",
    "--name-status",
    "--no-renames",
    "-z",
    change.mergeBase,
    change.headSha
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

/** The file in the base and head worktrees; a side is absent if the file isn't there. */
export function fileSides(
  change: Change,
  file: ChangedFile
): { original?: vscode.Uri; modified?: vscode.Uri } {
  return {
    original:
      file.status === "added"
        ? undefined
        : vscode.Uri.file(path.join(change.baseDir, file.path)),
    modified:
      file.status === "deleted"
        ? undefined
        : vscode.Uri.file(path.join(change.headDir, file.path)),
  };
}

async function showDiff(change: Change): Promise<void> {
  // Each resource is [label, original (absent if added), modified (absent if deleted)].
  const resources = (await changedFiles(change)).map((file) => {
    const { original, modified } = fileSides(change, file);
    return [(modified ?? original)!, original, modified];
  });
  await vscode.commands.executeCommand(
    "vscode.changes",
    changeTitle(change),
    resources
  );
}
