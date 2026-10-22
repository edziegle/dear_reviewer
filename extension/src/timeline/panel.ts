// The overview panel for one Change: the webview a Change opens with, alone
// in the main column, that orients the Reviewer (ADR 0019, ADR 0020). Code
// opens in the column beside it once the Reviewer starts reading. It shows
// what the Change is, how big it is, where the Reviewer stands on it, the
// Assistant's short take and its Reading Order (ADR 0022), then its history:
// a pull request's timeline from GitHub, or a local Change's commits. A pull
// request's Review ends here too, in the Submit step (ADR 0033). The
// extension sends it the whole state; the webview renders it, says which
// state it rendered, and asks the extension for everything else.

import * as crypto from "crypto";
import * as vscode from "vscode";
import { catMark, catSymbol } from "../assistantMark";
import { findReferences, type FileReference } from "../markdown";
import { isVerdict, type Verdict } from "../reviewSubmission";
import {
  Handshake,
  MarkdownPanel,
  RenderInto,
  reviewStyles,
  sharedScript,
  sharedStyles,
} from "../markdownPanel";
import type { ShownReadingOrder } from "../readingOrder";
import type { ShownRepeatedEdits } from "../repetitions";
import type { PendingCommentLine } from "../reviewComments";
import type { BriefState } from "../briefs";
import type {
  CheckRunStatus,
  CheckStatus,
  ReviewVerdict,
} from "../github/client";

export interface TimelineAuthor {
  login: string;
  /** The cached avatar, as a webview resource URI. */
  avatar?: string;
}

export type TimelineItem =
  | { kind: "description"; author: TimelineAuthor; date: string; body: string }
  | {
      kind: "commit";
      author: TimelineAuthor;
      date: string;
      sha: string;
      headline: string;
    }
  | { kind: "comment"; author: TimelineAuthor; date: string; body: string }
  | {
      kind: "review";
      author: TimelineAuthor;
      date: string;
      verdict: ReviewVerdict;
      body: string;
      comments: number;
    };

/**
 * A note in the overview's standing line: words, or words that open what
 * they name, such as the diff of the commits since the Reviewer's Review.
 */
export type StandingNote =
  string | { text: string; action: "showChangesSince" };

/** The Reviewer's last Review, as the overview's standing line opens with it. */
export interface ReviewStanding {
  verdict: "approved" | "changesRequested" | "commented" | "briefed";
  /** Such as "You approved at 14:32 · 3 Comments published", or "You copied a Brief at 14:32 · 3 Comments". */
  text: string;
}

/** What the overview shows from the Change's Assistant. */
export interface OverviewTake {
  /** "Assistant", or which Review an explanation of new commits is since. */
  label: string;
  /** Whether the label names a Review the take explains new commits since, so it opens their diff. */
  since?: boolean;
  /** Whether the Assistant is writing it. */
  reading: boolean;
  /** Markdown, as the Assistant wrote it so far. */
  text?: string;
  /** Why the Assistant can't write it. */
  problem?: string;
  /** The label of the button that helps with the problem. */
  problemAction?: string;
  /** Whether trying again can mend the problem, once its button has helped. */
  canRetry?: boolean;
}

/** The Submit step that ends a pull request's Review, while it is open (ADR 0033). */
export interface SubmitStep {
  /** Goes up each time the Reviewer asks for the step, which then takes the focus. */
  asked: number;
  /** The verdicts offered, in order. */
  verdicts: { verdict: Verdict; label: string; detail: string }[];
  /** The verdict to start from, when one was asked for. */
  verdict?: Verdict;
  /** Why GitHub would refuse each verdict that needs a summary, while there is none. */
  needsSummary: Partial<Record<Verdict, string>>;
  /** The Comments that publish with the Review. */
  comments: PendingCommentLine[];
  /** Whether GitHub is taking the Review. */
  submitting: boolean;
  /** Why GitHub didn't take it, in words for the Reviewer. */
  problem?: string;
  /** The label of the button that helps with the problem, such as signing in. */
  problemAction?: string;
  /** GitHub's own words about the problem, for the Reviewer who opens them. */
  problemDetail?: string;
  /** Why some verdicts aren't offered, such as on the Reviewer's own pull request. */
  note?: string;
}

export interface TimelineState {
  /** The pull request's title, or the branch or commits of a local Change. */
  title: string;
  /** What the Change is and where it goes, such as `acme/api #7 · alice → main`. */
  byline: string;
  /** The pull request on GitHub. */
  url?: string;
  /** How big the Change is, such as `12 files · +340 −58`, once counted. */
  size?: { files: number; additions: number; deletions: number };
  /** The Reviewer's last Review, while no new commits came since. */
  review?: ReviewStanding;
  /** Where the Reviewer stands: new commits since their Review, pending Comments, files viewed. */
  standing: StandingNote[];
  /** How many of the Change's files the Reviewer has viewed, once counted. */
  progress?: { viewed: number; total: number };
  /** How many Comments are pending, once counted. */
  pending?: number;
  /** Whether the Reviewer's last Review covers the head, with no Comments pending, so there is nothing to finish. */
  finished?: boolean;
  /** Whether the review window is untrusted, so code navigation is off. */
  navigationOff?: boolean;
  /** File extensions, such as `.tofu`, of changed files no installed language highlights, while any are offered. */
  unhighlighted?: string[];
  /**
   * Where the description, a commit message or a Comment holds text the
   * Reviewer can't see: hidden characters, or an HTML comment, which the
   * Assistant still gets as escapes or not at all (ADR 0042). One sentence each.
   */
  hiddenText?: string[];
  take: OverviewTake;
  /** The order the Assistant suggests for reading the Change's files, while it has one or writes one. */
  readingOrder?: ShownReadingOrder;
  /** Where the Change makes the same edit at several sites, found by Dear Reviewer's rules (ADR 0047); absent when it makes none. */
  repeatedEdits?: ShownRepeatedEdits;
  /** The button that finishes the Review: "Submit Review…" or "Write Brief…". */
  finish: string;
  /** The Submit step, while it is open. */
  submit?: SubmitStep;
  /** Where a local Change's Brief stands, while it is being written, waits to be copied, couldn't be written or was copied. */
  brief?: BriefState;
  /** Goes up each time the Reviewer is brought here to finish, which gives the finishing button the focus. */
  finishAsked?: number;
  /** The Review just submitted from the step: what it published, and its page on GitHub. */
  submitted?: { text: string; url?: string };
  /** "Timeline" for a pull request, "Commits" for a local Change. */
  history: string;
  /** Whether a reload is under way. */
  loading: boolean;
  items: TimelineItem[];
  /** The latest commit's checks; absent when it has none. */
  checks?: {
    commit: string;
    status?: CheckStatus;
    /** Failed checks first, then running ones, then the rest. */
    runs: { name: string; status: CheckRunStatus; url?: string }[];
    /** How many lead the list because they failed or are still running; the rest wait behind Show all. */
    attention: number;
    /** Such as "1 failed · 2 running · 38 passed". */
    summary: string;
  };
  /** What went wrong, in words for the Reviewer. */
  problem?: string;
  /** The label of the button that helps with the problem. */
  problemAction?: string;
}

/**
 * The overview as the webview gets it: the Assistant's take, and each
 * description, Comment and review body, also rendered from Markdown and
 * sanitised (ADR 0011).
 */
export interface ShownTimeline extends TimelineState {
  take: OverviewTake & {
    /** At most the first three sentences, rendered. */
    html?: string;
    /** All of it, rendered, when it runs longer than three sentences. */
    fullHtml?: string;
    /** The first reference to a changed file, where the Assistant says to start. */
    start?: FileReference;
  };
  items: (TimelineItem & { html?: string })[];
}

/** Webview to extension. */
export type FromWebview =
  | Handshake
  | { type: "openLink"; url: string }
  | { type: "openReference"; path: string; startLine: number; endLine: number }
  | { type: "openFile"; path: string }
  | {
      type: "openSite";
      path: string;
      side: "head" | "base";
      line: number;
      endLine: number;
      /** Whether it is a missed site, which opens as the head file at that line, rather than a hunk's diff. */
      missed: boolean;
    }
  | { type: "findExtension"; extension: string }
  | { type: "dismissUnhighlighted" }
  | { type: "suggestReadingOrder" }
  | { type: "refresh" }
  | { type: "finish" }
  | { type: "submit"; verdict: Verdict; summary: string }
  | { type: "cancelSubmit" }
  | { type: "submitAction" }
  | { type: "openPending"; index: number }
  | { type: "nextFile" }
  | { type: "ask" }
  | { type: "codeFlow" }
  | { type: "showChangesSince" }
  | { type: "skimSetting" }
  | { type: "takeAction" }
  | { type: "takeRetry" }
  | { type: "trust" }
  | { type: "closeChange" }
  | { type: "copyBrief" }
  | { type: "showBrief" }
  | { type: "discard" }
  | { type: "problemAction" };

