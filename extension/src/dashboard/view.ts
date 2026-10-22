// The Dashboard's view: the Dear Reviewer side bar in the Reviewer's own
// windows (ADR 0032). It reads top to bottom like a Change's overview, sized
// for the side bar: a facts line, where the Reviewer left off and the one
// button for what comes next, then the lists, Active Change, Waiting on you,
// Your pull requests, Reviewed by you and Local branches, and a way to open
// any commit range. The extension sends it the whole state; the webview
// renders it, says which state it rendered, and asks the extension for
// everything else.

import * as crypto from "crypto";
import * as vscode from "vscode";
import type { CheckStatus } from "../github/client";
import { sharedScript, sharedStyles, type Handshake } from "../markdownPanel";
import type { ReviewStanding } from "../timeline/panel";
import type { NextStep } from "./dashboardState";

/** A Change open in the review window. */
export interface DashboardChange {
  id: string;
  /** The pull request's title, or the Change's name. */
  title: string;
  /** Such as `acme/api #7 · waiting 2 days · alice`, or `local branch in api`. */
  byline: string;
  /** A pull request's size and checks, once the Inbox has listed it. */
  size?: { files: number; additions: number; deletions: number };
  checks?: string;
  /** The Reviewer's last Review, while no new commits came since. */
  review?: ReviewStanding;
  /** New commits since their Review, pending Comments, files viewed. */
  standing: string[];
  /** A pull request author's cached avatar, as a webview resource URI. */
  avatar?: string;
}

/** A pull request the Inbox lists. */
export interface DashboardPullRequest {
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
export interface DashboardBranch {
  id: string;
  name: string;
  repository: string;
  /** Such as "3 commits ahead of main". */
  ahead: string;
  notes: string[];
}

/** Something the Dashboard couldn't list, and the button that helps. */
export interface DashboardProblem {
  id: string;
  text: string;
  action?: string;
}

/** What to set up before pull requests can be listed, and the links that help. */
export interface DashboardSetup {
  text: string;
  actions: { id: string; label: string }[];
}

export interface DashboardState {
  /** Such as "5 waiting on you · oldest 6 days"; undefined while that's unknown. */
  facts?: string;
  next?: NextStep;
  inProgress: DashboardChange[];
  /** Undefined until the Inbox has loaded, or while it can't. */
  waiting?: DashboardPullRequest[];
  /** The ones the Reviewer set aside, listed collapsed under Waiting on you; they keep their wait. */
  ignored?: DashboardPullRequest[];
  authored?: DashboardPullRequest[];
  reviewed?: DashboardPullRequest[];
  /** Pull requests whose Team request a teammate answered; left out while there are none. */
  teamReviewed?: DashboardPullRequest[];
  branches: DashboardBranch[];
  /** Whether the Inbox is loading. */
  loading: boolean;
  /** What the Reviewer needs to set up before pull requests can be listed. */
  setup?: DashboardSetup;
  /** Why the pull requests couldn't load. */
  problems: DashboardProblem[];
  /** Clones whose branches couldn't be listed. */
  branchProblems: DashboardProblem[];
}

/** Webview to extension. */
export type FromDashboard =
  | Handshake
  | { type: "next" }
  | { type: "openRange" }
  | { type: "resume"; id: string }
  | { type: "finish"; id: string }
  | { type: "close"; id: string }
  | { type: "open"; id: string }
  | { type: "ignore"; id: string }
  | { type: "restore"; id: string }
  | { type: "fix"; id: string };

/** What the Reviewer does in the Dashboard. */
export type DashboardAction = Exclude<FromDashboard, Handshake>;

/** Extension to webview, besides the state. */
type ToWebview = { type: "focus" };

/** How many rows a long list, such as Waiting on you or Local branches, shows before Show all. */
export const shownAtFirst = 5;

export class DashboardView implements vscode.WebviewViewProvider {
  static readonly viewType = "dearReviewer.dashboard";
  private view?: vscode.WebviewView;
  private state: DashboardState;
  private revision = 0;
  private renderedState?: DashboardState;
  /** Whether the next step takes the focus once the webview is ready. */
  private focusWhenReady = false;
  private readonly shown = new vscode.EventEmitter<void>();
  /** Fires when the view comes into sight, so its lists can be shown afresh. */
  readonly onDidShow = this.shown.event;

