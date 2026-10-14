// The Assistant panel for one Change: a webview beside the diff that shows
// the conversation and takes the Reviewer's messages. The extension sends it
// the whole conversation state; the webview renders it, says which state it
// rendered, and sends what the Reviewer asks. The Assistant's replies are
// Markdown, which the extension renders and sanitises before sending
// (ADR 0011); the webview opens no links or files itself, but asks.

import * as crypto from "crypto";
import * as vscode from "vscode";
import { renderMarkdown } from "../markdown";
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
  /** The Change's title. */
  title: string;
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
}

/** The conversation as the webview gets it, with each reply's Markdown rendered. */
export interface ShownConversation extends ConversationState {
  messages: (Message & { html?: string })[];
}

/** Extension to webview. */
type ToWebview =
  | { type: "state"; revision: number; state: ShownConversation }
  | { type: "focus" };
/** Webview to extension. */
export type FromWebview =
  | { type: "ready" }
  | { type: "rendered"; revision: number }
  | { type: "ask"; text: string }
  | { type: "removeContext"; index: number }
  | { type: "problemAction" }
  | { type: "openLink"; url: string }
  | { type: "openReference"; path: string; startLine: number; endLine: number };

/** What the Reviewer does in the panel. */
export type ReviewerAction = Extract<
  FromWebview,
  | { type: "ask" }
  | { type: "removeContext" }
  | { type: "problemAction" }
  | { type: "openLink" }
  | { type: "openReference" }
>;

export class AssistantPanel {
  private readonly panel: vscode.WebviewPanel;
  private state: ShownConversation;
  private revision = 0;
  private renderedState?: ShownConversation;
  /** The web links in the replies sent, the only ones the panel may open. */
  private links = new Set<string>();
  private readonly disposed = new vscode.EventEmitter<void>();
  /** Fires when the Reviewer closes the panel. */
  readonly onDidDispose = this.disposed.event;

