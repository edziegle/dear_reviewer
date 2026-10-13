// Owns each open Change's pair of worktrees: creates detached base and head
// worktrees in the extension's storage, puts them in a window as workspace
// folders, opens the multi-file diff between them, and cleans up when the
// Change is closed.

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { git } from "./git";
import { Change, OpenChanges } from "./openChanges";
import {
  appendFolders,
  Folder,
  hasFolder,
  removeFolders,
  ReviewWindow,
} from "./reviewWindow";

export type { Change } from "./openChanges";

export interface ChangeRequest {
  repository: string;
  base: string;
  head: string;
}

export class ChangeWorkspace {
  private readonly openChanges: OpenChanges;
  private readonly reviewWindow: ReviewWindow;

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

  async close(request: ChangeRequest): Promise<void> {
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
    const id = crypto
      .createHash("sha256")
      .update(`${repository}\0${mergeBase}\0${headSha}`)
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
    };
  }
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

async function showDiff(change: Change): Promise<void> {
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
  // Each resource is [label, original (absent if added), modified (absent if deleted)].
  const resources: [
    vscode.Uri,
    vscode.Uri | undefined,
    vscode.Uri | undefined,
  ][] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const [status, file] = [fields[i], fields[i + 1]];
    const original =
      status === "A"
        ? undefined
        : vscode.Uri.file(path.join(change.baseDir, file));
    const modified =
      status === "D"
        ? undefined
        : vscode.Uri.file(path.join(change.headDir, file));
    resources.push([(modified ?? original)!, original, modified]);
  }
  await vscode.commands.executeCommand(
    "vscode.changes",
    changeTitle(change),
    resources
  );
}
