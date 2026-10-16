import * as assert from "assert";
import {
  capNodes,
  shownFlow,
  fileChangeFromDiff,
  layerLayout,
  swimlanes,
  symbolStatus,
  withinHops,
  type FileChange,
  type FlowGraph,
  type FlowNode,
} from "../../src/codeFlow";

function node(id: string, status: FlowNode["status"]): FlowNode {
  return { id, name: id, path: `src/${id}.py`, line: 1, status };
}

/** a (changed) calls b, b calls c, c calls d; x (changed) is called by d. */
const chain: FlowGraph = {
  nodes: [
    node("a", "changed"),
    node("b", "unchanged"),
    node("c", "unchanged"),
    node("d", "unchanged"),
    node("x", "changed"),
  ],
  edges: [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "c", to: "d" },
    { from: "x", to: "d" },
  ],
};

function ids(graph: FlowGraph): string[] {
  return graph.nodes.map((n) => n.id).sort();
}

describe("Code Flow hops", () => {
  it("shows only the changed and new symbols at zero hops", () => {
    assert.deepStrictEqual(ids(withinHops(chain, 0)), ["a", "x"]);
  });

  it("adds callers and callees one hop out", () => {
    assert.deepStrictEqual(ids(withinHops(chain, 1)), ["a", "b", "d", "x"]);
  });

  it("walks a second hop from each changed symbol", () => {
    assert.deepStrictEqual(ids(withinHops(chain, 2)), ["a", "b", "c", "d", "x"]);
  });

  it("keeps only the edges between symbols it shows", () => {
    assert.deepStrictEqual(withinHops(chain, 1).edges, [
      { from: "a", to: "b" },
      { from: "x", to: "d" },
    ]);
  });
});

describe("Code Flow symbol marks", () => {
  const symbol = { path: "src/pay.py", startLine: 10, endLine: 20 };
  const change = (over: Partial<FileChange>): FileChange => ({
    path: "src/pay.py",
    isNewFile: false,
    addedLines: [],
    modifiedLines: [],
    ...over,
  });

  it("marks a symbol in a file the Change adds as new", () => {
    assert.strictEqual(
      symbolStatus(symbol, [change({ isNewFile: true })]),
      "new"
    );
  });

  it("marks a symbol whose lines are all added as new", () => {
    assert.strictEqual(
      symbolStatus(symbol, [change({ addedLines: [{ start: 9, end: 21 }] })]),
      "new"
    );
  });

  it("marks a symbol with a modified line inside it as changed", () => {
    assert.strictEqual(
      symbolStatus(symbol, [change({ modifiedLines: [{ start: 15, end: 15 }] })]),
      "changed"
    );
  });

  it("marks a symbol with only some lines added as changed", () => {
    assert.strictEqual(
      symbolStatus(symbol, [change({ addedLines: [{ start: 18, end: 22 }] })]),
      "changed"
    );
  });

  it("marks a symbol the diff doesn't reach as unchanged", () => {
    assert.strictEqual(
      symbolStatus(symbol, [
        change({ modifiedLines: [{ start: 21, end: 30 }] }),
        change({ path: "src/other.py", isNewFile: true }),
      ]),
      "unchanged"
    );
  });
});

describe("Code Flow node cap", () => {
  it("keeps every node when the graph fits", () => {
    const capped = capNodes(chain, 10);
    assert.deepStrictEqual(ids(capped.graph), ["a", "b", "c", "d", "x"]);
    assert.deepStrictEqual([...capped.hidden], []);
  });

  it("drops the nodes farthest from a changed symbol first", () => {
    assert.deepStrictEqual(ids(capNodes(chain, 4).graph), ["a", "b", "d", "x"]);
  });

  it("counts what is hidden behind each node shown", () => {
    assert.deepStrictEqual([...capNodes(chain, 4).hidden], [
      ["b", 1],
      ["d", 1],
    ]);
  });

  it("never drops a changed or new symbol", () => {
    assert.deepStrictEqual(ids(capNodes(chain, 1).graph), ["a", "x"]);
  });

  it("keeps only the edges between the nodes it shows", () => {
    assert.deepStrictEqual(capNodes(chain, 4).graph.edges, [
      { from: "a", to: "b" },
      { from: "x", to: "d" },
    ]);
  });
});

describe("Code Flow swimlanes", () => {
  const at = (id: string, path: string): FlowNode => ({
    ...node(id, "unchanged"),
    path,
  });
  const graph: FlowGraph = {
    nodes: [
      { ...at("approve", "src/cli.py"), status: "changed" },
      at("check", "src/checks.py"),
      at("submit", "src/github.py"),
      at("fetch", "src/github.py"),
    ],
    edges: [
      { from: "approve", to: "check", label: "check(pr)" },
      { from: "check", to: "fetch" },
      { from: "approve", to: "submit" },
      { from: "fetch", to: "approve" },
    ],
  };

  it("gives each file a lane, in the order the calls first reach it", () => {
    assert.deepStrictEqual(swimlanes(graph, "approve").lanes, [
      "src/cli.py",
      "src/checks.py",
      "src/github.py",
    ]);
  });

  it("lists the calls in the order a run makes them", () => {
    assert.deepStrictEqual(
      swimlanes(graph, "approve").calls.map((c) => `${c.from}>${c.to}`),
      ["approve>check", "check>fetch", "fetch>approve", "approve>submit"]
    );
  });

  it("carries each call's label and the lanes it crosses", () => {
    assert.deepStrictEqual(swimlanes(graph, "approve").calls[0], {
      from: "approve",
      to: "check",
      label: "check(pr)",
      fromLane: 0,
      toLane: 1,
    });
  });

  it("follows a call back to a symbol already seen without looping", () => {
    assert.strictEqual(swimlanes(graph, "approve").calls.length, 4);
  });

  it("is empty for a symbol that isn't in the graph", () => {
    assert.deepStrictEqual(swimlanes(graph, "nope"), { lanes: [], calls: [] });
  });
});

