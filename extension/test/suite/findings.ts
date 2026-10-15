// Findings the way the Reviewer sees them: listed in the Findings view and
// marked in the gutter of the editors that show their files. The view's
// buttons and the hover's links run the commands the extension contributes.

import * as vscode from "vscode";
import type { ChangeRequest } from "./reviewer";

interface FindingsApi {
  view: vscode.TreeDataProvider<unknown>;
  decorated(): GutterMarker[];
}

export interface GutterMarker {
  file: string;
  /** First and last line, counted from 0. */
  lines: [number, number];
  /** The hover's Markdown. */
  hover: string;
  /** The only commands the hover's links may run. */
  enabledCommands: readonly string[];
  /** The icon the gutter shows on each of its lines. */
  gutter: ("lightbulb" | "lightbulbWithBar" | "bar" | undefined)[];
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
