// The Code Flow tab: a webview in an editor tab beside the diff that draws
// how the code a Change touches calls and is called by the code around it,
// as a call map or as swimlanes, or as a list for a screen reader. The
// extension sends it the whole state; the webview renders it, says which
// state it rendered, and asks the extension for everything else.

import * as crypto from "crypto";
import * as vscode from "vscode";
import type { FlowGraph, FlowNode, ShownFlow } from "./codeFlow";
import type { LanguageOutcome } from "./codeFlowGather";
import { MarkdownPanel, sharedScript, sharedStyles } from "./markdownPanel";

export type FlowView = "map" | "lanes" | "list";

/** What the extension sends the webview. */
export interface CodeFlowState {
  /** Whether the language servers are still being asked. */
  loading: boolean;
  hops: 0 | 1 | 2;
  view: FlowView;
  /** Whether the symbols of test files are drawn. */
  showTests: boolean;
  flow: ShownFlow;
  /** Every symbol gathered, for the details of one the picture doesn't draw. */
  known: FlowNode[];
  /** How many symbols the hops reach that the cap left undrawn. */
  undrawn: number;
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
  | { type: "showAll" }
  | { type: "setShowTests"; show: boolean }
  | { type: "retry" }
  | { type: "findExtensions"; language: string }
  | { type: "ready" }
  | { type: "rendered"; revision: number };

export class CodeFlowPanel {
  private readonly view: MarkdownPanel<CodeFlowState, CodeFlowState>;
  readonly onDidDispose: vscode.Event<void>;

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
        if (["map", "lanes", "list"].includes(message.view)) {
          this.onAction(message);
        }
        break;
      case "select":
      case "openDiff":
      case "setEntry":
        if (typeof message.id === "string") {
          this.onAction(message);
        }
        break;
      case "setShowTests":
        if (typeof message.show === "boolean") {
          this.onAction(message);
        }
        break;
      case "findExtensions":
        if (typeof message.language === "string") {
          this.onAction(message);
        }
        break;
      case "showAll":
      case "retry":
        this.onAction(message);
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
  .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin: 0 0 10px; }
  .group { display: inline-flex; align-items: center; gap: 6px; }
  .seg { display: inline-flex; }
  .seg button { font: inherit; padding: 2px 10px; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: 1px solid var(--vscode-button-border, var(--vscode-contrastBorder, transparent)); cursor: pointer; }
  .seg button:first-child { border-radius: 2px 0 0 2px; }
  .seg button:last-child { border-radius: 0 2px 2px 0; }
  .seg button:only-child { border-radius: 2px; }
  .seg button[aria-pressed=true] { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  .seg button[aria-pressed=true]::before { content: "\\2713\\00a0"; }
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
  .canvas { overflow: auto; border: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder)); background: var(--vscode-editor-background); }
  .canvas svg { display: block; }
  .node rect { fill: var(--vscode-editor-background); stroke: var(--vscode-descriptionForeground); stroke-width: 1; }
  .node.changed rect { stroke: var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-focusBorder)); stroke-width: 2.5; }
  .node.new rect { stroke: var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-focusBorder)); stroke-width: 2.5; stroke-dasharray: 5 3; }
  .node.removed rect { stroke: var(--vscode-gitDecoration-deletedResourceForeground, var(--vscode-focusBorder)); stroke-width: 2.5; stroke-dasharray: 2 3; }
  .node[aria-pressed=true] rect { fill: var(--vscode-list-activeSelectionBackground); }
  .node[aria-pressed=true] text { fill: var(--vscode-list-activeSelectionForeground); }
  .node[aria-pressed=true] rect, .call[aria-pressed=true] .hit { stroke-dasharray: none; }
  .node:focus { outline: none; }
  .node:focus-visible rect, .call:focus-visible .hit { stroke: var(--vscode-focusBorder); stroke-width: 3; }
  .node text, .lane text, .call text { fill: var(--vscode-editor-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
  .node .name { font-family: var(--vscode-editor-font-family); font-weight: 600; }
  .node .where, .edge-label, .more { fill: var(--vscode-descriptionForeground); font-size: calc(var(--vscode-font-size) * 0.9); }
  .node.unchanged .name { font-weight: 400; }
  .edge { fill: none; stroke: var(--vscode-descriptionForeground); stroke-width: 1.2; }
  .arrow { fill: var(--vscode-descriptionForeground); }
  .lane-head { font-weight: 600; }
  .lane-line { stroke: var(--vscode-panel-border, var(--vscode-descriptionForeground)); stroke-dasharray: 3 4; }
  .call .hit { fill: transparent; stroke: transparent; }
  .call:hover .hit { fill: var(--vscode-list-hoverBackground); }
  .call[aria-pressed=true] .hit { fill: var(--vscode-list-activeSelectionBackground); stroke: var(--vscode-list-activeSelectionForeground); }
  .call[aria-pressed=true] text { fill: var(--vscode-list-activeSelectionForeground); }
  .details { margin: 10px 0 0; padding: 8px; border: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder)); min-height: 3em; }
  .details .where, .list .where { font-family: var(--vscode-editor-font-family); color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; }
  .details button { margin-top: 6px; font: inherit; padding: 2px 12px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 1px solid var(--vscode-button-border, var(--vscode-contrastBorder, transparent)); border-radius: 2px; cursor: pointer; }
  .details button:hover { background: var(--vscode-button-hoverBackground); }
  .list { margin: 0; padding-left: 1.2em; }
  .list li { margin: 6px 0; }
  .list button.sym { font: inherit; font-family: var(--vscode-editor-font-family); background: none; border: none; color: var(--vscode-textLink-foreground); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; padding: 0; }
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
  const describe = (node) => node.name + ", " + STATUS[node.status] + ", " + before(node) + node.path + " line " + node.line;

  const arrowDefs = () => svg("defs", {}, svg("marker", { id: "arrow", viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" }, svg("path", { class: "arrow", d: "M0 0 L10 5 L0 10 z" })));

  /** A second Enter on the selected symbol opens its diff; anything else selects it. */
  function activate(event, id) {
    event.preventDefault();
    if (current.selected === id && event.key === "Enter") post({ type: "openDiff", id });
    else post({ type: "select", id });
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
      seg("View", [["map", "Call map"], ["lanes", "Swimlanes"], ["list", "List"]], state.view, (view) => post({ type: "setView", view })));
    if (state.view !== "lanes") {
      bar.append(seg("Show", [[0, "Changed only"], [1, "+1 hop"], [2, "+2 hops"]], state.hops, (hops) => post({ type: "setHops", hops })));
    } else if (state.flow.entries.length > 0) {
      const select = el("select", { id: "entry", "aria-label": "Entry point", onchange: () => post({ type: "setEntry", id: select.value }) },
        state.flow.entries.map((entry) => el("option", { value: entry.id, selected: entry.id === state.flow.entry, text: entry.name })));
      bar.append(el("span", { class: "group" }, el("label", { for: "entry", text: "Calls from" }), select));
    }
    bar.append(el("span", { class: "seg" },
      el("button", { type: "button", "aria-pressed": String(state.showTests), "data-focus": "showTests", onclick: () => post({ type: "setShowTests", show: !state.showTests }), text: "Show tests" })));
    bar.append(el("span", { class: "legend" },
      el("span", {}, el("i", { class: "key changed" }), "changed"),
      el("span", {}, el("i", { class: "key new" }), "new"),
      el("span", {}, el("i", { class: "key removed" }), "removed"),
      el("span", {}, el("i", { class: "key unchanged" }), "unchanged")));
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
      } else if (outcome === "silent") {
        out.push(el("div", { class: "notice" },
          "The language server for " + language + " did not answer.",
          el("button", { type: "button", onclick: () => post({ type: "retry" }), text: "Try again" })));
      }
    }
    if (!state.showTests && state.flow.testsHidden > 0) {
      out.push(el("div", { class: "notice" }, state.flow.testsHidden + (state.flow.testsHidden === 1 ? " test symbol hidden." : " test symbols hidden."),
        el("button", { type: "button", onclick: () => post({ type: "setShowTests", show: true }), text: "Show tests" })));
    }
    if (state.undrawn > 0) {
      out.push(el("div", { class: "notice" }, state.undrawn + " more symbols are left out to keep the map readable.",
        el("button", { type: "button", onclick: () => post({ type: "showAll" }), text: "Show all" })));
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
    const drawing = svg("svg", { width, height, viewBox: "0 0 " + width + " " + height, role: "group", "aria-label": "Call map: " + nodes.length + " symbols" },
      arrowDefs());
    for (const edge of state.flow.edges) {
      const from = byId.get(edge.from), to = byId.get(edge.to);
      if (!from || !to) continue;
      const a = at(from), b = at(to);
      const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2;
      const bend = Math.max(30, Math.abs(x2 - x1) / 2);
      const group = svg("g", {},
        svg("path", { class: "edge", d: "M" + x1 + " " + y1 + " C" + (x1 + bend) + " " + y1 + " " + (x2 - bend) + " " + y2 + " " + x2 + " " + y2, "marker-end": "url(#arrow)" }));
      if (edge.label) group.append(svg("text", { class: "edge-label", x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 4, "text-anchor": "middle" }, svg("title", { text: edge.label }), clip(edge.label, 22)));
      drawing.append(group);
    }
    for (const node of nodes) {
      const { x, y } = at(node);
      const group = svg("g", { class: "node " + node.status, transform: "translate(" + x + " " + y + ")", tabindex: "0", role: "button", "aria-pressed": String(state.selected === node.id), "aria-label": describe(node) + (node.hidden ? ", " + node.hidden + " more neighbours not drawn" : ""), "data-node": node.id, "data-focus": "node:" + node.id },
        svg("title", { text: describe(node) }),
        svg("rect", { width: NODE_W, height: NODE_H, rx: 3 }),
        svg("text", { class: "name", x: 8, y: 19 }, clip(node.name, 22)),
        svg("text", { class: "where", x: 8, y: 36 }, clip((node.side === "base" ? "before: " : "") + baseName(node.path) + ":" + node.line, 26)));
      if (node.status !== "unchanged") group.append(svg("text", { class: "where", x: NODE_W - 8, y: 19, "text-anchor": "end" }, node.status === "new" ? "+ new" : node.status === "removed" ? "\\u2212 removed" : "\\u25cf changed"));
      if (node.hidden) group.append(svg("text", { class: "more", x: NODE_W - 8, y: 36, "text-anchor": "end" }, "+" + node.hidden + " more"));
      group.addEventListener("click", () => post({ type: "select", id: node.id }));
      group.addEventListener("dblclick", () => post({ type: "openDiff", id: node.id }));
      group.addEventListener("keydown", (event) => nodeKey(event, node, nodes));
      drawing.append(group);
    }
    return el("div", { class: "canvas" }, drawing);
  }

  /** Enter and Space select, Enter again opens the diff; arrows move to the symbols around. */
  function nodeKey(event, node, nodes) {
    const focusNode = (target) => {
      if (!target) return;
      event.preventDefault();
      const found = document.querySelector('[data-node="' + CSS.escape(target.id) + '"]');
      if (found) found.focus();
    };
    const sameColumn = nodes.filter((n) => n.column === node.column).sort((a, b) => a.row - b.row);
    const index = sameColumn.indexOf(node);
    if (event.key === "Enter" || event.key === " ") activate(event, node.id);
    else if (event.key === "ArrowDown") focusNode(sameColumn[index + 1]);
    else if (event.key === "ArrowUp") focusNode(sameColumn[index - 1]);
    else if (event.key === "ArrowRight") focusNode(current.flow.edges.map((e) => e.from === node.id && nodes.find((n) => n.id === e.to)).find(Boolean));
    else if (event.key === "ArrowLeft") focusNode(current.flow.edges.map((e) => e.to === node.id && nodes.find((n) => n.id === e.from)).find(Boolean));
  }

  function lanes(state) {
    const { lanes: names, calls } = state.flow;
    const known = new Map(state.known.map((n) => [n.id, n]));
    if (names.length === 0) return el("p", { class: "empty", text: "Nothing is called from here." });
    const LANE_W = 210, ROW_H = 44, TOP = 46;
    const width = PAD * 2 + names.length * LANE_W;
    const height = TOP + calls.length * ROW_H + PAD;
    const x = (lane) => PAD + lane * LANE_W + LANE_W / 2;
    const drawing = svg("svg", { width, height, viewBox: "0 0 " + width + " " + height, role: "group", "aria-label": "Swimlanes: " + calls.length + " calls" },
      arrowDefs());
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
      const group = svg("g", { class: "call", tabindex: "0", role: "button", "aria-pressed": String(state.selected === call.to), "aria-label": (i + 1) + ". " + (source ? source.name : call.from) + " calls " + (target ? target.name : call.to) + (call.label ? ", " + call.label : ""), "data-focus": "call:" + i },
        svg("rect", { class: "hit", x: PAD, y: y - ROW_H / 2 + 2, width: width - PAD * 2, height: ROW_H - 4, rx: 3 }),
        same
          ? svg("path", { class: "edge", d: "M" + x1 + " " + (y - 6) + " h28 v12 h-26", "marker-end": "url(#arrow)" })
          : svg("line", { class: "edge", x1, x2: x2 + (x2 > x1 ? -2 : 2), y1: y, y2: y, "marker-end": "url(#arrow)" }),
        svg("text", { x: Math.min(x1, x2) + 8, y: y - 8 }, (i + 1) + ". " + clip((target ? target.name : call.to) + (call.label ? "  " + call.label : ""), 40)));
      group.addEventListener("click", () => post({ type: "select", id: call.to }));
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") activate(event, call.to);
        else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const calls = [...document.querySelectorAll("[data-focus^='call:']")];
          const target = calls[calls.indexOf(group) + (event.key === "ArrowDown" ? 1 : -1)];
          if (target) target.focus();
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
    if (state.flow.nodes.length === 0) return el("p", { class: "empty", text: "No symbols to list." });
    return el("ul", { class: "list" }, state.flow.nodes.map((node) =>
      el("li", {},
        link(node), el("span", { class: "badge", text: node.status }), " ",
        el("span", { class: "where", text: before(node) + node.path + ":" + node.line }),
        el("div", {}, "Called by: ", ...names(callersOf(node.id))),
        el("div", {}, "Calls: ", ...names(calleesOf(node.id))))));
  }

  function details(state) {
    const node = state.selected && state.known.find((n) => n.id === state.selected);
    if (!node) return el("div", { class: "details" }, el("span", { class: "empty", text: "Select a symbol to see where it is and to jump the diff to it." }));
    return el("div", { class: "details", id: "details" },
      el("strong", { text: node.name }), el("span", { class: "badge", text: node.status }), " ",
      el("div", { class: "where", text: before(node) + node.path + ":" + node.line }),
      el("button", { type: "button", onclick: () => post({ type: "openDiff", id: node.id }), text: "Open in diff" }));
  }

  let current;
  /** What identifies the focused control across a render: the shared script only follows buttons and inputs. */
  const focusKey = () => {
    const active = document.activeElement;
    return active && (active.getAttribute("data-focus") || (active.id === "entry" ? "entry" : null));
  };
  function render(state) {
    current = state;
    const key = focusKey();
    keepFocus(() => {
      app.replaceChildren(toolbar(state), ...notices(state));
      if (state.loading) {
        app.append(el("p", { class: "empty", text: "Asking the language servers\\u2026" }));
      } else if (!state.showTests && state.flow.testsHidden > 0 && state.flow.entries.length === 0) {
        app.append(el("p", { class: "empty", text: "Every symbol this Change touches is test code, which is hidden." }));
      } else if (state.flow.nodes.length === 0 && state.flow.entries.length === 0 && state.languages.every((l) => l.outcome === "answered") && !state.problem) {
        app.append(el("p", { class: "empty", text: "This Change touches no functions or methods Code Flow can draw." }));
      } else if (state.flow.nodes.length > 0 || state.view === "lanes") {
        app.append(state.view === "lanes" ? lanes(state) : state.view === "list" ? list(state) : callMap(state));
      }
      if (!state.loading) app.append(details(state));
    });
    const restored = key && document.querySelector(key === "entry" ? "#entry" : '[data-focus="' + CSS.escape(key) + '"]');
    if (restored && document.activeElement !== restored) restored.focus({ preventScroll: true });
    setText(live, state.loading ? "Asking the language servers" : state.flow.nodes.length + " symbols shown");
  }

  window.addEventListener("message", (event) => {
    if (event.data.type !== "state") return;
    render(event.data.state);
    post({ type: "rendered", revision: event.data.revision });
  });
  post({ type: "ready" });
</script>
</body>
</html>`;
}