  constructor(
    state: ConversationState,
    private readonly onAction: (action: ReviewerAction) => void
  ) {
    this.state = this.shown(state);
    this.panel = vscode.window.createWebviewPanel(
      "dearReviewer.assistant",
      `Assistant: ${state.title}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      }
    );
    this.panel.webview.html = html();
    this.panel.webview.onDidReceiveMessage((message: FromWebview) =>
      this.receive(message)
    );
    this.panel.onDidDispose(() => {
      this.disposed.fire();
      this.disposed.dispose();
    });
  }

  /** The state last sent to the webview. */
  get sent(): ShownConversation {
    return clone(this.state);
  }

  /** The state the webview last rendered, once it has rendered the latest one. */
  get rendered(): ShownConversation | undefined {
    return this.renderedState && clone(this.renderedState);
  }

  update(state: ConversationState): void {
    this.state = this.shown(state);
    this.panel.title = `Assistant: ${state.title}`;
    void this.post();
  }

  /** Handles a message from the webview; the tests send them here too. */
  receive(message: FromWebview): void {
    if (message.type === "ready") void this.post();
    else if (message.type === "rendered") {
      if (message.revision === this.revision)
        this.renderedState = clone(this.state);
    } else if (message.type === "ask") {
      if (typeof message.text === "string" && message.text.trim())
        this.onAction({ type: "ask", text: message.text.trim() });
    } else if (message.type === "removeContext") {
      if (Number.isInteger(message.index)) this.onAction(message);
    } else if (message.type === "problemAction") {
      this.onAction({ type: "problemAction" });
    } else if (message.type === "openLink") {
      if (typeof message.url === "string" && this.links.has(message.url))
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

  /** Brings the panel forward; with `focus`, puts the cursor in its message box. */
  reveal(focus = false): void {
    this.panel.reveal(undefined, !focus);
    if (focus)
      void this.panel.webview.postMessage({
        type: "focus",
      } satisfies ToWebview);
  }

  dispose(): void {
    this.panel.dispose();
  }

  /** Renders each reply's Markdown, and keeps the links it has. */
  private shown(state: ConversationState): ShownConversation {
    const links = new Set<string>();
    const messages = state.messages.map((message) => {
      if (message.from !== "assistant") return message;
      const rendered = renderMarkdown(message.text, { references: true });
      for (const link of rendered.links) links.add(link);
      return { ...message, html: rendered.html };
    });
    this.links = links;
    return clone({ ...state, messages });
  }

  private post(): Thenable<boolean> {
    const message: ToWebview = {
      type: "state",
      revision: ++this.revision,
      state: this.state,
    };
    return this.panel.webview.postMessage(message);
  }
}

/** The state as JSON carries it to the webview, with absent fields left out. */
function clone(state: ShownConversation): ShownConversation {
  return JSON.parse(JSON.stringify(state)) as ShownConversation;
}

function html(): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 0 16px; margin: 0; display: flex; flex-direction: column; min-height: 100vh; }
  header { position: sticky; top: 0; background: var(--vscode-editor-background); padding: 12px 0 8px; border-bottom: 1px solid var(--vscode-panel-border); }
  h1 { font-size: 1.1em; margin: 0 0 4px; }
  .login { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  main { flex: 1; }
  .message { white-space: pre-wrap; line-height: 1.5; margin: 12px 0; }
  .message.reviewer { padding: 8px; border-radius: 4px; background: var(--vscode-editor-inactiveSelectionBackground); }
  .message.note { color: var(--vscode-descriptionForeground); font-style: italic; }
  .context { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
  .chip { font-family: var(--vscode-editor-font-family); font-size: 0.85em; padding: 1px 6px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); white-space: nowrap; }
  .chip button { background: none; border: none; color: inherit; cursor: pointer; padding: 0 0 0 4px; font: inherit; }
  .problem { margin: 12px 0; padding: 8px; border: 1px solid var(--vscode-inputValidation-errorBorder); background: var(--vscode-inputValidation-errorBackground); white-space: pre-wrap; }
  .problem button { display: block; margin-top: 8px; padding: 4px 10px; border: none; border-radius: 2px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; font: inherit; }
  .problem button:hover { background: var(--vscode-button-hoverBackground); }
  .busy { color: var(--vscode-descriptionForeground); margin: 8px 0; }
  .busy .now { font-style: italic; }
  .busy code { font-family: var(--vscode-editor-font-family); font-style: normal; }
  .busy details { margin-top: 2px; font-size: 0.9em; }
  .busy summary { cursor: pointer; }
  .busy ol { margin: 4px 0; padding-left: 20px; }
  .message.assistant { white-space: normal; }
  .markdown > :first-child { margin-top: 0; }
  .markdown > :last-child { margin-bottom: 0; }
  .markdown h1, .markdown h2, .markdown h3, .markdown h4 { font-size: 1.05em; margin: 1em 0 0.4em; }
  .markdown h1 { font-size: 1.2em; }
  .markdown h2 { font-size: 1.1em; }
  .markdown p, .markdown ul, .markdown ol, .markdown pre, .markdown blockquote, .markdown table { margin: 0.5em 0; }
  .markdown ul, .markdown ol { padding-left: 1.6em; }
  .markdown code { font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); background: var(--vscode-textCodeBlock-background); padding: 0 3px; border-radius: 3px; }
  .markdown pre { background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 3px; overflow-x: auto; }
  .markdown pre code { padding: 0; background: none; white-space: pre; }
  .markdown blockquote { background: var(--vscode-textBlockQuote-background); padding: 4px 8px; border-radius: 3px; color: var(--vscode-textBlockQuote-foreground, inherit); }
  .markdown table { border-collapse: collapse; }
  .markdown th, .markdown td { border: 1px solid var(--vscode-panel-border); padding: 2px 6px; }
  .markdown a[data-href], .markdown a[data-path] { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: none; }
  .markdown a[data-href]:hover, .markdown a[data-path]:hover { text-decoration: underline; }
  footer { position: sticky; bottom: 0; background: var(--vscode-editor-background); padding: 8px 0 12px; border-top: 1px solid var(--vscode-panel-border); }
  form { display: flex; gap: 6px; align-items: flex-end; }
  textarea { flex: 1; resize: vertical; min-height: 2.6em; font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; padding: 4px 6px; }
  textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  button.send { font: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: none; border-radius: 2px; padding: 4px 12px; cursor: pointer; }
  button.send:hover { background: var(--vscode-button-hoverBackground); }
  button.send:disabled { opacity: 0.5; cursor: default; }
</style>
</head>
<body>
<header><h1 id="title"></h1><div class="login" id="login"></div></header>
<main id="messages"></main>
<div class="busy" id="busy" hidden><div class="now" id="now"></div><details id="steps" hidden><summary id="stepCount"></summary><ol id="stepList"></ol></details></div>
<div class="problem" id="problem" hidden></div>
<footer>
  <div class="context" id="context"></div>
  <form id="ask">
    <textarea id="text" rows="2" aria-label="Ask the Assistant about this Change" placeholder="Ask about this Change. Enter sends; Shift+Enter starts a new line."></textarea>
    <button class="send" id="send" type="submit">Send</button>
  </form>
</footer>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const byId = (id) => document.getElementById(id);
  const lines = (s) => s.startLine === s.endLine ? "line " + s.startLine : "lines " + s.startLine + "–" + s.endLine;
  const chip = (s, onRemove) => {
    const span = document.createElement("span");
    span.className = "chip";
    const side = s.side === "commit" ? "commit " + s.commit.slice(0, 7) : s.side;
    span.textContent = s.path + " · " + side + " · " + lines(s);
    if (onRemove) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "×";
      button.title = "Don't send this selection";
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
  let busy = false;
  const text = byId("text");
  const send = () => {
    const value = text.value.trim();
    if (!value || busy) return;
    vscode.postMessage({ type: "ask", text: value });
    text.value = "";
  };
  byId("ask").addEventListener("submit", (event) => { event.preventDefault(); send(); });
  text.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); send(); }
  });
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "focus") { text.focus(); return; }
    if (message.type !== "state") return;
    const state = message.state;
    byId("title").textContent = state.title;
    byId("login").textContent = state.login ? "Claude login: " + state.login : "";
    byId("messages").replaceChildren(...state.messages.map((m) => {
      const div = document.createElement("div");
      div.className = "message " + m.from;
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
    }));
    const steps = state.steps || [];
    const last = steps[steps.length - 1];
    byId("now").replaceChildren(...(last ? stepNodes(last, "…") : ["The Assistant is working…"]));
    byId("steps").hidden = steps.length < 2;
    byId("stepCount").textContent = steps.length + " steps so far";
    byId("stepList").replaceChildren(...steps.map((step) => {
      const li = document.createElement("li");
      li.append(...stepNodes(step, ""));
      return li;
    }));
    byId("context").replaceChildren(...(state.context || []).map((s, index) =>
      chip(s, () => vscode.postMessage({ type: "removeContext", index }))));
    busy = state.busy;
    byId("send").disabled = busy;
    byId("busy").hidden = !state.busy;
    byId("problem").hidden = !state.problem;
    byId("problem").textContent = state.problem || "";
    if (state.problem && state.problemAction) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = state.problemAction;
      button.addEventListener("click", () => vscode.postMessage({ type: "problemAction" }));
      byId("problem").append(button);
    }
    vscode.postMessage({ type: "rendered", revision: message.revision });
  });
  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
}
