// The overview panel for one Change: the webview a Change opens with, alone
// in the main column, that orients the Reviewer (ADR 0019, ADR 0020). Code
// opens in the column beside it once the Reviewer starts reading. It shows what the Change is, how big it is, where
// the Reviewer stands on it and the Assistant's short take, then its history:
// a pull request's timeline from GitHub, or a local Change's commits. The
// extension sends it the whole state; the webview renders it, says which
// state it rendered, and asks the extension for everything else.

import * as crypto from "crypto";
import * as vscode from "vscode";
import { findReferences, type FileReference } from "../markdown";
import {
  Handshake,
  MarkdownPanel,
  RenderInto,
  sharedStyles,
} from "../markdownPanel";
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
  /** Where the Reviewer stands: new commits since their Review, pending Comments, files viewed. */
  standing: string[];
  take: OverviewTake;
  /** The button that finishes the Review: "Submit Review…" or "Write Brief…". */
  finish: string;
  /** "Timeline" for a pull request, "Commits" for a local Change. */
  history: string;
  /** Whether a reload is under way. */
  loading: boolean;
  items: TimelineItem[];
  /** The latest commit's checks; absent when it has none. */
  checks?: {
    commit: string;
    status?: CheckStatus;
    runs: { name: string; status: CheckRunStatus; url?: string }[];
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
  | { type: "refresh" }
  | { type: "finish" }
  | { type: "nextFile" }
  | { type: "ask" }
  | { type: "takeAction" }
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
    } else if (
      [
        "refresh",
        "finish",
        "nextFile",
        "ask",
        "takeAction",
        "problemAction",
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

function html(cspSource: string): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">${sharedStyles}
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 0 24px 24px; max-width: 64em; margin: 0 auto; }
  header { position: sticky; top: 0; z-index: 1; background: var(--vscode-editor-background); padding: 12px 0 8px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
  header .heading { flex: 1 1 16em; min-width: 0; }
  h1 { font-size: 1.1em; margin: 0 0 4px; overflow-wrap: anywhere; }
  h2 { font-size: 1em; margin: 16px 0 8px; }
  .muted { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  #byline span { display: inline-block; max-width: 100%; overflow-wrap: anywhere; }
  button.icon { background: none; border: none; padding: 3px; border-radius: 4px; color: var(--vscode-icon-foreground, var(--vscode-foreground)); cursor: pointer; display: inline-flex; }
  button.icon:hover { background: var(--vscode-toolbar-hoverBackground); }
  button.icon svg { width: 16px; height: 16px; }
  button.link { background: none; border: none; padding: 0; color: var(--vscode-textLink-foreground); cursor: pointer; font: inherit; text-align: start; }
  button.link:hover { text-decoration: underline; }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; }
  header .actions { flex: none; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 2px 8px; border-radius: 2px; cursor: pointer; font: inherit; }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground)); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 2px 8px; border-radius: 2px; cursor: pointer; font: inherit; }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  .overview { padding: 12px 0 14px; border-bottom: 1px solid var(--vscode-panel-border); }
  .overview p { margin: 0 0 4px; }
  .facts { font-variant-numeric: tabular-nums; }
  .facts .added { color: var(--vscode-gitDecoration-addedResourceForeground); }
  .facts .deleted { color: var(--vscode-gitDecoration-deletedResourceForeground); }
  .take h2 { margin-top: 14px; margin-bottom: 4px; }
  .take .markdown { line-height: 1.5; max-width: 40em; }
  .take .start { margin-top: 8px; }
  .take .start button.link { font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); overflow-wrap: anywhere; }
  .take .more { margin-top: 4px; font-size: 0.9em; }
  .take .reading { font-style: italic; }
  .take .problem-line button.link { margin-left: 4px; }
  .overview .actions { margin-top: 12px; }
  ul { list-style: none; padding: 0; margin: 0; }
  .checks li { display: flex; gap: 8px; align-items: baseline; padding: 2px 0; }
  .checks .name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .status { font-size: 0.85em; padding: 0 6px; border-radius: 8px; border: 1px solid currentColor; }
  .status.passed { color: var(--vscode-testing-iconPassed); }
  .status.failed { color: var(--vscode-testing-iconFailed); }
  .status.running { color: var(--vscode-testing-iconQueued); }
  .status.skipped, .status.neutral { color: var(--vscode-descriptionForeground); }
  .item { display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--vscode-panel-border); }
  .item img, .item .no-avatar { width: 24px; height: 24px; border-radius: 50%; flex: none; background: var(--vscode-editor-inactiveSelectionBackground); }
  .item .content { flex: 1; min-width: 0; }
  .item .author { font-weight: 600; }
  .item .body { white-space: pre-wrap; line-height: 1.5; margin-top: 6px; overflow-wrap: anywhere; }
  .item .body.markdown { white-space: normal; }
  .item.commit .sha { font-family: var(--vscode-editor-font-family); }
</style>
</head>
<body>
<header>
  <div class="heading"><h1 id="title"></h1><div class="muted" id="byline"></div></div>
  <div class="actions">
    <button class="icon" id="refresh" title="Load the overview again" aria-label="Refresh"><svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M4.681 3H2V2h3.5l.5.5V6H5V4a5 5 0 1 0 4.53-.761l.302-.954A6 6 0 1 1 4.681 3z"/></svg></button>
    <button class="primary" id="finish"></button>
  </div>
