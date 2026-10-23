// Findings the way the Reviewer sees them: listed in the Findings view and
// marked in the gutter of the editors that show their files. The view is read
// through the state the extension last sent it, and clicks in it are the
// messages its webview would send. The webview renders, and answers the
// tests' keys, only while it's in sight, so `showFindingsView` brings it
// there first. The hover's links run the commands the extension contributes.

import * as assert from "assert";
import * as vscode from "vscode";
import { eventually, type ChangeRequest } from "./reviewer";

/** A Finding's row in the view. */
export interface FindingsRow {
  id: string;
  /** Such as `12` or `16–18`. */
  lines: string;
  base: boolean;
  message: string;
  firstLine: string;
  /** Its name for a screen reader. */
  name: string;
}

export interface FindingsFile {
  key: string;
  name: string;
  folder: string;
  findings: FindingsRow[];
}

export interface FindingsViewState {
  changeOpen: boolean;
  files: FindingsFile[];
  current?: string;
  count: string;
  key: string;
}

/** What the webview said it shows after its last render or key. */
export interface FindingsReport {
  focused: string | null;
  tabOrder: string[];
  rebuilt: string[];
  /** The open row's message as the page shows it. */
  openMessage: string | null;
  /** How many elements in the list the page didn't make itself, such as links from a message. */
  foreign: number;
  /** Whether the page has the focus. */
  hasFocus: boolean;
}

export type FindingsClick =
  | { type: "reveal" | "convert" | "dismiss"; id: string }
  | { type: "step"; direction: 1 | -1 }
  | { type: "ask" };

interface FindingsApi {
  view: {
    visible: boolean;
    sent: FindingsViewState;
    rendered?: FindingsViewState;
    report?: FindingsReport;
    receive(message: FindingsClick): Promise<void> | undefined;
    focusFinding(id: string): void;
    click(name: string): void;
    press(key: string, from?: string): void;
    requestReport(): void;
  };
  decorated(): GutterMarker[];
  hovers(): { count: number; last?: HoverPlace };
}

/** Where a hover opened on a Finding's lines: its file and line, from 0. */
export interface HoverPlace {
  file: string;
  line: number;
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
  id: string;
  message: string;
  /** Such as `util.py:2` or `util.py:1–3`, with ` (base)` for the base side. */
  where: string;
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

/** The state the extension last sent the Findings view. */
export async function findingsState(): Promise<FindingsViewState> {
  return (await findingsApi()).view.sent;
}

/** The Findings the view lists, in its order. */
export async function findingsView(): Promise<FindingEntry[]> {
  return (await findingsState()).files.flatMap((file) =>
    file.findings.map((f) => ({
      id: f.id,
      message: f.message,
      where: `${file.folder ? `${file.folder}/` : ""}${file.name}:${f.lines}${f.base ? " (base)" : ""}`,
    }))
  );
}

/**
 * Shows the Findings view, and waits for it to render its latest state.
 * Unless `focused` is false, it also waits for the page to have the focus,
 * which the editor gives it a moment after showing it, so that the focus a
 * test then puts in the page stays there.
 */
export async function showFindingsView(
  focused = true
): Promise<FindingsViewState> {
  await vscode.commands.executeCommand("dearReviewer.findings.focus");
  const rendered = await renderedFindings();
  if (focused) {
    const { view } = await findingsApi();
    await eventually(async () =>
      assert.ok(
        (await findingsReport(() => view.requestReport())).hasFocus,
        "the page has the focus"
      )
    );
  }
  return rendered;
}

/** What the Findings view last rendered, once it's in sight and has rendered the latest state. */
export async function renderedFindings(): Promise<FindingsViewState> {
  let rendered: FindingsViewState | undefined;
  await eventually(async () => {
    const { view } = await findingsApi();
    assert.ok(view.visible, "the Findings view is in sight");
    assert.deepStrictEqual(
      view.rendered,
      view.sent,
      "it rendered the latest state"
    );
    rendered = view.rendered;
  });
  return rendered!;
}

/** Clicks in the Findings view, as its webview does, and waits for what the click does. */
export async function clickFindings(click: FindingsClick): Promise<void> {
  await (await findingsApi()).view.receive(click);
}

/**
 * What the webview reports once it has done `act`, such as rendering a
 * state or pressing a key: where the focus is, what Tab reaches, and which
 * rows its last render built afresh.
 */
export async function findingsReport(
  act: () => unknown = () => undefined
): Promise<FindingsReport> {
  const { view } = await findingsApi();
  await act();
  let report: FindingsReport | undefined;
  await eventually(async () => {
    assert.deepStrictEqual(
      view.rendered,
      view.sent,
      "it rendered the latest state"
    );
    report = view.report;
    assert.ok(report, "the webview reported");
  });
  return report!;
}

/**
 * Clicks an element of the view's page, such as `finding:<id>`,
 * `dismiss:<id>`, `next` or `ask`, so the page itself sends what it does.
 * What the click does follows; wait for it.
 */
export async function clickInFindings(name: string): Promise<void> {
  const { view } = await findingsApi();
  await findingsReport(() => view.click(name));
}

/** What the webview shows now, once it has rendered the latest state. */
export async function freshFindingsReport(): Promise<FindingsReport> {
  const { view } = await findingsApi();
  return findingsReport(() => view.requestReport());
}

/** Puts the focus on a Finding's row in the view, and gives the webview's report. */
export async function focusFindingRow(id: string): Promise<FindingsReport> {
  const { view } = await findingsApi();
  return findingsReport(() => view.focusFinding(id));
}

/**
 * Presses a key on the view's focused element, or on the row of the Finding
 * `from`, focused first, and gives the webview's report.
 */
export async function pressInFindings(
  key: string,
  from?: string
): Promise<FindingsReport> {
  const { view } = await findingsApi();
  return findingsReport(() => view.press(key, from));
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

/** Clicks the entry's row. */
export function revealFinding(entry: FindingEntry): Promise<void> {
  return clickFindings({ type: "reveal", id: entry.id });
}

/** Clicks the entry's Dismiss link. */
export function dismissFinding(entry: FindingEntry): Promise<void> {
  return clickFindings({ type: "dismiss", id: entry.id });
}

/** Clicks the entry's Convert to Comment link. */
export function convertFinding(entry: FindingEntry): Promise<void> {
  return clickFindings({ type: "convert", id: entry.id });
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

/**
 * How many hovers have opened on a Finding's lines. The editor asks for a
 * hover where it opens one, and the extension counts each time, since the
 * extension host can't see the hover itself.
 */
export async function hoversOpened(): Promise<number> {
  return (await findingsApi()).hovers().count;
}

/**
 * Waits for a hover to open after the `before` that `hoversOpened` gave,
 * and gives where the last one opened.
 */
export async function nextHover(before: number): Promise<HoverPlace> {
  let opened: HoverPlace | undefined;
  await eventually(async () => {
    const { count, last } = (await findingsApi()).hovers();
    assert.ok(count > before && last, "a hover opened");
    opened = last;
  });
  return opened!;
}

/** Runs the hover's link to `command` with its arguments, as clicking it does. */
export function clickHoverLink(
  hover: string,
  command: string
): Thenable<unknown> {
  const opening = `](command:${command}?`;
  const start = hover.indexOf(opening);
  const end = hover.indexOf(")", start);
  if (start < 0 || end < 0)
    throw new Error(`no link to ${command} in ${hover}`);
  const args = JSON.parse(
    decodeURIComponent(hover.slice(start + opening.length, end))
  ) as unknown[];
  return vscode.commands.executeCommand(command, ...args);
}