  /** `avatarDir` holds the cached avatars, the only files the webview may load. */
  constructor(
    state: DashboardState,
    private readonly avatarDir: vscode.Uri,
    private readonly onAction: (action: DashboardAction) => void
  ) {
    this.state = clone(state);
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.renderedState = undefined;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.avatarDir],
    };
    view.webview.html = html(view.webview.cspSource);
    view.webview.onDidReceiveMessage((message: unknown) =>
      this.receive(message as FromDashboard)
    );
    view.onDidChangeVisibility(() => {
      if (view.visible) this.shown.fire();
    });
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });
    this.shown.fire();
  }

  /** Whether the view is in sight. */
  get visible(): boolean {
    return !!this.view?.visible;
  }

  /** The state last sent to the webview. */
  get sent(): DashboardState {
    return clone(this.state);
  }

  /** The state the webview last rendered, once it has rendered the latest one. */
  get rendered(): DashboardState | undefined {
    return this.renderedState && clone(this.renderedState);
  }

  /** The URI the webview loads a local file by, once the view has one. */
  webviewUri(file: vscode.Uri): string | undefined {
    return this.view?.webview.asWebviewUri(file).toString();
  }

  /** Handles a message from the webview; the tests send clicks through here too. */
  receive(message: FromDashboard): void {
    if (message.type === "ready") {
      void this.post();
      if (this.focusWhenReady) this.focus();
      return;
    }
    if (message.type === "rendered") {
      if (message.revision === this.revision)
        this.renderedState = clone(this.state);
      return;
    }
    if (message.type === "next" || message.type === "openRange")
      this.onAction({ type: message.type });
    else if (
      (message.type === "resume" ||
        message.type === "finish" ||
        message.type === "close" ||
        message.type === "open" ||
        message.type === "ignore" ||
        message.type === "restore" ||
        message.type === "fix") &&
      typeof message.id === "string"
    )
      this.onAction({ type: message.type, id: message.id });
  }

  update(state: DashboardState): void {
    this.state = clone(state);
    void this.post();
  }

  /** Puts the focus on the next step, or else the first thing to act on. */
  focus(): void {
    this.focusWhenReady = !this.view;
    void this.view?.webview.postMessage({ type: "focus" } satisfies ToWebview);
  }

  dispose(): void {
    this.shown.dispose();
  }

  private post(): Thenable<boolean> | undefined {
    return this.view?.webview.postMessage({
      type: "state",
      revision: ++this.revision,
      state: this.state,
    });
  }
}

