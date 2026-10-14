// What the Assistant and timeline panels share: a webview beside the diff to
// which the extension sends its whole state, with any Markdown in it already
// rendered and sanitised (ADR 0011). The webview says when it is ready for
// the state, and which state it rendered. The panel keeps the web links in
// the Markdown it sent, the only links the webview may ask to open.

import * as vscode from "vscode";
import { renderMarkdown, type RenderOptions } from "./markdown";

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
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
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

  reveal(preserveFocus = true): void {
    this.panel.reveal(undefined, preserveFocus);
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
