// Findings on request (see ADR 0017): only when the Reviewer runs Ask for
// Findings does the Assistant look over a Change and reply with Findings as a
// JSON object. Each one that lands on lines of its side's diff, inside the
// Change's worktrees, shows as a gutter marker on those lines and in the
// Findings view, never inline in the diff. The Reviewer dismisses a Finding,
// or converts it into a draft Comment at the same place, from its hover, the
// view or the editor's Quick Fix on its lines; nothing reaches
// GitHub until they save that Comment into their pending review and submit.
// From its hover or Quick Fix they can also ask its Change's Assistant about
// it, in the conversation that raised it.
// The view, and stepping through Findings, follow the Change in front (ADR
// 0025); a Change behind it keeps its Findings until it comes back.

import * as crypto from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import type { Selection } from "./assistant/prompts";
import { Change, changeName } from "./changeWorkspace";
import type { ThreadPlace } from "./github/client";
import { setContext } from "./context";
import { messageOf } from "./errors";
import { quickFixLabels, selectedLines } from "./findingActions";
import { gutterIcons, type GutterIcon, type IconSpan } from "./findingGutter";
import {
  findingAfter,
  placeAmong,
  stepOrder,
  type Placed,
  type StepStart,
} from "./findingOrder";
import { byFile, countText, currentFinding } from "./findingsList";
import {
  FindingsView,
  type FindingsAction,
  type FindingsViewState,
} from "./findingsView";
import { reviewKey } from "./reviewKeys";
import { countLines, readInWorktree } from "./worktreeFile";

/** A spot in a Change the Assistant thinks deserves the Reviewer's attention. */
export interface Finding {
  id: string;
  change: Change;
  /** Its side, path and lines, as a Comment there would have them. */
  place: ThreadPlace;
  message: string;
}

/** The most Findings kept from one reply, and the longest message. */
const maxFindings = 50;
const maxMessageChars = 2_000;

const findingCommands = [
  "dearReviewer.convertFinding",
  "dearReviewer.dismissFinding",
  "dearReviewer.askAboutFinding",
  "dearReviewer.nextFinding",
  "dearReviewer.previousFinding",
];

/** Each Finding's Quick Fix actions: what they do, and the command they run. */
const quickFixes = [
  ["Convert to Comment", "dearReviewer.convertFinding"],
  ["Dismiss", "dearReviewer.dismissFinding"],
  ["Ask the Assistant", "dearReviewer.askAboutFinding"],
] as const;

export class Findings implements vscode.CodeActionProvider, vscode.Disposable {
  /** The Findings view, which lists the Change in front's Findings. */
  readonly view: FindingsView;
  /** By Change id. */
  private readonly byChange = new Map<
    string,
    { change: Change; findings: Finding[] }
  >();
  /** Each Finding's whole lines: its hover and its mark on the scroll bar. */
  private readonly decoration: vscode.TextEditorDecorationType;
  /** The gutter's icons, one per line. */
  private readonly icons: Record<GutterIcon, vscode.TextEditorDecorationType>;
  /** What each visible editor shows, by document URI, for the tests. */
  private shown = new Map<
    string,
    { options: vscode.DecorationOptions[]; icons: IconSpan[] }
  >();
  /**
   * The Finding stepped to or opened last, which the next step starts from
   * and the view shows open while the cursor is on no Finding.
   */
  private current: string | undefined;
  /** The current Finding the view was last given. */
  private shownCurrent: string | undefined;
  /** How many hovers opened on a Finding's lines, and where the last did, for the tests. */
  private hovered: { count: number; last?: { file: string; line: number } } = {
    count: 0,
  };
  private readonly subscriptions: vscode.Disposable[] = [];

