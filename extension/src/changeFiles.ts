// The Change files view: each open Change in this window, with its files as a
// directory tree. Files show their status and a viewed checkbox; selecting
// one opens its diff between the base and head worktrees.

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  Change,
  ChangedFile,
  changedFiles,
  changeTitle,
  fileSides,
  FileStatus,
} from "./changeWorkspace";
import { hasFolder } from "./reviewWindow";
import { ViewedFiles } from "./viewedFiles";

export type ChangeFilesNode =
  | {
      kind: "change";
      change: Change;
      files: ChangedFile[];
      viewedCount: number;
      children: ChangeFilesNode[];
    }
  | {
      kind: "directory";
      change: Change;
      path: string;
      files: ChangedFile[];
      children: ChangeFilesNode[];
    }
  | { kind: "file"; change: Change; file: ChangedFile; viewed: boolean }
  | { kind: "problem"; message: string };

/** Gives the empty side of an added or deleted file's diff. */
export const emptyFileScheme = "dear-reviewer-empty";
const fileScheme = "dear-reviewer-file";

const statuses: Record<
  FileStatus,
  { badge: string; color: string; tooltip: string }
> = {
  added: {
    badge: "A",
    color: "gitDecoration.addedResourceForeground",
    tooltip: "Added",
  },
  modified: {
    badge: "M",
    color: "gitDecoration.modifiedResourceForeground",
    tooltip: "Modified",
  },
  deleted: {
    badge: "D",
    color: "gitDecoration.deletedResourceForeground",
    tooltip: "Deleted",
  },
};

export class ChangeFilesView
  implements
    vscode.TreeDataProvider<ChangeFilesNode>,
    vscode.FileDecorationProvider
{
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  // A Change's files never change: its base and head are fixed commits.
  private readonly files = new Map<string, Promise<ChangedFile[]>>();

  constructor(
    private readonly openChanges: () => Change[],
    private readonly viewedFiles: ViewedFiles,
    /** Keeps the view's settings, so every window and the next session share them. */
    private readonly settingsFile: string
  ) {
    void this.showHideViewedContext();
  }

  refresh(): void {
    this.changed.fire();
  }

  get hidesViewed(): boolean {
    try {
      const settings = JSON.parse(fs.readFileSync(this.settingsFile, "utf8"));
      return settings.hideViewed === true;
    } catch {
      return false;
    }
  }

  async setHideViewed(hide: boolean): Promise<void> {
    fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true });
    fs.writeFileSync(
      this.settingsFile,
      JSON.stringify({ hideViewed: hide }, null, 2)
    );
    await this.showHideViewedContext();
    this.refresh();
  }

  /** Marks the files of these nodes, including those under directories and Changes. */
  async setViewed(nodes: ChangeFilesNode[], viewed: boolean): Promise<void> {
    const byChange = new Map<string, { change: Change; paths: string[] }>();
    for (const node of nodes) {
      if (node.kind === "problem") continue;
      const files = node.kind === "file" ? [node.file] : node.files;
      const entry = byChange.get(node.change.id) ?? {
        change: node.change,
        paths: [],
      };
      entry.paths.push(...files.map((f) => f.path));
      byChange.set(node.change.id, entry);
    }
    try {
      for (const { change, paths } of byChange.values()) {
        await this.viewedFiles.setViewed(change, paths, viewed);
      }
    } finally {
      // Also puts a checkbox back if its file couldn't be marked.
      this.refresh();
    }
  }

  async openDiff(node: ChangeFilesNode): Promise<void> {
    if (node.kind !== "file") return;
    const { change, file } = node;
    const { original, modified } = fileSides(change, file);
    const empty = vscode.Uri.from({
      scheme: emptyFileScheme,
      path: `/${file.path}`,
    });
    await vscode.commands.executeCommand(
      "vscode.diff",
      original ?? empty,
      modified ?? empty,
      `${path.basename(file.path)} (${changeTitle(change)})`
    );
  }

  async getChildren(node?: ChangeFilesNode): Promise<ChangeFilesNode[]> {
    if (node) return "children" in node ? node.children : [];
    const open = this.openChanges().filter(
      (change) => hasFolder(change.baseDir) && hasFolder(change.headDir)
    );
    return Promise.all(open.map((change) => this.changeNode(change)));
  }

  getTreeItem(node: ChangeFilesNode): vscode.TreeItem {
    switch (node.kind) {
      case "problem": {
        const item = new vscode.TreeItem(node.message);
        item.iconPath = new vscode.ThemeIcon("error");
        // GitHub turned the token down: signing in again is the way out.
        const signIn = /\b401\b/.test(node.message);
        item.command = signIn
          ? { title: "Sign In to GitHub", command: "dearReviewer.signIn" }
          : { title: "Refresh", command: "dearReviewer.refreshChangeFiles" };
        item.tooltip = `${node.message}\n\nClick to ${signIn ? "sign in to GitHub" : "try again"}.`;
        return item;
      }
      case "change": {
        const item = new vscode.TreeItem(
          changeTitle(node.change),
          vscode.TreeItemCollapsibleState.Expanded
        );
        item.id = node.change.id;
        item.description = `${node.viewedCount} of ${node.files.length} viewed`;
        item.tooltip = node.change.repository;
        item.iconPath = new vscode.ThemeIcon("git-compare");
        item.contextValue = "change";
        return item;
      }
      case "directory": {
        const item = new vscode.TreeItem(
          path.posix.basename(node.path),
          vscode.TreeItemCollapsibleState.Expanded
        );
        item.id = `${node.change.id}:${node.path}/`;
        item.resourceUri = resourceUri(node.change, node.path);
        item.iconPath = vscode.ThemeIcon.Folder;
        item.contextValue = "directory";
        return item;
      }
      case "file": {
        const { change, file } = node;
        const item = new vscode.TreeItem(path.posix.basename(file.path));
        item.id = `${change.id}:${file.path}`;
        item.resourceUri = resourceUri(change, file.path, file.status);
        item.iconPath = vscode.ThemeIcon.File;
        item.tooltip = `${file.path} · ${statuses[file.status].tooltip}`;
        item.checkboxState = {
          state: node.viewed
            ? vscode.TreeItemCheckboxState.Checked
            : vscode.TreeItemCheckboxState.Unchecked,
          tooltip: node.viewed ? "Viewed" : "Mark viewed",
        };
        item.contextValue = node.viewed ? "file.viewed" : "file.unviewed";
        item.command = {
          command: "dearReviewer.openChangeFile",
          title: "Open Diff",
          arguments: [node],
        };
        return item;
      }
    }
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== fileScheme || !(uri.query in statuses)) return;
    const status = statuses[uri.query as FileStatus];
    return new vscode.FileDecoration(
      status.badge,
      status.tooltip,
      new vscode.ThemeColor(status.color)
    );
  }

  private async changeNode(change: Change): Promise<ChangeFilesNode> {
    let files: ChangedFile[];
    try {
      files = await this.filesOf(change);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        kind: "problem",
        message: `Couldn't list the files of ${changeTitle(change)}: ${message}`,
      };
    }
    let viewed: ReadonlySet<string>;
    try {
      viewed = await this.viewedFiles.viewed(change);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        kind: "problem",
        message: `Couldn't load the viewed state of ${changeTitle(change)}: ${message}`,
      };
    }
    return {
      kind: "change",
      change,
      files,
      viewedCount: files.filter((f) => viewed.has(f.path)).length,
      children: directoryTree(change, files, viewed, this.hidesViewed),
    };
  }

  private filesOf(change: Change): Promise<ChangedFile[]> {
    let files = this.files.get(change.id);
    if (!files) {
      files = changedFiles(change);
      files.catch(() => this.files.delete(change.id));
      this.files.set(change.id, files);
    }
    return files;
  }

  private showHideViewedContext(): Thenable<unknown> {
    return vscode.commands.executeCommand(
      "setContext",
      "dearReviewer.hideViewedFiles",
      this.hidesViewed
    );
  }
}