/** What the Reviewer does in the panel. */
export type OverviewAction = Exclude<FromWebview, Handshake>;

export class TimelinePanel {
  private readonly view: MarkdownPanel<TimelineState, ShownTimeline>;
  /** Fires when the Reviewer closes the panel. */
  readonly onDidDispose: vscode.Event<void>;
  /** Whether it opened with the focus, for the tests. */
  readonly openedWithFocus: boolean;

  /**
   * `avatarDir` holds the cached avatars, the only files the webview may
   * load. `isChangedFile` says which paths in the Assistant's take become
   * references to open, and `onAction` gets what the Reviewer does. With
   * `focus`, it opens with the focus.
   */
  private readonly name: string;

  constructor(
    state: TimelineState,
    title: string,
    avatarDir: vscode.Uri,
    isChangedFile: (path: string) => boolean,
    private readonly onAction: (action: OverviewAction) => void,
    focus: boolean
  ) {
    this.openedWithFocus = focus;
    this.name = title;
    this.view = new MarkdownPanel(state, {
      viewType: "dearReviewer.timeline",
      title,
      localResourceRoots: [avatarDir],
      // The Change opens with its overview alone, in front.
      placement: { viewColumn: vscode.ViewColumn.One, preserveFocus: !focus },
      html: (webview) => html(webview.cspSource),
      show: (shownState, render) => shown(shownState, render, isChangedFile),
      receive: (message) => this.receive(message as FromWebview),
    });
    this.onDidDispose = this.view.onDidDispose;
  }

  /** The Change's name, which names the panel to the tests; the tab's label may show its title instead. */
  get title(): string {
    return this.name;
  }

  /** Puts the label on the panel's tab, such as the pull request's title once it has loaded. */
  label(label: string): void {
    this.view.title = label;
  }

  /** Whether the panel is the one the Reviewer is looking at. */
  get active(): boolean {
    return this.view.active;
  }

  /** Settles once the webview is ready, and has taken the focus it was shown with. */
  get ready(): Promise<void> {
    return this.view.ready;
  }

  /** The state last sent to the webview. */
  get sent(): ShownTimeline {
    return this.view.sent;
  }

  /** The state the webview last rendered, once it has rendered the latest one. */
  get rendered(): ShownTimeline | undefined {
    return this.view.rendered;
  }

  /** Whether a body the panel was sent links to the URL. */
  hasLink(url: string): boolean {
    return this.view.hasLink(url);
  }

  /** The URI the webview loads a local file by. */
  webviewUri(file: vscode.Uri): string {
    return this.view.webview.asWebviewUri(file).toString();
  }

  /** Handles a message from the webview; the tests send clicks through here too. */
  receive(message: FromWebview): void {
    if (this.view.handshake(message)) return;
    if (message.type === "openLink") {
      if (typeof message.url === "string") this.onAction(message);
    } else if (message.type === "openReference") {
      const { path, startLine, endLine } = message;
      if (
        typeof path === "string" &&
        Number.isInteger(startLine) &&
        Number.isInteger(endLine)
      )
        this.onAction({ type: "openReference", path, startLine, endLine });
    } else if (message.type === "openFile") {
      if (typeof message.path === "string")
        this.onAction({ type: "openFile", path: message.path });
    } else if (message.type === "openSite") {
      const { path, side, line, endLine, missed } = message;
      if (
        typeof path === "string" &&
        (side === "head" || side === "base") &&
        Number.isInteger(line) &&
        Number.isInteger(endLine) &&
        typeof missed === "boolean"
      )
        this.onAction({ type: "openSite", path, side, line, endLine, missed });
    } else if (message.type === "submit") {
      const { verdict, summary } = message;
      if (isVerdict(verdict) && typeof summary === "string")
        this.onAction({ type: "submit", verdict, summary });
    } else if (message.type === "openPending") {
      if (Number.isInteger(message.index))
        this.onAction({ type: "openPending", index: message.index });
    } else if (message.type === "findExtension") {
      if (typeof message.extension === "string")
        this.onAction({ type: "findExtension", extension: message.extension });
    } else if (
      [
        "refresh",
        "suggestReadingOrder",
        "finish",
        "cancelSubmit",
        "submitAction",
        "nextFile",
        "ask",
        "codeFlow",
        "showChangesSince",
        "skimSetting",
        "takeAction",
        "takeRetry",
        "trust",
        "closeChange",
        "copyBrief",
        "showBrief",
        "discard",
        "problemAction",
        "dismissUnhighlighted",
      ].includes(message.type)
    )
      this.onAction({ type: message.type } as OverviewAction);
  }

  update(state: TimelineState): void {
    this.view.update(state);
  }

  /** Brings the panel forward; with `focus`, gives it the focus. */
  reveal(focus = false): void {
    this.view.reveal(!focus);
  }

  /** The editor column the panel is in, while it is shown. */
  get viewColumn(): vscode.ViewColumn | undefined {
    return this.view.viewColumn;
  }

  dispose(): void {
    this.view.dispose();
  }
}

/**
 * Renders the Assistant's take, whose `path:line` references to the
 * Change's files open them, and each description, Comment and review body.
 */
function shown(
  state: TimelineState,
  render: RenderInto,
  isChangedFile: (path: string) => boolean
): ShownTimeline {
  const items = state.items.map((item) =>
    item.kind === "commit" || !item.body
      ? item
      : { ...item, html: render(item.body) }
  );
  const text = state.take.text;
  if (!text) return { ...state, take: state.take, items };
  const sentences = sentencesOf(text);
  const short = sentences.slice(0, maxSentences).join(" ");
  const start = findReferences(text).find((ref) => isChangedFile(ref.path));
  const take = {
    ...state.take,
    html: render(short, { references: isChangedFile }),
    ...(sentences.length > maxSentences && {
      fullHtml: render(text, { references: isChangedFile }),
    }),
    ...(start && {
      start: {
        path: start.path,
        startLine: start.startLine,
        endLine: start.endLine,
      },
    }),
  };
  return { ...state, take, items };
}

/** The most sentences of the Assistant's take the overview shows before Show all. */
const maxSentences = 3;

/**
 * The sentences of a short paragraph: a split after `.`, `!` or `?` and a
 * space, before what starts a sentence. A path such as `util.py` has no
 * space after its dot, so it stays whole.
 */
