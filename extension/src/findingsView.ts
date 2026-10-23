// The Findings view (ADR 0050): the Change in front's Findings under a row
// per file, at the density of Change Files above it, with the current Finding
// open to show its whole message, Convert to Comment and Dismiss, and a
// stepper at its foot. A tree showed one line of each Finding and couldn't
// pin anything to its foot. The extension sends the whole state; the webview
// renders it, rebuilding only the rows that changed, and asks the extension
// for the Findings commands by a Finding's id, never by a command's name.

import * as crypto from "crypto";
import * as vscode from "vscode";
import { focusAfterRemoval, type FindingsFile } from "./findingsList";
import { sharedScript, sharedStyles, type Handshake } from "./markdownPanel";

export interface FindingsViewState {
  /** Whether a Change is in front, so Ask for Findings can run. */
  changeOpen: boolean;
  /** The Change in front's Findings by file, in Next Finding's order. */
  files: FindingsFile[];
  current?: string;
  /** `2 of 5`, or `5 Findings` with no current Finding. */
  count: string;
  /** Next Finding's key, such as `Ctrl+Alt+R F`. */
  key: string;
}

/** What the webview said it shows after its last render or test message, for the tests. */
export interface FindingsReport {
  /** The focused element's name, such as `finding:<id>`, `dismiss:<id>`, `next` or `ask`. */
  focused: string | null;
  /** The names of the elements Tab reaches, in order. */
  tabOrder: string[];
  /** The rows its last render built afresh, such as `file:<key>` or `finding:<id>`. */
  rebuilt: string[];
  /** The open row's message as the page shows it. */
  openMessage: string | null;
  /** How many elements in the list the page didn't make itself, such as links or images from a message. */
  foreign: number;
  /** Whether the page has the focus, as it does once the editor gives the view the focus. */
  hasFocus: boolean;
}

/** What the Reviewer does in the view. */
export type FindingsAction =
  | { type: "reveal" | "convert" | "dismiss"; id: string }
  | { type: "step"; direction: 1 | -1 }
  | { type: "ask" };

/** Webview to extension. */
export type FromFindings =
  Handshake | FindingsAction | ({ type: "report" } & FindingsReport);

/** Extension to webview, besides the state: only the tests send these. */
type ToWebview =
  | { type: "report" }
  | { type: "focusFinding"; id: string }
  | { type: "click"; name: string }
  | { type: "press"; key: string; from?: string };

export class FindingsView implements vscode.WebviewViewProvider {
  static readonly viewType = "dearReviewer.findings";
  private view?: vscode.WebviewView;
  private state: FindingsViewState;
  private revision = 0;
  private renderedState?: FindingsViewState;
  private lastReport?: FindingsReport;

