// Home's panel: the review window's page of where the Reviewer stands across
// their Changes, alone in the main column while no Change is in front
// (ADR 0025). It reads like a Change's overview: a facts line, where the
// Reviewer left off and the one button for what comes next, then the lists,
// In progress, Waiting on you, Your pull requests and Local branches. The
// extension sends it the whole state; the webview renders it, says which
// state it rendered, and asks the extension for everything else.

import * as crypto from "crypto";
import * as vscode from "vscode";
import {
  Handshake,
  MarkdownPanel,
  sharedScript,
  sharedStyles,
} from "../markdownPanel";
import { pageStyles, type ReviewStanding } from "../timeline/panel";
import type { CheckStatus } from "../github/client";
import type { NextStep } from "./homeState";

/** A Change open in the review window. */
export interface HomeChange {
  id: string;
  /** The pull request's title, or the Change's name. */
  title: string;
  /** Such as `acme/api #7`, or `local branch in api`. */
  byline: string;
  /** The Reviewer's last Review, while no new commits came since. */
  review?: ReviewStanding;
  /** New commits since their Review, pending Comments, files viewed. */
  standing: string[];
  /** "Submit Review…" or "Write Brief…". */
  finish: string;
}

/** A pull request in the Inbox. */
export interface HomePullRequest {
  id: string;
  title: string;
  /** Such as `acme/api #7`. */
  name: string;
  author: string;
  /** The cached avatar, as a webview resource URI. */
  avatar?: string;
  /** How long it has waited on the Reviewer, such as "6 days", in Waiting on you. */
  waited?: string;
  size: { files: number; additions: number; deletions: number };
  checks?: CheckStatus;
  /** Its states, new commits since a Review, and whether it's open or opening. */
  notes: string[];
}

/** A local branch ahead of main. */
export interface HomeBranch {
  id: string;
  name: string;
  repository: string;
  /** Such as "3 commits ahead of main". */
  ahead: string;
  notes: string[];
}

/** Something Home couldn't list, and the button that helps. */
export interface HomeProblem {
  id: string;
  text: string;
  action?: string;
}

export interface HomeState {
  /** Such as "2 in progress · 5 waiting on you · oldest 6 days". */
  facts: string;
  next?: NextStep;
  inProgress: HomeChange[];
  /** Undefined until the Inbox has loaded, or while it can't. */
  waiting?: HomePullRequest[];
  authored?: HomePullRequest[];
  branches: HomeBranch[];
  /** Whether the Inbox is loading. */
  loading: boolean;
  /** What the Reviewer needs to set up before pull requests can be listed. */
  setup?: HomeProblem;
  /** Why the pull requests couldn't load. */
  problems: HomeProblem[];
  /** Clones whose branches couldn't be listed. */
  branchProblems: HomeProblem[];
}

/** Webview to extension. */
export type FromHome =
  | Handshake
  | { type: "refresh" }
  | { type: "next" }
  | { type: "resume"; id: string }
  | { type: "finish"; id: string }
  | { type: "open"; id: string }
  | { type: "fix"; id: string };

/** What the Reviewer does in Home. */
export type HomeAction = Exclude<FromHome, Handshake>;

export class HomePanel {
  private readonly view: MarkdownPanel<HomeState, HomeState>;
  /** Fires when the Reviewer closes the panel. */
  readonly onDidDispose: vscode.Event<void>;

