// Owns each open Change's pair of worktrees: creates detached base and head
// worktrees in the extension's storage, adds them as workspace folders, and
// removes them again when the Change is closed.

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { git } from "./git";

export interface ChangeRequest {
  repository: string;
  base: string;
  head: string;
}

export interface Change {
  id: string;
  repository: string;
  mergeBase: string;
  headSha: string;
  baseDir: string;
  headDir: string;
}

export class ChangeWorkspace {
  constructor(private readonly storageDir: string) {}

  async open(request: ChangeRequest): Promise<Change> {
    const change = await this.resolve(request);
    await this.createWorktrees(change);
    await addFolders(change);
    await showDiff(change);
    return change;
  }

  async close(request: ChangeRequest): Promise<void> {
    const change = await this.resolve(request);
    await removeFolders(change);
    for (const dir of [change.baseDir, change.headDir]) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    await git(change.repository, "worktree", "prune");
  }

  private async resolve(request: ChangeRequest): Promise<Change> {
    const repository = path.resolve(request.repository);
    const mergeBase = await git(repository, "merge-base", request.base, request.head);
    const headSha = await git(repository, "rev-parse", `${request.head}^{commit}`);
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

  private async createWorktrees(change: Change): Promise<void> {
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
  const resources: [vscode.Uri, vscode.Uri | undefined, vscode.Uri | undefined][] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const [status, file] = [fields[i], fields[i + 1]];
    const original =
      status === "A" ? undefined : vscode.Uri.file(path.join(change.baseDir, file));
    const modified =
      status === "D" ? undefined : vscode.Uri.file(path.join(change.headDir, file));
    resources.push([(modified ?? original)!, original, modified]);
  }
  await vscode.commands.executeCommand("vscode.changes", changeTitle(change), resources);
}

function changeFolders(change: Change) {
  const repo = path.basename(change.repository);
  return [
    {
      uri: vscode.Uri.file(change.baseDir),
      name: `${repo} base ${change.mergeBase.slice(0, 7)}`,
    },
    {
      uri: vscode.Uri.file(change.headDir),
      name: `${repo} head ${change.headSha.slice(0, 7)}`,
    },
  ];
}

async function addFolders(change: Change): Promise<void> {
  const existing = vscode.workspace.workspaceFolders ?? [];
  const wanted = changeFolders(change).filter(
    (folder) => !existing.some((f) => f.uri.fsPath === folder.uri.fsPath)
  );
  if (wanted.length === 0) return;
  await updateFolders(existing.length, 0, ...wanted);
}

async function removeFolders(change: Change): Promise<void> {
  for (const dir of [change.headDir, change.baseDir]) {
    const index = (vscode.workspace.workspaceFolders ?? []).findIndex(
      (f) => f.uri.fsPath === dir
    );
    if (index >= 0) await updateFolders(index, 1);
  }
}

function updateFolders(
  start: number,
  deleteCount: number,
  ...add: { uri: vscode.Uri; name: string }[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    const listener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      listener.dispose();
      resolve();
    });
    if (!vscode.workspace.updateWorkspaceFolders(start, deleteCount, ...add)) {
      listener.dispose();
      reject(new Error("VS Code refused to update the workspace folders"));
    }
  });
}
