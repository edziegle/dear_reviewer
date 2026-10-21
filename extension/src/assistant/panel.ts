// The Assistant's view in the Secondary Side Bar (ADR 0038): a webview that
// shows one Change's conversation at a time and takes the Reviewer's
// messages. The extension sends it the whole conversation state; the webview
// renders it, says which state it rendered, and sends what the Reviewer asks.
// The Assistant's replies are Markdown, which the extension renders and
// sanitises before sending (ADR 0011); the webview opens no links or files
// itself, but asks.

import * as crypto from "crypto";
import * as vscode from "vscode";
import { catMark, catSymbol } from "../assistantMark";
import {
  Handshake,
  MarkdownState,
  RenderInto,
  sharedScript,
  sharedStyles,
} from "../markdownPanel";
import type { Step } from "./activity";
import type { Selection } from "./prompts";

export type { Step } from "./activity";
export type { Selection } from "./prompts";

export interface Message {
  /** A note is Dear Reviewer's own, such as that the Change has new commits. */
  from: "assistant" | "reviewer" | "note";
  text: string;
  /** The selections the Reviewer sent with the message. */
  context?: Selection[];
}

export interface ConversationState {
  /** The Change as the Reviewer knows it, which the view's title and heading show. */
  name: string;
  /** The pull request's title once it has loaded, which the heading shows in place of the name. */
  heading?: string;
  /** The Change's commits, such as `3f2a1c0..9be41d7`; with a title in the heading, where the Change comes from too. */
  range: string;
  /** The Claude login the Assistant runs on. */
  login?: string;
  /** Whether the Assistant is working on a reply. */
  busy: boolean;
  /** What the Assistant has done so far in the turn it is working on. */
  steps?: Step[];
  messages: Message[];
  /** Selections waiting to go with the Reviewer's next message. */
  context?: (Selection & { text: string })[];
  /** What went wrong, in words for the Reviewer. */
  problem?: string;
  /** The label of the button that helps with the problem, if one does. */
  problemAction?: string;
  /** Whether `claude` couldn't run, so the Assistant can't reply until it is started again. */
  unavailable?: boolean;
  /** Whether the Assistant is taking a turn the Reviewer can stop. */
  stoppable?: boolean;
}

/** The conversation as the webview gets it, with each reply's Markdown rendered. */
export interface ShownConversation extends ConversationState {
  messages: (Message & { html?: string })[];
}

/** Extension to webview, besides the state. */
type ToWebview = { type: "focus" };
/** Webview to extension. */
export type FromWebview =
  | Handshake
  | { type: "ask"; text: string }
  | { type: "removeContext"; index: number }
  | { type: "problemAction" }
  | { type: "retry" }
  | { type: "stop" }
  | { type: "openFromList" }
  | { type: "openLink"; url: string }
  | { type: "openReference"; path: string; startLine: number; endLine: number };

/** What the Reviewer does in the view. */
export type ReviewerAction = Exclude<FromWebview, Handshake>;

/** The conversation the view shows before it is given one: none. */
const noConversation: ConversationState = {
  name: "",
  range: "",
  busy: false,
  messages: [],
};

export class AssistantView implements vscode.WebviewViewProvider {
  static readonly viewType = "dearReviewer.assistant";
  private view?: vscode.WebviewView;
  private readonly content: MarkdownState<ConversationState, ShownConversation>;
  /** The Change's name the view's title shows. */
  private name = "";
  /** Whether the message box takes the cursor once the webview is ready. */
  private focusWhenReady = false;
  private readonly shown = new vscode.EventEmitter<void>();
  /** Fires when the view comes into sight. */
  readonly onDidShow = this.shown.event;