interface Directory {
  dirs: Map<string, Directory>;
  files: ChangedFile[];
}

/** Directories first, then files, each by name; empty directories are left out. */
function directoryTree(
  change: Change,
  files: ChangedFile[],
  viewed: ReadonlySet<string>,
  hideViewed: boolean
): ChangeFilesNode[] {
  const root: Directory = { dirs: new Map(), files: [] };
  for (const file of files) {
    let dir = root;
    for (const name of file.path.split("/").slice(0, -1)) {
      let next = dir.dirs.get(name);
      if (!next) dir.dirs.set(name, (next = { dirs: new Map(), files: [] }));
      dir = next;
    }
    dir.files.push(file);
  }
  const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const nodes = (dir: Directory, prefix: string): ChangeFilesNode[] => {
    const dirs = [...dir.dirs.keys()].sort(byName).flatMap((name) => {
      const dirPath = prefix + name;
      const children = nodes(dir.dirs.get(name)!, `${dirPath}/`);
      if (children.length === 0) return [];
      return [
        {
          kind: "directory" as const,
          change,
          path: dirPath,
          files: files.filter((f) => f.path.startsWith(`${dirPath}/`)),
          children,
        },
      ];
    });
    const shown = dir.files
      .filter((file) => !(hideViewed && viewed.has(file.path)))
      .sort((a, b) => byName(a.path, b.path))
      .map((file) => ({
        kind: "file" as const,
        change,
        file,
        viewed: viewed.has(file.path),
      }));
    return [...dirs, ...shown];
  };
  return nodes(root, "");
}

function resourceUri(
  change: Change,
  filePath: string,
  status?: FileStatus
): vscode.Uri {
  return vscode.Uri.from({
    scheme: fileScheme,
    authority: change.id,
    path: `/${filePath}`,
    query: status ?? "",
  });
}
