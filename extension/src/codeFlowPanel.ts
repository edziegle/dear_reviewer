// The Code Flow tab: a webview in an editor tab beside the diff that draws
// how the code a Change touches calls and is called by the code around it,
// as a call map or as swimlanes, or as a list for a screen reader. The
// extension sends it the whole state; the webview renders it, says which
// state it rendered, and asks the extension for everything else.

import * as crypto from "crypto";
import * as vscode from "vscode";
import type { FlowNode, FlowOffers, ShownFlow } from "./codeFlow";
import { languageName, type LanguageOutcome } from "./codeFlowGather";
import { codeFlowStyles } from "./codeFlowStyles";
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
  /** What to call each language in words, which the panel adds as it sends the state. */
  languageNames?: Record<string, string>;
  /** Why no Code Flow could be gathered at all. */
  problem?: string;
}

export type FromCodeFlow =
  | { type: "setHops"; hops: number }
  | { type: "setView"; view: string }
  /** Selects a symbol, and nothing more. */
  | { type: "select"; id: string }
  /** Selects a symbol and shows it in the diff, keeping the focus in the Code Flow. */
  | { type: "show"; id: string }
  /** Selects a symbol and moves the focus to it in the diff. */
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
      show: (shown) => ({
        ...shown,
        languageNames: languageNames(shown.languages),
      }),
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
      case "show":
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

/** What to call each language in words, from the extensions that contribute it. */
function languageNames(
  languages: CodeFlowState["languages"]
): Record<string, string> {
  const contributions = (vscode.extensions?.all ?? []).flatMap(
    (extension) => extension.packageJSON?.contributes?.languages ?? []
  );
  return Object.fromEntries(
    languages.map(({ language }) => [
      language,
      languageName(language, contributions),
    ])
  );
}

