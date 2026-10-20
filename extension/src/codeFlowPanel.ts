// The Code Flow tab: a webview in an editor tab beside the diff that draws
// how the code a Change touches calls and is called by the code around it,
// as a call map or as swimlanes, or as a list for a screen reader. The
// extension sends it the whole state; the webview renders it, says which
// state it rendered, and asks the extension for everything else.

import * as crypto from "crypto";
import * as vscode from "vscode";
import type { FlowNode, FlowOffers, ShownFlow } from "./codeFlow";
import type { LanguageOutcome } from "./codeFlowGather";
import type { ShownWalkthrough } from "./flowWalkthrough";
import { MarkdownPanel, sharedScript, sharedStyles } from "./markdownPanel";

export type FlowView = "map" | "lanes" | "list" | "walkthrough";

/** What the extension sends the webview. */
export interface CodeFlowState {
  /** Whether the language servers are still being asked. */
  loading: boolean;
  hops: 0 | 1 | 2;
  view: FlowView;
  /** Whether the symbols of test files are drawn. */
  showTests: boolean;
  /** Whether the symbols of deleted files are drawn. */
  showRemoved: boolean;
  flow: ShownFlow;
  /** The Assistant's account of how the calls run, in order. */
  walkthrough: ShownWalkthrough;
  /** The controls and notices that act on the view shown, and what it says with nothing to draw. */
  offers: FlowOffers;
  /** Every symbol gathered, for the details of one the picture doesn't draw. */
  known: FlowNode[];
  selected?: string;
  languages: { language: string; outcome: LanguageOutcome }[];
  /** Why no Code Flow could be gathered at all. */
  problem?: string;
}

export type FromCodeFlow =
  | { type: "setHops"; hops: number }
  | { type: "setView"; view: string }
  | { type: "select"; id: string }
  | { type: "openDiff"; id: string }
  | { type: "setEntry"; id: string }
  | { type: "expand"; id: string }
  | { type: "setShowAll"; show: boolean }
  | { type: "setShowTests"; show: boolean }
  | { type: "setShowRemoved"; show: boolean }
  | { type: "retry" }
  | { type: "writeWalkthrough" }
  | { type: "findExtensions"; language: string }
  | { type: "layout"; canvas: CanvasScroll | null; focusInView: boolean | null }
  | { type: "ready" }
  | { type: "rendered"; revision: number };

/** How far the canvas is scrolled, as the webview reports it after it renders. */
export interface CanvasScroll {
  left: number;
  top: number;
}

/** What the webview last said of how it is laid out, for the tests. */
export interface Layout {
  /** The canvas's scroll offsets; none while the view draws no canvas, such as the list. */
  canvas: CanvasScroll | null;
  /** Whether the symbol with the focus is inside the canvas's visible part; none if no symbol has it. */
  focusInView: boolean | null;
}

/** Test-only messages to the webview, which answers each with a layout. */
type ToWebview =
  | { type: "scrollCanvas"; left: number; top: number }
  | { type: "focusNode"; id: string };

export class CodeFlowPanel {
  private readonly view: MarkdownPanel<CodeFlowState, CodeFlowState>;
  readonly onDidDispose: vscode.Event<void>;
  private reportedLayout: Layout | undefined;

  constructor(
    state: CodeFlowState,
    title: string,
    column: vscode.ViewColumn,
    private readonly onAction: (action: FromCodeFlow) => void
  ) {
    this.view = new MarkdownPanel(state, {
      viewType: "dearReviewer.codeFlow",
      title,
      localResourceRoots: [],
      placement: { viewColumn: column, preserveFocus: false },
      html: () => html(),
      show: (shown) => shown,
      receive: (message) => this.receive(message as FromCodeFlow),
    });
    this.onDidDispose = this.view.onDidDispose;
  }

  get title(): string {
    return this.view.title;
  }

  get viewColumn(): vscode.ViewColumn | undefined {
    return this.view.viewColumn;
  }

  /** The state last sent to the webview. */
  get sent(): CodeFlowState {
    return this.view.sent;
  }

  /** The state the webview last rendered, once it has rendered the latest one. */
  get rendered(): CodeFlowState | undefined {
    return this.view.rendered;
  }

  /** What the webview last said of how it is laid out. */
  get layout(): Layout | undefined {
    return this.reportedLayout && structuredClone(this.reportedLayout);
  }

  /** Scrolls the canvas, as the Reviewer would; the tests use it. */
  scrollCanvas(left: number, top: number): void {
    void this.view.webview.postMessage({
      type: "scrollCanvas",
      left,
      top,
    } satisfies ToWebview);
  }

  /** Gives the focus to a symbol of the call map, as the Reviewer would; the tests use it. */
  focusNode(id: string): void {
    void this.view.webview.postMessage({
      type: "focusNode",
      id,
    } satisfies ToWebview);
  }

  update(state: CodeFlowState): void {
    this.view.update(state);
  }

  reveal(): void {
    this.view.reveal(false);
  }

  dispose(): void {
    this.view.dispose();
  }