  /** `avatarDir` holds the cached avatars, the only files the webview may load. */
  constructor(
    state: HomeState,
    avatarDir: vscode.Uri,
    private readonly onAction: (action: HomeAction) => void
  ) {
    this.view = new MarkdownPanel(state, {
      viewType: "dearReviewer.home",
      title: "Home",
      localResourceRoots: [avatarDir],
      // Home holds the main column alone, with the focus, like an overview.
      placement: { viewColumn: vscode.ViewColumn.One, preserveFocus: false },
      html: (webview) => html(webview.cspSource),
      show: (shownState) => shownState,
      receive: (message) => this.receive(message as FromHome),
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
  get sent(): HomeState {
    return this.view.sent;
  }

  /** The state the webview last rendered, once it has rendered the latest one. */
  get rendered(): HomeState | undefined {
    return this.view.rendered;
  }

  /** The URI the webview loads a local file by. */
  webviewUri(file: vscode.Uri): string {
    return this.view.webview.asWebviewUri(file).toString();
  }

  /** Handles a message from the webview; the tests send clicks through here too. */
  receive(message: FromHome): void {
    if (this.view.handshake(message)) return;
    if (message.type === "refresh" || message.type === "next")
      this.onAction({ type: message.type });
    else if (
      (message.type === "resume" ||
        message.type === "finish" ||
        message.type === "open" ||
        message.type === "fix") &&
      typeof message.id === "string"
    )
      this.onAction({ type: message.type, id: message.id });
  }

  update(state: HomeState): void {
    this.view.update(state);
  }

  /** Brings the panel forward in the main column, with the focus. */
  reveal(): void {
    this.view.reveal(false, vscode.ViewColumn.One);
  }

  dispose(): void {
    this.view.dispose();
  }
}

function html(cspSource: string): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">${sharedStyles}${pageStyles}
  [hidden] { display: none !important; }
  section.list h2 { margin-top: 20px; margin-bottom: 0; }
  section.list .problem-line, #loading:not(:empty) { margin: 8px 0 0; }
  .item .muted .status { font-size: inherit; color: var(--vscode-foreground); }
  .item { flex-wrap: wrap; align-items: flex-start; }
  .item .content { flex: 1 1 18em; }
  .item .content > div + div { margin-top: 2px; }
  .item .title { font-weight: 600; overflow-wrap: anywhere; }
  .item .link.title { color: var(--vscode-textLink-foreground); }
  .item .branch { font-family: var(--vscode-editor-font-family); font-weight: 400; }
  .item .actions { flex: none; align-self: center; }
  .item .muted span { display: inline-block; max-width: 100%; overflow-wrap: anywhere; }
  .problem-line .link { margin-left: 4px; text-decoration: underline; }
</style>
</head>
<body>
<header>
  <div class="heading"><h1>Home</h1></div>
  <div class="actions">
    <button class="icon" id="refresh" title="Load the pull requests and branches again" aria-label="Refresh"><svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M4.681 3H2V2h3.5l.5.5V6H5V4a5 5 0 1 0 4.53-.761l.302-.954A6 6 0 1 1 4.681 3z"/></svg></button>
  </div>
</header>
<section class="overview" aria-label="Where you stand">
  <p class="facts" id="facts"></p>
  <p class="muted" id="place" hidden></p>
  <div class="actions" id="ways" hidden><button class="primary" id="next" type="button"></button></div>
</section>
<section class="list" id="inProgress" aria-labelledby="inProgressHeading" hidden><h2 id="inProgressHeading">In progress</h2><div id="changes" role="list"></div></section>
<section class="list" id="waitingSection" aria-labelledby="waitingHeading"><h2 id="waitingHeading">Waiting on you</h2><div role="status"><div class="muted" id="loading"></div><div id="setup" hidden></div></div><div id="problems"></div><div id="waiting" role="list"></div></section>
<section class="list" id="authoredSection" aria-labelledby="authoredHeading" hidden><h2 id="authoredHeading">Your pull requests</h2><div id="authored" role="list"></div></section>
<section class="list" id="branchesSection" aria-labelledby="branchesHeading" hidden><h2 id="branchesHeading">Local branches</h2><div id="branchProblems"></div><div id="branches" role="list"></div></section>
<script nonce="${nonce}">${sharedScript}
  const vscode = acquireVsCodeApi();
  const byId = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  // A name, when given, starts with the text, so a row's buttons can say
  // which row they act on.
  const button = (className, text, message, title, name) => {
    const node = el("button", className, text);
    node.type = "button";
    if (title) node.title = title;
    if (name) node.setAttribute("aria-label", name);
    node.addEventListener("click", () => vscode.postMessage(message));
    return node;
  };
  // Parts of a muted line wrap between each other before inside one.
  const line = (className, parts) => {
    const node = el("div", className);
    parts.filter(Boolean).forEach((part, i) => node.append(...(i ? [" · "] : []), typeof part === "string" ? el("span", "", part) : part));
    return node;
  };
  byId("refresh").addEventListener("click", () => vscode.postMessage({ type: "refresh" }));
  byId("next").addEventListener("click", () => vscode.postMessage({ type: "next" }));

  const reviewMarks = { approved: "✓", changesRequested: "✗", commented: "•" };
  function change(entry) {
    const row = el("div", "item change");
    row.setAttribute("role", "listitem");
    const content = el("div", "content");
    content.append(el("div", "title", entry.title), line("muted", [entry.byline]));
    let review;
    if (entry.review) {
      review = el("span", "review " + entry.review.verdict);
      const mark = el("span", "mark", reviewMarks[entry.review.verdict]);
      mark.setAttribute("aria-hidden", "true");
      review.append(mark, " ", entry.review.text);
    }
    content.append(line("muted", [review, ...entry.standing]));
    const actions = el("div", "actions");
    actions.append(
      button("secondary", "Resume", { type: "resume", id: entry.id }, "Show the overview of " + entry.byline, "Resume " + entry.title),
      button("secondary", entry.finish, { type: "finish", id: entry.id }, entry.finish.startsWith("Submit") ? "Submit your Review to GitHub" : "Write a Brief of your Comments for an agent", entry.finish.replace("…", "") + " of " + entry.title + "…")
    );
    row.append(content, actions);
    return row;
  }

  function size(entry) {
    const { files, additions, deletions } = entry.size;
    const node = el("span", "facts");
    node.append(files + (files === 1 ? " file · " : " files · "), el("span", "added", "+" + additions), " ", el("span", "deleted", "−" + deletions));
    node.setAttribute("aria-label", files + (files === 1 ? " file, " : " files, ") + additions + " lines added, " + deletions + " removed");
    return node;
  }

  function pullRequest(entry) {
    const row = el("div", "item pull-request");
    row.setAttribute("role", "listitem");
    if (entry.waited !== undefined) {
      if (entry.avatar) {
        const img = el("img");
        img.src = entry.avatar;
        img.alt = "";
        row.append(img);
      } else row.append(el("div", "no-avatar"));
    }
    const content = el("div", "content");
    const title = el("div");
    title.append(button("link title", entry.title, { type: "open", id: entry.id }, "Open " + entry.name + " as a Change"));
    content.append(
      title,
      line("muted", [entry.name, entry.waited !== undefined && entry.author, entry.waited !== undefined && "waiting " + entry.waited]),
      line("muted", [size(entry), entry.checks && el("span", "status " + entry.checks, "checks " + entry.checks), ...entry.notes])
    );
    row.append(content);
    return row;
  }

  function branch(entry) {
    const row = el("div", "item branch-row");
    row.setAttribute("role", "listitem");
    const content = el("div", "content");
    const title = el("div");
    title.append(button("link title branch", entry.name, { type: "open", id: entry.id }, "Open " + entry.name + " as a Change"));
    content.append(title, line("muted", [entry.repository, entry.ahead, ...entry.notes]));
    row.append(content);
    return row;
  }

  function problem(entry) {
    const node = el("div", "muted problem-line");
    appendWithCode(node, entry.text);
    if (entry.action) node.append(" ", button("link", entry.action, { type: "fix", id: entry.id }));
    return node;
  }

  // Each list is built again only when it changed, so the focus in the others stays put.
  const said = {};
  function list(id, entries, build) {
    const text = JSON.stringify(entries);
    if (said[id] === text) return;
    said[id] = text;
    byId(id).replaceChildren(...entries.map(build));
  }

  function render(message) {
    const state = message.state;
    setText(byId("facts"), state.facts);
    const next = state.next;
    byId("place").hidden = !next;
    byId("ways").hidden = !next;
    if (next) {
      setText(byId("place"), next.place);
      setText(byId("next"), next.label);
      byId("next").title = next.kind === "open" ? "Open it as a Change" : next.kind === "resume" ? "Show its overview" : "Finish the Review (Ctrl+Alt+R S once it's in front)";
    }
    byId("inProgress").hidden = state.inProgress.length === 0;
    list("changes", state.inProgress, change);
    setText(byId("loading"), state.loading && !state.waiting ? "Loading…" : "");
    const setup = byId("setup");
    setup.hidden = !state.setup;
    const setupText = JSON.stringify(state.setup || null);
    if (setup.dataset.said !== setupText) {
      setup.dataset.said = setupText;
      setup.replaceChildren(...(state.setup ? [problem(state.setup)] : []));
    }
    list("problems", state.problems, problem);
    const waiting = state.waiting || [];
    list("waiting", waiting, pullRequest);
    // The facts line already says when nothing is waiting.
    byId("waitingSection").hidden = !!state.waiting && waiting.length === 0 && !state.setup && state.problems.length === 0;
    const authored = state.authored || [];
    byId("authoredSection").hidden = authored.length === 0;
    list("authored", authored, pullRequest);
    byId("branchesSection").hidden = state.branches.length === 0 && state.branchProblems.length === 0;
    list("branchProblems", state.branchProblems, problem);
    list("branches", state.branches, branch);
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
