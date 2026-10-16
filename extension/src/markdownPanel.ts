// What the Assistant and timeline panels share: a webview beside the diff to
// which the extension sends its whole state, with any Markdown in it already
// rendered and sanitised (ADR 0011). The webview says when it is ready for
// the state, and which state it rendered. The panel keeps the web links in
// the Markdown it sent, the only links the webview may ask to open.

import * as vscode from "vscode";
import { renderMarkdown, type RenderOptions } from "./markdown";

/**
 * The styles the webviews share: rendered Markdown, the problem banner and
 * its button, the Assistant's hand, the message box, the focus outline on
 * every button, link and summary, and the theme's button border, which only
 * high-contrast themes draw (DESIGN.md).
 */
export const sharedStyles = `
  button:focus-visible, a:focus-visible, summary:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  button.primary, button.secondary, button.send, .problem button { border: 1px solid var(--vscode-button-border, var(--vscode-contrastBorder, transparent)); }
  textarea { resize: vertical; min-height: 2.6em; font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; padding: 4px 6px; }
  textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  textarea::placeholder { color: var(--vscode-input-placeholderForeground); opacity: 1; }
  .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .markdown > :first-child { margin-top: 0; }
  .markdown > :last-child { margin-bottom: 0; }
  .markdown h3, .markdown h4, .markdown h5, .markdown h6 { font-size: 1.05em; margin: 1em 0 0.4em; }
  .markdown h3 { font-size: 1.2em; }
  .markdown h4 { font-size: 1.1em; }
  .markdown p, .markdown ul, .markdown ol, .markdown pre, .markdown blockquote, .markdown table { margin: 0.5em 0; }
  .markdown ul, .markdown ol { padding-left: 1.6em; list-style: revert; }
  .markdown code { font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); background: var(--vscode-textCodeBlock-background); padding: 0 3px; border-radius: 3px; overflow-wrap: anywhere; }
  .markdown pre { background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 3px; overflow-x: auto; }
  .markdown pre code { padding: 0; background: none; white-space: pre; }
  .markdown blockquote { background: var(--vscode-textBlockQuote-background); padding: 4px 8px; border-radius: 3px; color: var(--vscode-textBlockQuote-foreground, inherit); }
  .markdown table { border-collapse: collapse; }
  .markdown th, .markdown td { border: 1px solid var(--vscode-panel-border); padding: 2px 6px; }
  .markdown a[data-href], .markdown a[data-path] { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
  .markdown a[data-href]:hover, .markdown a[data-path]:hover { color: var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground)); }
  .problem { margin: 12px 0; padding: 8px; border: 1px solid var(--vscode-inputValidation-errorBorder); background: var(--vscode-inputValidation-errorBackground); white-space: pre-wrap; }
  .problem code { font-family: var(--vscode-editor-font-family); }
  .problem button { display: block; margin-top: 8px; padding: 4px 12px; border-radius: 2px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; font: inherit; }
  .problem button:hover { background: var(--vscode-button-hoverBackground); }
  .hand { border-left: 2px solid var(--vscode-dearReviewer-assistantForeground); padding-left: 12px; }
  .speaker { display: flex; flex-wrap: wrap; align-items: center; gap: 0 6px; font-size: 0.9em; font-weight: 600; margin: 0 0 4px; }
  .speaker .cat { width: 1.4em; height: 1.4em; flex: none; color: var(--vscode-dearReviewer-assistantForeground); }
  .progress { position: fixed; top: 0; left: 0; right: 0; height: 2px; overflow: hidden; pointer-events: none; z-index: 2; animation: progress-appear 150ms 300ms both; }
  .progress::before { content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 2%; background: var(--vscode-progressBar-background); animation: progress 4s linear infinite; }
  @keyframes progress-appear { from { opacity: 0; } to { opacity: 1; } }
  @keyframes progress { from { transform: translateX(0) scaleX(1); } 50% { transform: translateX(2500%) scaleX(3); } to { transform: translateX(4900%) scaleX(1); } }
  @media (prefers-reduced-motion: reduce) { .progress::before { width: 100%; opacity: 0.6; animation: none; } }`;

/**
 * The script the webviews share: `keepFocus` runs a render and, if the
 * render replaced, hid or disabled the focused element, puts the focus on the
 * element at the same place, else the panel's `data-focus-default`, else
 * the nearest one before it; `setText` changes a node's text only when it
 * differs, so a live region speaks only of a change; `appendWithCode` shows
 * the backticked parts of plain text, such as a problem, as code.
 */