  /** Handles a message from the webview; the tests send clicks through here too. */
  receive(message: FromCodeFlow): void {
    if (this.view.handshake(message)) {
      return;
    }
    switch (message.type) {
      case "setHops":
        if (message.hops === 0 || message.hops === 1 || message.hops === 2) {
          this.onAction(message);
        }
        break;
      case "setView":
        if (["map", "lanes", "list", "walkthrough"].includes(message.view)) {
          this.onAction(message);
        }
        break;
      case "select":
      case "openDiff":
      case "setEntry":
      case "expand":
        if (typeof message.id === "string") {
          this.onAction(message);
        }
        break;
      case "setShowTests":
      case "setShowRemoved":
      case "setShowAll":
        if (typeof message.show === "boolean") {
          this.onAction(message);
        }
        break;
      case "findExtensions":
        if (typeof message.language === "string") {
          this.onAction(message);
        }
        break;
      case "retry":
      case "writeWalkthrough":
        this.onAction(message);
        break;
      case "layout":
        this.reportedLayout = {
          canvas: message.canvas,
          focusInView: message.focusInView,
        };
        break;
    }
  }
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
  body { margin: 0; padding: 0 16px 16px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); line-height: 1.5; }
  h1 { font-size: 1.1em; margin: 14px 0 8px; }
  .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin: 0 0 10px; padding: 6px 0; position: sticky; top: 0; z-index: 1; background: var(--vscode-editor-background); }
  .group { display: inline-flex; align-items: center; gap: 6px; }
  .seg { display: inline-flex; }
  .seg button { font: inherit; padding: 2px 10px; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: 1px solid var(--vscode-button-border, var(--vscode-contrastBorder, transparent)); cursor: pointer; }
  .seg button:first-child { border-radius: 2px 0 0 2px; }
  .seg button:last-child { border-radius: 0 2px 2px 0; }
  .seg button:only-child { border-radius: 2px; }
  .seg button[aria-pressed=true] { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  .seg button::before { content: "\\2713\\00a0"; content: "\\2713\\00a0" / ""; visibility: hidden; }
  .seg button[aria-pressed=true]::before { visibility: visible; }
  select { font: inherit; color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); border: 1px solid var(--vscode-dropdown-border, var(--vscode-contrastBorder, transparent)); padding: 2px 4px; }
  select:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .legend { display: inline-flex; gap: 12px; color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .legend .key { display: inline-block; width: 1.6em; height: 0.9em; vertical-align: middle; margin-right: 4px; background: var(--vscode-editor-background); box-sizing: border-box; }
  .key.changed { border: 2px solid var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-focusBorder)); }
  .key.new { border: 2px dashed var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-focusBorder)); }
  .key.removed { border: 2px dotted var(--vscode-gitDecoration-deletedResourceForeground, var(--vscode-focusBorder)); }
  .key.unchanged { border: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder)); }
  .notice { margin: 8px 0; padding: 8px; border: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder)); background: var(--vscode-textBlockQuote-background); }
  .notice button { margin-left: 8px; font: inherit; padding: 2px 10px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 1px solid var(--vscode-button-border, var(--vscode-contrastBorder, transparent)); border-radius: 2px; cursor: pointer; }
  .notice button:hover { background: var(--vscode-button-hoverBackground); }
  .canvas { overflow: auto; max-height: max(240px, calc(100vh - 200px)); border: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder)); background: var(--vscode-editor-background); }
  .canvas svg { display: block; }
  .node .box { fill: var(--vscode-editor-background); stroke: var(--vscode-descriptionForeground); stroke-width: 1; }
  .node.changed .box { stroke: var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-focusBorder)); stroke-width: 2.5; }
  .node.new .box { stroke: var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-focusBorder)); stroke-width: 2.5; stroke-dasharray: 10 5; }
  .node.removed .box { stroke: var(--vscode-gitDecoration-deletedResourceForeground, var(--vscode-focusBorder)); stroke-width: 2.5; stroke-dasharray: 0.1 5; stroke-linecap: round; }
  .node[aria-selected=true] .box { fill: var(--vscode-list-activeSelectionBackground); }
  .node[aria-selected=true] text { fill: var(--vscode-list-activeSelectionForeground); }
  .call[aria-selected=true] .hit { stroke-dasharray: none; }
  /* The focus ring goes around the box, so the box keeps the stroke and dash that mark its status. */
  .node .ring { fill: none; stroke: none; }
  .node:focus { outline: none; }
  .node:focus-visible .ring { stroke: var(--vscode-focusBorder); stroke-width: 2; }
  .call:focus-visible .hit { stroke: var(--vscode-focusBorder); stroke-width: 3; }
  .node text, .lane text, .call text { fill: var(--vscode-editor-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
  .node .name { font-family: var(--vscode-editor-font-family); font-weight: 600; }
  .node .where, .edge-label, .more { fill: var(--vscode-descriptionForeground); font-size: calc(var(--vscode-font-size) * 0.9); }
  .node.unchanged .name { font-weight: 400; }
  .edge { fill: none; stroke: var(--vscode-descriptionForeground); stroke-width: 1.2; }
  .arrow { fill: var(--vscode-descriptionForeground); }
  .lane-head { font-weight: 600; }
  .lane-line { stroke: var(--vscode-panel-border, var(--vscode-descriptionForeground)); stroke-dasharray: 3 4; }
  .call.changed .edge { stroke: var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-focusBorder)); stroke-width: 2.5; }
  .call.new .edge { stroke: var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-focusBorder)); stroke-width: 2.5; stroke-dasharray: 10 5; }
  .call.removed .edge { stroke: var(--vscode-gitDecoration-deletedResourceForeground, var(--vscode-focusBorder)); stroke-width: 2.5; stroke-dasharray: 0.1 5; stroke-linecap: round; }
  .call .where { fill: var(--vscode-descriptionForeground); font-size: calc(var(--vscode-font-size) * 0.9); }
  .call[aria-selected=true] .where { fill: var(--vscode-list-activeSelectionForeground); }
  .call .hit { fill: transparent; stroke: transparent; }
  .call:hover .hit { fill: var(--vscode-list-hoverBackground); }
  .call[aria-selected=true] .hit { fill: var(--vscode-list-activeSelectionBackground); stroke: var(--vscode-list-activeSelectionForeground); }
  .call[aria-selected=true] text { fill: var(--vscode-list-activeSelectionForeground); }
  .details { position: sticky; bottom: 0; background: var(--vscode-editor-background); margin: 10px 0 0; padding: 8px; border: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder)); min-height: 3em; }
  .details .where, .list .where { font-family: var(--vscode-editor-font-family); color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; }
  .details button { margin-top: 6px; font: inherit; padding: 2px 12px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 1px solid var(--vscode-button-border, var(--vscode-contrastBorder, transparent)); border-radius: 2px; cursor: pointer; }
  .details button:hover { background: var(--vscode-button-hoverBackground); }
  .details .actions { display: flex; flex-wrap: wrap; gap: 6px 8px; margin-top: 6px; }
  .details .actions button { margin-top: 0; }
  .list { margin: 0; padding-left: 1.2em; }
  .list li { margin: 6px 0; }
  .walkthrough, .walkthrough ol { list-style: none; margin: 0; padding-left: 0; }
  .walkthrough ol { padding-left: 1.6em; }
  .walkthrough li { margin: 8px 0; }
  .walkthrough .num { font-variant-numeric: tabular-nums; color: var(--vscode-descriptionForeground); }
  .walkthrough .detail { margin-left: 2.2em; color: var(--vscode-descriptionForeground); }
  .walkthrough .note { margin-left: 2.2em; }
  .hint { margin: 0 0 6px; color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .neighbours { margin-top: 6px; }
  .neighbours button.sym, .list button.sym, .walkthrough button.sym { font: inherit; font-family: var(--vscode-editor-font-family); background: none; border: none; color: var(--vscode-textLink-foreground); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; padding: 0; }
  .badge { font-size: 0.85em; margin-left: 6px; padding: 0 6px; border-radius: 8px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); }
  .empty { color: var(--vscode-descriptionForeground); margin: 14px 0; }
