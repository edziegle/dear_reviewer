// Findings the way the Reviewer sees them: listed in the Findings view and
// marked in the gutter of the editors that show their files. The view's
// buttons and the hover's links run the commands the extension contributes.

import * as vscode from "vscode";
import { eventually, type ChangeRequest } from "./reviewer";

interface FindingsApi {
  view: vscode.TreeDataProvider<unknown>;
  decorated(): GutterMarker[];
}

export interface GutterMarker {
  file: string;
  /** First and last line, counted from 0. */
  lines: [number, number];
  /**
   * The hover's Markdown, with the Assistant's message escaped as
   * `MarkdownString.appendText` escapes it: each space or tab becomes
   * `&nbsp;`, and `>` and Markdown's punctuation, such as `_`, `*`, `#` and
   * brackets, get a backslash. Find the message by one word without them.
   */
  hover: string;
  /** The only commands the hover's links may run. */
  enabledCommands: readonly string[];
  /** The icon the gutter shows on each of its lines. */
  gutter: ("cat" | "bar" | undefined)[];
}

export interface FindingQuickFix {
  title: string;
  kind: string | undefined;
  command: string | undefined;
  arguments: unknown[] | undefined;
}

export interface FindingEntry {
  /** The Change the Finding is in, as the view names it. */
  change: string;
  message: string;
  /** Such as `util.py:2`, with ` (base)` for the base side. */
  where: string;
  /** The tree element, for passing to the view's commands. */
  node: unknown;
  /** What clicking the entry runs. */
  command?: vscode.Command;
}

async function findingsApi(): Promise<FindingsApi> {
  const extension = vscode.extensions.getExtension<{ findings: FindingsApi }>(
    "edziegle.dear-reviewer"
  );
  if (!extension) throw new Error("Dear Reviewer is not installed");
  return (await extension.activate()).findings;
}

/** Runs Find Issues on the Change. */
export function findIssues(change: ChangeRequest): Thenable<unknown> {
  return vscode.commands.executeCommand("dearReviewer.findIssues", change);
}

/** The Findings view, fully expanded, as its entries. */
export async function findingsView(): Promise<FindingEntry[]> {
  const { view } = await findingsApi();
  const entries: FindingEntry[] = [];
  for (const group of (await view.getChildren()) ?? []) {
    const change = labelOf(await view.getTreeItem(group));
    for (const node of (await view.getChildren(group)) ?? []) {
      const item = await view.getTreeItem(node);
      entries.push({
        change,
        message: labelOf(item),
        where: String(item.description ?? ""),
        node,
        command: item.command,
      });
    }
  }
  return entries;
}

/** The Findings view's entry at `where`. */
export async function findingAt(where: string): Promise<FindingEntry> {
  const entries = await findingsView();
  const found = entries.find((e) => e.where === where);
  if (!found)
    throw new Error(
      `no Finding at ${where}: ${JSON.stringify(entries.map((e) => e.where))}`
    );
  return found;
}

/** Clicks the entry's Dismiss button. */
export function dismissFinding(entry: FindingEntry): Thenable<unknown> {
  return vscode.commands.executeCommand(
    "dearReviewer.dismissFinding",
    entry.node
  );
}

/** Clicks the entry's Convert to Comment button. */
export function convertFinding(entry: FindingEntry): Thenable<unknown> {
  return vscode.commands.executeCommand(
    "dearReviewer.convertFinding",
    entry.node
  );
}

/**
 * The Finding actions the editor's Quick Fix offers at the cursor on a line,
 * counted from 0, or on a selection, leaving out any other extension's. The
 * editor cancels a request when its document changes under it, as when a
 * Comment was just saved, so a cancelled one is asked again. It answers only
 * for a document it has loaded, so the file is opened first.
 */
export async function findingQuickFixes(
  file: string,
  at: number | vscode.Range
): Promise<FindingQuickFix[]> {
  const range = typeof at === "number" ? new vscode.Range(at, 0, at, 0) : at;
  await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  let actions: vscode.CodeAction[] = [];
  let failure: unknown;
  await eventually(async () => {
    failure = undefined;
    try {
      actions =
        (await vscode.commands.executeCommand<vscode.CodeAction[]>(
          "vscode.executeCodeActionProvider",
          vscode.Uri.file(file),
          range,
          vscode.CodeActionKind.QuickFix.value
        )) ?? [];
    } catch (err) {
      if (err instanceof Error && err.name === "Canceled") throw err;
      failure = err;
    }
  });
  if (failure !== undefined) throw failure;
  return actions
    .filter((a) => a.title.startsWith("Finding"))
    .map((a) => ({
      title: a.title,
      kind: a.kind?.value,
      command: a.command?.command,
      arguments: a.command?.arguments,
    }));
}

/** Runs a Quick Fix action as choosing it in the menu does. */
export function runQuickFix(action: FindingQuickFix): Thenable<unknown> {
  return vscode.commands.executeCommand(
    action.command!,
    ...(action.arguments ?? [])
  );
}

/** The Finding markers in the gutters of the visible editors, sorted by file and line. */
export async function gutterMarkers(): Promise<GutterMarker[]> {
  return (await findingsApi())
    .decorated()
    .sort((a, b) => a.file.localeCompare(b.file) || a.lines[0] - b.lines[0]);
}

function labelOf(item: vscode.TreeItem): string {
  return typeof item.label === "string"
    ? item.label
    : (item.label?.label ?? "");
}