  /**
   * `ask` has the Change's Assistant reply to a request for Findings, and
   * `tell` adds a note to its panel. `onDiff` says whether lines take a
   * Comment, and `draft` opens a draft Comment for the Reviewer to edit.
   * `inFront` gives the Change in front, whose Findings the view lists.
   * `countHovers`, set only under the tests, counts the hovers that open on
   * Findings, for `hovers`.
   */
  constructor(
    extensionUri: vscode.Uri,
    private readonly inFront: () => Change | undefined,
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
    ) => vscode.CommentThread,
    countHovers: boolean
  ) {
    // A gutter marker and a mark on the scroll bar: nothing in the text. A
    // gutter icon can't take a theme color, so each theme kind gets an icon
    // in the Assistant color's default, charts.purple's.
    const icon = (name: string) =>
      vscode.window.createTextEditorDecorationType({
        light: {
          gutterIconPath: vscode.Uri.joinPath(
            extensionUri,
            "media",
            `${name}-light.svg`
          ),
        },
        dark: {
          gutterIconPath: vscode.Uri.joinPath(
            extensionUri,
            "media",
            `${name}.svg`
          ),
        },
        gutterIconSize: "contain",
      });
    this.icons = { cat: icon("finding-cat"), bar: icon("finding-bar") };
    this.decoration = vscode.window.createTextEditorDecorationType({
      overviewRulerColor: new vscode.ThemeColor(
        "dearReviewer.assistantForeground"
      ),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
    this.view = new FindingsView(this.viewState(), (action) =>
      this.act(action)
    );
    this.subscriptions.push(
      this.decoration,
      ...Object.values(this.icons),
      vscode.window.registerWebviewViewProvider(
        FindingsView.viewType,
        this.view,
        { webviewOptions: { retainContextWhenHidden: true } }
      ),
      vscode.window.onDidChangeVisibleTextEditors(() => this.render()),
      // The current Finding is the one under the cursor.
      vscode.window.onDidChangeTextEditorSelection(() => this.followCursor()),
      vscode.window.onDidChangeActiveTextEditor(() => this.followCursor()),
      vscode.languages.registerCodeActionsProvider({ scheme: "file" }, this, {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
      })
    );
    // The extension host can't see a hover, but the editor asks every
    // provider for its part of one where it opens. This one adds nothing.
    if (countHovers)
      this.subscriptions.push(
        vscode.languages.registerHoverProvider(
          { scheme: "file" },
          {
            provideHover: (document, position) => {
              if (this.at(document.uri, position.line))
                this.hovered = {
                  count: this.hovered.count + 1,
                  last: { file: document.uri.fsPath, line: position.line },
                };
              return undefined;
            },
          }
        )
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
        `Couldn't get Findings for ${name}: ${messageOf(err)}`
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
    this.refresh();
    this.tell(
      change,
      [
        findings.length === 0
          ? "Raised no Findings."
          : `Raised ${findings.length} Finding${findings.length === 1 ? "" : "s"}, marked in the gutter of the diff and listed in the Findings view. ${reviewKey("F")} steps through them, and ${reviewKey("Shift+F")} back.`,
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
    this.refresh();
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

  /**
   * The Finding's lines, as a selection for its Change's Assistant, marked
   * as the Finding and with its message as it is now. Gives nothing if its
   * file can't be read.
   */
  async selectionOf(
    finding: Finding
  ): Promise<(Selection & { text: string }) | undefined> {
    const { change, place } = finding;
    const side = place.side === "LEFT" ? "base" : "head";
    const file = await readInWorktree(
      side === "base" ? change.baseDir : change.headDir,
      place.path
    );
    if (!file) return;
    const startLine = place.startLine ?? place.line;
    return {
      path: place.path,
      side,
      startLine,
      endLine: place.line,
      text: file.text
        .split(/\r?\n/)
        .slice(startLine - 1, place.line)
        .join("\n"),
      finding: { message: finding.message },
    };
  }

  /** Opens the Finding's file at its lines, without its hover. */
  async reveal(finding: Finding): Promise<vscode.TextEditor> {
    return vscode.window.showTextDocument(fileOf(finding), {
      selection: rangeOf(finding.place),
      preview: true,
    });
  }

  /**
   * Opens the Finding's file at its lines, with the cursor on its first so
   * that the hover, which opens above the cursor, leaves them in sight, and
   * opens its hover.
   */
  async open(finding: Finding): Promise<void> {
    const editor = await this.reveal(finding);
    const { start, end } = rangeOf(finding.place);
    editor.selection = new vscode.Selection(
      editor.document.lineAt(end.line).range.end,
      start
    );
    this.current = finding.id;
    this.showView();
    // By default a hover already open, such as the last Finding's, only
    // takes the focus and stays where it is.
    await vscode.commands.executeCommand("editor.action.showHover", {
      focus: "noAutoFocus",
    });
  }

  /**
   * Opens the next Finding of the Change in front, or the one before it, by
   * file and line, going round at the end, with its hover open. It steps
   * from `from` if that is one of them, as a hover's link does, and
   * otherwise from the active editor's cursor. Gives the Finding opened, if
   * there is one.
   */
  async step(direction: 1 | -1, from?: Finding): Promise<Finding | undefined> {
    const ordered = this.inStepOrder();
    const editor = vscode.window.activeTextEditor;
    const start: StepStart | undefined =
      from && ordered.some((f) => f.id === from.id)
        ? { id: from.id }
        : editor && {
            file: editor.document.uri.toString(),
            line: editor.selection.active.line,
            current: this.current,
          };
    const next = findingAfter(ordered, start, direction);
    if (!next) return;
    await this.open(next.finding);
    return next.finding;
  }

  /**
   * Lists and marks the Findings of the Change in front afresh, such as
   * after another came to the front, since their hovers count them.
   */
  refresh(): void {
    this.showHasFindings();
    this.render();
    this.showView();
  }

  /** The names of the Changes this window holds Findings for, for the tests. */
  changeNames(): string[] {
    return [...this.byChange.values()].map((entry) => changeName(entry.change));
  }

  /** Forgets the Findings of a Change that was closed. */
  forget(change: Change): void {
    if (this.byChange.delete(change.id)) this.refresh();
  }

  /**
   * The Finding a command names: by its id, as a hover's link and the view
   * do, or else the one under the active editor's cursor.
   */
  get(target: string | undefined): Finding | undefined {
    if (target === undefined) return this.underCursor();
    return this.all().find((f) => f.id === target);
  }

  /**
   * The Quick Fix actions of the Findings on the range's lines, in either
   * side's file: Convert to Comment, Dismiss and Ask the Assistant for
   * each, as its hover has.
   */
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection
  ): vscode.CodeAction[] {
    const uri = document.uri.toString();
    const selected = selectedLines(range.start, range.end);
    const here = this.all()
      .filter((f) => {
        const lines = rangeOf(f.place);
        return (
          fileOf(f).toString() === uri &&
          lines.start.line <= selected.last &&
          selected.first <= lines.end.line
        );
      })
      .sort(
        (a, b) => rangeOf(a.place).start.line - rangeOf(b.place).start.line
      );
    const labels = quickFixLabels(
      here.map((f) => ({
        first: f.place.startLine ?? f.place.line,
        last: f.place.line,
        message: f.message,
      }))
    );
    return here.flatMap((finding, i) =>
      quickFixes.map(([verb, command]) => {
        const title = `${labels[i]}: ${verb}`;
        const action = new vscode.CodeAction(
          title,
          vscode.CodeActionKind.QuickFix
        );
        action.command = { title, command, arguments: [finding.id] };
        return action;
      })
    );
  }

  /**
   * The Findings the visible editors mark, for the tests: each one's lines,
   * hover, and the icon the gutter shows on each of its lines.
   */
  decorated(): {
    file: string;
    lines: [number, number];
    hover: string;
    enabledCommands: readonly string[];
    gutter: (GutterIcon | undefined)[];
  }[] {
    return [...this.shown].flatMap(([uri, { options, icons }]) =>
      options.map((o) => {
        const hover = o.hoverMessage as vscode.MarkdownString;
        const trusted = hover.isTrusted;
        const first = o.range.start.line;
        const last = o.range.end.line;
        return {
          file: vscode.Uri.parse(uri).fsPath,
          lines: [first, last] as [number, number],
          hover: hover.value,
          enabledCommands:
            typeof trusted === "object" ? trusted.enabledCommands : [],
          gutter: Array.from(
            { length: last - first + 1 },
            (_, i) =>
              icons.find((s) => s.first <= first + i && first + i <= s.last)
                ?.icon
          ),
        };
      })
    );
  }

  /** How many hovers opened on a Finding's lines, and where the last did, for the tests. */
  hovers(): { count: number; last?: { file: string; line: number } } {
    return this.hovered;
  }

  private all(): Finding[] {
    return [...this.byChange.values()].flatMap((entry) => entry.findings);
  }

  /** The Findings of the Change in front. */
  private ofFront(): Finding[] {
    const front = this.inFront();
    return (front && this.byChange.get(front.id)?.findings) ?? [];
  }

  /** The Findings of the Change in front, in the order the steps take. */
  private inStepOrder() {
    return stepOrder(
      this.ofFront().map((finding) => {
        const { start, end } = rangeOf(finding.place);
        return {
          id: finding.id,
          file: fileOf(finding).toString(),
          first: start.line,
          last: end.line,
          finding,
        };
      })
    );
  }

  /**
   * What the view shows: the Change in front's Findings by file, and the
   * current one, under the cursor or else stepped to or opened last.
   */
  private viewState(): FindingsViewState {
    const ordered = this.inStepOrder();
    const current = this.currentAmong(ordered);
    this.shownCurrent = current;
    return {
      changeOpen: !!this.inFront(),
      files: byFile(
        ordered.map((f) => ({
          ...f,
          path: f.finding.place.path,
          base: f.finding.place.side === "LEFT",
          message: f.finding.message,
        }))
      ),
      ...(current !== undefined && { current }),
      count: countText(ordered, current),
      key: reviewKey("F"),
      previousKey: reviewKey("Shift+F"),
    };
  }

  /** The current Finding among the ordered ones, as the view shows it. */
  private currentAmong(ordered: Placed[]): string | undefined {
    const editor = vscode.window.activeTextEditor;
    return currentFinding(
      ordered,
      editor && {
        file: editor.document.uri.toString(),
        line: editor.selection.active.line,
      },
      this.current
    );
  }

  private showView(): void {
    // Undefined while the constructor makes the view, which asks for its first state.
    this.view?.update(this.viewState());
  }

  /**
   * Shows the view afresh once the cursor moves the current Finding, and
   * only then: the cursor moves on every key typed in any editor.
   */
  private followCursor(): void {
    if (this.currentAmong(this.inStepOrder()) !== this.shownCurrent)
      this.showView();
  }

  /**
   * Does what the Reviewer asked of the view. A Finding it names must be
   * one it lists, of the Change in front, and a step starts from the
   * current Finding.
   */
  private async act(action: FindingsAction): Promise<void> {
    if (action.type === "ask") {
      await vscode.commands.executeCommand("dearReviewer.findIssues");
      return;
    }
    if (action.type === "step") {
      const current = this.currentAmong(this.inStepOrder());
      await this.step(
        action.direction,
        this.ofFront().find((f) => f.id === current)
      );
      return;
    }
    const finding = this.ofFront().find((f) => f.id === action.id);
    if (!finding) return;
    if (action.type === "reveal") await this.open(finding);
    else if (action.type === "convert") await this.convert(finding);
    else this.dismiss(finding);
  }

  private showHasFindings(): void {
    void setContext("dearReviewer.hasFindings", this.ofFront().length > 0);
  }

  /** Puts each Finding's marker in the gutter of every visible editor of its file. */
  private render(): void {
    const ordered = this.inStepOrder();
    const byFile = new Map<string, vscode.DecorationOptions[]>();
    for (const finding of this.all()) {
      const uri = fileOf(finding).toString();
      const options = byFile.get(uri) ?? [];
      options.push({
        range: rangeOf(finding.place),
        hoverMessage: hoverOf(finding, placeAmong(ordered, finding.id)),
      });
      byFile.set(uri, options);
    }
    const shown: typeof this.shown = new Map();
    for (const editor of vscode.window.visibleTextEditors) {
      const uri = editor.document.uri.toString();
      const options = byFile.get(uri) ?? [];
      const icons = gutterIcons(
        options.map(({ range }) => ({
          first: range.start.line,
          last: range.end.line,
        }))
      );
      editor.setDecorations(this.decoration, options);
      for (const [kind, type] of Object.entries(this.icons))
        editor.setDecorations(
          type,
          icons
            .filter(({ icon }) => icon === kind)
            .map(({ first, last }) => new vscode.Range(first, 0, last, 0))
        );
      if (options.length > 0) shown.set(uri, { options, icons });
    }
    this.shown = shown;
  }

  /** The Finding on the line under the active editor's cursor, if any. */
  private underCursor(): Finding | undefined {
    const editor = vscode.window.activeTextEditor;
    return editor && this.at(editor.document.uri, editor.selection.active.line);
  }

  /** A Finding on the line of the file, if any. */
  private at(uri: vscode.Uri, line: number): Finding | undefined {
    const file = uri.toString();
    return this.all().find((f) => {
      const range = rangeOf(f.place);
      return (
        fileOf(f).toString() === file &&
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
    const file = await readInWorktree(
      side === "head" ? change.headDir : change.baseDir,
      given
    );
    if (!file || last > countLines(file.text)) return;
    const place: ThreadPlace = {
      path: file.path,
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
 * escaped so it can't add links or formatting, and its three actions. A
 * Finding of the Change in front, which has a `place` among its Findings,
 * also gets its count and steps to its neighbours. These are the only
 * commands the hover may run, each given the Finding's id.
 */
function hoverOf(
  finding: Finding,
  place: { position: number; total: number } | undefined
): vscode.MarkdownString {
  const hover = new vscode.MarkdownString();
  hover.isTrusted = { enabledCommands: findingCommands };
  hover.supportHtml = false;
  hover.appendMarkdown(
    `**Finding${place ? ` ${place.position} of ${place.total}` : ""}** from the Assistant\n\n`
  );
  hover.appendText(finding.message);
  const args = encodeURIComponent(JSON.stringify([finding.id]));
  const steps = place
    ? `&emsp;&emsp;[↑ Previous](command:dearReviewer.previousFinding?${args}) · [↓ Next](command:dearReviewer.nextFinding?${args})`
    : "";
  hover.appendMarkdown(
    `\n\n[Convert to Comment](command:dearReviewer.convertFinding?${args}) · [Dismiss](command:dearReviewer.dismissFinding?${args}) · [Ask the Assistant](command:dearReviewer.askAboutFinding?${args})${steps}`
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

function isLine(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1;
}
