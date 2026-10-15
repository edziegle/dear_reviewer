// The Change files view: each open Change in this window, with its files as a
// directory tree, or in the steps of its Reading Order (ADR 0022). A Change
// shows how many files are viewed and whether it has new commits since the
// Reviewer's last Review, and holds the actions that finish its Review.
// Files show their status and a viewed checkbox; selecting one opens its diff
// between the base and head worktrees.

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  Change,
  ChangedFile,
  changedFiles,
  changeName,
  changeTitle,
  fileSides,
  FileStatus,
} from "./changeWorkspace";
import { setContext } from "./context";
import { messageOf } from "./errors";
import { SignInRejectedError } from "./github/client";
import {
  stepsAt,
  type ReadingOrderState,
  type ReadingStep,
  type ShownReadingOrder,
} from "./readingOrder";
import { hasFolder } from "./reviewWindow";
import { ViewedFiles } from "./viewedFiles";

export type ChangeFilesNode =
  | {
      kind: "change";
      change: Change;
      files: ChangedFile[];
      viewedCount: number;
      /** Whether the Change has new commits since the last Review, if one ended. */
      sinceReview?: "newCommits" | "noNewCommits";
      children: ChangeFilesNode[];
    }
  | {
      kind: "directory";
      change: Change;
      path: string;
      files: ChangedFile[];
      children: ChangeFilesNode[];
    }
  | {
      kind: "step";
      change: Change;
      /** Counted from 0. */
      index: number;
      label: string;
      files: ChangedFile[];
      children: ChangeFilesNode[];
    }
  | {
      kind: "file";
      change: Change;
      file: ChangedFile;
      viewed: boolean;
      /** Why the file comes where it does, in a step of the Reading Order. */
      why?: string;
      /** Whether it is listed flat in a step, rather than in its directory. */
      inStep?: boolean;
    }
  | {
      kind: "problem";
      message: string;
      /** Whether GitHub turned the token down, so signing in again is the way out. */
      signIn?: boolean;
    };

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

/** How Change Files lists a Change's files. */
export type SortBy = "readingOrder" | "tree";

interface Settings {
  hideViewed?: boolean;
  sortBy?: SortBy;
}

