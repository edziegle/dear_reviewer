// Findings on request (see ADR 0017): only when the Reviewer runs Find
// Issues does the Assistant look over a Change and reply with Findings as a
// JSON object. Each one that lands on lines of its side's diff, inside the
// Change's worktrees, shows as a gutter marker on those lines and in the
// Findings view, never inline in the diff. The Reviewer dismisses a Finding,
// or converts it into a draft Comment at the same place; nothing reaches
// GitHub until they save that Comment into their pending review and submit.

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { Change, changeName } from "./changeWorkspace";
import type { ThreadPlace } from "./github/client";
import { setContext } from "./context";
import { messageOf } from "./errors";

/** A spot in a Change the Assistant thinks deserves the Reviewer's attention. */
export interface Finding {
  id: string;
  change: Change;
  /** Its side, path and lines, as a Comment there would have them. */
  place: ThreadPlace;
  message: string;
}

export type FindingsNode =
  | { kind: "change"; change: Change; findings: Finding[] }
  | { kind: "finding"; finding: Finding };

/** The most Findings kept from one reply, and the longest message. */
const maxFindings = 50;
const maxMessageChars = 2_000;

const findingCommands = [
  "dearReviewer.convertFinding",
  "dearReviewer.dismissFinding",
];

export class Findings
  implements vscode.TreeDataProvider<FindingsNode>, vscode.Disposable
{
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  /** By Change id. */
  private readonly byChange = new Map<
    string,
    { change: Change; findings: Finding[] }
  >();
  private readonly decoration: vscode.TextEditorDecorationType;
  /** What each visible editor's gutter shows, by document URI, for the tests. */
  private shown = new Map<string, vscode.DecorationOptions[]>();
  private readonly subscriptions: vscode.Disposable[] = [];

  /**
   * `ask` has the Change's Assistant reply to a request for Findings, and
   * `tell` adds a note to its panel. `onDiff` says whether lines take a
   * Comment, and `draft` opens a draft Comment for the Reviewer to edit.
   */
  constructor(
    extensionUri: vscode.Uri,
    private readonly ask: (change: Change) => Promise<string>,
    private readonly tell: (change: Change, note: string) => void,
    private readonly onDiff: (
      change: Change,
      place: ThreadPlace
    ) => Promise<boolean>,
    private readonly draft: (
      change: Change,
      place: ThreadPlace,
      body: string
    ) => vscode.CommentThread
  ) {
    // A gutter marker and a mark on the scroll bar: nothing in the text. A
    // gutter icon can't take a theme color, so each theme kind gets an icon
    // in its default editorWarning.foreground.
    const icon = (file: string) =>
      vscode.Uri.joinPath(extensionUri, "media", file);
    this.decoration = vscode.window.createTextEditorDecorationType({
      light: { gutterIconPath: icon("finding-light.svg") },
      dark: { gutterIconPath: icon("finding.svg") },
      gutterIconSize: "contain",
      overviewRulerColor: new vscode.ThemeColor("editorWarning.foreground"),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
    this.subscriptions.push(
      this.decoration,
      this.changed,
      vscode.window.onDidChangeVisibleTextEditors(() => this.render())
    );
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
  }

  /**
   * Asks the Change's Assistant for Findings, which replace any it raised
   * before. If its reply holds no Findings, the earlier ones stay.
   */
  async find(change: Change): Promise<void> {
    const name = changeName(change);
    let reply: string;
    try {
      reply = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `The Assistant is looking for Findings in ${name}…`,
        },
        () => this.ask(change)
      );
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Couldn't find issues in ${name}: ${messageOf(err)}`
      );
      return;
    }
    let raised: unknown[];
    try {
      raised = parseFindings(reply);
    } catch (err) {
      void vscode.window.showErrorMessage(
        `The Assistant's reply held no Findings for ${name}: ${messageOf(err)}`
      );
      return;
    }
    const placed = await Promise.all(
      raised.slice(0, maxFindings).map((raw) => this.place(change, raw))
    );
    const findings = placed.filter((f): f is Finding => f !== undefined);
    const left = raised.length - findings.length;
    if (findings.length > 0) this.byChange.set(change.id, { change, findings });
    else this.byChange.delete(change.id);
    this.update();
    this.tell(
      change,
      [
        findings.length === 0
          ? "Raised no Findings."
          : `Raised ${findings.length} Finding${findings.length === 1 ? "" : "s"}, marked in the gutter of the diff and listed in the Findings view.`,
        ...(left > 0
          ? [
              `Left out ${left} that ${left === 1 ? "wasn't" : "weren't"} on the lines of the diff.`,
            ]
          : []),
      ].join(" ")
    );
  }

  /** Removes the Finding. */
  dismiss(finding: Finding): void {
    const entry = this.byChange.get(finding.change.id);
    if (!entry) return;
    entry.findings = entry.findings.filter((f) => f.id !== finding.id);
    if (entry.findings.length === 0) this.byChange.delete(finding.change.id);
    this.update();
  }

  /**
   * Turns the Finding into a draft Comment at the same place, with its
   * message for the Reviewer to edit, and removes the Finding. The draft
   * shows in the editors of its file, or in one opened for it.
   */
  async convert(finding: Finding): Promise<void> {
    const thread = this.draft(finding.change, finding.place, finding.message);
    this.dismiss(finding);
    const uri = thread.uri.toString();
    if (
      !vscode.window.visibleTextEditors.some(
        (e) => e.document.uri.toString() === uri
      )
    )
      await this.reveal(finding);
  }

  /** Opens the Finding's file at its lines. */
  async reveal(finding: Finding): Promise<void> {
    await vscode.window.showTextDocument(fileOf(finding), {
      selection: rangeOf(finding.place),
      preview: true,
    });
  }

  /** Forgets the Findings of a Change that was closed. */
  forget(change: Change): void {
    if (this.byChange.delete(change.id)) this.update();
  }

  /**
   * The Finding a command names: by its id, as a hover's link does, by a
   * node of the view, or else the one under the active editor's cursor.
   */
  get(target: string | FindingsNode | undefined): Finding | undefined {
    if (target === undefined) return this.underCursor();
    if (typeof target !== "string")
      return target.kind === "finding" ? target.finding : undefined;
    return this.all().find((f) => f.id === target);
  }

  getTreeItem(node: FindingsNode): vscode.TreeItem {
    if (node.kind === "change") {
      const item = new vscode.TreeItem(
        changeName(node.change),
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.description = `${node.findings.length} Finding${node.findings.length === 1 ? "" : "s"}`;
      item.contextValue = "change";
      return item;
    }
    const { finding } = node;
    const item = new vscode.TreeItem(
      finding.message.split("\n")[0],
      vscode.TreeItemCollapsibleState.None
    );
    item.description = `${reference(finding.place)}${finding.place.side === "LEFT" ? " (base)" : ""}`;
    // Plain text: the message is the Assistant's, from other people's code.
    item.tooltip = finding.message;
    item.iconPath = new vscode.ThemeIcon(
      "lightbulb",
      new vscode.ThemeColor("editorWarning.foreground")
    );
    item.contextValue = "finding";
    item.command = {
      title: "Show Finding",
      command: "dearReviewer.revealFinding",
      arguments: [finding.id],
    };
    return item;
  }

  getChildren(node?: FindingsNode): FindingsNode[] {
    if (node) {
      return node.kind === "change"
        ? node.findings.map((finding) => ({ kind: "finding", finding }))
        : [];
    }
    return [...this.byChange.values()].map(({ change, findings }) => ({
      kind: "change",
      change,
      findings,
    }));
  }

  /** What the gutters of the visible editors show, for the tests. */
  decorated(): {
    file: string;
    lines: [number, number];
    hover: string;
    enabledCommands: readonly string[];
  }[] {
    return [...this.shown].flatMap(([uri, options]) =>
      options.map((o) => {
        const hover = o.hoverMessage as vscode.MarkdownString;
        const trusted = hover.isTrusted;
        return {
          file: vscode.Uri.parse(uri).fsPath,
          lines: [o.range.start.line, o.range.end.line] as [number, number],
          hover: hover.value,
          enabledCommands:
            typeof trusted === "object" ? trusted.enabledCommands : [],
        };
      })
    );
  }

  private all(): Finding[] {
    return [...this.byChange.values()].flatMap((entry) => entry.findings);
  }

  private update(): void {
    this.changed.fire();
    this.render();
    void setContext("dearReviewer.hasFindings", this.all().length > 0);
  }

  /** Puts each Finding's marker in the gutter of every visible editor of its file. */
  private render(): void {
    const byFile = new Map<string, vscode.DecorationOptions[]>();
    for (const finding of this.all()) {
      const uri = fileOf(finding).toString();
      const options = byFile.get(uri) ?? [];
      options.push({
        range: rangeOf(finding.place),
        hoverMessage: hoverOf(finding),
      });
      byFile.set(uri, options);
    }
    const shown = new Map<string, vscode.DecorationOptions[]>();
    for (const editor of vscode.window.visibleTextEditors) {
      const uri = editor.document.uri.toString();
      const options = byFile.get(uri) ?? [];
      editor.setDecorations(this.decoration, options);
      if (options.length > 0) shown.set(uri, options);
    }
    this.shown = shown;
  }

  /** The Finding on the line under the active editor's cursor, if any. */
  private underCursor(): Finding | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const uri = editor.document.uri.toString();
    const line = editor.selection.active.line;
    return this.all().find((f) => {
      const range = rangeOf(f.place);
      return (
        fileOf(f).toString() === uri &&
        range.start.line <= line &&
        line <= range.end.line
      );
    });
  }

  /**
   * The Finding the Assistant raised, if it is one: a file inside its side's
   * worktree, even through symbolic links, with lines that file has, on the
   * lines of that side's diff. The Assistant reads other people's code, so
   * nothing in its reply is trusted.
   */
  private async place(
    change: Change,
    raw: unknown
  ): Promise<Finding | undefined> {
    if (typeof raw !== "object" || raw === null) return;
    const {
      path: given,
      side,
      startLine,
      endLine,
      message,
    } = raw as Record<string, unknown>;
    if (typeof given !== "string" || !given) return;
    if (typeof message !== "string" || !message.trim()) return;
    if (side !== "head" && side !== "base") return;
    const first = startLine ?? endLine;
    const last = endLine ?? startLine;
    if (!isLine(first) || !isLine(last) || last < first) return;
    const dir = side === "head" ? change.headDir : change.baseDir;
    const file = path.resolve(dir, given);
    const relative = path.relative(dir, file);
    if (!isInside(relative)) return;
    let text: string;
    try {
      const real = fs.realpathSync(file);
      if (!isInside(path.relative(fs.realpathSync(dir), real))) return;
      text = await fs.promises.readFile(real, "utf8");
    } catch {
      return;
    }
    const lineCount =
      text.split("\n").length - (text === "" || text.endsWith("\n") ? 1 : 0);
    if (last > lineCount) return;
    const place: ThreadPlace = {
      path: relative.split(path.sep).join("/"),
      side: side === "head" ? "RIGHT" : "LEFT",
      line: last,
      ...(last > first && { startLine: first }),
    };
    if (!(await this.onDiff(change, place))) return;
    const trimmed = message.trim();
    return {
      id: crypto.randomUUID(),
      change,
      place,
      message:
        trimmed.length > maxMessageChars
          ? `${trimmed.slice(0, maxMessageChars)}…`
          : trimmed,
    };
  }
}