describe("Code Flow layout", () => {
  it("puts callers in columns to the left of what they call", () => {
    const columns = layerLayout(chain);
    assert.strictEqual(columns.get("a")!.column, 0);
    assert.strictEqual(columns.get("b")!.column, 1);
    assert.strictEqual(columns.get("c")!.column, 2);
    assert.strictEqual(columns.get("d")!.column, 3);
    assert.strictEqual(columns.get("x")!.column, 0);
  });

  it("gives symbols in one column rows of their own", () => {
    const placed = layerLayout(chain);
    assert.notStrictEqual(placed.get("a")!.row, placed.get("x")!.row);
  });

  it("places a symbol in a call cycle once and finishes", () => {
    const cycle: FlowGraph = {
      nodes: [node("p", "changed"), node("q", "unchanged")],
      edges: [
        { from: "p", to: "q" },
        { from: "q", to: "p" },
      ],
    };
    const placed = layerLayout(cycle);
    assert.deepStrictEqual(
      [placed.get("p")!.column, placed.get("q")!.column],
      [0, 1]
    );
  });
});

describe("Code Flow file changes from a diff", () => {
  const diff = [
    "diff --git a/pay.py b/pay.py",
    "--- a/pay.py",
    "+++ b/pay.py",
    "@@ -3,0 +4,2 @@ def head():",
    "+a",
    "+b",
    "@@ -10,2 +12,3 @@",
    "-x",
    "-y",
    "+z",
    "+z",
    "+z",
    "@@ -20,2 +24,0 @@",
    "-gone",
    "-gone",
    "",
  ].join("\n");

  it("reads lines added with nothing replaced as added", () => {
    assert.deepStrictEqual(fileChangeFromDiff("pay.py", diff).addedLines, [
      { start: 4, end: 5 },
    ]);
  });

  it("reads replaced lines as modified, and a deletion as the lines around it", () => {
    assert.deepStrictEqual(fileChangeFromDiff("pay.py", diff).modifiedLines, [
      { start: 12, end: 14 },
      { start: 24, end: 25 },
    ]);
  });

  it("takes a hunk header with no count as one line", () => {
    const one = "@@ -7 +7 @@\n-a\n+b\n";
    assert.deepStrictEqual(fileChangeFromDiff("a.py", one).modifiedLines, [
      { start: 7, end: 7 },
    ]);
  });

  it("is not a new file unless told so", () => {
    assert.strictEqual(fileChangeFromDiff("pay.py", diff).isNewFile, false);
    assert.strictEqual(fileChangeFromDiff("pay.py", "", true).isNewFile, true);
  });
});

describe("Code Flow as the panel shows it", () => {
  const controls = { hops: 1 as const, showAll: false };

  it("places the symbols within the hops, with their columns and rows", () => {
    const shown = shownFlow(chain, controls);
    assert.deepStrictEqual(
      shown.nodes.map((n) => [n.id, n.column, n.row]),
      [
        ["a", 0, 0],
        ["b", 1, 0],
        ["d", 1, 1],
        ["x", 0, 1],
      ]
    );
  });

  it("offers the changed and new symbols as entry points, the first chosen", () => {
    const shown = shownFlow(chain, controls);
    assert.deepStrictEqual(shown.entries.map((e) => e.id), ["a", "x"]);
    assert.strictEqual(shown.entry, "a");
    assert.strictEqual(shownFlow(chain, { ...controls, entry: "x" }).entry, "x");
  });

  it("draws the lanes from the entry point", () => {
    const shown = shownFlow(chain, { ...controls, entry: "a" });
    assert.deepStrictEqual(shown.lanes, ["src/a.py", "src/b.py", "src/c.py", "src/d.py"]);
    assert.strictEqual(shown.calls.length, 3);
  });

  it("marks a symbol with neighbours the cap left out", () => {
    const many: FlowGraph = {
      nodes: [node("hub", "changed"), ...[1, 2, 3].map((i) => node(`n${i}`, "unchanged"))],
      edges: [1, 2, 3].map((i) => ({ from: "hub", to: `n${i}` })),
    };
    const shown = shownFlow(many, { ...controls, cap: 2 });
    assert.strictEqual(shown.nodes.length, 2);
    assert.strictEqual(shown.nodes.find((n) => n.id === "hub")!.hidden, 2);
    assert.strictEqual(shownFlow(many, { ...controls, cap: 2, showAll: true }).nodes.length, 4);
  });

  it("has no entry point when nothing changed", () => {
    const quiet: FlowGraph = { nodes: [node("a", "unchanged")], edges: [] };
    const shown = shownFlow(quiet, controls);
    assert.deepStrictEqual([shown.nodes, shown.entries, shown.entry], [[], [], undefined]);
  });
});