function sentencesOf(text: string): string[] {
  return text
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z`*_(\[])/)
    .filter(Boolean);
}

/**
 * The styles of the overview, a page in the main column: a centred column
 * under a sticky header, which scrolling to the focus keeps clear of (WCAG
 * 2.4.11), the theme's buttons, the facts line, status pills, and rows with
 * an avatar and a hairline below.
 */
export const pageStyles = `
  html { scroll-padding-top: 9em; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 0 24px 24px; max-width: 64em; margin: 0 auto; }
  header { position: sticky; top: 0; z-index: 1; background: var(--vscode-editor-background); padding: 12px 0 8px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
  header .heading { flex: 1 1 16em; min-width: 0; }
  /* The masthead: the title is the page's one large line, in ink rather than link blue. */
  h1 { font-size: 1.6em; line-height: 1.25; margin: 0 0 4px; overflow-wrap: anywhere; text-wrap: balance; }
  h1 .link { color: inherit; font-weight: inherit; }
  h1 .link:hover { color: var(--vscode-textLink-foreground); text-decoration: underline; text-underline-offset: 3px; }
  h2 { font-size: 1em; margin: 16px 0 8px; }
  .muted { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  button.icon { background: none; border: none; padding: 4px; border-radius: 2px; color: var(--vscode-icon-foreground, var(--vscode-foreground)); cursor: pointer; display: inline-flex; }
  button.icon:hover { background: var(--vscode-toolbar-hoverBackground); }
  button.icon svg { width: 16px; height: 16px; }
  .link { background: none; border: none; padding: 0; color: var(--vscode-textLink-foreground); cursor: pointer; font: inherit; text-align: start; text-decoration: none; }
  .link:hover { text-decoration: underline; }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .key { font-family: var(--vscode-editor-font-family); font-size: 0.85em; margin-left: 6px; }
  header .actions { flex: none; align-items: center; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); padding: 2px 8px; border-radius: 2px; cursor: pointer; font: inherit; }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground)); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); padding: 4px 12px; border-radius: 2px; cursor: pointer; font: inherit; }
  /* The header's button keeps the secondary's padding when it fills, so the header doesn't change height. */
  header button.primary { padding: 2px 8px; }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  .facts { font-variant-numeric: tabular-nums; }
  /* How big, and is it healthy: the first answer under the title, at headline size. */
  #facts { font-size: 1.25em; margin: 0 0 6px; }
  #facts .sep { color: var(--vscode-descriptionForeground); }
  #facts .mark { margin-right: 0.25em; }
  #facts .passed .mark { color: color-mix(in srgb, var(--vscode-testing-iconPassed) 70%, var(--vscode-foreground)); }
  #facts .failed .mark { color: var(--vscode-testing-iconFailed); }
  /* Below the masthead, sections are headed as the editor heads its own views, so the history recedes. */
  #checksHeading, #history, .order h3 { font-size: 0.85em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
  #checksHeading, #history { margin: 24px 0 8px; }
  #checksHeading code { font-family: var(--vscode-editor-font-family); text-transform: none; letter-spacing: 0; font-weight: 600; color: inherit; background: none; padding: 0; }
  .facts .added { color: var(--vscode-gitDecoration-addedResourceForeground); color: color-mix(in srgb, var(--vscode-gitDecoration-addedResourceForeground) 60%, var(--vscode-foreground)); }
  .facts .deleted { color: var(--vscode-gitDecoration-deletedResourceForeground); color: color-mix(in srgb, var(--vscode-gitDecoration-deletedResourceForeground) 60%, var(--vscode-foreground)); }
  ul { list-style: none; padding: 0; margin: 0; }
  .status { font-size: 0.85em; padding: 0 6px; border-radius: 8px; border: 1px solid var(--vscode-descriptionForeground); }
  .status.passed { border-color: var(--vscode-testing-iconPassed); }
  .status.failed { border-color: var(--vscode-testing-iconFailed); }
  .status.running { border-color: var(--vscode-testing-iconQueued); }
  .status.skipped, .status.neutral { color: var(--vscode-descriptionForeground); }
  .item { display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--vscode-panel-border); }
  .item img, .item .no-avatar { width: 24px; height: 24px; border-radius: 50%; flex: none; background: var(--vscode-editor-inactiveSelectionBackground); outline: 1px solid var(--vscode-contrastBorder, var(--vscode-panel-border)); outline-offset: -1px; }
  .item .content { flex: 1; min-width: 0; }
  .item .author { font-weight: 600; }
  #byline span { display: inline-block; max-width: 100%; overflow-wrap: anywhere; }
  .overview .actions button { max-width: 100%; overflow-wrap: anywhere; text-align: start; }
  .overview { padding: 16px 0 14px; border-bottom: 1px solid var(--vscode-panel-border); }
  .overview p { margin: 0 0 4px; }
  .overview .actions { margin-top: 12px; }
${reviewStyles}
  /* A link standing alone is a target of its own: give it height to hit. */
  .link.more, .link.file, #showTake { padding-block: 4px; }
  /* In a narrow column, such as beside code, the sticky header shouldn't take the screen. */
  @media (max-width: 640px) { h1 { font-size: 1.3em; } #facts { font-size: 1.1em; } }`;

function html(cspSource: string): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">${sharedStyles}${pageStyles}
  #highlighting { margin: 0; padding: 10px 0; border-bottom: 1px solid var(--vscode-panel-border); }
  #highlighting code { font-family: var(--vscode-editor-font-family); }
  #hiddenText { margin: 0; padding: 10px 0; border-bottom: 1px solid var(--vscode-panel-border); }
  #hiddenText ul { margin: 4px 0 0; padding-left: 1.4em; }
  #hiddenText li { margin: 2px 0; overflow-wrap: anywhere; }
  #start code { font-family: var(--vscode-editor-font-family); color: inherit; background: none; padding: 0; }
  .overview .hand { margin-top: 14px; }
  .take .speaker .label { font-weight: 400; color: var(--vscode-descriptionForeground); }
  .take .speaker .label .link { text-decoration: underline; text-underline-offset: 2px; }
  .take .markdown { line-height: 1.5; max-width: 40em; }
  .take .more { margin-top: 4px; font-size: 0.9em; }
  .take .reading { font-style: italic; }
  .problem-line .link { margin-left: 4px; }
  /* A link inside a sentence is underlined, so it doesn't rely on color alone. */
  .problem-line .link, #standing .link, #highlighting .link, #orderNote .link { text-decoration: underline; text-underline-offset: 2px; }
  .order h3 { margin: 16px 0 4px; }
  .order ol { margin: 0; padding-left: 1.6em; }
  .order ol > li { margin: 6px 0 0; }
  .order .step { font-weight: 600; }
  .order ul li { display: flex; flex-wrap: wrap; gap: 0 6px; align-items: baseline; padding: 1px 0; }
  .order .mark { width: 1em; flex: none; }
  .order .file { font-family: var(--vscode-editor-font-family); overflow-wrap: anywhere; }
  .order .viewed .file, .order .skim .file { color: var(--vscode-descriptionForeground); }
  .order .tag { font-size: 0.85em; font-weight: 400; margin-left: 4px; padding: 0 6px; border-radius: 8px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); }
  .order summary.step { cursor: pointer; }
  .order .skimNote { margin: 2px 0 4px; }
  .order .skimNote .link { text-decoration: underline; text-underline-offset: 2px; }
  .order .reading { font-style: italic; }
  .repeats { margin-top: 16px; }
  .repeats summary { cursor: pointer; }
  .repeats .sample { margin: 2px 0 2px; font-family: var(--vscode-editor-font-family); overflow-wrap: anywhere; white-space: pre-wrap; color: var(--vscode-descriptionForeground); }
  .repeats .sites { margin-top: 2px; }
  #repeatsNote { margin: 2px 0 4px; }
  #checksSummary { margin: 0 0 4px; }
  #checks .more { margin-top: 4px; font-size: 0.9em; }
  .checks li { display: flex; flex-wrap: wrap; gap: 0 8px; align-items: baseline; padding: 2px 0; }
  .checks .name { flex: 0 1 auto; min-width: 0; overflow-wrap: anywhere; }
  .item .body { white-space: pre-wrap; line-height: 1.5; margin-top: 6px; overflow-wrap: anywhere; }
  .item .body.markdown { white-space: normal; }
  .item.commit .sha { font-family: var(--vscode-editor-font-family); }
  #historyProblem { margin: 0 0 8px; }
  .submit { padding: 12px 0 14px; border-bottom: 1px solid var(--vscode-panel-border); }
  .submit h2 { margin-top: 0; }
  .submit fieldset { border: none; margin: 0; padding: 0; }
  .submit .choice { display: flex; gap: 6px; align-items: baseline; padding: 2px 0; cursor: pointer; }
  .submit .choice input { margin: 0; flex: none; accent-color: var(--vscode-contrastActiveBorder, var(--vscode-button-background)); }
  .submit .choice input:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  body.vscode-dark, body.vscode-high-contrast { color-scheme: dark; }
  body.vscode-light, body.vscode-high-contrast-light { color-scheme: light; }
  .submit .choice .label { flex: none; }
  .submit .choice.only { padding: 2px 0; }
  #morePending { margin-top: 4px; font-size: 0.9em; }
  .submit .choice .muted { min-width: 0; }
  .submit .field { display: block; margin: 12px 0 4px; }
  .submit textarea { display: block; box-sizing: border-box; width: 100%; max-width: 40em; }
  .submit .pending h3 { font-size: 1em; font-weight: 400; margin: 12px 0 4px; }
  .submit .pending li { display: flex; flex-wrap: wrap; gap: 0 8px; align-items: baseline; padding: 1px 0; }
  .submit .pending .file { font-family: var(--vscode-editor-font-family); overflow-wrap: anywhere; }
  .submit .pending .muted { min-width: 0; overflow-wrap: anywhere; }
  .submit .actions { margin-top: 12px; align-items: baseline; }
  .submit button[aria-disabled="true"], header button[aria-disabled="true"] { opacity: 0.5; cursor: default; }
  .result { padding: 12px 0 14px 12px; border-bottom: 1px solid var(--vscode-panel-border); border-left: 2px solid var(--vscode-descriptionForeground); }
  .result.passed { border-left-color: var(--vscode-testing-iconPassed); }
  .result.failed { border-left-color: var(--vscode-testing-iconFailed); }
  .result .verdict.done { font-weight: 600; }
  #showTake { margin-top: 12px; }
  .result p { margin: 0 0 8px; line-height: 1.5; }
  .result .verdict .mark { margin-right: 4px; }
  .result .actions { align-items: baseline; }
  .result .reading { font-style: italic; color: var(--vscode-descriptionForeground); }
  #resultProblem:empty, #resultText:empty { display: none; }
  #resultProblem { margin: 0 0 8px; }
  #resultProblem .mark { color: var(--vscode-testing-iconFailed); margin-right: 4px; }
  #submitProblem:empty, #submitReason:empty, #submitNote:empty { display: none; }
  #submitProblem { margin-top: 8px; }
  #submitProblem .mark { color: var(--vscode-testing-iconFailed); margin-right: 4px; }
  #submitProblem .detail { margin-top: 4px; font-size: 0.9em; color: var(--vscode-descriptionForeground); }
  #submitProblem .detail summary { cursor: pointer; color: var(--vscode-textLink-foreground); text-decoration: underline; text-underline-offset: 2px; }
  #submitProblem .detail code { display: block; margin-top: 2px; font-family: var(--vscode-editor-font-family); overflow-wrap: anywhere; white-space: pre-wrap; }
  #submitNote { margin: 2px 0 0; }
  #submitNote.warning { color: var(--vscode-foreground); margin-top: 6px; }
  #submitNote .mark { color: var(--vscode-testing-iconFailed); margin-right: 4px; }
  #submitReason { margin-top: 4px; }
