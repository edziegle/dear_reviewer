// The timeline panel for one pull request: a webview beside the diff. The
// extension sends it the whole timeline state; the webview renders it, says
// which state it rendered, and asks the extension to open links and reload.

import * as crypto from "crypto";
import * as vscode from "vscode";
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

export interface TimelineState {
  /** The pull request's title, once loaded. */
  title: string;
  /** owner/name #number */
  pullRequest: string;
  /** The pull request on GitHub. */
  url?: string;
  /** Whether a reload from GitHub is under way. */
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
 * The timeline as the webview gets it: each description, Comment and review
 * body also rendered from Markdown and sanitised (ADR 0011).
 */
export interface ShownTimeline extends TimelineState {
  items: (TimelineItem & { html?: string })[];
}

/** Webview to extension. */
export type FromWebview =
  | Handshake
  | { type: "openLink"; url: string }
  | { type: "refresh" }
  | { type: "problemAction" };

export class TimelinePanel {
  private readonly view: MarkdownPanel<TimelineState, ShownTimeline>;
  private readonly linkClicked = new vscode.EventEmitter<string>();
  private readonly refreshClicked = new vscode.EventEmitter<void>();
  private readonly problemActionClicked = new vscode.EventEmitter<void>();
  /** Fires when the Reviewer closes the panel. */
  readonly onDidDispose: vscode.Event<void>;
  /** Fires with the URL of a link the Reviewer clicked, as the webview gave it. */
  readonly onDidClickLink = this.linkClicked.event;
  readonly onDidClickRefresh = this.refreshClicked.event;
  /** Fires when the Reviewer clicks the button that goes with the problem. */
  readonly onDidClickProblemAction = this.problemActionClicked.event;

  /** `avatarDir` holds the cached avatars, the only files the webview may load. */
  constructor(state: TimelineState, avatarDir: vscode.Uri) {
    this.view = new MarkdownPanel(state, {
      viewType: "dearReviewer.timeline",
      title: `Timeline: ${state.pullRequest}`,
      localResourceRoots: [avatarDir],
      html: (webview) => html(webview.cspSource),
      show: shown,
      receive: (message) => this.receive(message as FromWebview),
    });
    this.onDidDispose = this.view.onDidDispose;
    this.view.onDidDispose(() => {
      for (const emitter of [
        this.linkClicked,
        this.refreshClicked,
        this.problemActionClicked,
      ])
        emitter.dispose();
    });
  }

  get title(): string {
    return this.view.title;
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
    if (message.type === "openLink" && typeof message.url === "string")
      this.linkClicked.fire(message.url);
    else if (message.type === "refresh") this.refreshClicked.fire();
    else if (message.type === "problemAction") this.problemActionClicked.fire();
  }

  update(state: TimelineState): void {
    this.view.update(state);
  }

  reveal(): void {
    this.view.reveal();
  }

  dispose(): void {
    this.view.dispose();
  }
}

/** Renders each description, Comment and review body. */
function shown(state: TimelineState, render: RenderInto): ShownTimeline {
  const items = state.items.map((item) =>
    item.kind === "commit" || !item.body
      ? item
      : { ...item, html: render(item.body) }
  );
  return { ...state, items };
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
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 0 16px 16px; }
  header { position: sticky; top: 0; background: var(--vscode-editor-background); padding: 12px 0 8px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; gap: 8px; align-items: baseline; }
  header .heading { flex: 1; min-width: 0; }
  h1 { font-size: 1.1em; margin: 0 0 4px; }
  h2 { font-size: 1em; margin: 16px 0 8px; }
  .muted { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  button.link { background: none; border: none; padding: 0; color: var(--vscode-textLink-foreground); cursor: pointer; font: inherit; }
  button.link:hover { text-decoration: underline; }
  button.refresh { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 2px 8px; border-radius: 2px; cursor: pointer; }
  ul { list-style: none; padding: 0; margin: 0; }
  .checks li { display: flex; gap: 8px; align-items: baseline; padding: 2px 0; }
  .checks .name { flex: 1; }
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
  <div class="heading"><h1 id="title"></h1><div class="muted" id="pullRequest"></div></div>
  <button class="refresh" id="refresh" title="Reload the timeline from GitHub">Refresh</button>
</header>
<div class="problem" id="problem" hidden></div>
<section id="checks" hidden><h2 id="checksHeading"></h2><ul class="checks" id="checkRuns"></ul></section>
<section><h2>Timeline</h2><div class="muted" id="loading" hidden>Loading from GitHub…</div><div id="items"></div></section>
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
  byId("refresh").addEventListener("click", () => vscode.postMessage({ type: "refresh" }));
  // Links in bodies open through the extension, which checks them.
  byId("items").addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[data-href]") : null;
    if (!link) return;
    event.preventDefault();
    vscode.postMessage({ type: "openLink", url: link.dataset.href });
  });
  byId("items").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target instanceof HTMLAnchorElement) event.target.click();
  });

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
      for (const a of body.querySelectorAll("a[data-href]")) {
        a.tabIndex = 0;
        a.setAttribute("role", "link");
      }
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

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type !== "state") return;
    const state = message.state;
    byId("title").replaceChildren(state.url ? link(state.title, state.url) : state.title);
    byId("pullRequest").textContent = state.pullRequest;
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