</header>
<div class="problem" id="problem" role="alert" hidden></div>
<section class="overview" aria-label="Overview">
  <p class="facts" id="facts" hidden></p>
  <p class="muted" id="standing" hidden></p>
  <div class="take">
    <h2 id="takeLabel"></h2>
    <div class="markdown" id="take"></div>
    <button class="link more" id="more" type="button" hidden>Show all</button>
    <div class="start" id="start" hidden></div>
    <div class="muted reading" id="reading" role="status"></div>
    <div class="muted problem-line" id="takeProblem" hidden></div>
  </div>
  <div class="actions">
    <button class="secondary" id="nextFile" title="Open the diff of the next file you haven't viewed">Next unviewed file</button>
    <button class="secondary" id="ask" title="Open the Assistant's chat about this Change">Ask the Assistant</button>
  </div>
</section>
<section id="checks" hidden><h2 id="checksHeading"></h2><ul class="checks" id="checkRuns"></ul></section>
<section><h2 id="history"></h2><div class="muted" id="loading" role="status" hidden>Loading…</div><div id="items"></div></section>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const byId = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const link = (text, url) => {
    const button = el("button", "link", text);
    button.addEventListener("click", () => vscode.postMessage({ type: "openLink", url }));
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
  for (const type of ["refresh", "finish", "nextFile", "ask"])
    byId(type).addEventListener("click", () => vscode.postMessage({ type }));
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
      size.append(files + (files === 1 ? " file · " : " files · "), el("span", "added", "+" + additions), " ", el("span", "deleted", "−" + deletions));
      size.setAttribute("aria-label", files + " files, " + additions + " lines added, " + deletions + " removed");
      parts.push(size);
    }
    if (state.checks && state.checks.status) parts.push("checks " + state.checks.status);
    node.hidden = parts.length === 0;
    node.replaceChildren();
    parts.forEach((part, i) => node.append(...(i ? [" · ", part] : [part])));
  }

  let showAll = false;
  let lastTake;
  byId("more").addEventListener("click", () => {
    showAll = !showAll;
    take(lastTake);
  });
  function take(state) {
    lastTake = state;
    const t = state.take;
    byId("takeLabel").textContent = t.label;
    const body = byId("take");
    const html = showAll && t.fullHtml !== undefined ? t.fullHtml : t.html;
    if (html !== undefined) {
      // Rendered and sanitised by the extension; see renderMarkdown.
      body.innerHTML = html;
      focusable(body);
    } else body.replaceChildren();
    const more = byId("more");
    more.hidden = t.fullHtml === undefined;
    more.textContent = showAll ? "Show less" : "Show all";
    const start = byId("start");
    start.hidden = !t.start;
    start.replaceChildren();
    if (t.start) {
      const where = t.start.path + ":" + t.start.startLine + (t.start.endLine > t.start.startLine ? "-" + t.start.endLine : "");
      const button = el("button", "link", where);
      button.type = "button";
      button.addEventListener("click", () => vscode.postMessage({ type: "openReference", ...t.start }));
      start.append("Start at ", button);
    }
    byId("reading").textContent = t.reading
      ? (t.text ? "" : "The Assistant is reading the Change…")
      : (!t.text && !t.problem ? "The Assistant hasn't summarised this Change." : "");
    const problem = byId("takeProblem");
    problem.hidden = !t.problem;
    problem.replaceChildren();
    if (t.problem) {
      problem.append(t.problem);
      if (t.problemAction) {
        const button = el("button", "link", t.problemAction);
        button.type = "button";
        button.addEventListener("click", () => vscode.postMessage({ type: "takeAction" }));
        problem.append(" ", button);
      }
    }
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type !== "state") return;
    const state = message.state;
    byId("title").replaceChildren(state.url ? link(state.title, state.url) : state.title);
    // Parts wrap between each other before inside one.
    byId("byline").replaceChildren(...state.byline.split(" · ").flatMap((part, i) => (i ? [" · ", el("span", "", part)] : [el("span", "", part)])));
    byId("finish").textContent = state.finish;
    facts(state);
    byId("standing").hidden = state.standing.length === 0;
    byId("standing").textContent = state.standing.join(" · ");
    take(state);
    byId("history").textContent = state.history;
    byId("loading").hidden = !state.loading;
    byId("problem").hidden = !state.problem;
    byId("problem").textContent = state.problem || "";
    if (state.problem && state.problemAction) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = state.problemAction;
      button.addEventListener("click", () => vscode.postMessage({ type: "problemAction" }));
      byId("problem").append(button);
    }
    const checks = state.checks;
    byId("checks").hidden = !checks;
    if (checks) {
      byId("checksHeading").textContent = "Checks on " + checks.commit + (checks.status ? ": " + checks.status : "");
      byId("checkRuns").replaceChildren(...checks.runs.map((run) => {
        const li = el("li");
        li.append(el("span", "status " + run.status, run.status), el("span", "name", run.name));
        if (run.url) li.append(link("Details", run.url));
        return li;
      }));
    }
    byId("items").replaceChildren(...state.items.map(item));
    vscode.postMessage({ type: "rendered", revision: message.revision });
  });
  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
}