</style>
</head>
<body>
${catSymbol}
<header>
  <div class="heading"><h1 id="title"></h1><div class="muted" id="byline"></div></div>
  <div class="actions">
    <button class="icon" id="refresh" title="Load the overview again" aria-label="Refresh"><svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M4.681 3H2V2h3.5l.5.5V6H5V4a5 5 0 1 0 4.53-.761l.302-.954A6 6 0 1 1 4.681 3z"/></svg></button>
    <button class="secondary" id="viewOnGitHub" hidden>View on GitHub</button>
    <button class="secondary" id="finish"></button>
  </div>
</header>
<section class="result" id="result" aria-label="Review result" hidden>
  <p class="verdict" id="resultText"></p>
  <div class="problem-line" id="resultProblem" role="alert"></div>
  <div class="actions" id="resultActions"></div>
</section>
<section class="submit" id="submitStep" aria-labelledby="submitHeading" hidden>
  <h2 id="submitHeading">Your Review</h2>
  <fieldset id="verdicts"><legend class="visually-hidden">Verdict</legend></fieldset>
  <div class="muted" id="submitNote" role="status"></div>
  <label class="field" for="summary">Summary <span class="muted">shown with your Review</span></label>
  <textarea id="summary" rows="3" aria-describedby="submitReason"></textarea>
  <div class="muted" id="submitReason" role="status"></div>
  <div class="pending" id="pending"><h3 id="pendingHeading"></h3><ul id="pendingComments" aria-labelledby="pendingHeading"></ul><button class="link more" id="morePending" type="button" aria-controls="pendingComments" aria-expanded="false" hidden></button></div>
  <div class="problem-line" id="submitProblem" role="alert"></div>
  <div class="actions">
    <button class="primary" id="submitReview" type="button" aria-label="Submit Review to GitHub" aria-describedby="submitReason" title="Publish your Review to GitHub (Ctrl+Enter)">Submit Review</button>
    <button class="secondary" id="cancelSubmit" type="button">Cancel</button>
    <button class="link" id="discardPending" type="button" title="Delete your pending Comments without publishing them" hidden>Discard pending Comments…</button>
  </div>
</section>
<div class="visually-hidden" id="announce" role="status"></div>
<section class="overview" aria-label="Overview">
  <p class="facts" id="facts" hidden></p>
  <p class="muted" id="standing" hidden></p>
  <div id="hiddenText" role="status" hidden></div>
  <button class="link" id="showTake" type="button" aria-controls="take" aria-expanded="false" hidden></button>
  <div class="hand">
    <div class="take">
      <h2 class="speaker">${catMark}Assistant<span class="label" id="takeLabel"></span></h2>
      <div class="markdown" id="take"></div>
      <button class="link more" id="more" type="button" aria-controls="take" aria-expanded="false" hidden>Show all</button>
      <div role="status" id="takeStatus">
        <div class="muted reading" id="reading"></div>
        <div class="muted problem-line" id="takeProblem" hidden></div>
      </div>
    </div>
    <div class="order" id="order" hidden>
      <h3>Reading Order</h3>
      <div class="muted" id="orderNote" role="status"></div>
      <ol id="orderSteps"></ol>
    </div>
    <details class="order repeats" id="repeats" hidden>
      <summary class="step" id="repeatsSummary"></summary>
      <div class="muted" id="repeatsNote" role="status"></div>
      <ol id="repeatList"></ol>
    </details>
  </div>
  <div class="actions" id="ways">
    <button class="primary" id="start" type="button" hidden></button>
    <button class="secondary" id="nextFile" type="button" hidden></button>
    <button class="secondary" id="ask" type="button" title="Open the Assistant's chat about this Change"></button>
    <button class="secondary" id="codeFlow" type="button" title="Show the calls to and from the changed code"></button>
  </div>
