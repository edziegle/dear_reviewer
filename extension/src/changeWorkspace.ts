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
import {
  assistantDir,
  type ChangedFile,
  changedFiles,
  changeName,
} from "./changeDetails";
import { conversationOf } from "./conversationName";
import { git } from "./git";
import { remoteFor } from "./remotes";
import {
  Change,
  arrivedDiffs,
  changeInFront,
  OpenChanges,
  waitingToShow,
  PullRequestRef,
} from "./openChanges";
import {
  appendFolders,
  Folder,
  hasFolder,
  removeFolders,
  ReviewWindow,
} from "./reviewWindow";

export type { Change, PullRequestRef } from "./openChanges";
export * from "./changeDetails";

export interface ChangeRequest {
  repository: string;
  base: string;
  head: string;
  /** Set when the Change comes from this pull request. */
  pullRequest?: PullRequestRef;
}

export class ChangeWorkspace implements vscode.Disposable {
  private readonly openChanges: OpenChanges;
  private readonly watcher: vscode.FileSystemWatcher;
  private readonly closeAskWatcher: vscode.FileSystemWatcher;
  /**
   * Fires when the open Changes change, in this window or another, such as
   * when another window opens again a Change this one shows.
   */
  readonly onDidChangeOpenChanges: vscode.Event<unknown>;
  private readonly reviewWindow: ReviewWindow;
  private readonly shown = new vscode.EventEmitter<Change>();
  /** Fires when a Change opens in this window, for its overview to show. */
  readonly onDidShowChange = this.shown.event;
  private readonly replaced = new vscode.EventEmitter<Change>();
  /** Fires with an older head's Change that a newer head of the same pull request or branch closed. */
  readonly onDidReplaceChange = this.replaced.event;
  /** Opening, closing and tidying run one after another. */
  private queue: Promise<unknown> = Promise.resolve();
  /** How many of them are queued or running. */
  private operations = 0;
  private readonly emptied = new vscode.EventEmitter<void>();
  /** Fires in the review window when the Reviewer closed its last Change, so the window should close. */
  readonly onDidEmptyReviewWindow = this.emptied.event;
  private readonly settled = new vscode.EventEmitter<void>();
  /** Fires when the last opening, closing or tidying queued finishes. */
  readonly onDidSettle = this.settled.event;

