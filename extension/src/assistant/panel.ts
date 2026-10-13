// The Assistant panel for one Change: a webview beside the diff that shows
// the conversation. The extension sends it the whole conversation state;
// the webview renders it and says which state it rendered.

import * as crypto from "crypto";
import * as vscode from "vscode";

export interface ConversationState {
  /** The Change's title. */
  title: string;
  /** The Claude login the Assistant runs on. */
  login?: string;
  /** Whether the Assistant is working on a reply. */
  busy: boolean;
  messages: { from: "assistant" | "reviewer"; text: string }[];
  /** What went wrong, in words for the Reviewer. */
  problem?: string;
}

/** Extension to webview. */
type ToWebview = { type: "state"; revision: number; state: ConversationState };
/** Webview to extension. */
type FromWebview = { type: "ready" } | { type: "rendered"; revision: number };

export class AssistantPanel {
  private readonly panel: vscode.WebviewPanel;
  private state: ConversationState;
  private revision = 0;
  private renderedState?: ConversationState;
  private readonly disposed = new vscode.EventEmitter<void>();
  /** Fires when the Reviewer closes the panel. */
  readonly onDidDispose = this.disposed.event;

  constructor(state: ConversationState) {
    this.state = clone(state);
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
    this.panel.webview.onDidReceiveMessage((message: FromWebview) => {
      if (message.type === "ready") void this.post();
      else if (
        message.type === "rendered" &&
        message.revision === this.revision
      )
        this.renderedState = clone(this.state);
    });
    this.panel.onDidDispose(() => {
      this.disposed.fire();
      this.disposed.dispose();
    });
  }

  /** The state last sent to the webview. */
  get sent(): ConversationState {
    return clone(this.state);
  }

  /** The state the webview last rendered, once it has rendered the latest one. */
  get rendered(): ConversationState | undefined {
    return this.renderedState && clone(this.renderedState);
  }

  update(state: ConversationState): void {
    this.state = clone(state);
    void this.post();
  }

  reveal(): void {
    this.panel.reveal(undefined, true);
  }

  dispose(): void {
    this.panel.dispose();
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
function clone(state: ConversationState): ConversationState {
  return JSON.parse(JSON.stringify(state)) as ConversationState;
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
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 0 16px 16px; }
  header { position: sticky; top: 0; background: var(--vscode-editor-background); padding: 12px 0 8px; border-bottom: 1px solid var(--vscode-panel-border); }
  h1 { font-size: 1.1em; margin: 0 0 4px; }
  .login { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .message { white-space: pre-wrap; line-height: 1.5; margin: 12px 0; }
  .message.reviewer { padding: 8px; border-left: 3px solid var(--vscode-textLink-foreground); }
  .problem { margin: 12px 0; padding: 8px; border: 1px solid var(--vscode-inputValidation-errorBorder); background: var(--vscode-inputValidation-errorBackground); white-space: pre-wrap; }
  .busy { color: var(--vscode-descriptionForeground); font-style: italic; }
</style>
</head>
<body>
<header><h1 id="title"></h1><div class="login" id="login"></div></header>
<main id="messages"></main>
<div class="busy" id="busy" hidden>The Assistant is reading the Change…</div>
<div class="problem" id="problem" hidden></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const byId = (id) => document.getElementById(id);
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type !== "state") return;
    const state = message.state;
    byId("title").textContent = state.title;
    byId("login").textContent = state.login ? "Claude login: " + state.login : "";
    const messages = byId("messages");
    messages.replaceChildren(...state.messages.map((m) => {
      const div = document.createElement("div");
      div.className = "message " + m.from;
      div.textContent = m.text;
      return div;
    }));
    byId("busy").hidden = !state.busy;
    byId("problem").hidden = !state.problem;
    byId("problem").textContent = state.problem || "";
    vscode.postMessage({ type: "rendered", revision: message.revision });
  });
  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
}