/**
 * The Findings in the Assistant's reply: the array `findings` of a JSON
 * object, which may come in a Markdown fence or after a sentence.
 */
export function parseFindings(reply: string): unknown[] {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("it isn't a JSON object.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.slice(start, end + 1));
  } catch {
    throw new Error("it isn't valid JSON.");
  }
  const findings = (parsed as { findings?: unknown } | null)?.findings;
  if (!Array.isArray(findings)) throw new Error("it has no list of findings.");
  return findings;
}

/**
 * The hover on a Finding's lines: the Assistant's message as plain text,
 * escaped so it can't add links or formatting, and the two actions, the
 * only commands the hover may run.
 */
function hoverOf(finding: Finding): vscode.MarkdownString {
  const hover = new vscode.MarkdownString();
  hover.isTrusted = { enabledCommands: findingCommands };
  hover.supportHtml = false;
  hover.appendMarkdown("**Finding** from the Assistant\n\n");
  hover.appendText(finding.message);
  const args = encodeURIComponent(JSON.stringify([finding.id]));
  hover.appendMarkdown(
    `\n\n[Convert to Comment](command:dearReviewer.convertFinding?${args}) · [Dismiss](command:dearReviewer.dismissFinding?${args})`
  );
  return hover;
}

function fileOf(finding: Finding): vscode.Uri {
  const { change, place } = finding;
  const dir = place.side === "LEFT" ? change.baseDir : change.headDir;
  return vscode.Uri.file(path.join(dir, ...place.path.split("/")));
}

/** The Finding's whole lines, so hovering its code shows it. */
function rangeOf(place: ThreadPlace): vscode.Range {
  return new vscode.Range(
    (place.startLine ?? place.line) - 1,
    0,
    place.line - 1,
    Number.MAX_SAFE_INTEGER
  );
}

function reference(place: ThreadPlace): string {
  const first = place.startLine ?? place.line;
  return `${place.path}:${first === place.line ? first : `${first}-${place.line}`}`;
}

function isLine(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1;
}

function isInside(relative: string): boolean {
  return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}