/** The state as JSON carries it to the webview, with absent fields left out. */
function clone<T>(state: T): T {
  return JSON.parse(JSON.stringify(state)) as T;
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
  [hidden] { display: none !important; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-sideBar-foreground, var(--vscode-foreground)); padding: 0 12px 16px; margin: 0; }
  h2 { display: flex; gap: 6px; align-items: baseline; font-size: 1em; margin: 16px 0 2px; }
  h2 .count { font-weight: 400; }
  .muted { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .link { background: none; border: none; padding: 0; color: var(--vscode-textLink-foreground); cursor: pointer; font: inherit; text-align: start; text-decoration: none; }
  .link:hover { text-decoration: underline; }
  button.primary, button.secondary { padding: 2px 8px; border-radius: 2px; cursor: pointer; font: inherit; }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground)); }
  .facts { font-variant-numeric: tabular-nums; }
  .facts .added { color: var(--vscode-gitDecoration-addedResourceForeground); color: color-mix(in srgb, var(--vscode-gitDecoration-addedResourceForeground) 60%, var(--vscode-foreground)); }
  .facts .deleted { color: var(--vscode-gitDecoration-deletedResourceForeground); color: color-mix(in srgb, var(--vscode-gitDecoration-deletedResourceForeground) 60%, var(--vscode-foreground)); }
  .status { font-size: 0.85em; padding: 0 6px; border-radius: 8px; border: 1px solid var(--vscode-descriptionForeground); color: var(--vscode-foreground); }
  .status.passed { border-color: var(--vscode-testing-iconPassed); }
  .status.failed { border-color: var(--vscode-testing-iconFailed); }
  .status.running { border-color: var(--vscode-testing-iconQueued); }
  .status.skipped, .status.neutral { color: var(--vscode-descriptionForeground); }
  .review { color: var(--vscode-foreground); }
  .review.approved .mark { color: var(--vscode-testing-iconPassed); }
  .review.changesRequested .mark { color: var(--vscode-testing-iconFailed); }
  .review.commented .mark { color: var(--vscode-descriptionForeground); }
  .overview { padding: 12px 0; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border)); }
  .overview p { margin: 0 0 2px; }
  #next, .setup button.primary, .setup button.secondary { display: block; width: 100%; max-width: 300px; margin-top: 10px; padding: 4px 12px; text-align: center; overflow-wrap: anywhere; }
  .item { display: flex; gap: 8px; align-items: flex-start; padding: 6px 0; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border)); }
  .item img, .item .no-avatar { width: 16px; height: 16px; margin-top: 2px; border-radius: 50%; flex: none; background: var(--vscode-editor-inactiveSelectionBackground); outline: 1px solid var(--vscode-contrastBorder, transparent); outline-offset: -1px; }
  .item .content { flex: 1; min-width: 0; }
  .item .content > div + div { margin-top: 1px; }
  .item .title { font-weight: 600; overflow-wrap: anywhere; }
  .item .link.title { color: var(--vscode-textLink-foreground); }
  .item .branch { font-family: var(--vscode-editor-font-family); font-weight: 400; }
  .item .muted { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 1px 0; }
  #place { overflow-wrap: anywhere; }
  .item .muted.notes { white-space: normal; overflow: visible; overflow-wrap: anywhere; }
  /* The repository/number and the wait are units that never truncate, so
     the line wraps before one of them rather than cutting it; only the
     author, last and flex-basis 0, is left to shrink and ellipsize. */
  .item .muted.byline { display: flex; flex-wrap: wrap; white-space: normal; overflow: visible; text-overflow: initial; }
  .item .byline .unit { white-space: nowrap; flex: none; }
  .item .byline .author { flex: 1 1 0%; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .item .notes > span { display: inline-block; max-width: 100%; }
  .problem-line { margin: 6px 0 0; }
  /* A link among words is underlined, so it doesn't rely on color alone. */
  .problem-line .link, .setup .muted .link { text-decoration: underline; text-underline-offset: 2px; }
  .setup .muted { margin-top: 8px; }
  .more { margin-top: 6px; }
  .item .actions { flex: none; }
  details.ignored { margin-top: 8px; }
  details.ignored > summary { cursor: pointer; }
  footer { margin-top: 16px; }
</style>
</head>
<body>
<h1 class="visually-hidden">Dear Reviewer Dashboard</h1>
<div class="progress" id="progress" aria-hidden="true" hidden></div>
<section class="overview" aria-label="Where you stand">
  <p class="facts" id="facts"></p>
  <p class="muted" id="place" hidden></p>
  <button class="primary" id="next" type="button" hidden></button>
</section>
<div role="status"><div class="muted problem-line" id="loading"></div></div>
<div id="setup" hidden></div>
<div id="problems"></div>
<section id="inProgress" aria-labelledby="inProgressHeading" hidden><h2 id="inProgressHeading">Active Change <span class="muted count" id="inProgressCount"></span></h2><div id="changes" role="list"></div></section>
<section id="waitingSection" aria-labelledby="waitingHeading" hidden><h2 id="waitingHeading">Waiting on you <span class="muted count" id="waitingCount"></span></h2><div id="waiting" role="list"></div><button class="link more" id="waitingMore" type="button" aria-controls="waiting" aria-expanded="false" hidden></button></section>
<section id="ignoredSection" aria-label="Ignored" hidden><details class="ignored"><summary id="ignoredLabel"></summary><div id="ignored" role="list"></div></details></section>
<section id="authoredSection" aria-labelledby="authoredHeading" hidden><h2 id="authoredHeading">Your pull requests <span class="muted count" id="authoredCount"></span></h2><div id="authored" role="list"></div><button class="link more" id="authoredMore" type="button" aria-controls="authored" aria-expanded="false" hidden></button></section>
<section id="reviewedSection" aria-labelledby="reviewedHeading" hidden><h2 id="reviewedHeading">Reviewed by you <span class="muted count" id="reviewedCount"></span></h2><div id="reviewed" role="list"></div><button class="link more" id="reviewedMore" type="button" aria-controls="reviewed" aria-expanded="false" hidden></button></section>
<section id="teamReviewedSection" aria-labelledby="teamReviewedHeading" hidden><h2 id="teamReviewedHeading">Reviewed by your team <span class="muted count" id="teamReviewedCount"></span></h2><div id="teamReviewed" role="list"></div><button class="link more" id="teamReviewedMore" type="button" aria-controls="teamReviewed" aria-expanded="false" hidden></button></section>
<section id="branchesSection" aria-labelledby="branchesHeading" hidden><h2 id="branchesHeading">Local branches <span class="muted count" id="branchesCount"></span></h2><div id="branchProblems"></div><div id="branches" role="list"></div><button class="link more" id="branchesMore" type="button" aria-controls="branches" aria-expanded="false" hidden></button></section>
<footer><button class="link" id="openRange" type="button" title="Open any commit range of a repository as a Change">Open a commit range…</button></footer>
<script nonce="${nonce}">${sharedScript}
  const vscode = acquireVsCodeApi();
  const byId = (id) => document.getElementById(id);
  const shownAtFirst = ${shownAtFirst};
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
  // A muted line keeps to one line, cut short with an ellipsis, and shows
  // the whole of it on hover. A row's notes, which say what it needs, have
  // a line of their own that wraps instead, so they are never cut.
  const line = (className, parts) => {
    const node = el("div", className);
    parts.filter(Boolean).forEach((part, i) => node.append(...(i ? [" · "] : []), typeof part === "string" ? el("span", "", part) : part));
    const shown = node.cloneNode(true);
    for (const hidden of shown.querySelectorAll(".visually-hidden")) hidden.remove();
    node.title = shown.textContent;
    return node;
  };
  // A pull request's byline: the repository/number and, once it's waiting
  // on the Reviewer, the wait are units that never truncate, wrapping
  // instead if they don't fit; only the author afterward is cut short
  // with an ellipsis, since a long name matters least.
  const byline = (name, waited, author) => {
    const node = el("div", "muted byline");
    node.append(el("span", "unit", name));
    if (waited !== undefined) {
      node.append(el("span", "unit", " · waiting " + waited), el("span", "author", " · " + author));
    }
    node.title = [name, waited !== undefined && "waiting " + waited, waited !== undefined && author].filter(Boolean).join(" · ");
    return node;
  };
  // Each note keeps whole, so the line breaks between notes, and its " ·"
  // keeps to its last word.
  const notes = (parts) => {
    const shown = parts.filter(Boolean);
    if (shown.length === 0) return [];
    const node = el("div", "muted notes");
    shown.forEach((part, i) => {
      const last = i === shown.length - 1;
      const span = el("span");
      span.append(part, ...(last ? [] : ["\u00a0·"]));
      node.append(span, ...(last ? [] : [" "]));
    });
    return [node];
  };
  byId("next").addEventListener("click", () => vscode.postMessage({ type: "next" }));
  byId("openRange").addEventListener("click", () => vscode.postMessage({ type: "openRange" }));
  // A long list shows its first rows, then Show all with the count.
  const showsAll = {};
  for (const id of ["waiting", "authored", "reviewed", "teamReviewed", "branches"])
    byId(id + "More").addEventListener("click", () => {
      showsAll[id] = !showsAll[id];
      keepFocus(() => lists(lastState));
    });

  // Up and down move between a list's rows, to each row's first button.
  document.body.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const row = event.target instanceof Element ? event.target.closest("[role=listitem]") : null;
    if (!row) return;
    const rows = [...row.parentElement.children];
    const to = rows[rows.indexOf(row) + (event.key === "ArrowDown" ? 1 : -1)];
    const target = to && to.querySelector("button");
    if (!target) return;
    event.preventDefault();
    target.focus();
  });

  const reviewMarks = { approved: "✓", changesRequested: "✗", commented: "•", briefed: "✓" };
  function change(entry) {
    const row = el("div", "item change");
    row.setAttribute("role", "listitem");
    row.append(avatar(entry));
    const content = el("div", "content");
    const title = el("div");
    title.append(button("link title", entry.title, { type: "resume", id: entry.id }, "Resume it: show its overview in the review window", "Resume " + entry.title));
    content.append(line("muted", [entry.byline]), title);
    if (entry.size) content.append(line("muted", [size(entry), entry.checks && el("span", "status " + entry.checks, "checks " + entry.checks)]));
    let review;
    if (entry.review) {
      review = el("span", "review " + entry.review.verdict);
      const mark = el("span", "mark", reviewMarks[entry.review.verdict]);
      mark.setAttribute("aria-hidden", "true");
      review.append(mark, " ", entry.review.text);
    }
    content.append(...notes([review, ...entry.standing]));
    row.append(content);
    return row;
  }

  // An author's avatar, or an empty circle in its place, so rows line up.
  function avatar(entry) {
    if (!entry.avatar) return el("div", "no-avatar");
    const img = el("img");
    img.src = entry.avatar;
    img.alt = "";
    return img;
  }

  function size(entry) {
    const { files, additions, deletions } = entry.size;
    const node = el("span", "facts");
    const shown = el("span");
    shown.setAttribute("aria-hidden", "true");
    shown.append(files + (files === 1 ? " file · " : " files · "), el("span", "added", "+" + additions), " ", el("span", "deleted", "−" + deletions));
    node.append(shown, el("span", "visually-hidden", files + (files === 1 ? " file, " : " files, ") + additions + " lines added, " + deletions + " removed"));
    return node;
  }

  // The repository and number come first, so a long title never hides them,
  // and the wait before the author, so a long name is what's cut short.
  // Waiting on you offers Ignore, and Ignored offers Restore; no other list does.
  function pullRequest(entry, action) {
    const row = el("div", "item pull-request");
    row.setAttribute("role", "listitem");
    if (entry.waited !== undefined) row.append(avatar(entry));
    const content = el("div", "content");
    const title = el("div");
    title.append(button("link title", entry.title, { type: "open", id: entry.id }, "Open " + entry.name + " as a Change", entry.title + ", " + entry.name));
    content.append(
      byline(entry.name, entry.waited, entry.author),
      title,
      line("muted", [size(entry), entry.checks && el("span", "status " + entry.checks, "checks " + entry.checks)]),
      ...notes(entry.notes)
    );
    row.append(content);
    if (action) {
      const label = action === "ignore" ? "Ignore" : "Restore";
      const title = action === "ignore" ? "Set it aside, so it stops asking for your attention. GitHub isn't told." : "Put it back in Waiting on you";
      const actions = el("div", "actions");
      actions.append(button("link", label, { type: action, id: entry.id }, title, label + " " + entry.name));
      row.append(actions);
    }
    return row;
  }
  // Built from a list's map, which also passes the index, so none is passed on as the action.
  const plainRow = (entry) => pullRequest(entry);
  const waitingRow = (entry) => pullRequest(entry, "ignore");
  const ignoredRow = (entry) => pullRequest(entry, "restore");

  function branch(entry) {
    const row = el("div", "item branch-row");
    row.setAttribute("role", "listitem");
    const content = el("div", "content");
    const title = el("div");
    title.append(button("link title branch", entry.name, { type: "open", id: entry.id }, "Open " + entry.name + " as a Change"));
    content.append(title, line("muted", [entry.repository, entry.ahead]), ...notes(entry.notes));
    row.append(content);
    return row;
  }

  function problem(entry) {
    const node = el("div", "muted problem-line");
    appendWithCode(node, entry.text);
    if (entry.action) node.append(" ", button("link", entry.action, { type: "fix", id: entry.id }));
    return node;
  }

  // The first way to set up is the next step, so it's the filled button,
  // unless a Change's next step is already the one filled button.
  function setupLine(setup, hasNext) {
    const node = el("div", "setup problem-line");
    const text = el("div");
    appendWithCode(text, setup.text);
    node.append(text);
    const [first, ...rest] = setup.actions;
    if (first) node.append(button(hasNext ? "secondary" : "primary", first.label, { type: "fix", id: first.id }));
    if (rest.length) node.append(line("muted", rest.map((action) => button("link", action.label, { type: "fix", id: action.id }))));
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

  function section(id, entries, countId) {
    byId(id).hidden = entries.length === 0;
    setText(byId(countId), String(entries.length));
  }

  function capped(id, entries, build) {
    const all = !!showsAll[id];
    const more = byId(id + "More");
    more.hidden = entries.length <= shownAtFirst;
    setText(more, all ? "Show less" : "Show all " + entries.length);
    more.setAttribute("aria-expanded", String(all));
    list(id, all ? entries : entries.slice(0, shownAtFirst), build);
  }

  function lists(state) {
    section("waitingSection", state.waiting || [], "waitingCount");
    capped("waiting", state.waiting || [], waitingRow);
    const ignored = state.ignored || [];
    byId("ignoredSection").hidden = ignored.length === 0;
    setText(byId("ignoredLabel"), "Ignored (" + ignored.length + ")");
    list("ignored", ignored, ignoredRow);
    section("authoredSection", state.authored || [], "authoredCount");
    capped("authored", state.authored || [], plainRow);
    section("reviewedSection", state.reviewed || [], "reviewedCount");
    capped("reviewed", state.reviewed || [], plainRow);
    section("teamReviewedSection", state.teamReviewed || [], "teamReviewedCount");
    capped("teamReviewed", state.teamReviewed || [], plainRow);
    byId("branchesSection").hidden = state.branches.length === 0 && state.branchProblems.length === 0;
    setText(byId("branchesCount"), state.branches.length ? String(state.branches.length) : "");
    list("branchProblems", state.branchProblems, problem);
    capped("branches", state.branches, branch);
  }

  let lastState;
  function render(state) {
    lastState = state;
    byId("facts").hidden = !state.facts;
    setText(byId("facts"), state.facts || "");
    const next = state.next;
    document.querySelector(".overview").hidden = !state.facts && !next;
    byId("place").hidden = !next || !next.place;
    byId("next").hidden = !next;
    if (next) {
      setText(byId("place"), next.place || "");
      byId("place").title = next.place || "";
      setText(byId("next"), next.label);
      byId("next").title = next.kind === "open" ? "Open it as a Change in the review window" : next.kind === "resume" ? "Show its overview in the review window" : next.kind === "close" ? "Nothing needs changing, so stop reviewing this Change. Nothing changes on GitHub." : (next.label.startsWith("Write") ? "Write a Brief of your Comments for an agent, in the review window" : "Submit your Review from its overview, in the review window");
    }
    section("inProgress", state.inProgress, "inProgressCount");
    list("changes", state.inProgress, change);
    setText(byId("loading"), state.loading && !state.waiting && !state.setup ? "Loading pull requests…" : "");
    byId("progress").hidden = !state.loading;
    const setup = byId("setup");
    setup.hidden = !state.setup;
    const setupText = JSON.stringify([state.setup || null, !!state.next]);
    if (setup.dataset.said !== setupText) {
      setup.dataset.said = setupText;
      setup.replaceChildren(...(state.setup ? [setupLine(state.setup, !!state.next)] : []));
    }
    list("problems", state.problems, problem);
    lists(state);
  }

  // The next step, or else the first thing to act on.
  function focusFirst() {
    const next = byId("next");
    const target = !next.hidden ? next : document.querySelector("#setup button, [role=list] button, #openRange");
    if (target) target.focus();
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "focus") { focusFirst(); return; }
    if (message.type !== "state") return;
    keepFocus(() => render(message.state));
    vscode.postMessage({ type: "rendered", revision: message.revision });
  });
  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
}