  constructor(private readonly storageDir: string) {
    this.openChanges = new OpenChanges(storageDir);
    this.reviewWindow = new ReviewWindow(storageDir);
    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.file(path.dirname(this.openChanges.file)),
        path.basename(this.openChanges.file)
      )
    );
    this.closeAskWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.file(path.dirname(this.openChanges.closeAskFile)),
        path.basename(this.openChanges.closeAskFile)
      )
    );
    this.closeAskWatcher.onDidCreate(() => this.closeIfAsked());
    this.closeAskWatcher.onDidChange(() => this.closeIfAsked());
    const { onDidCreate, onDidChange, onDidDelete } = this.watcher;
    this.onDidChangeOpenChanges = (listener, thisArgs, disposables) => {
      const subscriptions = [onDidCreate, onDidChange, onDidDelete].map(
        (event) => event(listener, thisArgs, disposables)
      );
      return vscode.Disposable.from(...subscriptions);
    };
  }

  dispose(): void {
    this.watcher.dispose();
    this.closeAskWatcher.dispose();
    this.emptied.dispose();
    this.settled.dispose();
  }

  /**
   * Whether an opening, closing or tidying is under way, such as a newer
   * head taking an older one's place, so the open Changes are still moving.
   */
  get busy(): boolean {
    return this.operations > 0;
  }

  /**
   * Whether this is the review window and a Change sent here still waits to
   * show, with its folders on their way.
   */
  waitingHere(): boolean {
    return (
      this.reviewWindow.isThisWindow() &&
      waitingToShow(this.openChanges.all(), this.reviewWindow.listedFolders())
    );
  }

  /**
   * Opens the Change. With `keepPlace`, a newer head of a pull request or
   * branch takes the older head's place in the list and is not shown, so a
   * Change behind the one in front stays behind it.
   */
  open(request: ChangeRequest, keepPlace = false): Promise<Change> {
    return this.serially(() => this.openNow(request, keepPlace));
  }

  private async openNow(
    request: ChangeRequest,
    keepPlace: boolean
  ): Promise<Change> {
    const change = await this.resolve(request);
    if (change.mergeBase === change.headSha)
      throw new Error(
        `${request.head} has no commits that ${request.base} doesn't have, so there is nothing to review.`
      );
    await createWorktrees(change);
    // A newer head of the same pull request or branch takes the older one's
    // place. It is listed first, so no window, seeing the older one go,
    // takes another Change for the one in front on the way.
    const older = this.openChanges
      .all()
      .filter(
        (c) => c.conversation === change.conversation && c.id !== change.id
      );
    const here = ReviewWindow.canAddFoldersHere();
    this.openChanges.withdrawCloseAsk();
    const entry = here
      ? { ...change, inReviewWindow: this.reviewWindow.isThisWindow() }
      : { ...change, inReviewWindow: true, diffPending: true };
    const inPlace = keepPlace && here && older.length > 0;
    if (inPlace)
      this.openChanges.putInPlaceOf(
        entry,
        older.map((c) => c.id)
      );
    else this.openChanges.put(entry);
    for (const old of older) {
      await this.remove(old);
      this.replaced.fire(old);
    }
    if (here) {
      await appendFolders(changeFolders(change));
      if (!inPlace) this.shown.fire(change);
    } else {
      this.syncReviewWindow();
      await this.reviewWindow.open();
    }
    return change;
  }

  /**
   * Brings a Change this window shows to the front again, as opening it
   * again would, without fetching anything: it becomes the one shown last.
   */
  bringToFront(change: Change): Promise<void> {
    return this.serially(async () => {
      const open = this.openChanges.all().find((c) => c.id === change.id);
      if (!open || open.diffPending) return;
      this.openChanges.put(open);
      this.shown.fire(change);
    });
  }

  /** Opens (or focuses) the review window, with the Changes it holds. */
  showReviewWindow(): Promise<void> {
    return this.serially(async () => {
      this.syncReviewWindow();
      await this.reviewWindow.open();
    });
  }

  /**
   * Closes a Change the Reviewer asked to close. If it was the last Change
   * in the review window, that window closes too: this one if it is the
   * review window, otherwise the review window is asked to.
   */
  close(request: ChangeRequest): Promise<Change> {
    return this.serially(async () => {
      const change = await this.resolve(request);
      const inReviewWindow = this.openChanges.get(change.id)?.inReviewWindow;
      await this.remove(change);
      if (inReviewWindow && !this.holdsReviewWindowChange()) {
        if (this.reviewWindow.isThisWindow()) this.windowEmptied = true;
        else this.openChanges.askToCloseWindow();
      }
      return change;
    });
  }

  /** Whether the last `close` emptied this window, the review window. */
  private windowEmptied = false;

  /** Once the closed Change is let go of, closes this window if closing it emptied it. */
  closeWindowIfEmptied(): void {
    if (!this.windowEmptied) return;
    this.windowEmptied = false;
    this.emptied.fire();
  }

  private holdsReviewWindowChange(): boolean {
    return this.openChanges.all().some((c) => c.inReviewWindow);
  }

  /** In the review window, closes it if another window asked and no Change is left in it. */
  private closeIfAsked(): void {
    if (!this.reviewWindow.isThisWindow()) return;
    if (!this.openChanges.takeCloseAsk()) return;
    if (!this.holdsReviewWindowChange()) this.emptied.fire();
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
      const closed: Change[] = this.openChanges
        .all()
        .filter((change) => isOver(change) || isBroken(change));
      await this.remove(...closed);
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

  /**
   * The Change in front in this window: of those it has shown, the one
   * shown last. Change Files, Findings and the review keybindings follow it.
   */
  inFront(): Change | undefined {
    return changeInFront(
      this.openChanges.all(),
      (c) => hasFolder(c.baseDir) && hasFolder(c.headDir)
    );
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
   * once its folders have arrived, unless one opened after it already shows.
   */
  async showPendingDiffs(): Promise<void> {
    if (!this.reviewWindow.isThisWindow()) return;
    const arrived = arrivedDiffs(
      this.openChanges.all(),
      (c) => hasFolder(c.baseDir) && hasFolder(c.headDir)
    );
    if (arrived.length === 0) return;
    this.openChanges.markShown(arrived.map(({ change }) => change.id));
    for (const { change, show } of arrived) if (show) this.shown.fire(change);
  }

  /**
   * Removes the Changes' folders, their worktrees and git's records of them.
   * They leave the open Changes in one write, so other windows see them go
   * at once rather than one by one.
   */
  private async remove(...changes: Change[]): Promise<void> {
    if (changes.length === 0) return;
    const ids = new Set(changes.map((c) => c.id));
    const wereInReviewWindow = this.openChanges
      .all()
      .some((c) => ids.has(c.id) && c.inReviewWindow);
    for (const change of changes)
      await removeFolders([change.headDir, change.baseDir]);
    this.openChanges.removeAll(ids);
    if (wereInReviewWindow && !this.reviewWindow.isThisWindow()) {
      this.syncReviewWindow();
    }
    for (const change of changes) {
      for (const dir of [change.baseDir, change.headDir, assistantDir(change)])
        fs.rmSync(dir, { recursive: true, force: true });
      // A repository that was deleted has no records left to prune.
      if (fs.existsSync(change.repository))
        await git(change.repository, "worktree", "prune");
    }
  }

  private serially<T>(work: () => Promise<T>): Promise<T> {
    this.operations++;
    const result = this.queue.then(work).finally(() => {
      if (--this.operations === 0) this.settled.fire();
    });
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

  /**
   * The conversation name of the Change the request opens, or opened while
   * it is open. A pull request's needs none of its commits.
   */
  async conversationFor(request: ChangeRequest): Promise<string> {
    if (request.pullRequest)
      return conversationOf(request.repository, request, () => {
        throw new Error("A pull request's conversation has no range");
      });
    return (await this.resolve(request)).conversation;
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
      (await conversationOf(repository, request, async () => ({
        mergeBase,
        headSha,
      })));
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
