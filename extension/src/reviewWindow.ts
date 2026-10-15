// Where a Change's folders go.
//
// Adding folders to a single-folder (or empty) window turns it into a
// workspace and restarts the extension host, and so does changing the first
// folder of a workspace. So Change folders are only ever appended to a
// multi-root workspace that already has a folder. Any other window sends the
// Change to the review window: a saved workspace that Dear Reviewer manages,
// whose first folder is a fixed home folder that never changes.
//
// The home folder is the folder of Changes, which holds every Change's
// worktrees, so trusting the review window once, with VS Code's own Trust,
// trusts every Change opened in it later (ADR 0021). Its own listing is
// hidden: the Changes show as folders of their own.

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export interface Folder {
  path: string;
  name: string;
}

export class ReviewWindow {
  private readonly home: string;
  readonly workspaceFile: string;

  constructor(storageDir: string) {
    this.home = path.join(storageDir, "changes");
    this.workspaceFile = path.join(
      storageDir,
      "review-window",
      "Dear Reviewer.code-workspace"
    );
  }

  /** Whether this window is the review window. */
  isThisWindow(): boolean {
    return vscode.workspace.workspaceFile?.fsPath === this.workspaceFile;
  }

  /** Whether folders can be added to this window without restarting its extension host. */
  static canAddFoldersHere(): boolean {
    return (
      vscode.workspace.workspaceFile !== undefined &&
      (vscode.workspace.workspaceFolders?.length ?? 0) > 0
    );
  }

  /**
   * Lists exactly these folders after the home folder in the review window's
   * workspace file. If the review window is open, it picks up the change.
   */
  setFolders(folders: Folder[]): void {
    fs.mkdirSync(path.join(this.home, ".vscode"), { recursive: true });
    fs.writeFileSync(
      path.join(this.home, ".vscode", "settings.json"),
      JSON.stringify({ "files.exclude": { "*": true, ".*": true } }, null, 2)
    );
    fs.mkdirSync(path.dirname(this.workspaceFile), { recursive: true });
    const workspace = {
      folders: [{ path: this.home, name: "Dear Reviewer" }, ...folders],
      // A review starts quiet: no terminal brought back from the last one.
      settings: {
        "terminal.integrated.enablePersistentSessions": false,
        "terminal.integrated.hideOnStartup": "always",
      },
    };
    fs.writeFileSync(this.workspaceFile, JSON.stringify(workspace, null, 2));
  }

  /**
   * The folders the review window's workspace file lists, as absolute
   * paths; none if it can't be read.
   */
  listedFolders(): string[] {
    try {
      const workspace = JSON.parse(
        fs.readFileSync(this.workspaceFile, "utf8")
      ) as { folders?: { path?: unknown }[] };
      return (workspace.folders ?? []).flatMap((folder) =>
        typeof folder.path === "string"
          ? [path.resolve(path.dirname(this.workspaceFile), folder.path)]
          : []
      );
    } catch {
      return [];
    }
  }

  /** Opens (or focuses) the review window, leaving this window as it is. */
  async open(): Promise<void> {
    await vscode.commands.executeCommand(
      "vscode.openFolder",
      vscode.Uri.file(this.workspaceFile),
      { forceNewWindow: true }
    );
  }
}

export function hasFolder(dir: string): boolean {
  return (vscode.workspace.workspaceFolders ?? []).some(
    (f) => f.uri.fsPath === dir
  );
}

export async function appendFolders(folders: Folder[]): Promise<void> {
  const wanted = folders.filter((folder) => !hasFolder(folder.path));
  if (wanted.length === 0) return;
  const start = vscode.workspace.workspaceFolders?.length ?? 0;
  await updateFolders(
    start,
    0,
    ...wanted.map((f) => ({ uri: vscode.Uri.file(f.path), name: f.name }))
  );
}

export async function removeFolders(dirs: string[]): Promise<void> {
  for (const dir of dirs) {
    const index = (vscode.workspace.workspaceFolders ?? []).findIndex(
      (f) => f.uri.fsPath === dir
    );
    // Never the first folder: removing it would restart the extension host.
    if (index > 0) await updateFolders(index, 1);
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