function html(): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">${sharedStyles}${codeFlowStyles}
</style>
</head>
<body>
<h1 id="heading" class="visually-hidden">Code Flow</h1>
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
  /** What a call is labelled with: the data it carries if the Assistant said, else the language server's label. */
  const edgeText = (edge) => edge.data || edge.label;
  /** The label's tooltip, which keeps both when there are two. */
  const edgeTitle = (edge) => edge.data && edge.label ? edge.data + " \u2014 " + edge.label : edgeText(edge);
  const describe = (node) => node.name + ", " + STATUS[node.status] + ", " + before(node) + node.path + " line " + node.line;

  /** Arrowheads of one size whatever the call's weight, in the color of the call they end. */
  const arrowDefs = () => svg("defs", {}, ["", "changed", "new", "removed", "selected"].map((status) =>
    svg("marker", { id: "arrow" + (status && "-" + status), viewBox: "0 0 10 10", refX: "9", refY: "5", markerUnits: "userSpaceOnUse", markerWidth: "8", markerHeight: "8", orient: "auto-start-reverse" },
      svg("path", { class: "arrow " + status, d: "M0 0 L10 5 L0 10 z" }))));
  const arrowOf = (status) => "url(#arrow" + (["changed", "new", "removed", "selected"].includes(status) ? "-" + status : "") + ")";

  /** A second Enter on the selected symbol opens it in the diff; anything else shows it there. */
  function activate(event, id) {
    event.preventDefault();
    if (current.selected === id && event.key === "Enter") post({ type: "openDiff", id });
    else post({ type: "show", id });
  }
  /** Shows a symbol in the diff from a click on its name, which its box or row would only select. */
  const showOnClick = (id, before) => (event) => { event.stopPropagation(); if (before) before(); post({ type: "show", id }); };

  /** Says how to move through the picture, since the keys are not otherwise visible: behind Keys, and always the picture's description. */
  const hint = (view) => el("p", { class: "hint", id: "hint", hidden: !keysOpen,
    text: (view === "lanes" ? "Up and Down move between calls. Enter, or clicking a name, shows the symbol in the diff; Enter again opens it there." : "Arrow keys move between symbols; Right and Left follow calls. Enter, or clicking a name, shows the symbol in the diff; Enter again, or a double-click, opens it there.") });
  /** Opens and closes the hint, without drawing the picture again. */
  const keysButton = () => el("button", { type: "button", class: "link keys", "aria-expanded": String(keysOpen), "aria-controls": "hint", "data-focus": "keys", text: "Keys",
    onclick: (event) => {
      keysOpen = !keysOpen;
      event.currentTarget.setAttribute("aria-expanded", String(keysOpen));
      const shown = document.getElementById("hint");
      if (shown) shown.hidden = !keysOpen;
    } });

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

  const PAD = 20;
  /** The picture's measures, in the Reviewer's font size, so boxes and rows grow with the text. */
  function metrics() {
    const em = parseFloat(getComputedStyle(document.body).fontSize) || 13;
    const of = (n) => Math.round(em * n);
    // A column takes at most 24em, and less than half of a narrow tab, so a long name doesn't push the rest out of sight.
    const maxW = Math.max(of(12), Math.min(of(24), Math.round(app.clientWidth * 0.45)));
    return { nodeH: of(3.5), colGap: of(7), rowGap: of(1.8), minW: of(12), maxW, line1: of(1.45), line2: of(2.75), laneW: of(16), rowH: of(3.4), top: of(3.5) };
  }

  /**
   * Cuts a text to the room it has, measured at the Reviewer's font size,
   * from its end, or from its start to keep the end, as a qualified name's
   * method. The tooltip of what holds it keeps the full text.
   */
  function fitText(text, room, from) {
    if (!text) return;
    const full = text.textContent;
    if (text.getComputedTextLength() <= room) return;
    const cut = (n) => from === "start" ? "\u2026" + full.slice(full.length - n) : full.slice(0, n) + "\u2026";
    let low = 0, high = full.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      text.textContent = cut(mid);
      if (text.getComputedTextLength() <= room) low = mid;
      else high = mid - 1;
    }
    text.textContent = cut(low);
  }

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
    bar.append(el("span", { class: "group toggles" },
      el("span", { class: "seg" },
        el("button", { type: "button", "aria-pressed": String(state.showTests), "data-focus": "showTests", onclick: () => post({ type: "setShowTests", show: !state.showTests }), text: "Show tests" })),
      (state.showRemoved || state.flow.removedHidden > 0) && el("span", { class: "seg" },
        el("button", { type: "button", "aria-pressed": String(state.showRemoved), "data-focus": "showRemoved", onclick: () => post({ type: "setShowRemoved", show: !state.showRemoved }), text: "Show removed" }))));
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

  /** What went wrong, and what a language server did instead of answering, each with what helps. */
  function notices(state) {
    const out = [];
    const nameOf = (language) => (state.languageNames && state.languageNames[language]) || language;
    if (state.problem) out.push(el("div", { class: "notice problem", role: "alert" }, state.problem, el("button", { type: "button", onclick: () => post({ type: "retry" }), text: "Try again" })));
    for (const { language, outcome } of state.languages) {
      const name = nameOf(language);
      if (outcome === "none") {
        out.push(el("div", { class: "notice" },
          "No language server for " + name + ", so its calls can't be drawn.",
          el("button", { type: "button", onclick: () => post({ type: "findExtensions", language }), text: "Search extensions for " + name })));
      } else if (outcome === "noCalls") {
        out.push(el("div", { class: "notice" },
          "The language server for " + name + " gave no calls, and may not support call hierarchies. Install a language server for " + name + " that does." + (language === "python" ? " Pyright-based servers support them; Jedi, the one VS Code falls back to, does not." : "")));
      } else if (outcome === "silent") {
        out.push(el("div", { class: "notice" },
          "The language server for " + name + " did not answer.",
          el("button", { type: "button", onclick: () => post({ type: "retry" }), text: "Try again" })));
      }
    }
    if (state.view !== "walkthrough" && state.offers.tryHop) {
      out.push(el("div", { class: "notice" }, "No changed symbol calls another. One hop out shows what they call and what calls them.",
        el("button", { type: "button", onclick: () => post({ type: "setHops", hops: 1 }), text: "+1 hop" })));
    }
    return out;
  }

  /**
   * One quiet line under the toolbar: what the picture leaves out, each with
   * the link that brings it in, and Keys, which opens the hint.
   */
  function meta(state, withKeys) {
    const items = [];
    const item = (text, label, name, onclick) => el("span", {}, text + " ", el("button", { type: "button", class: "link", "aria-label": name, onclick, text: label }));
    const count = (n, one, many) => n + (n === 1 ? one : many);
    if (!state.showTests && state.flow.testsHidden > 0)
      items.push(item(count(state.flow.testsHidden, " test symbol hidden.", " test symbols hidden."), "Show", "Show tests", () => post({ type: "setShowTests", show: true })));
    if (!state.showRemoved && state.flow.removedHidden > 0)
      items.push(item(count(state.flow.removedHidden, " removed symbol hidden.", " removed symbols hidden."), "Show", "Show removed", () => post({ type: "setShowRemoved", show: true })));
    const offers = state.offers;
    if (offers.callless > 0)
      items.push(item(count(offers.callless, " symbol with no calls is only in the list.", " symbols with no calls are only in the list."), "Show the list", undefined, () => post({ type: "setView", view: "list" })));
    if (offers.undrawn > 0)
      items.push(item(count(offers.undrawn, " more symbol is left out to keep the view readable.", " more symbols are left out to keep the view readable."), "Show all", undefined, () => post({ type: "setShowAll", show: true })));
    if (offers.showingAll)
      items.push(item("All " + offers.showingAll + " symbols are drawn.", "Show fewer", undefined, () => post({ type: "setShowAll", show: false })));
    if (items.length === 0 && !withKeys) return null;
    return el("div", { class: "meta" },
      el("p", { class: "left-out" }, items.flatMap((it, i) => (i ? [" \u00b7 ", it] : [it]))),
      withKeys && keysButton());
  }

  /** The second line's right-hand text: the symbol's mark, and how many of its neighbours the map leaves out. */
  const sideText = (node) => [statusMark(node), node.hidden ? node.hidden + " not drawn" : ""].filter(Boolean).join("  \u00b7  ");

  function callMap(state) {
    const m = metrics();
    const nodes = state.flow.nodes;
    const columns = Math.max(0, ...nodes.map((n) => n.column)) + 1;
    const rows = Math.max(0, ...nodes.map((n) => n.row)) + 1;
    // Each column is as wide as its longest name needs, within bounds, so a name keeps the part that tells it apart.
    const probe = svg("svg", { class: "probe", "aria-hidden": "true" });
    document.body.append(probe);
    const texts = nodes.map((node) => {
      const name = svg("text", { class: "name" }, node.name), loc = svg("text", { class: "where" }, placeOf(node)), side = svg("text", { class: "where" }, sideText(node));
      probe.append(svg("g", { class: "node " + node.status }, name, loc, side));
      return { node, name, loc, side };
    });
    const colW = Array.from({ length: columns }, () => m.minW);
    for (const { node, name, loc, side } of texts) {
      const beside = side.textContent ? side.getComputedTextLength() + 12 : 0;
      const need = Math.ceil(Math.max(name.getComputedTextLength(), loc.getComputedTextLength() + beside) + 16);
      colW[node.column] = Math.min(m.maxW, Math.max(colW[node.column], need));
    }
    probe.remove();
    const colX = colW.map((w, c) => PAD + colW.slice(0, c).reduce((sum, before) => sum + before + m.colGap, 0));
    const at = (n) => ({ x: colX[n.column], y: PAD + n.row * (m.nodeH + m.rowGap) });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const width = PAD * 2 + colW.reduce((sum, w) => sum + w, 0) + (columns - 1) * m.colGap;
    const height = PAD * 2 + rows * m.nodeH + (rows - 1) * m.rowGap;
    const drawing = svg("svg", { width, height, viewBox: "0 0 " + width + " " + height, role: "listbox", "aria-label": "Call map: " + nodes.length + " symbols", "aria-describedby": "hint" },
      arrowDefs());
    const inReadingOrder = nodes.slice().sort((a, b) => a.column - b.column || a.row - b.row);
    const stopId = nodes.some((n) => n.id === rovingNode) ? rovingNode : nodes.some((n) => n.id === state.selected) ? state.selected : inReadingOrder[0] && inReadingOrder[0].id;
    // The selected symbol's calls, in and out, are drawn last, so they cross over the others.
    const ofSelected = (edge) => Boolean(state.selected) && (edge.from === state.selected || edge.to === state.selected);
    const edges = [...state.flow.edges.filter((edge) => !ofSelected(edge)), ...state.flow.edges.filter(ofSelected)];
    for (const edge of edges) {
      const from = byId.get(edge.from), to = byId.get(edge.to);
      if (!from || !to) continue;
      const a = at(from), b = at(to);
      const x1 = a.x + colW[from.column], y1 = a.y + m.nodeH / 2, x2 = b.x, y2 = b.y + m.nodeH / 2;
      const bend = Math.max(30, Math.abs(x2 - x1) / 2);
      const selected = ofSelected(edge);
      const group = svg("g", { class: selected ? "selected-call" : undefined, "data-from": edge.from, "data-to": edge.to },
        svg("path", { class: "edge", d: "M" + x1 + " " + y1 + " C" + (x1 + bend) + " " + y1 + " " + (x2 - bend) + " " + y2 + " " + x2 + " " + y2, "marker-end": arrowOf(selected ? "selected" : undefined) }));
      // Only the selected symbol's calls are labelled, so a label can't be taken for its neighbour's; it keeps to the gap its call crosses.
      if (selected && edgeText(edge)) group.append(svg("text", { class: "edge-label", x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 4, "text-anchor": "middle", "data-room": Math.max(40, Math.abs(x2 - x1) - 12) }, svg("title", { text: edgeTitle(edge) }), svg("tspan", {}, edgeText(edge))));
      drawing.append(group);
    }
    for (const node of nodes) {
      const { x, y } = at(node);
      const w = colW[node.column];
      const group = svg("g", { class: "node " + node.status, transform: "translate(" + x + " " + y + ")", tabindex: node.id === stopId ? "0" : "-1", role: "option", "aria-selected": String(state.selected === node.id), "aria-label": describe(node) + (node.hidden ? ", " + node.hidden + " more neighbours not drawn" : ""), "data-node": node.id, "data-focus": "node:" + node.id, "data-width": w },
        svg("title", { text: describe(node) }),
        svg("rect", { class: "ring", x: -4, y: -4, width: w + 8, height: m.nodeH + 8, rx: 5 }),
        svg("rect", { class: "box", width: w, height: m.nodeH, rx: 3 }),
        svg("text", { class: "name", x: 8, y: m.line1, onclick: showOnClick(node.id) }, node.name),
        svg("text", { class: "where loc", x: 8, y: m.line2 }, placeOf(node)));
      if (sideText(node)) group.append(svg("text", { class: "where side", x: w - 8, y: m.line2, "text-anchor": "end" }, sideText(node)));
      group.addEventListener("click", () => post({ type: "select", id: node.id }));
      group.addEventListener("focus", () => { rovingNode = node.id; setRoving(node.id); });
      group.addEventListener("dblclick", () => post({ type: "openDiff", id: node.id }));
      group.addEventListener("keydown", (event) => nodeKey(event, node, nodes));
      drawing.append(group);
    }
    return el("div", { class: "canvas" }, drawing);
  }

  /**
   * Cuts each symbol's name to its box, from the start so the method of a
   * qualified name stays, and its location to the room left beside its mark;
   * each call's label to the gap it crosses; and each lane's file to its lane,
   * from the start so the file name stays. Then widens the swimlanes to their
   * longest row, which is never cut.
   */
  function fitTexts() {
    for (const group of app.querySelectorAll(".node[data-width]")) {
      const w = Number(group.getAttribute("data-width"));
      const side = group.querySelector(".side");
      fitText(group.querySelector(".name"), w - 16, "start");
      fitText(group.querySelector(".loc"), w - 16 - (side ? side.getComputedTextLength() + 12 : 0), "end");
    }
    for (const label of app.querySelectorAll(".edge-label"))
      fitText(label.querySelector("tspan"), Number(label.getAttribute("data-room")), "end");
    const lanes = app.querySelector(".canvas svg.lanes");
    if (!lanes) return;
    const laneW = Number(lanes.getAttribute("data-lane-width"));
    for (const head of lanes.querySelectorAll(".lane-head tspan")) fitText(head, laneW - 8, "start");
    const right = Math.max(0, ...[...lanes.querySelectorAll(".call text")].map((text) => Number(text.getAttribute("x")) + text.getComputedTextLength()));
    const width = Math.max(Number(lanes.getAttribute("width")), Math.ceil(right + PAD));
    const height = lanes.getAttribute("height");
    lanes.setAttribute("width", width);
    lanes.setAttribute("viewBox", "0 0 " + width + " " + height);
    for (const hit of lanes.querySelectorAll(".hit")) hit.setAttribute("width", width - PAD * 2);
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
    const m = metrics();
    const LANE_W = m.laneW, ROW_H = m.rowH, TOP = m.top;
    // As wide as the lanes to start with; fitTexts widens it to the longest row.
    const width = PAD * 2 + names.length * LANE_W;
    const height = TOP + calls.length * ROW_H + PAD;
    const x = (lane) => PAD + lane * LANE_W + LANE_W / 2;
    const drawing = svg("svg", { class: "lanes", width, height, viewBox: "0 0 " + width + " " + height, role: "listbox", "aria-label": "Swimlanes: " + calls.length + " calls", "aria-describedby": "hint", "data-lane-width": LANE_W },
      arrowDefs());
    // Rows that share a callee share the selection; only the one the Reviewer chose reads as selected.
    const selectedRow = calls.some((c, i) => i === selectedCall && c.to === state.selected) ? selectedCall : calls.findIndex((c) => c.to === state.selected);
    const stopRow = rovingCall !== undefined && rovingCall < calls.length ? rovingCall : Math.max(selectedRow, 0);
    names.forEach((name, i) => {
      drawing.append(svg("g", { class: "lane" },
        svg("text", { class: "lane-head", x: x(i), y: Math.round(TOP * 0.52), "text-anchor": "middle" }, svg("title", { text: name }), svg("tspan", {}, name)),
        svg("line", { class: "lane-line", x1: x(i), x2: x(i), y1: Math.round(TOP * 0.74), y2: height - 8 })));
    });
    calls.forEach((call, i) => {
      const y = TOP + i * ROW_H + ROW_H / 2;
      const target = known.get(call.to), source = known.get(call.from);
      const x1 = x(call.fromLane), x2 = x(call.toLane);
      const same = call.fromLane === call.toLane;
      // What marks the callee marks the call; the caller's mark is named in the row's second line.
      const calleeMark = target ? statusMark(target) : "", callerMark = source ? statusMark(source) : "";
      const callee = target ? target.name : call.to;
      const heading = callee + (edgeText(call) ? "  " + edgeText(call) : "");
      const detail = [calleeMark, target ? placeOf(target) : "", callerMark && source ? "called from " + callerMark + " " + source.name : ""].filter(Boolean).join("  \u00b7  ");
      const group = svg("g", { class: "call " + (target ? target.status : "unchanged"), tabindex: i === stopRow ? "0" : "-1", role: "option", "aria-selected": String(i === selectedRow), "aria-label": (i + 1) + ". " + (source ? source.name + (callerMark ? " (" + STATUS[source.status] + ")" : "") : call.from) + " calls " + (target ? target.name + ", " + STATUS[target.status] + ", " + before(target) + target.path + " line " + target.line : call.to) + (call.data ? ", carrying " + call.data : "") + (call.label ? ", " + call.label : ""), "data-focus": "call:" + i },
        svg("rect", { class: "hit", x: PAD, y: y - ROW_H / 2 + 2, width: width - PAD * 2, height: ROW_H - 4, rx: 3 }),
        // A call within one file loops out to the left of its lane and back, clear of the row's text on the right.
        same
          ? svg("path", { class: "edge", d: "M" + x1 + " " + (y - 6) + " h-18 v12 h16", "marker-end": arrowOf(target && target.status) })
          : svg("line", { class: "edge", x1, x2: x2 + (x2 > x1 ? -2 : 2), y1: y, y2: y, "marker-end": arrowOf(target && target.status) }),
        svg("text", { x: Math.min(x1, x2) + 8, y: y - 8 }, (i + 1) + ". ",
          svg("tspan", { class: "name", onclick: showOnClick(call.to, () => { selectedCall = i; }) }, heading.slice(0, callee.length)),
          heading.slice(callee.length)),
        detail && svg("text", { class: "where", x: Math.min(x1, x2) + 8, y: y + 14 }, detail));
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
    const link = (node) => el("button", { type: "button", class: "sym", onclick: () => post({ type: "show", id: node.id }), text: node.name });
    const names = (nodes) => nodes.length ? nodes.flatMap((n, i) => (i ? [", ", link(n)] : [link(n)])) : ["none"];
    return el("ul", { class: "list" }, [...state.flow.nodes, ...state.flow.callless].map((node) =>
      el("li", {},
        link(node), node.status !== "unchanged" ? el("span", { class: "badge", text: node.status }) : null, " ",
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
      el("button", { type: "button", class: "sym", "data-focus": "step:" + step.number, onclick: () => post({ type: "show", id: step.id }), text: step.name }),
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
    if (!node) return el("div", { class: "details" }, el("span", { class: "empty", text: "Select a symbol to see where it is and what it calls. Click its name to show it in the diff." }));
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
    return el("button", { type: "button", class: "secondary", "data-focus": "expand", onclick: () => post({ type: "expand", id }),
      text: "Draw its " + drawn.hidden + (drawn.hidden === 1 ? " other neighbour" : " other neighbours") });
  }

  /*
   * Motion says what changed and which way the calls run. When the map draws
   * other symbols, those it keeps glide to their new places, new ones fade in
   * where they land, column by column on a first draw, the calls follow them,
   * and the ones it drops fade out where they were. Selecting a symbol runs ink
   * along its calls, from it to each callee; a new trace in the swimlanes runs
   * down the rows, in the order the calls are made. With reduced motion, from
   * the system or the editor, things only fade: nothing moves or runs.
   */
  const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
  const GLIDE = 320, ENTER = 220, EXIT = 140, FADE = 150, TRACE = 640;
  const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.body.classList.contains("vscode-reduce-motion");
  /** The animations playing, which the next render stops, and a key, or a test's message, finishes. */
  const running = new Set();
  function play(element, keyframes, options, done) {
    const animation = element.animate(keyframes, options);
    running.add(animation);
    const end = () => { running.delete(animation); if (done) done(); };
    animation.onfinish = end;
    animation.oncancel = end;
    return animation;
  }
  const settle = () => [...running].forEach((animation) => animation.finish());
  const stop = () => [...running].forEach((animation) => animation.cancel());
  const translate = (at) => ({ transform: "translate(" + at.x + "px, " + at.y + "px)" });
  /** Where a symbol of the map is drawn now, partway through a glide included. */
  function placeOn(group) {
    const style = getComputedStyle(group).transform;
    const matrix = style && style !== "none" ? new DOMMatrixReadOnly(style) : group.transform.baseVal.consolidate()?.matrix;
    return matrix ? { x: matrix.e, y: matrix.f } : { x: 0, y: 0 };
  }
  const edgeKey = (group) => group.getAttribute("data-from") + "\\n" + group.getAttribute("data-to");
  const traceKey = (state) => state.flow.calls.map((call) => call.from + "\\n" + call.to).join("\\n\\n");
  /** Takes a dropped symbol or call out of reach of the keyboard, the screen reader and the pointer. */
  function ghost(group) {
    for (const name of group.getAttributeNames()) if (name !== "class" && name !== "transform") group.removeAttribute(name);
    group.classList.add("ghost");
    group.setAttribute("aria-hidden", "true");
    return group;
  }

  /** What the picture showed, taken before a render replaces it. */
  function snapshot() {
    const nodes = new Map(), edges = new Map();
    for (const group of app.querySelectorAll(".canvas .node[data-node]")) nodes.set(group.getAttribute("data-node"), { group, at: placeOn(group) });
    for (const group of app.querySelectorAll(".canvas [data-from]")) edges.set(edgeKey(group), group);
    const row = app.querySelector(".call[aria-selected=true]");
    return {
      selected: current && current.selected,
      nodes, edges,
      trace: current && !current.loading && current.view === "lanes" ? traceKey(current) : null,
      row: row && row.getAttribute("data-focus"),
    };
  }

  /** Runs ink once along a call, from caller to callee. */
  function trace(drawing, edge, delay) {
    const d = edge.tagName === "line"
      ? "M" + edge.getAttribute("x1") + " " + edge.getAttribute("y1") + " L" + edge.getAttribute("x2") + " " + edge.getAttribute("y2")
      : edge.getAttribute("d");
    const run = svg("path", { class: "trace", d, pathLength: "1", "aria-hidden": "true" });
    drawing.append(run);
    return play(run, [
      { opacity: 1, strokeDashoffset: "1", easing: "cubic-bezier(0.3, 0, 0.2, 1)" },
      { opacity: 1, strokeDashoffset: "0", offset: 0.6 },
      { opacity: 0, strokeDashoffset: "0" },
    ], { duration: TRACE, delay, fill: "backwards" }, () => run.remove());
  }

  function mapMotion(before, state, drawing, reduced) {
    const played = [];
    const fade = (group, delay) => played.push(play(group, [{ opacity: 0 }, { opacity: 1 }], { duration: reduced ? FADE : ENTER, delay: reduced ? 0 : delay, easing: "ease-out", fill: "backwards" }));
    const groups = [...drawing.querySelectorAll(".node[data-node]")];
    const idOf = (group) => group.getAttribute("data-node");
    // When each symbol that moved or arrived is in place, for the calls that join it.
    const ready = new Map();
    for (const group of groups) {
      const was = before.nodes.get(idOf(group));
      const at = placeOn(group);
      if (!was || (was.at.x === at.x && was.at.y === at.y)) continue;
      ready.set(idOf(group), reduced ? 0 : GLIDE * 0.6);
      if (!reduced) played.push(play(group, [translate(was.at), translate(at)], { duration: GLIDE, easing: EASE_OUT }));
    }
    const firstDraw = before.nodes.size === 0;
    const enterAfter = ready.size > 0 ? GLIDE * 0.4 : 0;
    const columns = new Map(state.flow.nodes.map((node) => [node.id, node.column]));
    for (const group of groups) {
      if (before.nodes.has(idOf(group))) continue;
      const delay = enterAfter + (firstDraw ? Math.min((columns.get(idOf(group)) || 0) * 60, 240) : 0);
      ready.set(idOf(group), reduced ? 0 : delay + ENTER / 2);
      fade(group, delay);
    }
    // When each call is drawn in full, for the ink to run along it.
    const drawn = new Map();
    const edges = [...drawing.querySelectorAll("[data-from]")];
    for (const group of edges) {
      const ends = [group.getAttribute("data-from"), group.getAttribute("data-to")];
      if (before.edges.has(edgeKey(group)) && !ends.some((id) => ready.has(id))) continue;
      const delay = Math.max(0, ...ends.map((id) => ready.get(id) || 0));
      drawn.set(edgeKey(group), reduced ? 0 : delay + ENTER);
      fade(group, delay);
    }
    if (!firstDraw) {
      const kept = new Set(groups.map(idOf)), keptEdges = new Set(edges.map(edgeKey));
      const leaving = [
        ...[...before.edges].filter(([key]) => !keptEdges.has(key)).map(([, group]) => group),
        ...[...before.nodes].filter(([id]) => !kept.has(id)).map(([, { group, at }]) => { group.setAttribute("transform", "translate(" + at.x + " " + at.y + ")"); return group; }),
      ];
      const under = drawing.querySelector("defs");
      for (const group of leaving.reverse()) {
        under.after(ghost(group));
        played.push(play(group, [{ opacity: 1 }, { opacity: 0 }], { duration: reduced ? FADE : EXIT, easing: "ease-in", fill: "forwards" }, () => group.remove()));
      }
    }
    if (!reduced && state.selected && state.selected !== before.selected) {
      for (const group of drawing.querySelectorAll('[data-from="' + CSS.escape(state.selected) + '"]'))
        played.push(trace(drawing, group.querySelector(".edge"), drawn.get(edgeKey(group)) || 0));
    }
    return played;
  }

  function laneMotion(before, state, drawing, reduced) {
    const rows = [...drawing.querySelectorAll(".call")];
    if (traceKey(state) !== before.trace) {
      if (reduced) return [play(drawing, [{ opacity: 0 }, { opacity: 1 }], { duration: FADE, easing: "ease-out" })];
      const step = Math.min(45, 360 / Math.max(rows.length, 1));
      return rows.map((row, i) => trace(drawing, row.querySelector(".edge"), i * step));
    }
    const row = drawing.querySelector(".call[aria-selected=true]");
    if (reduced || !row || row.getAttribute("data-focus") === before.row) return [];
    return [trace(drawing, row.querySelector(".edge"), 0)];
  }

  /** Plays what changed since the snapshot; settles once it has played. */
  function motion(before, state) {
    const drawing = app.querySelector(".canvas svg");
    if (!drawing || state.loading || document.visibilityState !== "visible") return Promise.resolve();
    const reduced = reducedMotion();
    const played = state.view === "map" ? mapMotion(before, state, drawing, reduced)
      : state.view === "lanes" ? laneMotion(before, state, drawing, reduced)
      : [];
    return Promise.all(played.map((animation) => animation.finished.catch(() => {})));
  }
  // A key acts on where things end up, and a hidden page draws no frames to finish on.
  app.addEventListener("keydown", settle, true);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState !== "visible") settle(); });

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
  /** Whether the Reviewer opened the hint with Keys. */
  let keysOpen = false;
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
      const keyed = state.offers.picture && state.view !== "list";
      const line = !state.loading && state.view !== "walkthrough" && meta(state, keyed);
      if (line) app.append(line);
      if (state.loading) {
        app.append(el("p", { class: "empty", text: "Asking the language servers\\u2026" }));
      } else if (state.view === "walkthrough") {
        app.append(walkthrough(state));
      } else if (state.offers.picture) {
        if (keyed) app.append(hint(state.view));
        app.append(state.view === "lanes" ? lanes(state) : state.view === "list" ? list(state) : callMap(state));
      } else if (state.offers.empty) {
        app.append(el("p", { class: "empty", text: state.offers.empty }));
      }
      if (!state.loading) app.append(details(state));
    });
    fitTexts();
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
  window.addEventListener("message", function receive(event) {
    // The picture is laid out from measured text, so it waits for the fonts; messages keep their order behind them.
    if (document.fonts && document.fonts.status !== "loaded") { document.fonts.ready.then(() => receive(event)); return; }
    const message = event.data;
    if (message.type === "scrollCanvas") {
      settle();
      const canvas = app.querySelector(".canvas");
      if (canvas) { canvas.scrollLeft = message.left; canvas.scrollTop = message.top; }
      reportLayout();
      return;
    }
    if (message.type === "focusNode") {
      settle();
      const node = document.querySelector('[data-node="' + CSS.escape(message.id) + '"]');
      if (node) node.focus();
      reportLayout();
      return;
    }
    if (message.type !== "state") return;
    const before = snapshot();
    stop();
    render(message.state);
    // The layout is where things end up, so it is reported before they move;
    // the state counts as rendered once they have.
    reportLayout();
    motion(before, message.state).then(() => post({ type: "rendered", revision: message.revision }));
  });
  post({ type: "ready" });
</script>
</body>
</html>`;
}
