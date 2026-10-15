// Drives the Change files view the way the Reviewer does, and reads the tree
// back as the view shows it.

import * as vscode from "vscode";

type ChangeFilesView = vscode.TreeDataProvider<unknown> &
  vscode.FileDecorationProvider & {
    readonly viewedPaths: readonly string[];
  };

export interface FileEntry {
  label: string;
  description?: string;
  /** The status badge: A, M or D. */
  status?: string;
  /** The viewed checkbox, on files only. */
  viewed?: boolean;
  children: FileEntry[];
  command?: vscode.Command;
  /** What picks the element's menus, such as a Change's finishing actions. */
  contextValue?: string;
  /** The tree element, for passing to the view's commands. */
  node: unknown;
}

/** The Change files tree, fully expanded. */
export async function changeFiles(): Promise<FileEntry[]> {
  const view = await changeFilesView();
  const entries = async (parent?: unknown): Promise<FileEntry[]> =>
    Promise.all(
      ((await view.getChildren(parent)) ?? []).map(async (node) => {
        const item = await view.getTreeItem(node);
        const entry: FileEntry = {
          label:
            typeof item.label === "string"
              ? item.label
              : (item.label?.label ?? ""),
          children: item.collapsibleState ? await entries(node) : [],
          node,
        };
        if (item.description) entry.description = String(item.description);
        if (item.resourceUri) {
          const decoration = await view.provideFileDecoration(
            item.resourceUri,
            new vscode.CancellationTokenSource().token
          );
          if (decoration?.badge) entry.status = decoration.badge;
        }
        if (item.checkboxState !== undefined) {
          const state =
            typeof item.checkboxState === "object"
              ? item.checkboxState.state
              : item.checkboxState;
          entry.viewed = state === vscode.TreeItemCheckboxState.Checked;
        }
        if (item.command) entry.command = item.command;
        if (item.contextValue) entry.contextValue = item.contextValue;
        return entry;
      })
    );
  return entries();
}

/**
 * The tree as indented lines, one per element:
 * `label [status] (viewed)  — description`.
 */
export function render(entries: FileEntry[], depth = 0): string[] {
  return entries.flatMap((entry) => [
    "  ".repeat(depth) +
      entry.label +
      (entry.status ? ` [${entry.status}]` : "") +
      (entry.viewed ? " (viewed)" : "") +
      (entry.description ? ` — ${entry.description}` : ""),
    ...render(entry.children, depth + 1),
  ]);
}

/** Finds an element by its labels from the top, such as ["repo …", "pkg", "core.py"]. */
export function entryAt(entries: FileEntry[], ...labels: string[]): FileEntry {
  let found: FileEntry | undefined;
  for (const label of labels) {
    found = entries.find((e) => e.label === label);
    if (!found)
      throw new Error(
        `no "${label}" among ${JSON.stringify(entries.map((e) => e.label))}`
      );
    entries = found.children;
  }
  if (!found) throw new Error("no labels given");
  return found;
}

/** Clicks the element, running the command the view gives it. */
export async function select(entry: FileEntry): Promise<void> {
  if (!entry.command) throw new Error(`"${entry.label}" has no command`);
  await vscode.commands.executeCommand(
    entry.command.command,
    ...(entry.command.arguments ?? [])
  );
}

/** Marks viewed from the context menu, with these elements selected. */
export function markViewed(...entries: FileEntry[]): Thenable<unknown> {
  const nodes = entries.map((e) => e.node);
  return vscode.commands.executeCommand(
    "dearReviewer.markViewed",
    nodes[0],
    nodes
  );
}

export function unmarkViewed(...entries: FileEntry[]): Thenable<unknown> {
  const nodes = entries.map((e) => e.node);
  return vscode.commands.executeCommand(
    "dearReviewer.unmarkViewed",
    nodes[0],
    nodes
  );
}

/**
 * Runs a command of a Change file's tab menu, or of its title bar, as VS Code
 * does: on the file the tab shows.
 */
export function onTab(
  command: "markViewed" | "markViewedAndClose" | "unmarkViewed",
  file: vscode.Uri
): Thenable<unknown> {
  return vscode.commands.executeCommand(`dearReviewer.${command}`, file, {
    groupId: vscode.window.tabGroups.activeTabGroup.viewColumn,
  });
}

/** The files the `dearReviewer.viewedFiles` context key lists, as `resourcePath` gives them. */
export async function viewedFilesKey(): Promise<readonly string[]> {
  return (await changeFilesView()).viewedPaths;
}

/** Runs a review keybinding's command, such as `nextUnviewedFile`. */
export function review(
  command: "nextUnviewedFile" | "previousUnviewedFile" | "markViewedAndNext"
): Thenable<unknown> {
  return vscode.commands.executeCommand(`dearReviewer.${command}`);
}

export function hideViewedFiles(): Thenable<unknown> {
  return vscode.commands.executeCommand("dearReviewer.hideViewedFiles");
}

export function showViewedFiles(): Thenable<unknown> {
  return vscode.commands.executeCommand("dearReviewer.showViewedFiles");
}

/** The original and modified sides of the active diff editor. */
export function activeDiff(): { original: vscode.Uri; modified: vscode.Uri } {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (!(input instanceof vscode.TabInputTextDiff))
    throw new Error(`the active tab is not a diff: ${JSON.stringify(input)}`);
  return { original: input.original, modified: input.modified };
}

/** The file the active tab shows in a plain editor, rather than a diff. */
export function activeText(): vscode.Uri {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (!(input instanceof vscode.TabInputText))
    throw new Error(
      `the active tab is not a plain editor: ${JSON.stringify(input)}`
    );
  return input.uri;
}

/** The files the tab shows: both sides of a diff, or a plain editor's one. */
export function filesIn(tab: vscode.Tab | undefined): string[] {
  const input = tab?.input;
  if (input instanceof vscode.TabInputTextDiff)
    return [input.original.fsPath, input.modified.fsPath];
  if (input instanceof vscode.TabInputText) return [input.uri.fsPath];
  return [];
}

async function changeFilesView(): Promise<ChangeFilesView> {
  const extension = vscode.extensions.getExtension<{
    changeFiles: ChangeFilesView;
  }>("edziegle.dear-reviewer");
  if (!extension) throw new Error("Dear Reviewer is not installed");
  return (await extension.activate()).changeFiles;
}