  /** `onAction` gets what the Reviewer does, in whichever conversation the view shows. */
  constructor(private readonly onAction: (action: ReviewerAction) => void) {
    this.content = new MarkdownState(
      noConversation,
      shownConversation,
      () => this.view?.webview
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.description = this.name;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = html();
    view.webview.onDidReceiveMessage((message: unknown) =>
      this.receive(message as FromWebview)
    );
    view.onDidChangeVisibility(() => {
      if (view.visible) this.shown.fire();
    });
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });
    if (view.visible) this.shown.fire();
  }

  /** Whether the view is in sight. */
  get visible(): boolean {
    return !!this.view?.visible;
  }

  /** The state last sent to the webview. */
  get sent(): ShownConversation {
    return this.content.sent;
  }

  /** The state the webview last rendered, once it has rendered the latest one. */
  get rendered(): ShownConversation | undefined {
    return this.content.rendered;
  }

  /** Shows the conversation, which may be another Change's than the one shown before. */
  update(state: ConversationState): void {
    this.name = state.name;
    if (this.view) this.view.description = state.name;
    this.content.update(state);
  }

  /** Shows no conversation, once the Change it showed has closed. */
  clear(): void {
    this.update(noConversation);
  }

  /** Handles a message from the webview; the tests send them here too. */
  receive(message: FromWebview): void {
    if (message.type === "ready" && this.focusWhenReady) {
      this.focusWhenReady = false;
      void this.view?.webview.postMessage({
        type: "focus",
      } satisfies ToWebview);
    }
    if (this.content.handshake(message)) return;
    if (message.type === "ask") {
      if (typeof message.text === "string" && message.text.trim())
        this.onAction({ type: "ask", text: message.text.trim() });
    } else if (message.type === "removeContext") {
      if (Number.isInteger(message.index)) this.onAction(message);
    } else if (
      message.type === "problemAction" ||
      message.type === "retry" ||
      message.type === "stop" ||
      message.type === "openFromList"
    ) {
      this.onAction({ type: message.type });
    } else if (message.type === "openLink") {
      // Only links in the replies sent, the only ones the view may open.
      if (typeof message.url === "string" && this.content.hasLink(message.url))
        this.onAction({ type: "openLink", url: message.url });
    } else if (message.type === "openReference") {
      const { path, startLine, endLine } = message;
      if (
        typeof path === "string" &&
        Number.isInteger(startLine) &&
        Number.isInteger(endLine)
      )
        this.onAction({ type: "openReference", path, startLine, endLine });
    }
  }

  /**
   * Shows the view, opening the Secondary Side Bar if it is closed, and puts
   * the cursor in its message box.
   */
  async reveal(): Promise<void> {
    await vscode.commands.executeCommand(`${AssistantView.viewType}.focus`);
    // A webview that hasn't loaded yet would drop the message.
    this.focusWhenReady = true;
    void this.view?.webview.postMessage({
      type: "focus",
    } satisfies ToWebview);
  }

  dispose(): void {
    this.shown.dispose();
  }
}

/** Renders each reply's Markdown, with `path:line` references. */
function shownConversation(
  state: ConversationState,
  render: RenderInto
): ShownConversation {
  const messages = state.messages.map((message) =>
    message.from === "assistant"
      ? { ...message, html: render(message.text, { references: true }) }
      : message
  );
  return { ...state, messages };
}

function html(): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">${sharedStyles}
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-sideBar-foreground, var(--vscode-foreground)); padding: 0 12px; margin: 0; display: flex; flex-direction: column; min-height: 100vh; }
  header { position: sticky; top: 0; background: var(--vscode-sideBar-background, var(--vscode-editor-background)); padding: 12px 0 8px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border)); }
  h1 { font-size: 1.1em; margin: 0 0 4px; }
  .muted { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  /* The working line and any problem follow the conversation, and the footer keeps to the bottom. */
  .conversation { flex: 1; }
  .message { white-space: pre-wrap; line-height: 1.5; margin: 12px 0; }
  .message.reviewer { padding: 8px; border-radius: 4px; background: var(--vscode-editor-inactiveSelectionBackground); outline: 1px solid var(--vscode-contrastBorder, transparent); outline-offset: -1px; }
  .message.note { color: var(--vscode-descriptionForeground); font-style: italic; }
  .context { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
  .chip { display: inline-flex; align-items: center; font-family: var(--vscode-editor-font-family); font-size: 0.85em; padding: 1px 6px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); outline: 1px solid var(--vscode-contrastBorder, transparent); outline-offset: -1px; max-width: 100%; overflow-wrap: anywhere; }
  .chip button { display: inline-flex; align-items: center; justify-content: center; flex: none; min-width: 20px; min-height: 20px; margin: -2px -5px -2px 2px; padding: 0; background: none; border: none; border-radius: 2px; color: inherit; cursor: pointer; }
  .chip button:hover { background: var(--vscode-toolbar-hoverBackground); }
  .chip button svg { width: 12px; height: 12px; }
  .busy { color: var(--vscode-descriptionForeground); margin: 12px 0; }
  .busy .now { font-style: italic; }
  .busy code { font-family: var(--vscode-editor-font-family); font-style: normal; }
  .busy details { margin-top: 2px; font-size: 0.9em; }
  .busy summary { cursor: pointer; }
  .busy ol { margin: 4px 0; padding-left: 20px; }
  button.stop { background: none; border: none; padding: 0; margin-top: 2px; color: var(--vscode-textLink-foreground); cursor: pointer; font: inherit; font-size: 0.9em; }
  button.stop:hover { text-decoration: underline; }
  .message.assistant { white-space: normal; max-width: 80ch; }
  .problem .buttons { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .problem .buttons button { margin-top: 0; }
  .problem button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  .problem button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground)); }
  footer { position: sticky; bottom: 0; background: var(--vscode-sideBar-background, var(--vscode-editor-background)); padding: 8px 0 12px; border-top: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border)); }
  form { display: flex; gap: 6px; align-items: flex-end; }
  textarea { flex: 1; }
  .hint { margin-top: 4px; }
  .empty { margin: 12px 0; }
  .empty p { margin: 0 0 8px; color: var(--vscode-descriptionForeground); }
  button.send { font: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border-radius: 2px; padding: 4px 12px; cursor: pointer; }
  button.send:hover { background: var(--vscode-button-hoverBackground); }
  button.send:disabled { opacity: 0.5; cursor: default; }