</section>
<section id="checks" hidden><h2 id="checksHeading"></h2><p class="muted facts" id="checksSummary"></p><ul class="checks" id="checkRuns"></ul><button class="link more" id="moreChecks" type="button" aria-controls="checkRuns" aria-expanded="false" hidden></button></section>
<p class="muted" id="highlighting" hidden></p>
<div class="progress" id="progress" aria-hidden="true" hidden></div>
<section aria-labelledby="history"><h2 id="history"></h2><div class="muted" id="loading" role="status"></div><div class="muted problem-line" id="historyProblem" role="status" hidden></div><div id="items" role="list"></div></section>
<script nonce="${nonce}">${sharedScript}
  const vscode = acquireVsCodeApi();
  const byId = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  // A web link, which the body's click handler opens through the extension.
  const link = (text, url) => {
    const a = el("a", "link", text);
    a.dataset.href = url;
    a.tabIndex = 0;
    a.setAttribute("role", "link");
    return a;
  };
  const textButton = (text, onClick) => {
    const button = el("button", "link", text);
    button.type = "button";
    button.addEventListener("click", onClick);
    return button;
  };
  // A button's key shows beside its label, in the Reviewer's own notation;
  // the key isn't part of the name a screen reader gives the button.
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
  // The default chord, in the Reviewer's own notation; a rebinding isn't known here.
  const keyOf = (letter) => (mac ? "⌃⌥R " : "Ctrl+Alt+R ") + letter;
  function setLabel(node, text, letter) {
    const said = text + "\0" + letter;
    if (node.dataset.label === said) return;
    node.dataset.label = said;
    const key = el("span", "key", keyOf(letter));
    key.setAttribute("aria-hidden", "true");
    node.replaceChildren(text, key);
    node.setAttribute("aria-label", text);
  }
  const when = (iso) => {
    const date = new Date(iso);
    return isNaN(date) ? "" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  };
  const verbs = {
    description: "opened this pull request",
    commit: "committed",
    comment: "commented",
    approved: "approved these changes",
    changesRequested: "requested changes",
    commented: "reviewed",
    dismissed: "reviewed (dismissed)",
  };
  for (const type of ["refresh", "nextFile", "ask", "codeFlow"])
    byId(type).addEventListener("click", () => vscode.postMessage({ type }));
  byId("viewOnGitHub").addEventListener("click", () => {
    if (lastState && lastState.url) vscode.postMessage({ type: "openLink", url: lastState.url });
  });
  byId("finish").addEventListener("click", () => {
    if (lastState && notReady(lastState)) return;
    vscode.postMessage({ type: "finish" });
  });
  // Links and file references open through the extension, which checks them.
  document.body.addEventListener("click", (event) => {
    const a = event.target instanceof Element ? event.target.closest("a[data-href], a[data-path]") : null;
    if (!a) return;
    event.preventDefault();
    if (a.dataset.href) vscode.postMessage({ type: "openLink", url: a.dataset.href });
    else vscode.postMessage({
      type: "openReference",
      path: a.dataset.path,
      startLine: Number(a.dataset.start),
      endLine: Number(a.dataset.end),
    });
  });
  document.body.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target instanceof HTMLAnchorElement) event.target.click();
  });
  const focusable = (root) => {
    for (const a of root.querySelectorAll("a[data-href], a[data-path]")) {
      a.tabIndex = 0;
      a.setAttribute("role", "link");
    }
  };

  function item(entry) {
    const row = el("div", "item " + entry.kind);
    row.setAttribute("role", "listitem");
    if (entry.author.avatar) {
      const img = el("img");
      img.src = entry.author.avatar;
      img.alt = "";
      row.append(img);
    } else {
      row.append(el("div", "no-avatar"));
    }
    const content = el("div", "content");
    const line = el("div");
    line.append(el("span", "author", entry.author.login), " ");
    line.append(verbs[entry.kind === "review" ? entry.verdict : entry.kind] || "", " ");
    line.append(el("span", "muted", when(entry.date)));
    content.append(line);
    if (entry.kind === "commit") {
      const commit = el("div", "body");
      commit.append(el("span", "sha", entry.sha), " ", entry.headline);
      content.append(commit);
    } else if (entry.html !== undefined) {
      const body = el("div", "body markdown");
      // Rendered and sanitised by the extension; see renderMarkdown.
      body.innerHTML = entry.html;
      focusable(body);
      content.append(body);
    } else if (entry.body) {
      content.append(el("div", "body", entry.body));
    } else if (entry.kind === "description") {
      content.append(el("div", "body muted", "No description provided."));
    }
    if (entry.kind === "review" && entry.comments > 0) {
      content.append(el("div", "muted", entry.comments === 1 ? "1 Comment on the diff" : entry.comments + " Comments on the diff"));
    }
    row.append(content);
    return row;
  }

  // Running checks have no verdict yet, so no mark.
  const checkMarks = { passed: "✓", failed: "✗" };
  function facts(state) {
    const node = byId("facts");
    const parts = [];
    if (state.size) {
      const { files, additions, deletions } = state.size;
      const size = el("span");
      const shown = el("span");
      shown.setAttribute("aria-hidden", "true");
      shown.append(files + (files === 1 ? " file" : " files"), el("span", "sep", " · "), el("span", "added", "+" + additions), " ", el("span", "deleted", "−" + deletions));
      size.append(shown, el("span", "visually-hidden", files + (files === 1 ? " file, " : " files, ") + additions + " lines added, " + deletions + " removed"));
      parts.push(size);
    }
    if (state.checks && state.checks.status) {
      const status = state.checks.status;
      const health = el("span", status);
      if (checkMarks[status]) {
        const mark = el("span", "mark", checkMarks[status]);
        mark.setAttribute("aria-hidden", "true");
        health.append(mark);
      }
      health.append("checks " + status);
      parts.push(health);
    }
    node.hidden = parts.length === 0;
    node.replaceChildren();
    parts.forEach((part, i) => node.append(...(i ? [el("span", "sep", " · "), part] : [part])));
  }

  const reviewMarks = { approved: "✓", changesRequested: "✗", commented: "•", briefed: "✓" };
  function standing(state) {
    const node = byId("standing");
    const notes = state.standing;
    // While the result block says how the Review ended, it isn't said twice.
    const review = state.review && !showing(state) ? state.review : undefined;
    node.hidden = notes.length === 0 && !review && !state.navigationOff;
    const said = JSON.stringify([notes, review, state.navigationOff]);
    if (node.dataset.said === said) return;
    node.dataset.said = said;
    node.replaceChildren();
    const parts = [];
    if (review) {
      const span = el("span", "review " + review.verdict);
      const mark = el("span", "mark", reviewMarks[review.verdict]);
      mark.setAttribute("aria-hidden", "true");
      span.append(mark, " ", review.text);
      parts.push(span);
    }
    parts.push(...notes.map((note) => typeof note === "string" ? note : sinceButton(note.text)));
    if (state.navigationOff) {
      const off = el("span", "", "Navigation off: ");
      const trust = textButton("Trust the review window…", () => vscode.postMessage({ type: "trust" }));
      trust.title = "The review window is in Restricted Mode, so go to definition and other code navigation are off";
      off.append(trust);
      parts.push(off);
    }
    parts.forEach((part, i) => node.append(...(i ? [" · "] : []), part));
  }

  // Words about the commits since the Reviewer's Review, which open their diff.
  function sinceButton(text) {
    const button = textButton(text, () => vscode.postMessage({ type: "showChangesSince" }));
    button.title = "Open the diff of what changed since your Review (" + keyOf("C") + ")";
    return button;
  }

  // Says where the Change holds text the Reviewer can't see, which the
  // Assistant also reads, so both see the same text.
  function hiddenText(state) {
    const node = byId("hiddenText");
    const places = state.hiddenText || [];
    node.hidden = places.length === 0;
    const said = JSON.stringify(places);
    if (node.dataset.said === said) return;
    node.dataset.said = said;
    node.replaceChildren();
    if (places.length === 0) return;
    const list = el("ul");
    for (const place of places) list.append(el("li", "", place));
    node.append(
      el("strong", "", "Hidden text. "),
      "This Change holds text that nothing here shows you. The Assistant gets it as escapes, or not at all for an HTML comment, and reads it as data.",
      list
    );
  }

  // Offers to search the Extensions view for each file extension no
  // installed language highlights; the Reviewer chooses what to install.
  function highlighting(state) {
    const node = byId("highlighting");
    const extensions = state.unhighlighted || [];
    node.hidden = extensions.length === 0 || stepsBack(state);
    const said = JSON.stringify(extensions);
    if (node.dataset.said === said) return;
    node.dataset.said = said;
    node.replaceChildren();
    if (extensions.length === 0) return;
    node.append("No syntax highlighting for ");
    extensions.forEach((extension, i) => {
      if (i) node.append(i === extensions.length - 1 ? " and " : ", ");
      node.append(el("code", "", extension));
    });
    node.append(" files. ");
    const find = (extension, label) => {
      const button = textButton(label, () => vscode.postMessage({ type: "findExtension", extension }));
      button.title = "Search the Extensions view for " + extension.slice(1);
      button.setAttribute("aria-label", "Find an Extension for " + extension + " files");
      return button;
    };
    if (extensions.length === 1) node.append(find(extensions[0], "Find an Extension"));
    else {
      node.append("Find an Extension: ");
      extensions.forEach((extension, i) => node.append(...(i ? [", "] : []), find(extension, extension)));
    }
    node.append(" · ", textButton("Don't ask again", () => vscode.postMessage({ type: "dismissUnhighlighted" })));
  }

  let showAll = false;
  let lastTake;
  let lastState;
  byId("more").addEventListener("click", () => {
    showAll = !showAll;
    keepFocus(() => take(lastTake));
  });
  byId("start").addEventListener("click", () => {
    const start = lastTake && lastTake.take.start;
    if (start) vscode.postMessage({ type: "openReference", ...start });
  });
  function take(state) {
    lastTake = state;
    const t = state.take;
    // The heading names the Assistant; a take since a Review says so after,
    // and opens the diff of what it explains.
    const label = byId("takeLabel");
    const labelled = JSON.stringify([t.label, !!t.since]);
    if (label.dataset.said !== labelled) {
      label.dataset.said = labelled;
      if (t.label === "Assistant") label.replaceChildren();
      else label.replaceChildren("· ", t.since ? sinceButton(t.label) : t.label);
    }
    const body = byId("take");
    const html = showAll && t.fullHtml !== undefined ? t.fullHtml : t.html;
    if (html === undefined) body.replaceChildren();
    else if (body.dataset.html !== html) {
      // Rendered and sanitised by the extension; see renderMarkdown.
      body.innerHTML = html;
      focusable(body);
    }
    body.dataset.html = html === undefined ? "" : html;
    const more = byId("more");
    more.hidden = t.fullHtml === undefined;
    setText(more, showAll ? "Show less" : "Show all");
    more.setAttribute("aria-expanded", String(showAll));
    setText(byId("reading"), t.reading
      ? (t.text ? "" : "Reading the Change…")
      : (!t.text && !t.problem ? "The Assistant hasn't summarised this Change." : ""));
    const problem = byId("takeProblem");
    problem.hidden = !t.problem;
    const said = JSON.stringify([t.problem, t.problemAction, t.canRetry]);
    if (problem.dataset.said !== said) {
      problem.dataset.said = said;
      problem.replaceChildren();
      if (t.problem) {
        appendWithCode(problem, t.problem);
        if (t.problemAction) problem.append(" ", textButton(t.problemAction, () => vscode.postMessage({ type: "takeAction" })));
        if (t.canRetry) problem.append(t.problemAction ? " · " : " ", textButton("Retry", () => vscode.postMessage({ type: "takeRetry" })));
      }
    }
  }

  function readingOrder(state) {
    const order = state.readingOrder;
    byId("order").hidden = !order;
    if (!order) return;
    const said = JSON.stringify(order);
    const node = byId("order");
    if (node.dataset.said === said) return;
    node.dataset.said = said;
    // The note is a live region, so it changes only when its words do.
    const note = byId("orderNote");
    const noted = JSON.stringify([order.writing, order.outOfDate, order.problem]);
    if (note.dataset.said !== noted) {
      note.dataset.said = noted;
      note.replaceChildren();
      note.className = order.writing ? "muted reading" : "muted";
      if (order.writing) note.append("Choosing an order to read the files in…");
      else if (order.problem) note.append("The Assistant couldn't order the files, so they stay as they are in the Change. ", textButton("Try again", () => vscode.postMessage({ type: "suggestReadingOrder" })));
      else if (order.outOfDate) note.append("Suggested before the latest commits, which are in the last step. ", textButton("Suggest again", () => vscode.postMessage({ type: "suggestReadingOrder" })));
    }
    // The skim-only step starts collapsed, and stays as the Reviewer left it.
    const skimOpen = byId("orderSteps").querySelector("details")?.open === true;
    byId("orderSteps").replaceChildren(...order.steps.map((step) => {
      const li = el("li");
      const heading = el("div", "step", step.label);
      if (step.core) heading.append(" ", el("span", "tag", "Core of the change"));
      const files = el("ul");
      files.append(...step.files.map((file) => {
        const row = el("li", [file.viewed ? "viewed" : "", file.skim ? "skim" : ""].join(" ").trim());
        const mark = el("span", "mark", file.viewed ? "✓" : "");
        mark.setAttribute("aria-hidden", "true");
        const open = textButton(file.path, () => vscode.postMessage({ type: "openFile", path: file.path }));
        open.classList.add("file");
        open.title = "Open the diff of " + file.path;
        // The ✓ is hidden from screen readers, so the name says it.
        open.setAttribute("aria-label", file.path + (file.skim ? ", skim-only: " + file.skim : "") + (file.viewed ? ", viewed" : ", not viewed"));
        row.append(mark, open);
        if (file.skim) row.append(el("span", "muted", "skim-only: " + file.skim));
        if (file.why) row.append(el("span", "muted", file.why));
        return row;
      }));
      if (step.skimOnly) {
        const details = el("details");
        details.open = skimOpen;
        // What Next unviewed file does with these is said where they are.
        const note = el("div", "muted skimNote", "Next unviewed file leaves these until last, unless ");
        const setting = textButton("Visit Skim Only Files", () => vscode.postMessage({ type: "skimSetting" }));
        setting.title = "Open the setting in Settings";
        note.append(setting, " is on.");
        details.append(el("summary", "step", step.label + " (" + step.files.length + ")"), note, files);
        li.append(details);
      } else {
        li.append(heading, files);
      }
      return li;
    }));
  }

  // The Repeated edits section opens when an edit has a differing or a missed
  // site, and stays as the Reviewer left it once they have opened or closed it.
  byId("repeatsSummary").addEventListener("click", () => { byId("repeats").dataset.touched = "true"; });
  function repeatedEdits(state) {
    const shown = state.repeatedEdits;
    const node = byId("repeats");
    node.hidden = !shown;
    if (!shown) return;
    const said = JSON.stringify(shown);
    if (node.dataset.said === said) return;
    node.dataset.said = said;
    if (!node.dataset.touched) node.open = shown.open;
    byId("repeatsSummary").textContent = "Repeated edits (" + shown.edits.length + ")";
    const note = byId("repeatsNote");
    note.textContent = shown.checked === "pending" ? "Still checking the rest of the repository for places that missed the edit."
      : shown.checked === "partial" ? "The repository took too long to read, so places that missed the edit weren't fully checked."
      : "";
    note.hidden = !note.textContent;
    const siteButton = (site, missed) => {
      const where = site.path + ":" + site.line + (site.endLine > site.line ? "-" + site.endLine : "");
      const open = textButton(where, () => vscode.postMessage({ type: "openSite", path: site.path, side: site.side, line: site.line, endLine: site.endLine, missed }));
      open.classList.add("file");
      open.title = missed ? "Open " + site.path + " at the lines that still hold the old code" : "Open the diff of " + site.path + " at this edit";
      return open;
    };
    byId("repeatList").replaceChildren(...shown.edits.map((edit) => {
      const li = el("li");
      li.append(el("div", "step", edit.summary));
      if (edit.removed.length || edit.added.length) {
        // A line to each div: a newline in this template would end the script's string.
        const sample = el("div", "sample");
        sample.append(...edit.removed.map((l) => el("div", "", "- " + l)), ...edit.added.map((l) => el("div", "", "+ " + l)));
        li.append(sample);
      }
      const sites = el("ul", "sites");
      const row = (label, buttons, more) => {
        const item = el("li");
        item.append(el("span", "muted", label), ...buttons);
        if (more) item.append(el("span", "muted", "and " + more + " more"));
        sites.append(item);
      };
      if (edit.differing.length) row("Differs here:", edit.differing.map((site) => siteButton(site, false)));
      if (edit.missed.length) row("Still holds the old code:", edit.missed.map((site) => siteButton(site, true)), edit.moreMissed);
      li.append(sites);
      return li;
    }));
  }

  // The way in is the filled button until every file is viewed; then
  // finishing the Review is.
  function ways(state) {
    const t = state.take;
    const progress = state.progress;
    // Once the Review is submitted, or covers the head with nothing pending,
    // the way in steps back with the finishing button.
    const back = stepsBack(state);
    const reading = (!progress || progress.viewed < progress.total) && !back && !state.finished;
    const start = byId("start");
    start.hidden = !t.start || back;
    if (t.start) {
      const lines = t.start.startLine + (t.start.endLine > t.start.startLine ? "-" + t.start.endLine : "");
      const where = t.start.path + ":" + lines;
      if (start.dataset.where !== where) {
        start.dataset.where = where;
        start.replaceChildren("Start at ", el("code", "", t.start.path.split("/").pop() + ":" + lines));
        start.title = "Open " + where + ", where the Assistant says to start";
      }
    }
    const next = byId("nextFile");
    setLabel(next, "Next unviewed file", "N");
    setLabel(byId("ask"), "Ask the Assistant", "A");
    setLabel(byId("codeFlow"), "Code Flow", "G");
    next.hidden = !progress || progress.viewed >= progress.total || back;
    next.title = "Open the diff of the next file you haven't viewed (" + keyOf("N") + ")";
    byId("ask").title = "Open the Assistant's chat about this Change (" + keyOf("A") + ")";
    byId("codeFlow").title = "Show the calls to and from the changed code (" + keyOf("G") + ")";
    const first = t.start ? start : next;
    start.className = reading && first === start ? "primary" : "secondary";
    next.className = reading && first === next ? "primary" : "secondary";
    const finish = byId("finish");
    // There is nothing to finish while the result block says how it ended,
    // and none while the Submit step is open: the step has its own Submit
    // Review, Cancel and Escape, so a second button of the same name would
    // do the opposite.
    finish.hidden = back || noBrief(state) || !!state.submit;
    setLabel(finish, state.finish, "S");
    if (state.finish.startsWith("Submit")) {
      finish.setAttribute("aria-expanded", "false");
      finish.setAttribute("aria-controls", "submitStep");
    } else {
      finish.removeAttribute("aria-expanded");
      finish.removeAttribute("aria-controls");
    }
    finish.setAttribute("aria-disabled", String(notReady(state)));
    finish.title = notReady(state) ? "Loading your Review…" : (state.finish.startsWith("Submit") ? "Submit your Review to GitHub" : "Write a Brief of your Comments for an agent") + " (" + keyOf("S") + ")";
    // While the Submit step is open, its own button is the one filled; once
    // a Review covers the head, there is nothing to finish.
    const allViewed = !!progress && progress.viewed >= progress.total;
    finish.className = allViewed && !state.submit && !back && !state.finished ? "primary" : "secondary";
  }

  // How the Review ended or stands, for the result block: a Brief being
  // written or waiting to be copied, a Review submitted or covering the head,
  // or a Brief that couldn't be written. Nothing while the Submit step is open.
  function resultOf(state) {
    if (state.submit) return;
    const brief = state.brief;
    if (brief && brief.phase === "writing") return "writing";
    if (brief && brief.phase === "written") return "written";
    if (state.submitted || state.finished) return "ended";
    if (clean(state)) return "clean";
    if (brief && brief.phase === "problem") return "problem";
  }
  // A local Change fully viewed with no Comments has nothing to brief: the
  // agent's work needs no changes, so there is only closing it.
  const isLocal = (state) => state.finish.startsWith("Write");
  const clean = (state) => isLocal(state) && state.pending === 0 && !!state.progress && state.progress.viewed >= state.progress.total;
  // Write Brief… has nothing to write from until a Comment exists.
  const noBrief = (state) => isLocal(state) && state.pending === 0;
  // Whether the result block shows what the Reviewer has done, so the way
  // in and the finishing button step back.
  const showing = (state) => resultOf(state) !== undefined;
  const stepsBack = (state) => ["writing", "written", "ended", "clean"].includes(resultOf(state));
  // The page of the Review just submitted, which the result block links to.
  const submittedUrl = (state) => resultOf(state) === "ended" && state.submitted ? state.submitted.url : undefined;
  // The way to the pull request on GitHub, for a pull request once it has
  // loaded. It steps back while the result block has a View on GitHub of its
  // own, so the page never has two buttons with the name.
  function viewOnGitHub(state) {
    const button = byId("viewOnGitHub");
    button.hidden = !state.url || !!submittedUrl(state);
    button.setAttribute("aria-label", "View on GitHub: " + state.title);
    button.title = "Open the pull request on GitHub";
  }
  const countOfComments = (n) => n === 1 ? "1 Comment" : n + " Comments";

  // Once the Reviewer is brought here to finish, the focus goes to the
  // filled button for the next step: finishing, or what follows it.
  let finishAsked = 0;
  function finishFocus(state) {
    if (state.finishAsked === undefined || state.finishAsked === finishAsked) return;
    finishAsked = state.finishAsked;
    const finish = byId("finish");
    const target = !finish.hidden ? finish : document.querySelector("#result button.primary");
    if (target) target.focus();
  }

  // While the result shows, the Assistant's take and Reading Order are
  // reference, so they fold behind one link, closed again each time.
  let takeOpen = false;
  let wasBack = false;
  function collapse(state) {
    const back = stepsBack(state);
    if (back !== wasBack) {
      wasBack = back;
      takeOpen = false;
    }
    const toggle = byId("showTake");
    toggle.hidden = !back;
    document.querySelector(".overview .hand").hidden = back && !takeOpen;
    setText(toggle, takeOpen ? "Hide the Assistant's take" : "Show the Assistant's take");
    toggle.setAttribute("aria-expanded", String(takeOpen));
  }
  byId("showTake").addEventListener("click", () => {
    takeOpen = !takeOpen;
    keepFocus(() => collapse(lastState));
  });

  function result(state) {
    const kind = resultOf(state);
    const node = byId("result");
    node.hidden = !kind;
    if (!kind) return;
    // The rule takes the result's state color.
    const tone = kind === "problem" ? "failed"
      : kind === "clean" ? "passed"
      : kind === "ended" ? (state.review && state.review.verdict === "changesRequested" ? "failed" : state.review && state.review.verdict === "commented" ? "" : "passed")
      : "";
    node.className = "result " + tone;
    const said = JSON.stringify([kind, state.submitted, state.review, state.brief]);
    if (node.dataset.said === said) return;
    node.dataset.said = said;
    const text = byId("resultText");
    const problem = byId("resultProblem");
    const actions = byId("resultActions");
    text.className = "verdict";
    text.replaceChildren();
    problem.replaceChildren();
    actions.replaceChildren();
    const brief = state.brief;
    const button = (className, label, message, title, id) => {
      const b = el("button", className, label);
      b.type = "button";
      if (id) b.id = id;
      if (title) b.title = title;
      b.addEventListener("click", () => vscode.postMessage(message));
      return b;
    };
    if (kind === "writing") {
      text.className = "reading";
      text.append("The Assistant is writing a Brief of " + countOfComments(brief.comments) + "…");
    } else if (kind === "written" && !brief.canShow) {
      // Its file was deleted, so there is nothing to copy: write it again.
      text.append("The file of the Brief of " + countOfComments(brief.comments) + " is gone. Write it again from your Comments.");
      actions.append(button("primary", "Write Brief…", { type: "finish" }, "Write the Brief again"));
      actions.append(textButton("Discard pending Comments…", () => vscode.postMessage({ type: "discard" })));
    } else if (kind === "written") {
      text.append("A Brief of " + countOfComments(brief.comments) + " is open in the editor. Read and edit it, then copy it for your agent.");
      actions.append(button("primary", "Copy Brief", { type: "copyBrief" }, "Copy the Brief, with your edits, which ends this Review"));
      actions.append(button("secondary", "Show Brief", { type: "showBrief" }, "Open the Brief in the editor"));
      actions.append(textButton("Discard pending Comments…", () => vscode.postMessage({ type: "discard" })));
    } else if (kind === "clean") {
      text.className = "verdict done review approved";
      const mark = el("span", "mark", "✓");
      mark.setAttribute("aria-hidden", "true");
      text.append(mark, "Nothing to brief. You found nothing to change.");
      actions.append(button("primary", "Stop Reviewing", { type: "closeChange" }, "Stop reviewing this Change: its worktrees and folders go, and this window closes if it was the last Change. Nothing changes on GitHub.", "closeChange"));
    } else if (kind === "ended") {
      const review = state.review;
      const done = state.submitted;
      const verdict = review ? review.verdict : "approved";
      text.className = "verdict done review " + verdict;
      const mark = el("span", "mark", reviewMarks[verdict] || "✓");
      mark.setAttribute("aria-hidden", "true");
      text.append(mark, done ? done.text.replace(/\.$/, "") : review ? review.text : "Your Review is submitted");
      actions.append(button("primary", "Back to Dashboard", { type: "closeChange" }, "Back to the Dashboard: this Change's worktrees and folders go, and this window closes if it was the last Change. Nothing changes on GitHub.", "closeChange"));
      // The Review so far may not be the last word: approve after requesting changes.
      if (!isLocal(state)) actions.append(button("secondary", "Submit Another Review…", { type: "finish" }, "Open the Submit step on this head, for a new verdict", "submitAnother"));
      const reviewUrl = submittedUrl(state);
      if (reviewUrl) actions.append(button("secondary", "View on GitHub", { type: "openLink", url: reviewUrl }, "Open your Review on GitHub", "viewSubmitted"));
      if (brief && brief.canShow) actions.append(button("secondary", "Show Brief", { type: "showBrief" }, "Open the Brief in the editor"));
    } else if (kind === "problem") {
      const mark = el("span", "mark", "✗");
      mark.setAttribute("aria-hidden", "true");
      problem.append(mark, brief.problem);
      actions.append(button("secondary", "Try again", { type: "finish" }, "Write the Brief again"));
    }
    // The result is said once, by the page's own status line, which is there
    // before the block fills; a problem is an alert of its own.
    if (kind !== "problem") setText(byId("announce"), text.textContent);
  }

  // The Submit step (ADR 0033). The verdict and summary are a draft the
  // webview keeps, so they outlive the panel being hidden or reloaded.
  const draft = Object.assign({ verdict: undefined, summary: "" }, vscode.getState() || {});
  const saveDraft = () => vscode.setState({ verdict: draft.verdict, summary: draft.summary });
  let asked = 0;
  let lastStep;
  const summary = byId("summary");
  summary.addEventListener("input", () => {
    draft.summary = summary.value;
    saveDraft();
    if (lastStep) submitButtons(lastStep);
  });
  // Ctrl+Enter submits from anywhere in the step, and Escape cancels it.
  byId("submitStep").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      byId("submitReview").click();
    } else if (event.key === "Escape" && lastStep && !lastStep.submitting) {
      event.preventDefault();
      byId("cancelSubmit").click();
    }
  });
  // Submit Review and Cancel are aria-disabled rather than disabled, so the
  // focus stays on them while GitHub takes the Review.
  byId("submitReview").addEventListener("click", () => {
    if (!lastStep || lastStep.submitting) return;
    const reason = reasonOf(lastStep);
    if (reason) return blocked(reason);
    vscode.postMessage({ type: "submit", verdict: draft.verdict, summary: draft.summary });
  });
  let allPending = false;
  byId("morePending").addEventListener("click", () => {
    allPending = !allPending;
    keepFocus(() => submitStep(lastState));
  });
  byId("discardPending").addEventListener("click", () => vscode.postMessage({ type: "discard" }));
  byId("cancelSubmit").addEventListener("click", () => {
    if (lastStep && lastStep.submitting) return;
    byId("finish").focus();
    vscode.postMessage({ type: "cancelSubmit" });
  });
  // Until the overview has loaded, its pending Comments aren't known, so
  // nothing can be submitted from it yet.
  const notReady = (state) => !!state && state.loading && state.items.length === 0 && !state.problem;
  const reasonOf = (step) => notReady(lastState)
    ? "Loading your Review…"
    : !draft.verdict
      ? "Choose a verdict."
      : (draft.summary.trim() ? "" : step.needsSummary[draft.verdict] || "");
  // A blocked Submit says why, again even in the same words, and takes the
  // focus to what is missing.
  function blocked(reason) {
    const node = byId("submitReason");
    node.textContent = "";
    setTimeout(() => { node.textContent = reason; }, 60);
    const first = !draft.verdict ? byId("verdicts").querySelector("input") : undefined;
    (first || summary).focus();
  }
  // Checks that failed are worth knowing before approving, though they don't
  // block it: the Reviewer may know why, and says so by approving anyway.
  const checksNote = () => draft.verdict === "approve" && lastState && lastState.checks && lastState.checks.status === "failed"
    ? "Checks failed on " + lastState.checks.commit + ". Approve only if that is expected."
    : "";
  function submitButtons(step) {
    const reason = reasonOf(step);
    setText(byId("submitReason"), step.problem ? "" : reason);
    const note = byId("submitNote");
    const failed = step.note ? "" : checksNote();
    // The note is a live region, so it changes only when its words do.
    if (failed) {
      if (note.dataset.said !== failed) {
        note.dataset.said = failed;
        note.replaceChildren(el("span", "mark", "✗"), failed);
      }
    } else {
      delete note.dataset.said;
      setText(note, step.note || "");
    }
    note.className = failed ? "warning" : "muted";
    const submit = byId("submitReview");
    submit.setAttribute("aria-disabled", String(step.submitting || !!reason));
    submit.title = "Publish your Review to GitHub (" + (mac ? "⌘↩" : "Ctrl+Enter") + ")";
    submit.setAttribute("aria-label", step.submitting ? "Submitting your Review to GitHub" : "Submit Review to GitHub");
    setText(submit, step.submitting ? "Submitting…" : "Submit Review");
    byId("cancelSubmit").setAttribute("aria-disabled", String(step.submitting));
    byId("discardPending").hidden = step.submitting || step.comments.length === 0;
  }
  function submitStep(state) {
    const step = state.submit;
    const node = byId("submitStep");
    const had = node.contains(document.activeElement);
    lastStep = step;
    node.hidden = !step;
    if (!step) {
      if (had) (byId("closeChange") || byId("viewSubmitted") || byId("finish")).focus();
      return;
    }
    const choices = byId("verdicts");
    const offered = JSON.stringify(step.verdicts);
    if (choices.dataset.said !== offered) {
      choices.dataset.said = offered;
      choices.replaceChildren(choices.firstElementChild, ...step.verdicts.map((v) => {
        // A verdict that is the only one is no choice, so it is no radio.
        if (step.verdicts.length === 1) {
          const only = el("div", "choice only");
          only.append(el("span", "label", v.label), el("span", "muted", v.detail));
          return only;
        }
        const label = el("label", "choice");
        const input = el("input");
        input.type = "radio";
        input.name = "verdict";
        input.value = v.verdict;
        input.addEventListener("change", () => {
          draft.verdict = v.verdict;
          saveDraft();
          submitButtons(lastStep);
        });
        // The radio is named by its verdict alone; what it does describes it.
        const detail = el("span", "muted", v.detail);
        detail.id = "verdict-" + v.verdict;
        detail.setAttribute("aria-hidden", "true");
        input.setAttribute("aria-describedby", detail.id);
        label.append(input, el("span", "label", v.label), detail);
        return label;
      }));
    }
    const fresh = step.asked !== asked;
    if (fresh && step.verdict) draft.verdict = step.verdict;
    // A verdict that publishes is the Reviewer's to choose, unless only one is offered.
    if (!step.verdicts.some((v) => v.verdict === draft.verdict))
      draft.verdict = step.verdicts.length === 1 ? step.verdicts[0].verdict : undefined;
    for (const input of choices.querySelectorAll("input")) input.checked = input.value === draft.verdict;
    if (summary.value !== draft.summary) summary.value = draft.summary;
    const comments = step.comments;
    setText(byId("pendingHeading"), comments.length === 0
      ? "No pending Comments: only your summary and verdict publish."
      : (comments.length === 1 ? "1 Comment publishes with it:" : comments.length + " Comments publish with it:"));
    const list = byId("pendingComments");
    // A long Review lists its first Comments, so Submit stays in reach.
    const fewPending = 5;
    const whole = comments.length <= fewPending;
    const listed = JSON.stringify([comments, allPending]);
    const more = byId("morePending");
    more.hidden = whole;
    setText(more, allPending ? "Show less" : "Show all " + comments.length);
    more.setAttribute("aria-expanded", String(allPending));
    if (list.dataset.said !== listed) {
      list.dataset.said = listed;
      list.replaceChildren(...comments.flatMap((comment, index) => whole || allPending || index < fewPending ? [comment] : []).map((comment) => {
        const index = comments.indexOf(comment);
        const li = el("li");
        const where = comment.path + ":" + comment.line;
        const open = textButton(where, () => vscode.postMessage({ type: "openPending", index }));
        open.classList.add("file");
        open.title = "Show this Comment in the diff";
        li.append(open);
        const about = [comment.side === "LEFT" ? "before the change" : "", comment.text].filter(Boolean).join(" · ");
        if (about) {
          const line = el("span", "muted", about);
          if (comment.text === "Suggested change") line.title = "A change to the code that you propose, which the author can apply from GitHub";
          li.append(line);
        }
        return li;
      }));
    }
    const problem = byId("submitProblem");
    const said = JSON.stringify([step.problem, step.problemAction, step.problemDetail]);
    if (problem.dataset.said !== said) {
      problem.dataset.said = said;
      problem.replaceChildren();
      if (step.problem) {
        // The ✗ marks the problem without relying on its color.
        const mark = el("span", "mark", "✗");
        mark.setAttribute("aria-hidden", "true");
        problem.append(mark);
        appendWithCode(problem, step.problem);
        if (step.problemAction) problem.append(" ", textButton(step.problemAction, () => vscode.postMessage({ type: "submitAction" })));
        // A refusal GitHub gave offers the pull request, and its own words.
        if (step.problemDetail) {
          if (lastState && lastState.url) problem.append(" ", link("Open the pull request on GitHub", lastState.url));
          const details = el("details", "detail");
          details.append(el("summary", "", "Details"), el("code", "", step.problemDetail));
          problem.append(details);
        }
      }
    }
    if (step.submitting) setText(byId("announce"), "Submitting your Review…");
    submitButtons(step);
    if (fresh) {
      asked = step.asked;
      node.scrollIntoView({ block: "start" });
      const first = choices.querySelector("input:checked") || choices.querySelector("input") || summary;
      first.focus({ preventScroll: true });
    }
  }
  let announced;
  function submitted(state) {
    const done = state.submitted;
    const said = done ? done.text : undefined;
    if (said === announced) return;
    announced = said;
    if (!done) return;
    draft.verdict = undefined;
    draft.summary = "";
    saveDraft();
  }

  // The checks that failed or are running lead, and the rest wait behind
  // Show all, so a pull request with many checks doesn't push its history
  // down; a few show whole.
  const fewChecks = 5;
  let allChecks = false;
  byId("moreChecks").addEventListener("click", () => {
    allChecks = !allChecks;
    keepFocus(() => checks(lastState.checks, true));
  });
  function checks(state, changed) {
    byId("checks").hidden = !state;
    if (!state || !changed) return;
    const heading = byId("checksHeading");
    const said = state.commit + "\0" + (state.status || "");
    if (heading.dataset.said !== said) {
      heading.dataset.said = said;
      heading.replaceChildren("Checks on ", el("code", "", state.commit), state.status ? ": " + state.status : "");
    }
    setText(byId("checksSummary"), state.summary);
    const whole = state.runs.length <= fewChecks;
    const runs = whole || allChecks ? state.runs : state.runs.slice(0, state.attention);
    byId("checkRuns").replaceChildren(...runs.map((run) => {
      const li = el("li");
      li.append(el("span", "status " + run.status, run.status), el("span", "name", run.name));
      if (run.url) li.append(link("Details", run.url));
      return li;
    }));
    const more = byId("moreChecks");
    more.hidden = whole || state.attention === state.runs.length;
    setText(more, allChecks ? "Show less" : "Show all " + state.runs.length);
    more.setAttribute("aria-expanded", String(allChecks));
  }

  function render(message) {
    const state = message.state;
    const was = lastState || { items: [] };
    lastState = state;
    if (state.title !== was.title || state.url !== was.url)
      byId("title").replaceChildren(state.url ? link(state.title, state.url) : state.title);
    // Parts wrap between each other before inside one.
    if (state.byline !== was.byline)
      byId("byline").replaceChildren(...state.byline.split(" · ").filter(Boolean).flatMap((part, i) => (i ? [" · ", el("span", "", part)] : [el("span", "", part)])));
    facts(state);
    standing(state);
    hiddenText(state);
    highlighting(state);
    take(state);
    readingOrder(state);
    repeatedEdits(state);
    ways(state);
    submitted(state);
    result(state);
    viewOnGitHub(state);
    collapse(state);
    submitStep(state);
    finishFocus(state);
    setText(byId("history"), state.history);
    setText(byId("loading"), state.loading ? (state.items.length ? "Refreshing…" : "Loading…") : "");
    byId("progress").hidden = !state.loading && !(state.submit && state.submit.submitting) && !(state.brief && state.brief.phase === "writing");
    const problem = byId("historyProblem");
    problem.hidden = !state.problem;
    const said = JSON.stringify([state.problem, state.problemAction]);
    if (problem.dataset.said !== said) {
      problem.dataset.said = said;
      problem.replaceChildren();
      if (state.problem) {
        appendWithCode(problem, state.problem);
        if (state.problemAction) problem.append(" ", textButton(state.problemAction, () => vscode.postMessage({ type: "problemAction" })));
      }
    }
    checks(state.checks, JSON.stringify(state.checks) !== JSON.stringify(was.checks));
    // Only a changed history is built again, so the focus in it stays put.
    if (JSON.stringify(state.items) !== JSON.stringify(was.items))
      byId("items").replaceChildren(...state.items.map(item));
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type !== "state") return;
    keepFocus(() => render(message));
    vscode.postMessage({ type: "rendered", revision: message.revision });
  });
  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
}