</style>
</head>
<body>
<h1 id="heading">Code Flow</h1>
<div id="live" class="visually-hidden" role="status" aria-live="polite"></div>
<div id="app"></div>
<script nonce="${nonce}">${sharedScript}
  const vscode = acquireVsCodeApi();
  const SVG = "http://www.w3.org/2000/svg";
  const app = document.getElementById("app");
  const live = document.getElementById("live");
  const STATUS = { changed: "changed", new: "new", removed: "removed", unchanged: "unchanged" };
  const before = (node) => (node.side === "base" ? "before the Change: " : "");
  /** The glyph and word that mark a symbol the Change touched; nothing for one it left alone. */
  const statusMark = (node) => (node.status === "new" ? "+ new" : node.status === "removed" ? "\\u2212 removed" : node.status === "changed" ? "\\u25cf changed" : "");
  const placeOf = (node) => (node.side === "base" ? "before: " : "") + baseName(node.path) + ":" + node.line;

  const el = (tag, attrs, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === undefined || value === false) continue;
      if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : value);
    }
    node.append(...children.flat().filter(Boolean));
    return node;
  };
  const svg = (tag, attrs, ...children) => {
    const node = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === undefined || value === false) continue;
      if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    node.append(...children.flat().filter(Boolean));
    return node;
  };
  const post = (message) => vscode.postMessage(message);
  const baseName = (path) => path.split("/").pop();
  const clip = (text, max) => (text.length > max ? text.slice(0, max - 1) + "\\u2026" : text);
  /** What a call is labelled with: the data it carries if the Assistant said, else the language server's label. */
  const edgeText = (edge) => edge.data || edge.label;
  /** The label's tooltip, which keeps both when there are two. */
  const edgeTitle = (edge) => edge.data && edge.label ? edge.data + " \u2014 " + edge.label : edgeText(edge);
  const describe = (node) => node.name + ", " + STATUS[node.status] + ", " + before(node) + node.path + " line " + node.line;

  const arrowDefs = () => svg("defs", {}, svg("marker", { id: "arrow", viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" }, svg("path", { class: "arrow", d: "M0 0 L10 5 L0 10 z" })));

  /** A second Enter on the selected symbol opens its diff; anything else selects it. */
  function activate(event, id) {
    event.preventDefault();
    if (current.selected === id && event.key === "Enter") post({ type: "openDiff", id });
    else post({ type: "select", id });
  }

  /** Says how to move through the picture, since the keys are not otherwise visible. */
  const hint = (view) => el("p", { class: "hint", id: "hint",
    text: (view === "lanes" ? "Up and Down move between calls. " : "Arrow keys move between symbols; Right and Left follow calls. ") + "Enter shows a symbol in the diff; Enter again moves to the diff." });

  /** Makes the symbol the one tab stop into the call map. */
  function setRoving(id) {
    rovingNode = id;
    for (const n of document.querySelectorAll("[data-node]")) n.setAttribute("tabindex", n.getAttribute("data-node") === id ? "0" : "-1");
  }
  /** Makes the call row the one tab stop into the swimlanes. */
  function setRovingCall(index) {
    rovingCall = index;
    document.querySelectorAll("[data-focus^='call:']").forEach((row, i) => row.setAttribute("tabindex", i === index ? "0" : "-1"));
  }

  const NODE_W = 190, NODE_H = 46, COL_GAP = 90, ROW_GAP = 24, PAD = 20;

  function toolbar(state) {
    const seg = (label, items, current, onPick) =>
      el("span", { class: "group" },
        el("span", { text: label }),
        el("span", { class: "seg", role: "group", "aria-label": label },
          items.map(([value, text]) =>
            el("button", { type: "button", "aria-pressed": String(current === value), onclick: () => onPick(value) , text }))));
    const bar = el("div", { class: "toolbar" },
      seg("View", [["map", "Call map"], ["lanes", "Swimlanes"], ["list", "List"], ...(state.walkthrough.offered ? [["walkthrough", "Walkthrough"]] : [])], state.view, (view) => post({ type: "setView", view })));
    // The walkthrough follows the calls the Assistant was given, so the picture's controls don't act on it.
    if (state.view === "walkthrough") return bar;
    if (state.offers.hops) {
      bar.append(seg("Show", [[0, "Changed only"], [1, "+1 hop"], [2, "+2 hops"]], state.hops, (hops) => post({ type: "setHops", hops })));
    } else if (state.flow.entries.length > 0) {
      const select = el("select", { id: "entry", onchange: () => post({ type: "setEntry", id: select.value }) },
        state.flow.entries.map((entry) => el("option", { value: entry.id, selected: entry.id === state.flow.entry, text: entry.label })));
      bar.append(el("span", { class: "group" }, el("label", { for: "entry", text: "Calls from" }), select));
    }
    bar.append(el("span", { class: "seg" },
      el("button", { type: "button", "aria-pressed": String(state.showTests), "data-focus": "showTests", onclick: () => post({ type: "setShowTests", show: !state.showTests }), text: "Show tests" })));
    if (state.showRemoved || state.flow.removedHidden > 0) {
      bar.append(el("span", { class: "seg" },
        el("button", { type: "button", "aria-pressed": String(state.showRemoved), "data-focus": "showRemoved", onclick: () => post({ type: "setShowRemoved", show: !state.showRemoved }), text: "Show removed" })));
    }
    // The key explains only the marks the picture draws: the list names each status in a badge.
    const known = new Map(state.known.map((n) => [n.id, n]));
    const drawn = state.view === "map" ? state.flow.nodes
      : state.view === "lanes" ? state.flow.calls.flatMap((c) => [known.get(c.from), known.get(c.to)]).filter(Boolean)
      : [];
    const present = ["changed", "new", "removed", "unchanged"].filter((status) => drawn.some((n) => n.status === status));
    if (present.length > 0)
      bar.append(el("span", { class: "legend" },
        present.map((status) => el("span", {}, el("i", { class: "key " + status }), STATUS[status]))));
    return bar;
  }

  function notices(state) {
    const out = [];
    if (state.problem) out.push(el("div", { class: "notice problem", role: "alert" }, state.problem, el("button", { type: "button", onclick: () => post({ type: "retry" }), text: "Try again" })));
    for (const { language, outcome } of state.languages) {
      if (outcome === "none") {
        out.push(el("div", { class: "notice" },
          "No language server for " + language + ", so its calls can't be drawn.",
          el("button", { type: "button", onclick: () => post({ type: "findExtensions", language }), text: "Search extensions for " + language })));
      } else if (outcome === "noCalls") {
        out.push(el("div", { class: "notice" },
          "The language server for " + language + " gave no calls, and may not support call hierarchies. Install a language server for " + language + " that does." + (language === "python" ? " Pyright-based servers support them; Jedi, the one VS Code falls back to, does not." : "")));
      } else if (outcome === "silent") {
        out.push(el("div", { class: "notice" },
          "The language server for " + language + " did not answer.",
          el("button", { type: "button", onclick: () => post({ type: "retry" }), text: "Try again" })));
      }
    }
    if (state.view === "walkthrough") return out;
    if (!state.showTests && state.flow.testsHidden > 0) {
      out.push(el("div", { class: "notice" }, state.flow.testsHidden + (state.flow.testsHidden === 1 ? " test symbol hidden." : " test symbols hidden."),
        el("button", { type: "button", onclick: () => post({ type: "setShowTests", show: true }), text: "Show tests" })));
    }
    if (!state.showRemoved && state.flow.removedHidden > 0) {
      out.push(el("div", { class: "notice" }, state.flow.removedHidden + (state.flow.removedHidden === 1 ? " removed symbol hidden." : " removed symbols hidden."),
        el("button", { type: "button", onclick: () => post({ type: "setShowRemoved", show: true }), text: "Show removed" })));
    }
    const offers = state.offers;
    if (offers.callless > 0) {
      out.push(el("div", { class: "notice" }, offers.callless + (offers.callless === 1 ? " symbol with no calls." : " symbols with no calls.") + " The List view lists them.",
        el("button", { type: "button", onclick: () => post({ type: "setView", view: "list" }), text: "Show the list" })));
    }
    if (offers.undrawn > 0) {
      out.push(el("div", { class: "notice" }, offers.undrawn + (offers.undrawn === 1 ? " more symbol is" : " more symbols are") + " left out to keep the view readable.",
        el("button", { type: "button", onclick: () => post({ type: "setShowAll", show: true }), text: "Show all" })));
    }
    if (offers.showingAll) {
      out.push(el("div", { class: "notice" }, "All " + offers.showingAll + " symbols are drawn.",
        el("button", { type: "button", onclick: () => post({ type: "setShowAll", show: false }), text: "Show fewer" })));
    }
    if (offers.tryHop) {
      out.push(el("div", { class: "notice" }, "No changed symbol calls another. One hop out shows what they call and what calls them.",
        el("button", { type: "button", onclick: () => post({ type: "setHops", hops: 1 }), text: "+1 hop" })));
    }
    return out;
  }

  function callMap(state) {
    const nodes = state.flow.nodes;
    const columns = Math.max(0, ...nodes.map((n) => n.column)) + 1;
    const rows = Math.max(0, ...nodes.map((n) => n.row)) + 1;
    const at = (n) => ({ x: PAD + n.column * (NODE_W + COL_GAP), y: PAD + n.row * (NODE_H + ROW_GAP) });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const width = PAD * 2 + columns * NODE_W + (columns - 1) * COL_GAP;
    const height = PAD * 2 + rows * NODE_H + (rows - 1) * ROW_GAP;
    const drawing = svg("svg", { width, height, viewBox: "0 0 " + width + " " + height, role: "listbox", "aria-label": "Call map: " + nodes.length + " symbols", "aria-describedby": "hint" },
      arrowDefs());
    const inReadingOrder = nodes.slice().sort((a, b) => a.column - b.column || a.row - b.row);
    const stopId = nodes.some((n) => n.id === rovingNode) ? rovingNode : nodes.some((n) => n.id === state.selected) ? state.selected : inReadingOrder[0] && inReadingOrder[0].id;
    for (const edge of state.flow.edges) {
      const from = byId.get(edge.from), to = byId.get(edge.to);
      if (!from || !to) continue;
      const a = at(from), b = at(to);
      const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2;
      const bend = Math.max(30, Math.abs(x2 - x1) / 2);
      const group = svg("g", {},
        svg("path", { class: "edge", d: "M" + x1 + " " + y1 + " C" + (x1 + bend) + " " + y1 + " " + (x2 - bend) + " " + y2 + " " + x2 + " " + y2, "marker-end": "url(#arrow)" }));
      if (edgeText(edge)) group.append(svg("text", { class: "edge-label", x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 4, "text-anchor": "middle" }, svg("title", { text: edgeTitle(edge) }), clip(edgeText(edge), 22)));
      drawing.append(group);
    }
    for (const node of nodes) {
      const { x, y } = at(node);
      const group = svg("g", { class: "node " + node.status, transform: "translate(" + x + " " + y + ")", tabindex: node.id === stopId ? "0" : "-1", role: "option", "aria-selected": String(state.selected === node.id), "aria-label": describe(node) + (node.hidden ? ", " + node.hidden + " more neighbours not drawn" : ""), "data-node": node.id, "data-focus": "node:" + node.id },
        svg("title", { text: describe(node) }),
        svg("rect", { class: "ring", x: -4, y: -4, width: NODE_W + 8, height: NODE_H + 8, rx: 5 }),
        svg("rect", { class: "box", width: NODE_W, height: NODE_H, rx: 3 }),
        svg("text", { class: "name", x: 8, y: 19 }, node.name),
        svg("text", { class: "where loc", x: 8, y: 36 }, placeOf(node)));
      if (node.status !== "unchanged") group.append(svg("text", { class: "where status", x: NODE_W - 8, y: 19, "text-anchor": "end" }, statusMark(node)));
      if (node.hidden) group.append(svg("text", { class: "more", x: NODE_W - 8, y: 36, "text-anchor": "end" }, node.hidden + " not drawn"));
      group.addEventListener("click", () => post({ type: "select", id: node.id }));
      group.addEventListener("focus", () => { rovingNode = node.id; setRoving(node.id); });
      group.addEventListener("dblclick", () => post({ type: "openDiff", id: node.id }));
      group.addEventListener("keydown", (event) => nodeKey(event, node, nodes));
      drawing.append(group);
    }
    return el("div", { class: "canvas" }, drawing);
  }

  /**
   * Cuts each symbol's name and location to the room left beside the text on
   * its line, the status or the count of neighbours not drawn, measured at
   * the Reviewer's font size. The whole box's tooltip keeps the full text.
   */
  function fitNodeTexts() {
    const fit = (text, room) => {
      if (!text) return;
      const full = text.textContent;
      if (text.getComputedTextLength() <= room) return;
      let low = 0, high = full.length;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        text.textContent = full.slice(0, mid) + "\\u2026";
        if (text.getComputedTextLength() <= room) low = mid;
        else high = mid - 1;
      }
      text.textContent = full.slice(0, low) + "\\u2026";
    };
    const room = (beside) => NODE_W - 16 - (beside ? beside.getComputedTextLength() + 8 : 0);
    for (const group of document.querySelectorAll(".node")) {
      fit(group.querySelector(".name"), room(group.querySelector(".status")));
      fit(group.querySelector(".loc"), room(group.querySelector(".more")));
    }
  }

  /**
   * Enter and Space select, Enter again opens the diff. Up and Down move
   * along the column, and Right and Left follow a call to the callee or caller
   * nearest in the column, going back the way the Reviewer came when they
   * press the opposite key. The details list every caller and callee too.
   */
  function nodeKey(event, node, nodes) {
    const move = (target) => {
      if (!target) return;
      event.preventDefault();
      const found = document.querySelector('[data-node="' + CSS.escape(target.id) + '"]');
      if (found) { setRoving(target.id); found.focus(); }
    };
    const column = nodes.filter((n) => n.column === node.column).sort((a, b) => a.row - b.row);
    const index = column.indexOf(node);
    const linked = (ids) => ids.map((id) => nodes.find((n) => n.id === id)).filter(Boolean);
    const callees = linked(current.flow.edges.filter((e) => e.from === node.id).map((e) => e.to));
    const callers = linked(current.flow.edges.filter((e) => e.to === node.id).map((e) => e.from));
    const nearest = (list) => list.slice().sort((a, b) => Math.abs(a.row - node.row) - Math.abs(b.row - node.row) || a.row - b.row)[0];
    const toward = (list) => list.find((n) => trail.to === node.id && n.id === trail.from) || nearest(list);
    const follow = (target) => { if (!target) return; trail = { from: node.id, to: target.id }; move(target); };
    if (event.key === "Enter" || event.key === " ") activate(event, node.id);
    else if (event.key === "ArrowDown") move(column[index + 1]);
    else if (event.key === "ArrowUp") move(column[index - 1]);
    else if (event.key === "Home") move(column[0]);
    else if (event.key === "End") move(column[column.length - 1]);
    else if (event.key === "ArrowRight") follow(toward(callees));
    else if (event.key === "ArrowLeft") follow(toward(callers));
  }

  function lanes(state) {
    const { lanes: names, calls } = state.flow;
    const known = new Map(state.known.map((n) => [n.id, n]));
    const LANE_W = 210, ROW_H = 44, TOP = 46;
    const width = PAD * 2 + names.length * LANE_W;
    const height = TOP + calls.length * ROW_H + PAD;
    const x = (lane) => PAD + lane * LANE_W + LANE_W / 2;
    const drawing = svg("svg", { width, height, viewBox: "0 0 " + width + " " + height, role: "listbox", "aria-label": "Swimlanes: " + calls.length + " calls", "aria-describedby": "hint" },
      arrowDefs());
    // Rows that share a callee share the selection; only the one the Reviewer chose reads as selected.
    const selectedRow = calls.some((c, i) => i === selectedCall && c.to === state.selected) ? selectedCall : calls.findIndex((c) => c.to === state.selected);
    const stopRow = rovingCall !== undefined && rovingCall < calls.length ? rovingCall : Math.max(selectedRow, 0);
    names.forEach((name, i) => {
      drawing.append(svg("g", { class: "lane" },
        svg("text", { class: "lane-head", x: x(i), y: 24, "text-anchor": "middle" }, svg("title", { text: name }), clip(name, 28)),
        svg("line", { class: "lane-line", x1: x(i), x2: x(i), y1: 34, y2: height - 8 })));
    });
    calls.forEach((call, i) => {
      const y = TOP + i * ROW_H + ROW_H / 2;
      const target = known.get(call.to), source = known.get(call.from);
      const x1 = x(call.fromLane), x2 = x(call.toLane);
      const same = call.fromLane === call.toLane;
      // What marks the callee marks the call; the caller's mark is named in the row's second line.
      const calleeMark = target ? statusMark(target) : "", callerMark = source ? statusMark(source) : "";
      const detail = [calleeMark, target ? placeOf(target) : "", callerMark && source ? "called from " + callerMark + " " + source.name : ""].filter(Boolean).join("  \u00b7  ");
      const group = svg("g", { class: "call " + (target ? target.status : "unchanged"), tabindex: i === stopRow ? "0" : "-1", role: "option", "aria-selected": String(i === selectedRow), "aria-label": (i + 1) + ". " + (source ? source.name + (callerMark ? " (" + STATUS[source.status] + ")" : "") : call.from) + " calls " + (target ? target.name + ", " + STATUS[target.status] + ", " + before(target) + target.path + " line " + target.line : call.to) + (call.data ? ", carrying " + call.data : "") + (call.label ? ", " + call.label : ""), "data-focus": "call:" + i },
        svg("rect", { class: "hit", x: PAD, y: y - ROW_H / 2 + 2, width: width - PAD * 2, height: ROW_H - 4, rx: 3 }),
        same
          ? svg("path", { class: "edge", d: "M" + x1 + " " + (y - 6) + " h28 v12 h-26", "marker-end": "url(#arrow)" })
          : svg("line", { class: "edge", x1, x2: x2 + (x2 > x1 ? -2 : 2), y1: y, y2: y, "marker-end": "url(#arrow)" }),
        svg("text", { x: Math.min(x1, x2) + 8, y: y - 8 }, (i + 1) + ". " + clip((target ? target.name : call.to) + (edgeText(call) ? "  " + edgeText(call) : ""), 40)),
        detail && svg("text", { class: "where", x: Math.min(x1, x2) + 8, y: y + 14 }, clip(detail, 70)));
      group.addEventListener("click", () => { selectedCall = i; post({ type: "select", id: call.to }); });
      group.addEventListener("focus", () => setRovingCall(i));
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { selectedCall = i; activate(event, call.to); }
        else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const rows = [...document.querySelectorAll("[data-focus^='call:']")];
          const to = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : i + (event.key === "ArrowDown" ? 1 : -1);
          if (rows[to]) { setRovingCall(to); rows[to].focus(); }
        }
      });
      drawing.append(group);
    });
    return el("div", { class: "canvas" }, drawing);
  }

  function list(state) {
    const known = new Map(state.known.map((n) => [n.id, n]));
    const callersOf = (id) => state.flow.edges.filter((e) => e.to === id).map((e) => known.get(e.from)).filter(Boolean);
    const calleesOf = (id) => state.flow.edges.filter((e) => e.from === id).map((e) => known.get(e.to)).filter(Boolean);
    const link = (node) => el("button", { type: "button", class: "sym", onclick: () => post({ type: "select", id: node.id }), text: node.name });
    const names = (nodes) => nodes.length ? nodes.flatMap((n, i) => (i ? [", ", link(n)] : [link(n)])) : ["none"];
    return el("ul", { class: "list" }, [...state.flow.nodes, ...state.flow.callless].map((node) =>
      el("li", {},
        link(node), el("span", { class: "badge", text: node.status }), " ",
        el("span", { class: "where", text: before(node) + node.path + ":" + node.line }),
        el("div", {}, "Called by: ", ...names(callersOf(node.id))),
        el("div", {}, "Calls: ", ...names(calleesOf(node.id))))));
  }

  /** The Assistant's outline of how the calls run: a suggestion the Reviewer can read or ignore. */
  function walkthrough(state) {
    const { status, steps } = state.walkthrough;
    if (status === "writing" || status === "idle") return el("p", { class: "empty", text: "The Assistant is walking through the calls\u2026" });
    if (status === "problem") {
      return el("div", { class: "notice problem", role: "alert" }, "The Assistant could not walk through the calls.",
        el("button", { type: "button", "data-focus": "writeWalkthrough", onclick: () => post({ type: "writeWalkthrough" }), text: "Try again" }));
    }
    const item = (step) => el("li", {},
      el("span", { class: "num", text: step.number + "." }), " ",
      el("button", { type: "button", class: "sym", "data-focus": "step:" + step.number, onclick: () => post({ type: "select", id: step.id }), text: step.name }),
      step.status !== "unchanged" ? el("span", { class: "badge", text: step.status }) : null, " ",
      el("span", { class: "where", text: before(step) + step.path + ":" + step.line }),
      step.when ? el("div", { class: "detail", text: "When " + step.when }) : null,
      step.takes || step.gives ? el("div", { class: "detail", text: [step.takes && "Takes " + step.takes, step.gives && "Gives " + step.gives].filter(Boolean).join("  \u00b7  ") }) : null,
      step.note ? el("div", { class: "note", text: "The Change: " + step.note }) : null,
      step.calls.length > 0 ? el("ol", {}, step.calls.map(item)) : null);
    return el("div", {},
      el("p", { class: "hint", text: "The Assistant's account of how the calls run, in order. It is a suggestion made from the calls the language servers gave; the call map and swimlanes show the data it says crosses them." }),
      el("ol", { class: "list walkthrough", "aria-label": "Walkthrough: " + steps.length + " steps" }, steps.map(item)));
  }

  function details(state) {
    const node = state.selected && state.known.find((n) => n.id === state.selected);
    if (!node) return el("div", { class: "details" }, el("span", { class: "empty", text: "Select a symbol to see where it is and to jump the diff to it." }));
    return el("div", { class: "details", id: "details" },
      el("strong", { text: node.name }), el("span", { class: "badge", text: node.status }), " ",
      el("div", { class: "where", text: before(node) + node.path + ":" + node.line }),
      neighbours(state, node),
      el("div", { class: "actions" },
        el("button", { type: "button", onclick: () => post({ type: "openDiff", id: node.id }), text: "Open in diff" }),
        expandButton(state, node.id)));
  }

  /** The symbols the selected one calls and is called by, as buttons that select them: the map's calls without the arrow keys. */
  function neighbours(state, node) {
    if (state.view !== "map") return null;
    const known = new Map(state.known.map((n) => [n.id, n]));
    const drawn = new Set(state.flow.nodes.map((n) => n.id));
    const ends = (pick) => state.flow.edges.map(pick).map((id) => known.get(id)).filter((n) => n && drawn.has(n.id));
    const calls = ends((e) => e.from === node.id && e.to), callers = ends((e) => e.to === node.id && e.from);
    const link = (n) => el("button", { type: "button", class: "sym", "data-focus": "nb:" + n.id, onclick: () => { focusAfter = n.id; post({ type: "select", id: n.id }); }, text: n.name });
    const names = (list) => list.length ? list.flatMap((n, i) => (i ? [", ", link(n)] : [link(n)])) : ["none"];
    return el("div", { class: "neighbours" }, el("div", {}, "Calls: ", ...names(calls)), el("div", {}, "Called by: ", ...names(callers)));
  }

  /** Draws the neighbours the cap left out around a symbol the call map or list shows. */
  function expandButton(state, id) {
    const drawn = state.offers.hops && state.flow.nodes.find((n) => n.id === id);
    if (!drawn || !drawn.hidden) return null;
    return el("button", { type: "button", "data-focus": "expand", onclick: () => post({ type: "expand", id }),
      text: "Draw its " + drawn.hidden + (drawn.hidden === 1 ? " other neighbour" : " other neighbours") });
  }

  let current;
  /** The symbol, and the call row, that hold the one tab stop into the picture. */
  let rovingNode, rovingCall;
  /** The call row the Reviewer chose, since several rows may share a callee. */
  let selectedCall;
  /** Where the Reviewer last moved with Right or Left, so the opposite key goes back. */
  let trail = {};
  /** A symbol to focus once the next render has drawn it. */
  let focusAfter;
  /** The symbol whose selection the live region last announced. */
  let announced;
  /** What identifies the focused control across a render: the shared script only follows buttons and inputs. */
  const focusKey = () => {
    const active = document.activeElement;
    return active && (active.getAttribute("data-focus") || (active.id === "entry" ? "entry" : null));
  };
  function render(state) {
    // Rebuilding the page puts every scroll back at the start, so note where they were.
    const prior = { view: current && current.view, page: window.scrollY, canvas: scrollOf(app.querySelector(".canvas")) };
    current = state;
    const key = focusKey();
    keepFocus(() => {
      app.replaceChildren(toolbar(state), ...notices(state));
      if (state.loading) {
        app.append(el("p", { class: "empty", text: "Asking the language servers\\u2026" }));
      } else if (state.view === "walkthrough") {
        app.append(walkthrough(state));
      } else if (state.offers.picture) {
        if (state.view !== "list") app.append(hint(state.view));
        app.append(state.view === "lanes" ? lanes(state) : state.view === "list" ? list(state) : callMap(state));
      } else if (state.offers.empty) {
        app.append(el("p", { class: "empty", text: state.offers.empty }));
      }
      if (!state.loading) app.append(details(state));
    });
    fitNodeTexts();
    const canvas = app.querySelector(".canvas");
    if (canvas && prior.canvas && prior.view === state.view) { canvas.scrollLeft = prior.canvas.left; canvas.scrollTop = prior.canvas.top; }
    window.scrollTo(window.scrollX, prior.page);
    const restored = key && document.querySelector(key === "entry" ? "#entry" : '[data-focus="' + CSS.escape(key) + '"]');
    if (restored && document.activeElement !== restored) {
      restored.focus({ preventScroll: true });
      // Only as far as it takes to see it: the canvas and the page stay where they were.
      restored.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    if (focusAfter) {
      const target = document.querySelector('[data-node="' + CSS.escape(focusAfter) + '"]');
      focusAfter = undefined;
      if (target) { setRoving(target.getAttribute("data-node")); target.focus({ preventScroll: true }); target.scrollIntoView({ block: "nearest", inline: "nearest" }); }
    }
    const picked = state.selected && state.known.find((n) => n.id === state.selected);
    if (!state.loading && picked && picked.id !== announced) {
      const calls = state.flow.edges.filter((e) => e.from === picked.id).length, callers = state.flow.edges.filter((e) => e.to === picked.id).length;
      setText(live, "Selected " + describe(picked) + ", " + calls + (calls === 1 ? " call, " : " calls, ") + callers + (callers === 1 ? " caller" : " callers"));
    } else {
      setText(live, state.loading ? "Asking the language servers" : state.flow.nodes.length + " symbols shown");
    }
    announced = picked ? picked.id : undefined;
  }

  const scrollOf = (canvas) => canvas ? { left: canvas.scrollLeft, top: canvas.scrollTop } : null;
  /** Says how the page is laid out, so the tests can check that a render kept the Reviewer's place. */
  function reportLayout() {
    const canvas = app.querySelector(".canvas");
    const active = document.activeElement;
    const focused = canvas && active && canvas.contains(active) ? active : null;
    let focusInView = null;
    if (focused) {
      const inner = focused.getBoundingClientRect(), outer = canvas.getBoundingClientRect();
      focusInView = inner.left >= outer.left - 1 && inner.right <= outer.right + 1 && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
    }
    post({ type: "layout", canvas: scrollOf(canvas), focusInView });
  }
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "scrollCanvas") {
      const canvas = app.querySelector(".canvas");
      if (canvas) { canvas.scrollLeft = message.left; canvas.scrollTop = message.top; }
      reportLayout();
      return;
    }
    if (message.type === "focusNode") {
      const node = document.querySelector('[data-node="' + CSS.escape(message.id) + '"]');
      if (node) node.focus();
      reportLayout();
      return;
    }
    if (message.type !== "state") return;
    render(message.state);
    reportLayout();
    post({ type: "rendered", revision: message.revision });
  });
  post({ type: "ready" });
</script>
</body>
</html>`;
}
