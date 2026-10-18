// The logic behind Code Flow: which symbols a picture of a Change shows, and
// how they are marked. Kept apart from `vscode` so the unit tests can run it
// under plain Node.

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
 * The symbols within `hops` calls, in either direction, of a changed or new
 * symbol, and the edges between them.
 */
export function withinHops(graph: FlowGraph, hops: number): FlowGraph {
  return keeping(graph, new Set(distances(graph, hops).keys()));
}

/**
 * At most `max` symbols, nearest a changed or new symbol first, though never
 * fewer than the changed and new ones. `hidden` counts, for each symbol shown,
 * the neighbours left out, which the picture offers as "+N more".
 */
export function capNodes(
  graph: FlowGraph,
  max: number
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
  const rows = new Map<number, number>();
  const placed = new Map<string, { column: number; row: number }>();
  for (const node of graph.nodes) {
    const c = column.get(node.id)!;
    const row = rows.get(c) ?? 0;
    rows.set(c, row + 1);
    placed.set(node.id, { column: c, row });
  }
  return placed;
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
  /** The changed or new symbol the swimlanes follow; the first one if absent. */
  entry?: string;
  /** Draw the symbols of test files too. */
  showTests?: boolean;
}

export interface ShownNode extends FlowNode {
  column: number;
  row: number;
  /** How many neighbours the cap left out. */
  hidden: number;
}

/** What the panel draws for a gathered graph under the Reviewer's controls. */
export interface ShownFlow {
  nodes: ShownNode[];
  edges: FlowEdge[];
  entries: { id: string; name: string }[];
  /** How many test symbols within the hops are left out. */
  testsHidden: number;
  entry?: string;
  lanes: string[];
  calls: SwimlaneCall[];
}

export function shownFlow(full: FlowGraph, controls: FlowControls): ShownFlow {
  const graph = controls.showTests ? full : withoutTests(full);
  const testsHidden = controls.showTests
    ? 0
    : withinHops(full, controls.hops).nodes.filter((n) => isTestPath(n.path))
        .length;
  const within = withinHops(graph, controls.hops);
  const { graph: capped, hidden } = controls.showAll
    ? { graph: within, hidden: new Map<string, number>() }
    : capNodes(within, controls.cap ?? NODE_CAP);
  const placed = layerLayout(capped);
  const entries = graph.nodes
    .filter((node) => node.status !== "unchanged")
    .map(({ id, name }) => ({ id, name }));
  const entry =
    entries.find((e) => e.id === controls.entry)?.id ?? entries[0]?.id;
  return {
    nodes: capped.nodes.map((node) => ({
      ...node,
      ...placed.get(node.id)!,
      hidden: hidden.get(node.id) ?? 0,
    })),
    edges: capped.edges,
    entries,
    testsHidden,
    entry,
    ...(entry === undefined
      ? { lanes: [], calls: [] }
      : swimlanes(graph, entry)),
  };
}
