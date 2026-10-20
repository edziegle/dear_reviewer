// Drives the Change files view the way the Reviewer does, and reads the tree
// back as the view shows it.

import * as assert from "assert";
import * as vscode from "vscode";
import { eventually } from "./reviewer";

type ChangeFilesView = vscode.TreeDataProvider<unknown> &
  vscode.FileDecorationProvider & {
    readonly viewedPaths: readonly string[];
  };

export interface FileEntry {
  label: string;
  description?: string;
  /** What shows on hovering the element. */
  tooltip?: string;
  /** What a screen reader says for the element, where it isn't the label and description. */
  accessibilityLabel?: string;
  /** The status badge: A, M or D. */
  status?: string;
  /** The viewed checkbox, on files only. */
  viewed?: boolean;
  /** Whether the row starts collapsed, on rows with children. */
  collapsed?: boolean;
  /** Whether the file is drawn muted, as a skim-only file is. */
  muted?: boolean;
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
        if (item.tooltip)
          entry.tooltip =
            typeof item.tooltip === "string"
              ? item.tooltip
              : item.tooltip.value;
        if (item.accessibilityInformation)
          entry.accessibilityLabel = item.accessibilityInformation.label;
        if (item.resourceUri) {
          const decoration = await view.provideFileDecoration(
            item.resourceUri,
            new vscode.CancellationTokenSource().token
          );
          if (decoration?.badge) entry.status = decoration.badge;
          if (decoration?.color?.id === "disabledForeground")
            entry.muted = true;
        }
        if (item.checkboxState !== undefined) {
          const state =
            typeof item.checkboxState === "object"
              ? item.checkboxState.state
              : item.checkboxState;
          entry.viewed = state === vscode.TreeItemCheckboxState.Checked;
        }
        if (item.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed)
          entry.collapsed = true;
        if (item.command) entry.command = item.command;
        if (item.contextValue) entry.contextValue = item.contextValue;
        return entry;
      })
    );
  return entries();
}

/**
 * The tree once a root row is labelled `title`. A pull request's row shows
 * its number until its overview has loaded, and its title after.
 */
export async function changeFilesTitled(title: string): Promise<FileEntry[]> {
  let tree: FileEntry[] = [];
  await eventually(async () => {
    tree = await changeFiles();
    assert.ok(
      tree.some((entry) => entry.label === title),
      `no root row "${title}" among ${JSON.stringify(tree.map((e) => e.label))}`
    );
  });
  return tree;
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
  command:
    | "markViewed"
    | "markViewedAndClose"
    | "unmarkViewed"
    | "showTimeline"
    | "finishReview",
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

/**
 * The tab in front of the code column, where a Change's files open: the
 * editor group the overview isn't in front of, or the active one of those.
 *
 * Read what a file opened through this, not through the focus. A webview's
 * page reports to VS Code that it gained the focus on a timer, so an
 * overview given the focus, as a Change opens or Show Overview runs, can
 * take it back from a file opened beside it a moment later: the active tab
 * is then the overview, and no wait for anything a test can see rules that
 * out. Only a test of where the focus goes should read the active tab.
 */
export function codeColumnTab(): vscode.Tab | undefined {
  const isOverview = (tab: vscode.Tab | undefined) =>
    tab?.input instanceof vscode.TabInputWebview &&
    tab.input.viewType.endsWith("dearReviewer.timeline");
  const groups = vscode.window.tabGroups.all.filter(
    (group) => !isOverview(group.activeTab)
  );
  const group =
    groups.find((g) => g === vscode.window.tabGroups.activeTabGroup) ??
    groups[0];
  return group?.activeTab;
}

/** What each editor group shows in front, for an error to say. */
function inFront(): string {
  return JSON.stringify(
    vscode.window.tabGroups.all.map((group) => group.activeTab?.input)
  );
}

/** The original and modified sides of the diff in front of the code column. */
export function shownDiff(): { original: vscode.Uri; modified: vscode.Uri } {
  const input = codeColumnTab()?.input;
  if (!(input instanceof vscode.TabInputTextDiff))
    throw new Error(`the code column shows no diff: ${inFront()}`);
  return { original: input.original, modified: input.modified };
}

/** The file in front of the code column in a plain editor, rather than a diff. */
export function shownText(): vscode.Uri {
  const input = codeColumnTab()?.input;
  if (!(input instanceof vscode.TabInputText))
    throw new Error(`the code column shows no plain editor: ${inFront()}`);
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

/** Subscribes to every change of the Change files tree. */
export async function changeFilesTreeChanged(): Promise<
  (listener: () => void) => unknown
> {
  const view = await changeFilesView();
  return (listener) => view.onDidChangeTreeData?.(listener);
}

async function changeFilesView(): Promise<ChangeFilesView> {
  const extension = vscode.extensions.getExtension<{
    changeFiles: ChangeFilesView;
  }>("edziegle.dear-reviewer");
  if (!extension) throw new Error("Dear Reviewer is not installed");
  return (await extension.activate()).changeFiles;
}
