// The logic behind Code Flow: which symbols a picture of a Change shows, and
// how they are marked. Kept apart from `vscode` so the unit tests can run it
// under plain Node.

import type { LanguageOutcome } from "./codeFlowGather";
import { isTestPath } from "./testFiles";

export interface FlowNode {
  id: string;
  name: string;
  /** The file the symbol is in, from the repository root. */
  path: string;
  line: number;
  /** "removed" is a function of a file the Change deletes, as it was before. */
  status: "changed" | "new" | "removed" | "unchanged";
  /** Set for a symbol of the base worktree, as the Change found it. */
  side?: "base";
}

export interface FlowEdge {
  from: string;
  to: string;
  /** The call or signature the language server gave for the edge. */
  label?: string;
  /** The data that crosses the call, such as "verdict, body", as the Assistant's walkthrough gave it. */
  data?: string;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface LineRange {
  start: number;
  end: number;
}

/** What the diff does to one file, in the lines of the head side. */
export interface FileChange {
  path: string;
  isNewFile: boolean;
  /** Whether the Change deletes the file, so its symbols are those of the base worktree. */
  isDeletedFile?: boolean;
  /** Lines the Change adds with nothing replaced. */
  addedLines: LineRange[];
  /** Lines the Change rewrites. */
  modifiedLines: LineRange[];
}

/**
 * Whether the Change adds a symbol, edits it, or leaves it alone: new when
 * its file is new or every one of its lines is added, changed when the diff
 * reaches any of its lines.
 */
export function symbolStatus(
  symbol: { path: string; startLine: number; endLine: number },
  changes: readonly FileChange[]
): FlowNode["status"] {
  const change = changes.find((c) => c.path === symbol.path);
  if (!change) {
    return "unchanged";
  }
  if (change.isNewFile) {
    return "new";
  }
  const covers = (r: LineRange) =>
    r.start <= symbol.startLine && r.end >= symbol.endLine;
  const touches = (r: LineRange) =>
    r.start <= symbol.endLine && r.end >= symbol.startLine;
  if (change.addedLines.some(covers)) {
    return "new";
  }
  return [...change.addedLines, ...change.modifiedLines].some(touches)
    ? "changed"
    : "unchanged";
}

/** How many calls, in either direction, each symbol is from a changed or new one. */
function distances(graph: FlowGraph, maxHops: number): Map<string, number> {
  const neighbours = neighbourIds(graph);
  const distance = new Map<string, number>();
  let frontier = graph.nodes
    .filter((node) => node.status !== "unchanged")
    .map((node) => node.id);
  for (const id of frontier) {
    distance.set(id, 0);
  }
  for (let hop = 1; hop <= maxHops && frontier.length > 0; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const other of neighbours.get(id) ?? []) {
        if (!distance.has(other)) {
          distance.set(other, hop);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  return distance;
}

function neighbourIds(graph: FlowGraph): Map<string, string[]> {
  const neighbours = new Map<string, string[]>();
  for (const { from, to } of graph.edges) {
    neighbours.set(from, [...(neighbours.get(from) ?? []), to]);
    neighbours.set(to, [...(neighbours.get(to) ?? []), from]);
  }
  return neighbours;
}

function keeping(graph: FlowGraph, kept: ReadonlySet<string>): FlowGraph {
  return {
    nodes: graph.nodes.filter((node) => kept.has(node.id)),
    edges: graph.edges.filter(
      (edge) => kept.has(edge.from) && kept.has(edge.to)
    ),
  };
}

/**
 * The graph without the symbols of test files and their edges. What only a
 * test symbol reaches is left out by `withinHops`, which counts distance from
 * the changed symbols that remain.
 */
export function withoutTests(graph: FlowGraph): FlowGraph {
  return keeping(
    graph,
    new Set(graph.nodes.filter((n) => !isTestPath(n.path)).map((n) => n.id))
  );
}

/**
 * The graph without the symbols of deleted files, drawn as removed, and
 * their edges. What only a removed symbol reaches is left out by
 * `withinHops`, as with test symbols.
 */
export function withoutRemoved(graph: FlowGraph): FlowGraph {
  return keeping(
    graph,
    new Set(graph.nodes.filter((n) => n.status !== "removed").map((n) => n.id))
  );
}

/**
 * The symbols within `hops` calls, in either direction, of a changed or new
 * symbol, and the edges between them.
 */
export function withinHops(graph: FlowGraph, hops: number): FlowGraph {
  return keeping(graph, new Set(distances(graph, hops).keys()));
}

/**
 * At most `max` symbols, nearest a changed or new symbol first, though never
 * fewer than the changed and new ones, and with every neighbour of an
 * `expanded` symbol that is shown. `hidden` counts, for each symbol shown,
 * the neighbours left out, which the picture says it doesn't draw.
 */
export function capNodes(
  graph: FlowGraph,
  max: number,
  expanded: ReadonlySet<string> = new Set()
): { graph: FlowGraph; hidden: Map<string, number> } {
  const distance = distances(graph, Infinity);
  const nearestFirst = graph.nodes
    .filter((node) => distance.has(node.id))
    .sort((a, b) => distance.get(a.id)! - distance.get(b.id)!);
  const mustShow = nearestFirst.filter((node) => distance.get(node.id) === 0);
  const kept = new Set(
    nearestFirst.slice(0, Math.max(max, mustShow.length)).map((n) => n.id)
  );
  const neighbours = neighbourIds(graph);
  for (const id of [...kept]) {
    if (expanded.has(id)) {
      for (const other of neighbours.get(id) ?? []) {
        kept.add(other);
      }
    }
  }
  const hidden = new Map<string, number>();
  for (const node of graph.nodes) {
    if (!kept.has(node.id)) {
      continue;
    }
    const left = (neighbours.get(node.id) ?? []).filter((id) => !kept.has(id));
    if (left.length > 0) {
      hidden.set(node.id, new Set(left).size);
    }
  }
  return { graph: keeping(graph, kept), hidden };
}

export interface SwimlaneCall {
  from: string;
  to: string;
  label?: string;
  data?: string;
  /** Indexes into the lanes. */
  fromLane: number;
  toLane: number;
}

/**
 * The calls a run from `entry` makes, in the order it makes them, down one
 * lane for each file the calls reach. A call back to a symbol already
 * followed is listed but not followed again.
 */
export function swimlanes(
  graph: FlowGraph,
  entry: string
): { lanes: string[]; calls: SwimlaneCall[] } {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const start = byId.get(entry);
  if (!start) {
    return { lanes: [], calls: [] };
  }
  const lanes: string[] = [];
  const laneOf = (id: string): number => {
    const path = byId.get(id)!.path;
    const index = lanes.indexOf(path);
    if (index >= 0) {
      return index;
    }
    lanes.push(path);
    return lanes.length - 1;
  };
  laneOf(entry);
  const calls: SwimlaneCall[] = [];
  const followed = new Set<string>();
  const follow = (id: string) => {
    if (followed.has(id)) {
      return;
    }
    followed.add(id);
    for (const edge of graph.edges) {
      if (edge.from !== id || !byId.has(edge.to)) {
        continue;
      }
      const call: SwimlaneCall = {
        from: edge.from,
        to: edge.to,
        ...(edge.label === undefined ? {} : { label: edge.label }),
        ...(edge.data === undefined ? {} : { data: edge.data }),
        fromLane: laneOf(edge.from),
        toLane: laneOf(edge.to),
      };
      calls.push(call);
      follow(edge.to);
    }
  };
  follow(entry);
  return { lanes, calls };
}

/**
 * Where each symbol sits in a call map: callers in columns to the left of
 * what they call, symbols in one column in rows of their own. A call back to
 * a symbol still being followed is left out of the columns, so a cycle
 * places each symbol once.
 */
export function layerLayout(
  graph: FlowGraph
): Map<string, { column: number; row: number }> {
  const ids = new Set(graph.nodes.map((node) => node.id));
  const calls = new Map<string, string[]>();
  const called = new Set<string>();
  for (const { from, to } of graph.edges) {
    if (ids.has(from) && ids.has(to)) {
      calls.set(from, [...(calls.get(from) ?? []), to]);
      called.add(to);
    }
  }
  const forward: [string, string][] = [];
  const state = new Map<string, "open" | "done">();
  const walk = (id: string) => {
    state.set(id, "open");
    for (const to of calls.get(id) ?? []) {
      if (state.get(to) === "open") {
        continue;
      }
      forward.push([id, to]);
      if (!state.has(to)) {
        walk(to);
      }
    }
    state.set(id, "done");
  };
  const roots = graph.nodes.filter((node) => !called.has(node.id));
  for (const node of [...roots, ...graph.nodes]) {
    if (!state.has(node.id)) {
      walk(node.id);
    }
  }
  const column = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (let changed = true; changed;) {
    changed = false;
    for (const [from, to] of forward) {
      if (column.get(to)! < column.get(from)! + 1) {
        column.set(to, column.get(from)! + 1);
        changed = true;
      }
    }
  }
  // In a column, the symbol that makes the most calls leads, then the one
  // that receives the most, then the graph's own order.
  const makes = distinctEnds(graph, ids, "from", "to");
  const receives = distinctEnds(graph, ids, "to", "from");
  const inColumn = new Map<number, FlowNode[]>();
  for (const node of graph.nodes) {
    const c = column.get(node.id)!;
    inColumn.set(c, [...(inColumn.get(c) ?? []), node]);
  }
  const placed = new Map<string, { column: number; row: number }>();
  for (const [c, members] of inColumn) {
    const ordered = members
      .map((node, index) => ({ node, index }))
      .sort(
        (a, b) =>
          (makes.get(b.node.id) ?? 0) - (makes.get(a.node.id) ?? 0) ||
          (receives.get(b.node.id) ?? 0) - (receives.get(a.node.id) ?? 0) ||
          a.index - b.index
      );
    ordered.forEach(({ node }, row) => placed.set(node.id, { column: c, row }));
  }
  return placed;
}

/** For each symbol, how many other symbols it has a call with, in the direction given. */
function distinctEnds(
  graph: FlowGraph,
  ids: ReadonlySet<string>,
  own: "from" | "to",
  other: "from" | "to"
): Map<string, number> {
  const ends = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (edge.from === edge.to || !ids.has(edge.from) || !ids.has(edge.to)) {
      continue;
    }
    const set = ends.get(edge[own]) ?? new Set<string>();
    set.add(edge[other]);
    ends.set(edge[own], set);
  }
  return new Map([...ends].map(([id, set]) => [id, set.size]));
}

/**
 * What a `git diff -U0` of one file does to it, in the lines of the head
 * side. A deletion leaves no head lines, so it counts as an edit to the
 * lines on either side of it.
 */
export function fileChangeFromDiff(
  path: string,
  diff: string,
  isNewFile = false
): FileChange {
  const change: FileChange = {
    path,
    isNewFile,
    addedLines: [],
    modifiedLines: [],
  };
  for (const [, oldCount, newStart, newCount] of diff.matchAll(
    /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm
  ) as Iterable<[string, string | undefined, string, string | undefined]>) {
    const start = Number(newStart);
    const count = newCount === undefined ? 1 : Number(newCount);
    if (count === 0) {
      change.modifiedLines.push({ start, end: start + 1 });
    } else if (oldCount === "0") {
      change.addedLines.push({ start, end: start + count - 1 });
    } else {
      change.modifiedLines.push({ start, end: start + count - 1 });
    }
  }
  return change;
}

/** The most symbols a call map draws before it offers "+N more". */
export const NODE_CAP = 80;

export interface FlowControls {
  hops: 0 | 1 | 2;
  /** Draw every symbol within the hops, whatever the cap. */
  showAll: boolean;
  /** Lowers the cap, for tests. */
  cap?: number;
  /** The changed or new symbol the swimlanes follow; if absent or no longer one, where a run through the Change starts (see `shownFlow`). */
  entry?: string;
  /** Draw the symbols of test files too. */
  showTests?: boolean;
  /** Draw the symbols of deleted files too. */
  showRemoved?: boolean;
  /** Symbols whose every neighbour is drawn, whatever the cap. */
  expanded?: readonly string[];
}

/** Where Code Flow starts: one hop out, or Changed only when one hop is more than the cap draws. */
export function initialHops(full: FlowGraph, cap = NODE_CAP): 0 | 1 {
  const graph = withoutRemoved(withoutTests(full));
  return withinHops(graph, 1).nodes.length > cap ? 0 : 1;
}

export interface ShownNode extends FlowNode {
  column: number;
  row: number;
  /** How many neighbours the cap left out. */
  hidden: number;
}

/** What the panel draws for a gathered graph under the Reviewer's controls. */
export interface ShownFlow {
  /** The symbols with a call to or from another symbol drawn, which the call map places. */
  nodes: ShownNode[];
  /** The symbols within the hops with no call to another drawn symbol: the call map leaves them out, the list has them. */
  callless: FlowNode[];
  edges: FlowEdge[];
  /**
   * The swimlanes' entry points: the changed, new and removed symbols that
   * make a call; `label` adds where one is when another has its name.
   */
  entries: { id: string; name: string; label: string }[];
  /** How many changed, new and removed symbols the graph has, whether or not they call. */
  changed: number;
  /** How many test symbols within the hops are left out. */
  testsHidden: number;
  /** How many symbols of deleted files within the hops are left out. */
  removedHidden: number;
  /** How many symbols within the hops the cap left out. */
  undrawn: number;
  /** Whether the cap leaves symbols out, so Show all draws past it. */
  overCap: boolean;
  entry?: string;
  lanes: string[];
  calls: SwimlaneCall[];
}

export function shownFlow(full: FlowGraph, controls: FlowControls): ShownFlow {
  const withTestsOff = controls.showTests ? full : withoutTests(full);
  const graph = controls.showRemoved
    ? withTestsOff
    : withoutRemoved(withTestsOff);
  const removedHidden = controls.showRemoved
    ? 0
    : withinHops(withTestsOff, controls.hops).nodes.filter(
        (n) => n.status === "removed"
      ).length;
  const testsHidden = controls.showTests
    ? 0
    : withinHops(full, controls.hops).nodes.filter((n) => isTestPath(n.path))
        .length;
  const within = withinHops(graph, controls.hops);
  const limited = capNodes(
    within,
    controls.cap ?? NODE_CAP,
    new Set(controls.expanded)
  );
  const { graph: capped, hidden } = controls.showAll
    ? { graph: within, hidden: new Map<string, number>() }
    : limited;
  // A symbol with no call to another drawn symbol is no box in the map,
  // unless the cap left out a neighbour it calls or is called by.
  const connected = new Set(
    capped.edges
      .filter((edge) => edge.from !== edge.to)
      .flatMap((edge) => [edge.from, edge.to])
  );
  const isDrawn = (node: FlowNode) =>
    connected.has(node.id) || (hidden.get(node.id) ?? 0) > 0;
  const drawn = { nodes: capped.nodes.filter(isDrawn), edges: capped.edges };
  const callless = capped.nodes.filter((node) => !isDrawn(node));
  const placed = layerLayout(drawn);
  const changed = graph.nodes.filter((node) => node.status !== "unchanged");
  const named = (name: string) => changed.filter((n) => n.name === name);
  const ids = new Set(graph.nodes.map((node) => node.id));
  const callers = new Set(
    graph.edges.filter((edge) => ids.has(edge.to)).map((edge) => edge.from)
  );
  const entries = changed
    .filter((node) => callers.has(node.id))
    .map(({ id, name, path, line, side }) => ({
      id,
      name,
      label:
        named(name).length > 1
          ? `${name} · ${side === "base" ? "before: " : ""}${path}:${line}`
          : name,
    }));
  // A run starts where no other changed symbol calls in, and of those the one
  // that opens the most of the picture leads, unless the Reviewer chose one.
  const callsMade = distinctEnds(
    graph,
    new Set(graph.nodes.map((n) => n.id)),
    "from",
    "to"
  );
  const changedIds = new Set(changed.map((node) => node.id));
  const calledByChanged = new Set(
    graph.edges
      .filter((edge) => edge.from !== edge.to && changedIds.has(edge.from))
      .map((edge) => edge.to)
  );
  const roots = entries.filter((e) => !calledByChanged.has(e.id));
  const mostCalls = (roots.length > 0 ? roots : entries).reduce<
    (typeof entries)[number] | undefined
  >(
    (best, e) =>
      !best || (callsMade.get(e.id) ?? 0) > (callsMade.get(best.id) ?? 0)
        ? e
        : best,
    undefined
  );
  const entry =
    entries.find((e) => e.id === controls.entry)?.id ?? mostCalls?.id;
  return {
    nodes: drawn.nodes.map((node) => ({
      ...node,
      ...placed.get(node.id)!,
      hidden: hidden.get(node.id) ?? 0,
    })),
    callless,
    edges: capped.edges,
    entries,
    changed: changed.length,
    testsHidden,
    removedHidden,
    undrawn: within.nodes.length - capped.nodes.length,
    overCap: limited.graph.nodes.length < within.nodes.length,
    entry,
    ...(entry === undefined
      ? { lanes: [], calls: [] }
      : swimlanes(graph, entry)),
  };
}

/**
 * What the Code Flow tab offers around its picture, for the view shown: the
 * controls and notices that act on that view, and what it says in place of a
 * picture with nothing to draw. The call map and the list draw the symbols
 * within the hops, under the cap; the swimlanes follow every call from their
 * entry point, so neither applies to them.
 */
export interface FlowOffers {
  /** The hop control. */
  hops: boolean;
  /** How many symbols the cap left out, offered with Show all. */
  undrawn: number;
  /** How many symbols Show all draws past the cap, offered with Show fewer. */
  showingAll?: number;
  /** Changed only, and no changed symbol calls another: a hop shows their calls. */
  tryHop: boolean;
  /** How many symbols with no calls the call map leaves out, listed in the List view. */
  callless: number;
  /** Whether the view has a picture to draw. */
  picture: boolean;
  /** What the view says instead of a picture. */
  empty?: string;
}

export function flowOffers(input: {
  view: "map" | "lanes" | "list";
  flow: ShownFlow;
  hops: 0 | 1 | 2;
  showAll: boolean;
  showTests: boolean;
  showRemoved?: boolean;
  languages: readonly { outcome: LanguageOutcome }[];
  /** Whether gathering the Code Flow failed. */
  problem: boolean;
}): FlowOffers {
  const { view, flow } = input;
  const answered = input.languages.every((l) => l.outcome === "answered");
  const drawsWithinHops = view !== "lanes";
  const symbols = flow.nodes.length + flow.callless.length;
  const picture =
    view === "lanes"
      ? flow.calls.length > 0
      : view === "list"
        ? symbols > 0
        : flow.nodes.length > 0;
  return {
    hops: drawsWithinHops,
    undrawn: drawsWithinHops ? flow.undrawn : 0,
    ...(drawsWithinHops &&
      input.showAll &&
      flow.overCap && { showingAll: flow.nodes.length }),
    tryHop:
      drawsWithinHops &&
      input.hops === 0 &&
      symbols > 0 &&
      flow.edges.length === 0 &&
      answered,
    callless:
      view === "map" && flow.nodes.length > 0 ? flow.callless.length : 0,
    picture,
    ...(!picture && { empty: emptyText() }),
  };

  function emptyText(): string | undefined {
    if (!input.showTests && flow.testsHidden > 0 && flow.changed === 0) {
      return "Every symbol this Change touches is test code, which is hidden.";
    }
    if (!input.showRemoved && flow.removedHidden > 0 && flow.changed === 0) {
      return "Every symbol this Change touches is in a deleted file, which is hidden.";
    }
    if (view === "map" && flow.nodes.length === 0 && flow.callless.length > 0) {
      return `${flow.callless.length} ${
        flow.callless.length === 1 ? "symbol has" : "symbols have"
      } no calls to draw. The List view lists ${
        flow.callless.length === 1 ? "it" : "them"
      }.`;
    }
    if (symbols === 0 && flow.changed === 0) {
      return answered && !input.problem
        ? "This Change touches no functions or methods Code Flow can draw."
        : undefined;
    }
    if (!drawsWithinHops && flow.changed > 0) {
      return answered
        ? "No symbol this Change touches calls anything."
        : "No calls from the symbols this Change touches are known.";
    }
    return undefined;
  }
}