export class ChangeFilesView
  implements
    vscode.TreeDataProvider<ChangeFilesNode>,
    vscode.FileDecorationProvider
{
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  // A Change's files never change: its base and head are fixed commits.
  private readonly files = new Map<string, Promise<ChangedFile[]>>();
  /** The commit each Change's last Review covered, until a Review ends. */
  private readonly reviewed = new Map<string, Promise<string | undefined>>();

  constructor(
    private readonly openChanges: () => Change[],
    private readonly viewedFiles: ViewedFiles,
    /** Keeps the view's settings, so every window and the next session share them. */
    private readonly settingsFile: string,
    /** The head commit the Reviewer's last Review of a Change covered, if one ended. */
    private readonly lastReviewed: (
      change: Change
    ) => Promise<string | undefined>,
    /** The column a diff of the Change opens in: beside its overview. */
    private readonly codeColumn: (change: Change) => Promise<vscode.ViewColumn>,
    /** The Change's Reading Order, and whether the Assistant is writing one. */
    private readonly readingOrderOf: (
      change: Change
    ) => ReadingOrderState | undefined
  ) {
    void this.showSettingsContext();
  }

  refresh(): void {
    this.changed.fire();
  }

  /** Shows the Change's state since its last Review afresh, such as after a Review ended. */
  reviewEnded(change: Change): void {
    this.reviewed.delete(change.id);
    this.refresh();
  }

  get hidesViewed(): boolean {
    return this.settings().hideViewed === true;
  }

  async setHideViewed(hide: boolean): Promise<void> {
    await this.changeSettings({ hideViewed: hide });
  }

  /** Reading Order, for the Changes that have one, until the Reviewer picks Tree. */
  get sortBy(): SortBy {
    return this.settings().sortBy === "tree" ? "tree" : "readingOrder";
  }

  async setSortBy(sortBy: SortBy): Promise<void> {
    await this.changeSettings({ sortBy });
  }

  /**
   * The Change's Reading Order as the overview lists it, at its head and
   * with each file's viewed state, while it has one or one is being written.
   */
  async readingOrder(change: Change): Promise<ShownReadingOrder | undefined> {
    const state = this.readingOrderOf(change);
    if (!state?.order)
      return state?.writing
        ? { ...state, outOfDate: false, steps: [] }
        : undefined;
    const [{ steps, outOfDate }, viewed] = await Promise.all([
      stepsAt(
        change,
        state.order,
        inTreeOrder(change, await this.filesOf(change))
      ),
      this.viewedFiles.viewed(change),
    ]);
    return {
      writing: state.writing,
      outOfDate,
      steps: steps.map((step) => ({
        label: step.label,
        files: step.files.map((file) => ({
          ...file,
          viewed: viewed.has(file.path),
        })),
      })),
    };
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

  /** Marks these files of the Change viewed or not. */
  async setFilesViewed(
    change: Change,
    paths: string[],
    viewed: boolean
  ): Promise<void> {
    try {
      await this.viewedFiles.setViewed(change, paths, viewed);
    } finally {
      this.refresh();
    }
  }

  /**
   * The Change's next file not yet viewed after this one, or the one before
   * it, in the view's order, going round at the end. From no file, the first
   * or last. Gives the file and how many the Change has.
   */
  async unviewedFile(
    change: Change,
    from: string | undefined,
    direction: 1 | -1
  ): Promise<{ file?: ChangedFile; total: number }> {
    const all = await this.filesOf(change);
    const steps = await this.stepsOf(change, all);
    const files = steps
      ? filesInSteps(all, steps).flatMap((s) =>
          s.files.map(({ why: _, ...file }) => file)
        )
      : inTreeOrder(change, all);
    const viewed = await this.viewedFiles.viewed(change);
    const start = from ? files.findIndex((f) => f.path === from) : -1;
    for (let step = 1; step <= files.length; step++) {
      const i =
        start === -1
          ? direction === 1
            ? step - 1
            : files.length - step
          : (start + direction * step + files.length * step) % files.length;
      const file = files[i];
      if (file.path !== from && !viewed.has(file.path))
        return { file, total: files.length };
    }
    return { total: files.length };
  }

  /** Whether the Change has new commits since the last Review, if one ended. */
  async sinceReview(
    change: Change
  ): Promise<"newCommits" | "noNewCommits" | undefined> {
    const reviewed = await this.reviewedOf(change);
    if (!reviewed) return;
    return reviewed === change.headSha ? "noNewCommits" : "newCommits";
  }

  /** How many of the Change's files are viewed, of how many. */
  async viewedCount(
    change: Change
  ): Promise<{ viewed: number; total: number }> {
    const files = await this.filesOf(change);
    const viewed = await this.viewedFiles.viewed(change);
    return {
      viewed: files.filter((f) => viewed.has(f.path)).length,
      total: files.length,
    };
  }

  /** Opens the diff of one of the Change's files. */
  openFile(change: Change, file: ChangedFile): Promise<void> {
    return this.openDiff({ kind: "file", change, file, viewed: false });
  }

  /** Opens the diff of the Change's file at this path, if it is one of its files. */
  async openPath(change: Change, filePath: string): Promise<void> {
    const file = (await this.filesOf(change)).find((f) => f.path === filePath);
    if (file) await this.openFile(change, file);
  }

  async openDiff(node: ChangeFilesNode): Promise<void> {
    if (node.kind !== "file") return;
    const { change, file } = node;
    const { original, modified } = fileSides(change, file);
    const empty = vscode.Uri.from({
      scheme: emptyFileScheme,
      path: `/${file.path}`,
    });
    const viewColumn = await this.codeColumn(change);
    // Pinned, so going to a definition opens a new tab instead of replacing
    // the diff, and Go Back returns to it.
    await vscode.commands.executeCommand(
      "vscode.diff",
      original ?? empty,
      modified ?? empty,
      `${path.basename(file.path)} · ${changeName(change)}`,
      { viewColumn, preview: false }
    );
  }

  async getChildren(node?: ChangeFilesNode): Promise<ChangeFilesNode[]> {
    if (node) return "children" in node ? node.children : [];
    const open = this.openChanges().filter(
      (change) => hasFolder(change.baseDir) && hasFolder(change.headDir)
    );
    void setContext(
      "dearReviewer.hasReadingOrder",
      open.some((change) => this.readingOrderOf(change)?.order)
    );
    return Promise.all(open.map((change) => this.changeNode(change)));
  }

  getTreeItem(node: ChangeFilesNode): vscode.TreeItem {
    switch (node.kind) {
      case "problem": {
        const item = new vscode.TreeItem(node.message);
        item.iconPath = new vscode.ThemeIcon("error");
        const { signIn } = node;
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
        const since = {
          newCommits: "new commits since my Review",
          noNewCommits: "no new commits since my Review",
        };
        item.description = [
          `${node.viewedCount} of ${node.files.length} viewed`,
          ...(node.sinceReview ? [since[node.sinceReview]] : []),
        ].join(" · ");
        item.tooltip = node.change.repository;
        item.iconPath = new vscode.ThemeIcon("git-compare");
        // Menus show the actions that fit: submit or a Brief, and what changed since.
        item.contextValue = [
          "change",
          node.change.pullRequest ? "pullRequest" : "local",
          ...(node.sinceReview === "newCommits" ? ["since"] : []),
        ].join(".");
        return item;
      }
      case "step": {
        const item = new vscode.TreeItem(
          `${node.index + 1}. ${node.label}`,
          vscode.TreeItemCollapsibleState.Expanded
        );
        item.id = `${node.change.id}:step:${node.index}`;
        item.iconPath = new vscode.ThemeIcon("list-ordered");
        item.contextValue = "step";
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
        item.tooltip = [
          file.path,
          statuses[file.status].tooltip,
          ...(node.why ? [node.why] : []),
        ].join(" · ");
        if (node.inStep) {
          const dir = path.posix.dirname(file.path);
          item.description = [
            ...(dir === "." ? [] : [dir]),
            ...(node.why ? [node.why] : []),
          ].join(" · ");
        }
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
      const message = messageOf(err);
      return {
        kind: "problem",
        message: `Couldn't list the files of ${changeTitle(change)}: ${message}`,
      };
    }
    let viewed: ReadonlySet<string>;
    try {
      viewed = await this.viewedFiles.viewed(change);
    } catch (err) {
      const message = messageOf(err);
      return {
        kind: "problem",
        message: `Couldn't load the viewed state of ${changeTitle(change)}: ${message}`,
        signIn: err instanceof SignInRejectedError,
      };
    }
    const reviewed = await this.reviewedOf(change);
    const steps = await this.stepsOf(change, files);
    return {
      kind: "change",
      change,
      files,
      viewedCount: files.filter((f) => viewed.has(f.path)).length,
      ...(reviewed && {
        sinceReview:
          reviewed === change.headSha ? "noNewCommits" : "newCommits",
      }),
      children: steps
        ? stepNodes(change, files, steps, viewed, this.hidesViewed)
        : directoryTree(change, files, viewed, this.hidesViewed),
    };
  }

  /** The Reading Order's steps, while the view lists the Change by one. */
  private async stepsOf(
    change: Change,
    files: ChangedFile[]
  ): Promise<ReadingStep[] | undefined> {
    const order = this.readingOrderOf(change)?.order;
    if (this.sortBy !== "readingOrder" || !order) return;
    const { steps } = await stepsAt(change, order, inTreeOrder(change, files));
    return steps;
  }

  private settings(): Settings {
    try {
      return JSON.parse(fs.readFileSync(this.settingsFile, "utf8")) as Settings;
    } catch {
      return {};
    }
  }

  private async changeSettings(changes: Settings): Promise<void> {
    fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true });
    fs.writeFileSync(
      this.settingsFile,
      JSON.stringify({ ...this.settings(), ...changes }, null, 2)
    );
    await this.showSettingsContext();
    this.refresh();
  }

  /** The commit the Change's last Review covered; unknown counts as none. */
  private reviewedOf(change: Change): Promise<string | undefined> {
    let reviewed = this.reviewed.get(change.id);
    if (!reviewed) {
      reviewed = this.lastReviewed(change).catch(() => {
        this.reviewed.delete(change.id);
        return undefined;
      });
      this.reviewed.set(change.id, reviewed);
    }
    return reviewed;
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

  private async showSettingsContext(): Promise<void> {
    await setContext("dearReviewer.hideViewedFiles", this.hidesViewed);
    await setContext("dearReviewer.changeFilesSortBy", this.sortBy);
  }
}

/** The Change's files in the order the view lists them as a tree. */
export function inTreeOrder(
  change: Change,
  files: ChangedFile[]
): ChangedFile[] {
  const flat = (nodes: ChangeFilesNode[]): ChangedFile[] =>
    nodes.flatMap((node) =>
      node.kind === "file"
        ? [node.file]
        : node.kind === "directory"
          ? flat(node.children)
          : []
    );
  return flat(directoryTree(change, files, new Set(), false));
}

/** The Change's files in each step, which lists only the Change's files. */
function filesInSteps(
  files: ChangedFile[],
  steps: ReadingStep[]
): { step: ReadingStep; files: (ChangedFile & { why?: string })[] }[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  return steps.map((step) => ({
    step,
    files: step.files.map((f) => ({
      ...byPath.get(f.path)!,
      ...(f.why && { why: f.why }),
    })),
  }));
}

/** The Reading Order's steps, each with its files flat beneath it; empty steps are left out. */
function stepNodes(
  change: Change,
  files: ChangedFile[],
  steps: ReadingStep[],
  viewed: ReadonlySet<string>,
  hideViewed: boolean
): ChangeFilesNode[] {
  return filesInSteps(files, steps).flatMap(
    ({ step, files: inStep }, index) => {
      const children = inStep
        .filter((f) => !(hideViewed && viewed.has(f.path)))
        .map(({ why, ...file }) => ({
          kind: "file" as const,
          change,
          file,
          viewed: viewed.has(file.path),
          ...(why && { why }),
          inStep: true,
        }));
      if (children.length === 0) return [];
      return [
        {
          kind: "step" as const,
          change,
          index,
          label: step.label,
          files: inStep.map(({ why: _, ...file }) => file),
          children,
        },
      ];
    }
  );
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