</style>
</head>
<body>
<header id="header"><h1 id="title"></h1><div class="muted" id="range"></div><div class="muted" id="login"></div></header>
${catSymbol}
<div class="conversation">
<div class="empty" id="empty" hidden><p>No Change is open, so there is no conversation to show.</p><button class="send" id="openFromList" type="button">Open Pull Request or Branch…</button></div>
<main id="messages"></main>
<div class="busy hand" id="busy" hidden><div class="now" id="now"></div><details id="steps" hidden><summary id="stepCount"></summary><ol id="stepList"></ol></details><button class="stop" id="stop" type="button" title="Stop this reply; the conversation goes on with your next message" hidden>Stop</button></div>
<div class="problem" id="problem" role="alert" hidden></div>
</div>
<div class="visually-hidden" id="announce" role="status"></div>
<footer id="footer">
  <div class="context" id="context"></div>
  <form id="ask">
    <textarea id="text" rows="2" aria-label="Ask the Assistant about this Change" aria-describedby="hint" data-focus-default></textarea>
    <button class="send" id="send" type="submit">Send</button>
  </form>
  <div class="muted hint" id="hint">Enter sends · Shift+Enter starts a new line</div>
</footer>
<script nonce="${nonce}">${sharedScript}
  const vscode = acquireVsCodeApi();
  const byId = (id) => document.getElementById(id);
  const lines = (s) => s.startLine === s.endLine ? "line " + s.startLine : "lines " + s.startLine + "–" + s.endLine;
  const closeIcon = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z"/></svg>';
  const chip = (s, onRemove) => {
    const span = document.createElement("span");
    span.className = "chip";
    const side = s.side === "commit" ? "commit " + s.commit.slice(0, 7) : s.side;
    span.textContent = s.path + " · " + side + " · " + lines(s);
    if (onRemove) {
      const button = document.createElement("button");
      button.type = "button";
      button.innerHTML = closeIcon;
      button.title = "Don't send this selection";
      button.setAttribute("aria-label", "Don't send " + s.path + ", " + lines(s));
      button.addEventListener("click", onRemove);
      span.append(button);
    }
    return span;
  };
  const stepNodes = (step, end) => {
    const nodes = [step.doing];
    if (step.subject) {
      const code = document.createElement("code");
      code.textContent = step.subject;
      nodes.push(" ", code);
    }
    nodes.push(end);
    return nodes;
  };
  // Who said it: the Assistant's name shows, in its hand; the others' are
  // for screen readers, as the look already tells.
  const speakers = { reviewer: "You: ", note: "Dear Reviewer: " };
  const messageNode = (m) => {
    const div = document.createElement("div");
    div.className = "message " + m.from;
    // The Assistant's name is a heading, so a reply's own headings, which sit
    // below it, don't jump a level.
    const speaker = document.createElement(m.from === "assistant" ? "h2" : "div");
    if (m.from === "assistant") {
      div.classList.add("hand");
      speaker.className = "speaker";
      speaker.innerHTML = ${JSON.stringify(catMark)};
      speaker.append("Assistant");
    } else {
      speaker.className = "visually-hidden";
      speaker.textContent = speakers[m.from] || "";
    }
    div.append(speaker);
    if (m.context && m.context.length) {
      const context = document.createElement("div");
      context.className = "context";
      context.append(...m.context.map((s) => chip(s)));
      div.append(context);
    }
    if (m.html !== undefined) {
      const body = document.createElement("div");
      body.className = "markdown";
      // Rendered and sanitised by the extension; see renderMarkdown.
      body.innerHTML = m.html;
      for (const a of body.querySelectorAll("a[data-href], a[data-path]")) {
        a.tabIndex = 0;
        a.setAttribute("role", "link");
      }
      div.append(body);
    } else {
      div.append(document.createTextNode(m.text));
    }
    return div;
  };
  // Builds only the messages that changed, such as the reply being written,
  // so the focus on a link in an earlier one stays put.
  const shownMessages = [];
  const showMessages = (messages) => {
    const root = byId("messages");
    let changed = false;
    messages.forEach((m, i) => {
      const key = JSON.stringify(m);
      if (shownMessages[i] === key) return;
      shownMessages[i] = key;
      changed = true;
      const node = messageNode(m);
      if (root.children[i]) root.children[i].replaceWith(node);
      else root.append(node);
    });
    while (root.children.length > messages.length) {
      root.lastElementChild.remove();
      changed = true;
    }
    shownMessages.length = messages.length;
    return changed;
  };
  const button = (label, type, className) => {
    const node = document.createElement("button");
    node.type = "button";
    node.textContent = label;
    if (className) node.className = className;
    node.addEventListener("click", () => vscode.postMessage({ type }));
    return node;
  };
  // Links and file references open through the extension, which checks them.
  byId("messages").addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a") : null;
    if (!link) return;
    event.preventDefault();
    if (link.dataset.href) vscode.postMessage({ type: "openLink", url: link.dataset.href });
    else if (link.dataset.path) vscode.postMessage({
      type: "openReference",
      path: link.dataset.path,
      startLine: Number(link.dataset.start),
      endLine: Number(link.dataset.end),
    });
  });
  byId("messages").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target instanceof HTMLAnchorElement) event.target.click();
  });
  byId("openFromList").addEventListener("click", () => vscode.postMessage({ type: "openFromList" }));
  byId("stop").addEventListener("click", () => vscode.postMessage({ type: "stop" }));
  let busy;
  let unavailable = false;
  const text = byId("text");
  const send = () => {
    const value = text.value.trim();
    if (!value || busy || unavailable) return;
    vscode.postMessage({ type: "ask", text: value });
    text.value = "";
  };
  byId("ask").addEventListener("submit", (event) => { event.preventDefault(); send(); });
  text.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); send(); }
  });
  // What the Reviewer was writing to each Change's Assistant, kept while the view shows another.
  const drafts = new Map();
  let shownName;
  const render = (state) => {
    const another = state.name !== shownName;
    if (another) {
      if (shownName !== undefined) drafts.set(shownName, text.value);
      text.value = drafts.get(state.name) || "";
      drafts.delete(state.name);
      shownName = state.name;
    }
    // A Reviewer reading at the end keeps following the reply as it grows,
    // and another Change's conversation opens at its end.
    const following = another || window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 24;
    // With no conversation to show, the view offers the way to one instead.
    const none = !state.name;
    byId("empty").hidden = !none;
    byId("header").hidden = none;
    byId("footer").hidden = none;
    setText(byId("title"), state.heading || state.name);
    setText(byId("range"), state.range);
    setText(byId("login"), state.login ? "Claude login: " + state.login : "");
    const grew = showMessages(state.messages);
    const steps = state.steps || [];
    const last = steps[steps.length - 1];
    byId("now").replaceChildren(...(last ? stepNodes(last, "…") : ["The Assistant is working…"]));
    byId("steps").hidden = steps.length < 2;
    setText(byId("stepCount"), steps.length + " steps so far");
    if (byId("stepList").children.length !== steps.length)
      byId("stepList").replaceChildren(...steps.map((step) => {
        const li = document.createElement("li");
        li.append(...stepNodes(step, ""));
        return li;
      }));
    byId("stop").hidden = !state.stoppable;
    const context = JSON.stringify(state.context || []);
    if (byId("context").dataset.shown !== context) {
      byId("context").dataset.shown = context;
      byId("context").replaceChildren(...(state.context || []).map((s, index) =>
        chip(s, () => vscode.postMessage({ type: "removeContext", index }))));
    }
    // Tells a screen reader when a reply starts and ends, not each step, nor
    // when the view moves to another Change's conversation.
    if (busy !== undefined && !another && state.busy !== busy)
      byId("announce").textContent = state.busy ? "The Assistant is working on a reply." : "The Assistant replied.";
    busy = state.busy;
    unavailable = !!state.unavailable;
    byId("send").disabled = busy || unavailable;
    text.placeholder = unavailable
      ? "The Assistant can't reply until Claude Code runs; see above."
      : "Ask about this Change.";
    byId("busy").hidden = !state.busy;
    const problem = byId("problem");
    problem.hidden = !state.problem;
    const said = JSON.stringify([state.problem, state.problemAction, unavailable]);
    if (problem.dataset.said !== said) {
      problem.dataset.said = said;
      problem.replaceChildren();
      if (state.problem) {
        appendWithCode(problem, state.problem);
        const buttons = document.createElement("div");
        buttons.className = "buttons";
        if (state.problemAction) buttons.append(button(state.problemAction, "problemAction"));
        // One filled button: Retry is secondary beside the one that helps.
        if (unavailable) buttons.append(button("Retry", "retry", state.problemAction ? "secondary" : ""));
        if (buttons.children.length) problem.append(buttons);
      }
    }
    if (following && grew) window.scrollTo(0, document.documentElement.scrollHeight);
  };
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "focus") { text.focus(); return; }
    if (message.type !== "state") return;
    keepFocus(() => render(message.state));
    vscode.postMessage({ type: "rendered", revision: message.revision });
  });
  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
}