  constructor(
    state: FindingsViewState,
    private readonly onAction: (action: FindingsAction) => Promise<void>
  ) {
    this.state = clone(state);
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.renderedState = undefined;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = html();
    view.webview.onDidReceiveMessage(
      (message: unknown) => void this.receive(message as FromFindings)
    );
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });
  }

  /** Whether the view is in sight. */
  get visible(): boolean {
    return !!this.view?.visible;
  }

  /** The state last sent to the webview. */
  get sent(): FindingsViewState {
    return clone(this.state);
  }

  /** The state the webview last rendered, once it has rendered the latest one. */
  get rendered(): FindingsViewState | undefined {
    return this.renderedState && clone(this.renderedState);
  }

  /** What the webview last reported, for the tests. */
  get report(): FindingsReport | undefined {
    return this.lastReport && clone(this.lastReport);
  }

  /** Handles a message from the webview; the tests send clicks through here too. */
  receive(message: FromFindings): Promise<void> | undefined {
    if (typeof message !== "object" || message === null) return;
    switch (message.type) {
      case "ready":
        void this.post();
        return;
      case "rendered":
        if (message.revision === this.revision)
          this.renderedState = clone(this.state);
        return;
      case "report":
        this.lastReport = {
          focused: message.focused,
          tabOrder: message.tabOrder,
          rebuilt: message.rebuilt,
          openMessage: message.openMessage,
          foreign: message.foreign,
          hasFocus: message.hasFocus,
        };
        return;
      case "reveal":
      case "convert":
      case "dismiss":
        if (typeof message.id === "string")
          return this.onAction({ type: message.type, id: message.id });
        return;
      case "step":
        if (message.direction === 1 || message.direction === -1)
          return this.onAction({ type: "step", direction: message.direction });
        return;
      case "ask":
        return this.onAction({ type: "ask" });
    }
  }

  /** Sends the state, unless it's the one sent last, as when the cursor moves within a Finding. */
  update(state: FindingsViewState): void {
    if (JSON.stringify(state) === JSON.stringify(this.state)) return;
    this.state = clone(state);
    void this.post();
  }

  /** Has the webview report afresh; for the tests. */
  requestReport(): void {
    void this.send({ type: "report" });
  }

  /** Clicks the page's element named `name`, such as `dismiss:<id>` or `next`; for the tests. */
  click(name: string): void {
    void this.send({ type: "click", name });
  }

  /** Puts the focus on a Finding's row, as clicking it would; for the tests. */
  focusFinding(id: string): void {
    void this.send({ type: "focusFinding", id });
  }

  /** Presses a key on the focused element, or first focuses the Finding `from`; for the tests. */
  press(key: string, from?: string): void {
    void this.send({ type: "press", key, from });
  }

  private send(message: ToWebview): Thenable<boolean> | undefined {
    this.lastReport = undefined;
    return this.view?.webview.postMessage(message);
  }

  private post(): Thenable<boolean> | undefined {
    // The webview reports again once it has rendered this state.
    this.lastReport = undefined;
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

// Codicons, drawn inline since a webview can't load the editor's icon font.
const fileIcon =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M13.85 4.44l-3.28-3.3-.35-.14H2.5l-.5.5v13l.5.5h11l.5-.5V4.8l-.15-.36zM13 5h-3V2l3 3zM3 14V2h6v3.5l.5.5H13v8H3z"/></svg>';
const arrowUp =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M13.854 7.146l-5.5-5.5a.5.5 0 0 0-.708 0l-5.5 5.5a.5.5 0 0 0 .708.708L7.5 3.207V14.5a.5.5 0 0 0 1 0V3.207l4.646 4.647a.5.5 0 0 0 .708-.708z"/></svg>';
const arrowDown =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2.146 8.854l5.5 5.5a.5.5 0 0 0 .708 0l5.5-5.5a.5.5 0 0 0-.708-.708L8.5 12.793V1.5a.5.5 0 0 0-1 0v11.293L2.854 8.146a.5.5 0 0 0-.708.708z"/></svg>';

const welcome = {
  open: "The Assistant looks for spots worth a second look, only when you ask. Each shows in the diff's gutter, where you can dismiss it or turn it into a Comment. Ctrl+Alt+R F, or ⌃⌥R F on a Mac, steps through them.",
  closed:
    "The Assistant looks for spots worth a second look, only when you ask. Open a Change to ask for them.",
};

function html(): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">${sharedStyles}
  [hidden] { display: none !important; }
  html, body { height: 100%; }
  body { display: flex; flex-direction: column; margin: 0; padding: 0; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-sideBar-foreground, var(--vscode-foreground)); }
  #list { flex: 1; min-height: 0; overflow: auto; outline: none; }
  .row { height: 22px; display: flex; align-items: center; gap: 4px; padding: 0 8px; white-space: nowrap; cursor: pointer; }
  .row:hover { background: var(--vscode-list-hoverBackground); }
  .row svg { width: 16px; height: 16px; flex: none; }
  .row .label { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .row .muted { color: var(--vscode-descriptionForeground); }
  .file { padding-left: 8px; cursor: default; }
  .file:hover { background: none; }
  .file .folder { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; min-width: 0; font-size: 0.92em; }
  .file .count { margin-left: auto; flex: none; font-size: 0.92em; font-variant-numeric: tabular-nums; }
  .finding { padding-left: 28px; }
  .finding .label { flex: 1; }
  .finding .lines, .finding .base { flex: none; font-size: 0.85em; font-variant-numeric: tabular-nums; }
  .finding .rule { width: 2px; align-self: stretch; margin: 3px 4px 3px 0; flex: none; background: var(--vscode-dearReviewer-assistantForeground); }
  .finding[aria-selected=true], .open { background: var(--vscode-list-inactiveSelectionBackground); color: var(--vscode-list-inactiveSelectionForeground, inherit); }
  .finding[aria-selected=true] { outline: 1px dotted var(--vscode-contrastActiveBorder, transparent); outline-offset: -1px; }
  .finding:focus { outline: 1px solid var(--vscode-list-focusOutline, var(--vscode-focusBorder)); outline-offset: -1px; }
  #list:focus-within .finding:focus { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground, inherit); }
  #list:focus-within .finding:focus .muted { color: inherit; }
  .open { padding: 2px 10px 8px 42px; }
  .open .message { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.45; border-left: 2px solid var(--vscode-dearReviewer-assistantForeground); padding-left: 8px; }
  .open .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 6px; padding-left: 10px; }
  .link { background: none; border: none; padding: 0; color: var(--vscode-textLink-foreground); cursor: pointer; font: inherit; }
  .link:hover { text-decoration: underline; }
  #welcome { flex: 1; padding: 8px 20px; line-height: 1.4; }
  #welcome p { margin: 0 0 10px; }
  button.primary { display: block; width: 100%; max-width: 300px; padding: 4px 12px; border-radius: 2px; cursor: pointer; font: inherit; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  .foot { flex: none; display: flex; align-items: center; gap: 4px; padding: 3px 8px 3px 12px; border-top: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border)); }
  .foot .count { flex: 1; font-variant-numeric: tabular-nums; }
  .foot .key { font-family: var(--vscode-editor-font-family); font-size: 0.85em; color: var(--vscode-descriptionForeground); margin-right: 4px; }
  .icon { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border: none; border-radius: 5px; background: none; color: var(--vscode-icon-foreground, var(--vscode-foreground)); cursor: pointer; }
  .icon:hover { background: var(--vscode-toolbar-hoverBackground); }
  .icon svg { width: 16px; height: 16px; }
