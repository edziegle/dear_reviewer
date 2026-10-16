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
  sharedScript,
  sharedStyles,
} from "../markdownPanel";
import type { ShownReadingOrder } from "../readingOrder";
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
  standing: string[];
  /** How many of the Change's files the Reviewer has viewed, once counted. */
  progress?: { viewed: number; total: number };
  /** Whether the Reviewer's last Review covers the head, with no Comments pending, so there is nothing to finish. */
  finished?: boolean;
  /** Whether the review window is untrusted, so code navigation is off. */
  navigationOff?: boolean;
  /** File extensions, such as `.tofu`, of changed files no installed language highlights, while any are offered. */
  unhighlighted?: string[];
  take: OverviewTake;
  /** The order the Assistant suggests for reading the Change's files, while it has one or writes one. */
  readingOrder?: ShownReadingOrder;
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

  /**
   * `avatarDir` holds the cached avatars, the only files the webview may
   * load. `isChangedFile` says which paths in the Assistant's take become
   * references to open, and `onAction` gets what the Reviewer does.
   */
  constructor(
    state: TimelineState,
    title: string,
    avatarDir: vscode.Uri,
    isChangedFile: (path: string) => boolean,
    private readonly onAction: (action: OverviewAction) => void
  ) {
    this.view = new MarkdownPanel(state, {
      viewType: "dearReviewer.timeline",
      title,
      localResourceRoots: [avatarDir],
      // The Change opens with its overview alone, in front, with the focus.
      placement: { viewColumn: vscode.ViewColumn.One, preserveFocus: false },
      html: (webview) => html(webview.cspSource),
      show: (shownState, render) => shown(shownState, render, isChangedFile),
      receive: (message) => this.receive(message as FromWebview),
    });
    this.onDidDispose = this.view.onDidDispose;
  }

  get title(): string {
    return this.view.title;
  }

  /** Whether the panel is the one the Reviewer is looking at. */
  get active(): boolean {
    return this.view.active;
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
  html { scroll-padding-top: 6em; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 0 24px 24px; max-width: 64em; margin: 0 auto; }
  header { position: sticky; top: 0; z-index: 1; background: var(--vscode-editor-background); padding: 12px 0 8px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
  header .heading { flex: 1 1 16em; min-width: 0; }
  h1 { font-size: 1.1em; margin: 0 0 4px; overflow-wrap: anywhere; }
  h2 { font-size: 1em; margin: 16px 0 8px; }
  .muted { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  button.icon { background: none; border: none; padding: 4px; border-radius: 2px; color: var(--vscode-icon-foreground, var(--vscode-foreground)); cursor: pointer; display: inline-flex; }
  button.icon:hover { background: var(--vscode-toolbar-hoverBackground); }
  button.icon svg { width: 16px; height: 16px; }
  .link { background: none; border: none; padding: 0; color: var(--vscode-textLink-foreground); cursor: pointer; font: inherit; text-align: start; text-decoration: none; }
  .link:hover { text-decoration: underline; }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; }
  header .actions { flex: none; align-items: center; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); padding: 2px 8px; border-radius: 2px; cursor: pointer; font: inherit; }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground)); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); padding: 2px 8px; border-radius: 2px; cursor: pointer; font: inherit; }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  .facts { font-variant-numeric: tabular-nums; }
  .facts .added { color: var(--vscode-gitDecoration-addedResourceForeground); color: color-mix(in srgb, var(--vscode-gitDecoration-addedResourceForeground) 60%, var(--vscode-foreground)); }
  .facts .deleted { color: var(--vscode-gitDecoration-deletedResourceForeground); color: color-mix(in srgb, var(--vscode-gitDecoration-deletedResourceForeground) 60%, var(--vscode-foreground)); }
  ul { list-style: none; padding: 0; margin: 0; }
  .status { font-size: 0.85em; padding: 0 6px; border-radius: 8px; border: 1px solid var(--vscode-descriptionForeground); }
  .status.passed { border-color: var(--vscode-testing-iconPassed); }
  .status.failed { border-color: var(--vscode-testing-iconFailed); }
  .status.running { border-color: var(--vscode-testing-iconQueued); }
  .status.skipped, .status.neutral { color: var(--vscode-descriptionForeground); }
  .item { display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--vscode-panel-border); }
  .item img, .item .no-avatar { width: 24px; height: 24px; border-radius: 50%; flex: none; background: var(--vscode-editor-inactiveSelectionBackground); outline: 1px solid var(--vscode-contrastBorder, transparent); outline-offset: -1px; }
  .item .content { flex: 1; min-width: 0; }
  .item .author { font-weight: 600; }
  #byline span { display: inline-block; max-width: 100%; overflow-wrap: anywhere; }
  .overview .actions button.primary { padding: 4px 12px; }
  .overview .actions button { max-width: 100%; overflow-wrap: anywhere; text-align: start; }
  .overview { padding: 12px 0 14px; border-bottom: 1px solid var(--vscode-panel-border); }
  .overview p { margin: 0 0 4px; }
  .overview .actions { margin-top: 12px; }
  .review { color: var(--vscode-foreground); }
  .review.approved .mark { color: var(--vscode-testing-iconPassed); }
  .review.changesRequested .mark { color: var(--vscode-testing-iconFailed); }
  .review.commented .mark { color: var(--vscode-descriptionForeground); }
  .review.briefed .mark { color: var(--vscode-testing-iconPassed); }`;

function html(cspSource: string): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">${sharedStyles}${pageStyles}
  #highlighting code { font-family: var(--vscode-editor-font-family); }
  #start code { font-family: var(--vscode-editor-font-family); color: inherit; background: none; padding: 0; }
  .overview .hand { margin-top: 14px; }
  .take .speaker .label { font-weight: 400; color: var(--vscode-descriptionForeground); }
  .take .markdown { line-height: 1.5; max-width: 40em; }
  .take .more { margin-top: 4px; font-size: 0.9em; }
  .take .reading { font-style: italic; }
  .problem-line .link { margin-left: 4px; }
  /* A link inside a sentence is underlined, so it doesn't rely on color alone. */
  .problem-line .link, #standing .link, #highlighting .link, #orderNote .link { text-decoration: underline; text-underline-offset: 2px; }
  .order h2 { margin-top: 14px; margin-bottom: 4px; }
  .order ol { margin: 0; padding-left: 1.6em; }
  .order ol > li { margin: 6px 0 0; }
  .order .step { font-weight: 600; }
  .order ul li { display: flex; flex-wrap: wrap; gap: 0 6px; align-items: baseline; padding: 1px 0; }
  .order .mark { width: 1em; flex: none; }
  .order .file { font-family: var(--vscode-editor-font-family); overflow-wrap: anywhere; }
  .order .viewed .file { color: var(--vscode-descriptionForeground); }
  .order .reading { font-style: italic; }
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
  .submit .choice .muted { min-width: 0; }
  .submit .field { display: block; margin: 12px 0 4px; }
  .submit textarea { display: block; box-sizing: border-box; width: 100%; max-width: 40em; }
  .submit .pending h3 { font-size: 1em; font-weight: 400; margin: 12px 0 4px; }
  .submit .pending li { display: flex; flex-wrap: wrap; gap: 0 8px; align-items: baseline; padding: 1px 0; }
  .submit .pending .file { font-family: var(--vscode-editor-font-family); overflow-wrap: anywhere; }
  .submit .pending .muted { min-width: 0; overflow-wrap: anywhere; }
  .submit .actions { margin-top: 12px; align-items: baseline; }
  .submit .actions button.primary { padding: 4px 12px; }
  .submit button[aria-disabled="true"] { opacity: 0.5; cursor: default; }
  .result { padding: 12px 0 14px; border-bottom: 1px solid var(--vscode-panel-border); }
  .result p { margin: 0 0 8px; line-height: 1.5; }
  .result .verdict .mark { margin-right: 4px; }
  .result .actions { align-items: baseline; }
  .result button.primary { padding: 4px 12px; }
  .result .reading { font-style: italic; color: var(--vscode-descriptionForeground); }
  #resultProblem:empty { display: none; }
  #resultProblem { margin: 0 0 8px; }
  #resultProblem .mark { color: var(--vscode-testing-iconFailed); margin-right: 4px; }
  #submitProblem:empty, #submitReason:empty, #submitNote:empty { display: none; }
  #submitProblem { margin-top: 8px; }
  #submitProblem .mark { color: var(--vscode-testing-iconFailed); margin-right: 4px; }
  #submitNote { margin: 2px 0 0; }
  #submitReason { margin-top: 4px; }
</style>
</head>
<body>
${catSymbol}
<header>
  <div class="heading"><h1 id="title"></h1><div class="muted" id="byline"></div></div>
  <div class="actions">
    <button class="icon" id="refresh" title="Load the overview again" aria-label="Refresh"><svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M4.681 3H2V2h3.5l.5.5V6H5V4a5 5 0 1 0 4.53-.761l.302-.954A6 6 0 1 1 4.681 3z"/></svg></button>
    <button class="secondary" id="finish"></button>
  </div>
</header>
<section class="result" id="result" aria-label="Review result" hidden>
  <p class="verdict" id="resultText" role="status"></p>
  <div class="problem-line" id="resultProblem" role="alert"></div>
  <div class="actions" id="resultActions"></div>
</section>
<section class="submit" id="submitStep" aria-labelledby="submitHeading" hidden>
  <h2 id="submitHeading">Your Review</h2>
  <fieldset id="verdicts"><legend class="visually-hidden">Verdict</legend></fieldset>
  <div class="muted" id="submitNote"></div>
  <label class="field" for="summary">Summary <span class="muted">for the author</span></label>
  <textarea id="summary" rows="3" aria-describedby="submitReason"></textarea>
  <div class="muted" id="submitReason"></div>
  <div class="pending" id="pending"><h3 id="pendingHeading"></h3><ul id="pendingComments" aria-labelledby="pendingHeading"></ul></div>
  <div class="problem-line" id="submitProblem" role="alert"></div>
  <div class="actions">
    <button class="primary" id="submitReview" type="button" aria-describedby="submitReason" title="Publish your Review to GitHub (Ctrl+Enter)">Submit Review</button>
    <button class="secondary" id="cancelSubmit" type="button">Cancel</button>
    <button class="link" id="discardPending" type="button" title="Delete your pending Comments without publishing them" hidden>Discard pending Comments…</button>
  </div>
</section>
<div class="visually-hidden" id="announce" role="status"></div>
<section class="overview" aria-label="Overview">
  <p class="facts" id="facts" hidden></p>
  <p class="muted" id="standing" hidden></p>
  <p class="muted" id="highlighting" hidden></p>
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
      <h2>Reading Order</h2>
      <div class="muted" id="orderNote" role="status"></div>
      <ol id="orderSteps"></ol>
    </div>
  </div>
  <div class="actions" id="ways">
    <button class="primary" id="start" type="button" hidden></button>
    <button class="secondary" id="nextFile" type="button" hidden>Next unviewed file</button>
    <button class="secondary" id="ask" type="button" title="Open the Assistant's chat about this Change (Ctrl+Alt+R A)">Ask the Assistant</button>
  </div>
</section>
<section id="checks" hidden><h2 id="checksHeading"></h2><p class="muted facts" id="checksSummary"></p><ul class="checks" id="checkRuns"></ul><button class="link more" id="moreChecks" type="button" aria-controls="checkRuns" aria-expanded="false" hidden></button></section>
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
  for (const type of ["refresh", "nextFile", "ask"])
    byId(type).addEventListener("click", () => vscode.postMessage({ type }));
  byId("finish").addEventListener("click", () => {
    if (lastState && lastState.submit && !lastState.submit.submitting) vscode.postMessage({ type: "cancelSubmit" });
    else vscode.postMessage({ type: "finish" });
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

  function facts(state) {
    const node = byId("facts");
    const parts = [];
    if (state.size) {
      const { files, additions, deletions } = state.size;
      const size = el("span");
      const shown = el("span");
      shown.setAttribute("aria-hidden", "true");
      shown.append(files + (files === 1 ? " file · " : " files · "), el("span", "added", "+" + additions), " ", el("span", "deleted", "−" + deletions));
      size.append(shown, el("span", "visually-hidden", files + (files === 1 ? " file, " : " files, ") + additions + " lines added, " + deletions + " removed"));
      parts.push(size);
    }
    if (state.checks && state.checks.status) parts.push("checks " + state.checks.status);
    node.hidden = parts.length === 0;
    node.replaceChildren();
    parts.forEach((part, i) => node.append(...(i ? [" · ", part] : [part])));
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
    parts.push(...notes);
    if (state.navigationOff) {
      const off = el("span", "", "Navigation off: ");
      const trust = textButton("Trust the review window…", () => vscode.postMessage({ type: "trust" }));
      trust.title = "The review window is in Restricted Mode, so go to definition and other code navigation are off";
      off.append(trust);
      parts.push(off);
    }
    parts.forEach((part, i) => node.append(...(i ? [" · "] : []), part));
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
    // The heading names the Assistant; a take since a Review says so after.
    setText(byId("takeLabel"), t.label === "Assistant" ? "" : "· " + t.label);
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
    const noted = JSON.stringify([order.writing, order.outOfDate]);
    if (note.dataset.said !== noted) {
      note.dataset.said = noted;
      note.replaceChildren();
      note.className = order.writing ? "muted reading" : "muted";
      if (order.writing) note.append("Choosing an order to read the files in…");
      else if (order.outOfDate) note.append("Suggested before the latest commits, which are in the last step. ", textButton("Suggest again", () => vscode.postMessage({ type: "suggestReadingOrder" })));
    }
    byId("orderSteps").replaceChildren(...order.steps.map((step) => {
      const li = el("li");
      li.append(el("div", "step", step.label));
      const files = el("ul");
      files.append(...step.files.map((file) => {
        const row = el("li", file.viewed ? "viewed" : "");
        const mark = el("span", "mark", file.viewed ? "✓" : "");
        mark.setAttribute("aria-hidden", "true");
        const open = textButton(file.path, () => vscode.postMessage({ type: "openFile", path: file.path }));
        open.classList.add("file");
        open.title = "Open the diff of " + file.path;
        // The ✓ is hidden from screen readers, so the name says it.
        open.setAttribute("aria-label", file.path + (file.viewed ? ", viewed" : ", not viewed"));
        row.append(mark, open);
        if (file.why) row.append(el("span", "muted", file.why));
        return row;
      }));
      li.append(files);
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
    next.hidden = !progress || progress.viewed >= progress.total || back;
    next.title = "Open the diff of the next file you haven't viewed (Ctrl+Alt+R N)";
    const first = t.start ? start : next;
    start.className = reading && first === start ? "primary" : "secondary";
    next.className = reading && first === next ? "primary" : "secondary";
    const finish = byId("finish");
    // There is nothing to finish while the result block says how it ended.
    finish.hidden = back;
    setText(finish, state.finish);
    // While the Submit step is open, the button is its disclosure: pressing
    // it again closes the step.
    if (state.submit) {
      finish.setAttribute("aria-expanded", "true");
      finish.setAttribute("aria-controls", "submitStep");
    } else if (state.finish.startsWith("Submit")) {
      finish.setAttribute("aria-expanded", "false");
      finish.setAttribute("aria-controls", "submitStep");
    } else {
      finish.removeAttribute("aria-expanded");
      finish.removeAttribute("aria-controls");
    }
    finish.title = (state.finish.startsWith("Submit") ? "Submit your Review to GitHub" : "Write a Brief of your Comments for an agent") + " (Ctrl+Alt+R S)";
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
    if (brief && brief.phase === "problem") return "problem";
  }
  // Whether the result block shows what the Reviewer has done, so the way
  // in and the finishing button step back.
  const showing = (state) => resultOf(state) !== undefined;
  const stepsBack = (state) => ["writing", "written", "ended"].includes(resultOf(state));
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

  function result(state) {
    const kind = resultOf(state);
    const node = byId("result");
    node.hidden = !kind;
    if (!kind) return;
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
    } else if (kind === "written") {
      text.append("A Brief of " + countOfComments(brief.comments) + " is open in the editor. Read and edit it, then copy it for your agent.");
      actions.append(button("primary", "Copy Brief", { type: "copyBrief" }, "Copy the Brief, with your edits, which ends this Review"));
      if (brief.canShow) actions.append(button("secondary", "Show Brief", { type: "showBrief" }, "Open the Brief in the editor"));
      actions.append(textButton("Discard Comments…", () => vscode.postMessage({ type: "discard" })));
    } else if (kind === "ended") {
      const review = state.review;
      const done = state.submitted;
      const verdict = review ? review.verdict : "approved";
      text.className = "verdict review " + verdict;
      const mark = el("span", "mark", reviewMarks[verdict] || "✓");
      mark.setAttribute("aria-hidden", "true");
      text.append(mark, done ? done.text.replace(/\.$/, "") : review ? review.text : "Your Review is submitted");
      actions.append(button("primary", "Close Change", { type: "closeChange" }, "Close this Change and its worktrees, and go back to the Dashboard", "closeChange"));
      if (done && done.url) actions.append(button("secondary", "View on GitHub", { type: "openLink", url: done.url }, "Open your Review on GitHub", "viewSubmitted"));
      if (brief && brief.canShow) actions.append(button("secondary", "Show Brief", { type: "showBrief" }, "Open the Brief in the editor"));
    } else if (kind === "problem") {
      const mark = el("span", "mark", "✗");
      mark.setAttribute("aria-hidden", "true");
      problem.append(mark, brief.problem);
    }
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
    if (!lastStep || lastStep.submitting || reasonOf(lastStep)) return;
    vscode.postMessage({ type: "submit", verdict: draft.verdict, summary: draft.summary });
  });
  byId("discardPending").addEventListener("click", () => vscode.postMessage({ type: "discard" }));
  byId("cancelSubmit").addEventListener("click", () => {
    if (lastStep && lastStep.submitting) return;
    byId("finish").focus();
    vscode.postMessage({ type: "cancelSubmit" });
  });
  const reasonOf = (step) => !draft.verdict
    ? "Choose a verdict."
    : (draft.summary.trim() ? "" : step.needsSummary[draft.verdict] || "");
  function submitButtons(step) {
    const reason = reasonOf(step);
    setText(byId("submitReason"), step.problem ? "" : reason);
    const submit = byId("submitReview");
    submit.setAttribute("aria-disabled", String(step.submitting || !!reason));
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
      if (had) (byId("viewSubmitted") || byId("closeChange") || byId("finish")).focus();
      return;
    }
    const choices = byId("verdicts");
    const offered = JSON.stringify(step.verdicts);
    if (choices.dataset.said !== offered) {
      choices.dataset.said = offered;
      choices.replaceChildren(choices.firstElementChild, ...step.verdicts.map((v) => {
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
    setText(byId("submitNote"), step.note || "");
    for (const input of choices.querySelectorAll("input")) input.checked = input.value === draft.verdict;
    if (summary.value !== draft.summary) summary.value = draft.summary;
    const comments = step.comments;
    setText(byId("pendingHeading"), comments.length === 0
      ? "No pending Comments: only your summary and verdict publish."
      : (comments.length === 1 ? "1 Comment publishes with it:" : comments.length + " Comments publish with it:"));
    const list = byId("pendingComments");
    const listed = JSON.stringify(comments);
    if (list.dataset.said !== listed) {
      list.dataset.said = listed;
      list.replaceChildren(...comments.map((comment, index) => {
        const li = el("li");
        const where = comment.path + ":" + comment.line;
        const open = textButton(where, () => vscode.postMessage({ type: "openPending", index }));
        open.classList.add("file");
        open.title = "Show this Comment in the diff";
        li.append(open);
        const about = [comment.side === "LEFT" ? "before the change" : "", comment.text].filter(Boolean).join(" · ");
        if (about) li.append(el("span", "muted", about));
        return li;
      }));
    }
    const problem = byId("submitProblem");
    const said = JSON.stringify([step.problem, step.problemAction]);
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
      }
    }
    if (step.submitting) setText(byId("announce"), "Submitting your Review…");
    submitButtons(step);
    if (fresh) {
      asked = step.asked;
      node.scrollIntoView({ block: "start" });
      const first = choices.querySelector("input:checked") || choices.querySelector("input");
      if (first) first.focus({ preventScroll: true });
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
    setText(byId("announce"), done.text);
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
    setText(byId("checksHeading"), "Checks on " + state.commit + (state.status ? ": " + state.status : ""));
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
    highlighting(state);
    take(state);
    readingOrder(state);
    ways(state);
    submitted(state);
    result(state);
    submitStep(state);
    finishFocus(state);
    setText(byId("history"), state.history);
    setText(byId("loading"), state.loading ? (state.items.length ? "Refreshing…" : "Loading…") : "");
    byId("progress").hidden = !state.loading && !(state.submit && state.submit.submitting);
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
