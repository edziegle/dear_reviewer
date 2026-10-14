// Owns each open Change's pair of worktrees: creates detached base and head
// worktrees in the extension's storage, puts them in a window as workspace
// folders, and cleans up when the Change is closed, is over (see ADR 0013),
// or gives way to a newer head of the same pull request or branch (see ADR
// 0020). Opening a Change shows its overview, not its diff; the multi-file
// diff between the worktrees opens when the Reviewer asks.

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { branchOfConversation, conversationName } from "./conversationName";
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
  /** Fires when a Change opens in this window, for its overview to show. */
  readonly onDidShowChange = this.shown.event;
  private readonly replaced = new vscode.EventEmitter<Change>();
  /** Fires with an older head's Change that a newer head of the same pull request or branch closed. */
  readonly onDidReplaceChange = this.replaced.event;
  /** Opening, closing and tidying run one after another. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly storageDir: string) {
    this.openChanges = new OpenChanges(storageDir);
    this.reviewWindow = new ReviewWindow(storageDir);
  }

  open(request: ChangeRequest): Promise<Change> {
    return this.serially(() => this.openNow(request));
  }

  private async openNow(request: ChangeRequest): Promise<Change> {
    const change = await this.resolve(request);
    if (change.mergeBase === change.headSha)
      throw new Error(
        `${request.head} has no commits that ${request.base} doesn't have, so there is nothing to review.`
      );
    await createWorktrees(change);
    // A newer head of the same pull request or branch takes the older one's place.
    const older = this.openChanges
      .all()
      .filter(
        (c) => c.conversation === change.conversation && c.id !== change.id
      );
    for (const old of older) {
      await this.remove(old);
      this.replaced.fire(old);
    }
    if (ReviewWindow.canAddFoldersHere()) {
      this.openChanges.put({
        ...change,
        inReviewWindow: this.reviewWindow.isThisWindow(),
      });
      await appendFolders(changeFolders(change));
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

  /** Opens (or focuses) the review window, with the Changes it holds. */
  showReviewWindow(): Promise<void> {
    return this.serially(async () => {
      this.syncReviewWindow();
      await this.reviewWindow.open();
    });
  }

  close(request: ChangeRequest): Promise<Change> {
    return this.serially(async () => {
      const change = await this.resolve(request);
      await this.remove(change);
      return change;
    });
  }

  /**
   * Closes the Changes that are over: those `isOver` names, such as a merged
   * pull request's, and those whose worktrees or repository were deleted.
   * Then takes out of this window any Change folders no open Change has,
   * such as those of a Change another window closed. Gives the Changes it
   * closed.
   */
  tidy(isOver: (change: Change) => boolean): Promise<Change[]> {
    return this.serially(async () => {
      const closed: Change[] = [];
      for (const change of this.openChanges.all()) {
        if (!isOver(change) && !isBroken(change)) continue;
        await this.remove(change);
        closed.push(change);
      }
      const kept = new Set(
        this.openChanges.all().flatMap((c) => [c.baseDir, c.headDir])
      );
      const changesDir = path.join(this.storageDir, "changes") + path.sep;
      await removeFolders(
        (vscode.workspace.workspaceFolders ?? [])
          .filter((f) => f.uri.scheme === "file")
          .map((f) => f.uri.fsPath)
          .filter((dir) => dir.startsWith(changesDir) && !kept.has(dir))
      );
      return closed;
    });
  }

  /** The Change the request names, if it is open in this window. */
  async find(request: ChangeRequest): Promise<Change | undefined> {
    const change = await this.resolve(request);
    if (hasFolder(change.baseDir) && hasFolder(change.headDir)) return change;
  }

  list(): Change[] {
    return this.openChanges.all();
  }

  /** The Changes whose diff this window has shown, such as before a reload. */
  shownHere(): Change[] {
    return this.openChanges
      .all()
      .filter(
        (c) => !c.diffPending && hasFolder(c.baseDir) && hasFolder(c.headDir)
      );
  }

  /**
   * In the review window, shows each Change sent here from another window,
   * once its folders have arrived.
   */
  async showPendingDiffs(): Promise<void> {
    if (!this.reviewWindow.isThisWindow()) return;
    for (const change of this.openChanges.all()) {
      if (!change.diffPending) continue;
      if (!hasFolder(change.baseDir) || !hasFolder(change.headDir)) continue;
      this.openChanges.put({ ...change, diffPending: false });
      this.shown.fire(change);
    }
  }

  /** Removes the Change's folders, its worktrees and git's records of them. */
  private async remove(change: Change): Promise<void> {
    const wasInReviewWindow = this.openChanges.get(change.id)?.inReviewWindow;
    await removeFolders([change.headDir, change.baseDir]);
    this.openChanges.remove(change.id);
    if (wasInReviewWindow && !this.reviewWindow.isThisWindow()) {
      this.syncReviewWindow();
    }
    for (const dir of [change.baseDir, change.headDir]) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    // A repository that was deleted has no records left to prune.
    if (fs.existsSync(change.repository))
      await git(change.repository, "worktree", "prune");
  }

  private serially<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
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
    const conversation =
      this.openChanges.get(id)?.conversation ??
      (await conversationOf(repository, request, mergeBase, headSha));
    return {
      id,
      repository,
      mergeBase,
      headSha,
      baseDir: path.join(dir, "base"),
      headDir: path.join(dir, "head"),
      ...(pullRequest && { pullRequest }),
      conversation,
    };
  }
}

/**
 * What the Change is across new commits: its pull request, or else the local
 * branch the request named (`HEAD` names the checked-out branch), or else
 * the commit range itself.
 */
async function conversationOf(
  repository: string,
  request: ChangeRequest,
  mergeBase: string,
  headSha: string
): Promise<string> {
  if (request.pullRequest)
    return conversationName({
      kind: "pullRequest",
      pullRequest: request.pullRequest,
    });
  const ref = await git(
    repository,
    "rev-parse",
    "--symbolic-full-name",
    request.head
  ).catch(() => "");
  if (ref.startsWith("refs/heads/"))
    return conversationName({
      kind: "branch",
      branch: ref.slice("refs/heads/".length),
      repository,
    });
  return conversationName({ kind: "range", mergeBase, headSha, repository });
}

/** Whether a worktree, or the repository it belongs to, was deleted outside Dear Reviewer. */
function isBroken(change: Change): boolean {
  return [change.repository, change.baseDir, change.headDir].some(
    (dir) => !fs.existsSync(dir)
  );
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
export async function remoteFor(
  clone: string,
  repository: string
): Promise<string> {
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

/**
 * The Change as the Reviewer knows it: its pull request, or else the local
 * branch it was opened at, or else its commits.
 */
export function changeName(change: Change): string {
  if (change.pullRequest) return pullRequestName(change.pullRequest);
  return branchOfConversation(change.conversation) ?? changeTitle(change);
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

/** Opens the multi-file diff of all the Change's files, in the main column. */
export async function showAllChanges(change: Change): Promise<void> {
  // Each resource is [label, original (absent if added), modified (absent if deleted)].
  const resources = (await changedFiles(change)).map((file) => {
    const { original, modified } = fileSides(change, file);
    return [(modified ?? original)!, original, modified];
  });
  await vscode.commands.executeCommand(
    "vscode.changes",
    `${changeName(change)} · all changes`,
    resources
  );
}
