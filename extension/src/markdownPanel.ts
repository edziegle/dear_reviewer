// What the webviews share: a webview, in a panel beside the diff or in a
// view, to which the extension sends its whole state, with any Markdown in it
// already rendered and sanitised (ADR 0011). The webview says when it is
// ready for the state, and which state it rendered. The extension keeps the
// web links in the Markdown it sent, the only links the webview may ask to
// open.

import * as vscode from "vscode";
import { renderMarkdown, type RenderOptions } from "./markdown";

export { sharedStyles } from "./markdownStyles";

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

/**
 * The state a webview of rendered Markdown was sent, which state it last
 * rendered, and the web links in it, for a panel or a view alike.
 */
export class MarkdownState<State, Shown> {
  private state: Shown;
  private revision = 0;
  private renderedState?: Shown;
  private links = new Set<string>();
  private markReady!: () => void;
  /** Settles once the webview first says it is ready. */
  readonly ready = new Promise<void>((resolve) => (this.markReady = resolve));

  /** `webview` gives the webview to send the state to, while there is one. */
  constructor(
    state: State,
    private readonly show: (state: State, render: RenderInto) => Shown,
    private readonly webview: () => vscode.Webview | undefined
  ) {
    this.state = this.shown(state);
  }

  /** The state last sent to the webview. */
  get sent(): Shown {
    return clone(this.state);
  }

  /** The state the webview last rendered, once it has rendered the latest one. */
  get rendered(): Shown | undefined {
    return this.renderedState && clone(this.renderedState);
  }

  /** Whether Markdown the webview was sent links to the URL. */
  hasLink(url: string): boolean {
    return this.links.has(url);
  }

  /**
   * Sends the webview the state once it is ready, and notes which state it
   * rendered. Gives whether the message was one of these.
   */
  handshake(message: { type?: unknown; revision?: unknown }): boolean {
    if (message.type === "ready") {
      this.markReady();
      // A webview made again, such as a view moved elsewhere, has rendered nothing.
      this.renderedState = undefined;
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

  private shown(state: State): Shown {
    const links = new Set<string>();
    const shown = this.show(state, (text, options) => {
      const rendered = renderMarkdown(text, options);
      for (const link of rendered.links) links.add(link);
      return rendered.html;
    });
    this.links = links;
    return clone(shown);
  }

  private post(): Thenable<boolean> | undefined {
    return this.webview()?.postMessage({
      type: "state",
      revision: ++this.revision,
      state: this.state,
    });
  }
}

export class MarkdownPanel<State, Shown> {
  private readonly panel: vscode.WebviewPanel;
  private readonly content: MarkdownState<State, Shown>;
  private readonly disposed = new vscode.EventEmitter<void>();
  /** Fires when the Reviewer closes the panel. */
  readonly onDidDispose = this.disposed.event;
  /**
   * Settles once the webview is ready, or the panel closed before it was.
   * VS Code holds the focus a panel was shown with until its webview is
   * ready, and then gives it to the panel whatever has the focus since, so
   * an editor opened meanwhile loses it. Even after this settles, the
   * webview's page tells VS Code it has the focus only on a timer, every
   * 250 ms, and VS Code then puts the focus on the panel again: an editor
   * opened in that moment loses it too. Only a panel shown without the focus
   * is sure to leave it alone.
   */
  readonly ready: Promise<void>;

  constructor(state: State, options: MarkdownPanelOptions<State, Shown>) {
    this.content = new MarkdownState(
      state,
      options.show,
      () => this.panel.webview
    );
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
    this.ready = Promise.race([
      this.content.ready,
      new Promise<void>((resolve) => this.panel.onDidDispose(() => resolve())),
    ]);
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
    return this.content.sent;
  }

  /** The state the webview last rendered, once it has rendered the latest one. */
  get rendered(): Shown | undefined {
    return this.content.rendered;
  }

  /** Whether Markdown the panel was sent links to the URL. */
  hasLink(url: string): boolean {
    return this.content.hasLink(url);
  }

  /**
   * Sends the webview the state once it is ready, and notes which state it
   * rendered. Gives whether the message was one of these.
   */
  handshake(message: { type?: unknown; revision?: unknown }): boolean {
    return this.content.handshake(message);
  }

  update(state: State): void {
    this.content.update(state);
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
}

/** The state as JSON carries it to the webview, with absent fields left out. */
function clone<T>(state: T): T {
  return JSON.parse(JSON.stringify(state)) as T;
}