</style>
</head>
<body>
<h1 class="visually-hidden">Findings</h1>
<div id="list" role="listbox" aria-label="Findings" hidden></div>
<div id="welcome" hidden><p id="welcomeText"></p><button class="primary" id="ask" type="button" data-name="ask">Ask for Findings</button></div>
<div class="foot" id="foot" hidden>
  <span class="count" id="count"></span><span class="key" id="key"></span>
  <button class="icon" id="previous" type="button" data-name="previous" aria-label="Previous Finding" title="Previous Finding">${arrowUp}</button>
  <button class="icon" id="next" type="button" data-name="next" aria-label="Next Finding">${arrowDown}</button>
</div>
<script nonce="${nonce}">${sharedScript}
  const vscode = acquireVsCodeApi();
  const byId = (id) => document.getElementById(id);
  const focusAfterRemoval = ${focusAfterRemoval.toString()};
  const welcome = ${JSON.stringify(welcome)};
  const fileIcon = ${JSON.stringify(fileIcon)};
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const list = byId("list");
  byId("ask").addEventListener("click", () => vscode.postMessage({ type: "ask" }));
  byId("previous").addEventListener("click", () => vscode.postMessage({ type: "step", direction: -1 }));
  byId("next").addEventListener("click", () => vscode.postMessage({ type: "step", direction: 1 }));

  const options = () => [...list.querySelectorAll("[role=option]")];
  const optionOf = (id) => options().find((o) => o.dataset.finding === id);
  // The list is one tab stop, on the focused Finding while the focus is in
  // the list, else on the current one, else on the first.
  function setTabStop(target) {
    for (const option of options()) option.tabIndex = option === target ? 0 : -1;
  }
  function moveTo(option) {
    if (!option) return;
    setTabStop(option);
    option.focus();
    option.scrollIntoView({ block: "nearest" });
  }

  function fileRow(file) {
    const row = el("div", "row file");
    row.setAttribute("role", "none");
    row.insertAdjacentHTML("beforeend", fileIcon);
    row.append(el("span", "label", file.name), el("span", "folder muted", file.folder), el("span", "count muted", String(file.findings.length)));
    row.title = file.folder ? file.folder + "/" + file.name : file.name;
    return row;
  }

  function findingRow(finding, open) {
    const row = el("div", "row finding");
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(open));
    row.setAttribute("aria-label", finding.name);
    row.dataset.finding = finding.id;
    row.dataset.name = "finding:" + finding.id;
    row.tabIndex = -1;
    const rule = el("span", "rule");
    const lines = el("span", "lines muted", finding.lines);
    row.append(rule, lines);
    if (finding.base) row.append(el("span", "base muted", "base"));
    row.append(el("span", "label", open ? "" : finding.firstLine));
    if (!open) row.title = finding.message;
    for (const child of row.children) child.setAttribute("aria-hidden", "true");
    row.addEventListener("click", () => {
      moveTo(row);
      vscode.postMessage({ type: "reveal", id: finding.id });
    });
    return row;
  }

  // The current Finding's whole message, as plain text, and its actions.
  function openRow(finding) {
    const node = el("div", "open");
    node.setAttribute("role", "none");
    node.dataset.finding = finding.id;
    node.append(el("div", "message", finding.message));
    const actions = el("div", "actions");
    const link = (label, type) => {
      const button = el("button", "link", label);
      button.type = "button";
      button.dataset.name = type + ":" + finding.id;
      button.addEventListener("click", () => vscode.postMessage({ type, id: finding.id }));
      return button;
    };
    actions.append(link("Convert to Comment", "convert"), link("Dismiss", "dismiss"));
    node.append(actions);
    return node;
  }

  // Each row is built again only when what it shows changed, so an update
  // leaves the others, and the focus in them, alone.
  let built = new Map();
  let rebuilt = [];
  function rowFor(key, data, build) {
    const text = JSON.stringify(data);
    const old = built.get(key);
    if (old && old.text === text) return old;
    rebuilt.push(key);
    return { text, node: build() };
  }

  let shownIds = [];
  function renderList(state) {
    const active = document.activeElement;
    const holder = active && list.contains(active) ? active.closest("[data-finding]") : null;
    const focused = holder ? holder.dataset.finding : undefined;
    const next = new Map();
    const order = [];
    for (const file of state.files) {
      const key = "file:" + file.key;
      const row = rowFor(key, { name: file.name, folder: file.folder, count: file.findings.length }, () => fileRow(file));
      next.set(key, row);
      order.push(row.node);
      for (const finding of file.findings) {
        const open = finding.id === state.current;
        const findingKey = "finding:" + finding.id;
        const row = rowFor(findingKey, [finding, open], () => findingRow(finding, open));
        next.set(findingKey, row);
        order.push(row.node);
        if (open) {
          const openKey = "open:" + finding.id;
          const detail = rowFor(openKey, finding, () => openRow(finding));
          next.set(openKey, detail);
          order.push(detail.node);
        }
      }
    }
    const keep = new Set(order);
    for (const child of [...list.children]) if (!keep.has(child)) child.remove();
    order.forEach((node, i) => {
      if (list.children[i] !== node) list.insertBefore(node, list.children[i] || null);
    });
    built = next;
    const ids = state.files.flatMap((file) => file.findings.map((f) => f.id));
    const before = shownIds;
    shownIds = ids;
    const stop = (focused && optionOf(focused)) || optionOf(state.current) || options()[0];
    setTabStop(stop);
    // An update never moves the focus: it stays on its Finding, else goes to
    // the Finding that takes its place, else the one before, else Ask.
    // A row built afresh, such as one that opened or closed, keeps the focus
    // on the same element in its place. While the page doesn't have the
    // focus, such as once a click opened a Finding in the editor, it isn't
    // taken back.
    if (focused === undefined || document.activeElement === active || !document.hasFocus()) return;
    const target = focusAfterRemoval(before, ids, focused);
    const same = target === focused && [...list.querySelectorAll("[data-name]")].find((node) => node.dataset.name === nameOf(active));
    if (same) same.focus();
    else if (target !== undefined) moveTo(optionOf(target));
    else if (state.changeOpen) byId("ask").focus();
  }

  let current;
  function render(state) {
    current = state.current;
    const any = state.files.length > 0;
    list.hidden = !any;
    byId("foot").hidden = !any;
    byId("welcome").hidden = any;
    setText(byId("welcomeText"), state.changeOpen ? welcome.open : welcome.closed);
    byId("ask").hidden = !state.changeOpen;
    setText(byId("count"), state.count);
    setText(byId("key"), state.key);
    byId("next").title = "Next Finding (" + state.key + ")";
    renderList(state);
  }

  // Up and Down move between Findings, skipping file rows; Home and End go
  // to the first and last; Enter opens the focused one as a click does.
  // Tab goes on to the open row's links from any Finding, wherever they are.
  list.addEventListener("keydown", (event) => {
    const option = event.target instanceof Element ? event.target.closest("[role=option]") : null;
    if (!option) return;
    const all = options();
    const i = all.indexOf(option);
    let to;
    if (event.key === "Tab" && !event.shiftKey) {
      const link = list.querySelector(".open button");
      if (!link || option.dataset.finding === current) return;
      event.preventDefault();
      link.focus();
      return;
    }
    if (event.key === "ArrowDown") to = all[i + 1];
    else if (event.key === "ArrowUp") to = all[i - 1];
    else if (event.key === "Home") to = all[0];
    else if (event.key === "End") to = all.at(-1);
    else if (event.key === "Enter") {
      event.preventDefault();
      vscode.postMessage({ type: "reveal", id: option.dataset.finding });
      return;
    } else return;
    event.preventDefault();
    moveTo(to);
  });
  // Once the focus leaves the list, its tab stop goes back to the current Finding.
  list.addEventListener("focusout", (event) => {
    if (list.contains(event.relatedTarget)) return;
    setTabStop(optionOf(current) || options()[0]);
  });

  const nameOf = (node) => (node && node.dataset && node.dataset.name) || null;
  // Says what the page shows, and the rows built afresh since it last said.
  function report() {
    const since = rebuilt;
    rebuilt = [];
    const reachable = [...document.querySelectorAll("[tabindex], button")].filter(
      (node) => node.tabIndex >= 0 && canFocus(node)
    );
    vscode.postMessage({
      type: "report",
      focused: nameOf(document.activeElement),
      tabOrder: reachable.map(nameOf),
      rebuilt: since,
      openMessage: list.querySelector(".open .message")?.textContent ?? null,
      foreign: list.querySelectorAll("a, img, script, iframe, strong, em, code").length,
      hasFocus: document.hasFocus(),
    });
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "report") {
      report();
      return;
    }
    if (message.type === "focusFinding") {
      moveTo(optionOf(message.id));
      report();
      return;
    }
    if (message.type === "click") {
      const target = [...document.querySelectorAll("[data-name]")].find((node) => node.dataset.name === message.name);
      if (target && canFocus(target)) {
        target.focus();
        target.click();
      }
      report();
      return;
    }
    if (message.type === "press") {
      if (message.from !== undefined) moveTo(optionOf(message.from));
      const target = document.activeElement || document.body;
      target.dispatchEvent(new KeyboardEvent("keydown", { key: message.key, bubbles: true, cancelable: true }));
      report();
      return;
    }
    if (message.type !== "state") return;
    if (document.hasFocus()) keepFocus(() => render(message.state));
    else render(message.state);
    vscode.postMessage({ type: "rendered", revision: message.revision });
    report();
  });
  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
}