export const sharedScript = `
  const canFocus = (node) => node.isConnected && !node.disabled && !node.closest("[hidden]");
  const focusables = (root) => [...root.querySelectorAll("a[role=link], button, summary, textarea, input")].filter(canFocus);
  const keepFocus = (render) => {
    const active = document.activeElement;
    if (!active || active === document.body) return render();
    const scope = active.parentElement ? active.parentElement.closest("[id]") : null;
    const scopeId = scope && scope.id;
    const index = scope ? focusables(scope).indexOf(active) : -1;
    const all = focusables(document.body);
    const earlier = all.slice(0, all.indexOf(active)).reverse();
    render();
    const now = document.activeElement;
    // The render kept the focus, or gave it somewhere on purpose.
    if (now === active ? canFocus(active) : now && now !== document.body) return;
    const rebuilt = scopeId && document.getElementById(scopeId);
    const fallback = document.querySelector("[data-focus-default]");
    const target = (rebuilt && index >= 0 && focusables(rebuilt)[index])
      || (fallback && canFocus(fallback) && fallback)
      || earlier.find(canFocus)
      || focusables(document.body)[0];
    if (target) target.focus({ preventScroll: true });
  };
  const setText = (node, text) => {
    if (node.textContent !== text) node.textContent = text;
  };
  const appendWithCode = (node, text) => {
    text.split("\`").forEach((part, i) => {
      if (i % 2 === 0) node.append(part);
      else {
        const code = document.createElement("code");
        code.textContent = part;
        node.append(code);
      }
    });
  };`;

/** Renders Markdown to sanitised HTML, keeping the links it has. */
export type RenderInto = (text: string, options?: RenderOptions) => string;

/** The messages every webview of a `MarkdownPanel` sends. */
export type Handshake =
  { type: "ready" } | { type: "rendered"; revision: number };

export interface MarkdownPanelOptions<State, Shown> {
  viewType: string;
  title: string;
  /** The only local files the webview may load. */
  localResourceRoots: vscode.Uri[];
  /** Where it opens, and whether it takes focus: beside the editor and without, unless given. */
  placement?: { viewColumn: vscode.ViewColumn; preserveFocus: boolean };
  html: (webview: vscode.Webview) => string;
  /** The state as the webview gets it, with its Markdown rendered by `render`. */
  show: (state: State, render: RenderInto) => Shown;
  /** Handles a message from the webview other than the handshake. */
  receive: (message: unknown) => void;
}

export class MarkdownPanel<State, Shown> {
  private readonly panel: vscode.WebviewPanel;
  private state: Shown;
  private revision = 0;
  private renderedState?: Shown;
  private links = new Set<string>();
  private readonly disposed = new vscode.EventEmitter<void>();
  /** Fires when the Reviewer closes the panel. */
  readonly onDidDispose = this.disposed.event;

  constructor(
    state: State,
    private readonly options: MarkdownPanelOptions<State, Shown>
  ) {
    this.state = this.shown(state);
    this.panel = vscode.window.createWebviewPanel(
      options.viewType,
      options.title,
      options.placement ?? {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: true,
      },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: options.localResourceRoots,
      }
    );
    this.panel.webview.html = options.html(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((message: unknown) =>
      options.receive(message)
    );
    this.panel.onDidDispose(() => {
      this.disposed.fire();
      this.disposed.dispose();
    });
  }

  get title(): string {
    return this.panel.title;
  }

  set title(title: string) {
    this.panel.title = title;
  }

  /** Whether the panel is the one the Reviewer is looking at. */
  get active(): boolean {
    return this.panel.active;
  }

  get webview(): vscode.Webview {
    return this.panel.webview;
  }

  /** The state last sent to the webview. */
  get sent(): Shown {
    return clone(this.state);
  }

  /** The state the webview last rendered, once it has rendered the latest one. */
  get rendered(): Shown | undefined {
    return this.renderedState && clone(this.renderedState);
  }

  /** Whether Markdown the panel was sent links to the URL. */
  hasLink(url: string): boolean {
    return this.links.has(url);
  }

  /**
   * Sends the webview the state once it is ready, and notes which state it
   * rendered. Gives whether the message was one of these.
   */
  handshake(message: { type?: unknown; revision?: unknown }): boolean {
    if (message.type === "ready") {
      void this.post();
      return true;
    }
    if (message.type === "rendered") {
      if (message.revision === this.revision)
        this.renderedState = clone(this.state);
      return true;
    }
    return false;
  }

  update(state: State): void {
    this.state = this.shown(state);
    void this.post();
  }

  /** The editor column the panel is in, while it is shown. */
  get viewColumn(): vscode.ViewColumn | undefined {
    return this.panel.viewColumn;
  }

  /** Shows the panel, in another column if given. */
  reveal(preserveFocus = true, viewColumn?: vscode.ViewColumn): void {
    this.panel.reveal(viewColumn, preserveFocus);
  }

  dispose(): void {
    this.panel.dispose();
  }

  private shown(state: State): Shown {
    const links = new Set<string>();
    const shown = this.options.show(state, (text, options) => {
      const rendered = renderMarkdown(text, options);
      for (const link of rendered.links) links.add(link);
      return rendered.html;
    });
    this.links = links;
    return clone(shown);
  }

  private post(): Thenable<boolean> {
    return this.panel.webview.postMessage({
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
