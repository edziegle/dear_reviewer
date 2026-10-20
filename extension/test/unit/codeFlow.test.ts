import * as assert from "assert";
import {
  capNodes,
  flowOffers,
  initialHops,
  NODE_CAP,
  shownFlow,
  fileChangeFromDiff,
  layerLayout,
  swimlanes,
  symbolStatus,
  withinHops,
  withoutRemoved,
  withoutTests,
  type FileChange,
  type FlowGraph,
  type FlowNode,
} from "../../src/codeFlow";
import type { LanguageOutcome } from "../../src/codeFlowGather";

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
    assert.deepStrictEqual(ids(withinHops(chain, 2)), [
      "a",
      "b",
      "c",
      "d",
      "x",
    ]);
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
      symbolStatus(symbol, [
        change({ modifiedLines: [{ start: 15, end: 15 }] }),
      ]),
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
    assert.deepStrictEqual(
      [...capNodes(chain, 4).hidden],
      [
        ["b", 1],
        ["d", 1],
      ]
    );
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

describe("Code Flow row order in a column", () => {
  /** hub calls m1, m2 and m3; m2 calls leaf; m3 calls leaf; caller calls m3. */
  const graph: FlowGraph = {
    nodes: [
      node("hub", "changed"),
      node("caller", "unchanged"),
      node("m1", "unchanged"),
      node("m2", "unchanged"),
      node("m3", "unchanged"),
      node("leaf", "unchanged"),
    ],
    edges: [
      { from: "hub", to: "m1" },
      { from: "hub", to: "m2" },
      { from: "hub", to: "m3" },
      { from: "caller", to: "m3" },
      { from: "m2", to: "leaf" },
      { from: "m3", to: "leaf" },
    ],
  };
  const rowsOf = (g: FlowGraph, column: number) => {
    const placed = layerLayout(g);
    return g.nodes
      .filter((n) => placed.get(n.id)!.column === column)
      .sort((a, b) => placed.get(a.id)!.row - placed.get(b.id)!.row)
      .map((n) => n.id);
  };

  it("puts the symbol that makes the most calls first", () => {
    assert.deepStrictEqual(rowsOf(graph, 0), ["hub", "caller"]);
  });

  it("orders by calls received when calls made are equal", () => {
    // Column 1: m2 and m3 each make one call; m3 receives two, m2 one; m1 makes none.
    assert.deepStrictEqual(rowsOf(graph, 1), ["m3", "m2", "m1"]);
  });

  it("keeps the graph's order when both counts are equal", () => {
    const tied: FlowGraph = {
      nodes: [
        node("p", "changed"),
        node("q", "changed"),
        node("r", "unchanged"),
      ],
      edges: [
        { from: "p", to: "r" },
        { from: "q", to: "r" },
      ],
    };
    assert.deepStrictEqual(rowsOf(tied, 0), ["p", "q"]);
  });

  it("counts a symbol it calls twice, or itself, once or not at all", () => {
    const twice: FlowGraph = {
      nodes: [
        node("a", "changed"),
        node("b", "changed"),
        node("c", "unchanged"),
      ],
      edges: [
        { from: "a", to: "c" },
        { from: "a", to: "c" },
        { from: "b", to: "b" },
        { from: "b", to: "c" },
        { from: "b", to: "a" },
      ],
    };
    // b makes two distinct calls (c and a), a makes one.
    assert.strictEqual(rowsOf(twice, 0)[0], "b");
  });
});

describe("Code Flow with no-call symbols collapsed", () => {
  const controls = { hops: 1 as const, showAll: false };
  /** a (changed) calls b; lone1 and lone2 (changed) touch no call. */
  const graph: FlowGraph = {
    nodes: [
      node("a", "changed"),
      node("b", "unchanged"),
      node("lone1", "changed"),
      node("lone2", "changed"),
    ],
    edges: [{ from: "a", to: "b" }],
  };

  it("leaves a symbol with no call to a drawn symbol out of the map, and counts it", () => {
    const shown = shownFlow(graph, controls);
    assert.deepStrictEqual(shown.nodes.map((n) => n.id).sort(), ["a", "b"]);
    assert.deepStrictEqual(
      shown.callless.map((n) => n.id),
      ["lone1", "lone2"]
    );
  });

  it("counts none when every symbol has a call", () => {
    const pair: FlowGraph = {
      nodes: [node("a", "changed"), node("b", "unchanged")],
      edges: [{ from: "a", to: "b" }],
    };
    assert.strictEqual(shownFlow(pair, controls).callless.length, 0);
  });

  it("does not count a call to itself as a call", () => {
    const self: FlowGraph = {
      nodes: [node("a", "changed")],
      edges: [{ from: "a", to: "a" }],
    };
    assert.deepStrictEqual(
      shownFlow(self, controls).callless.map((n) => n.id),
      ["a"]
    );
  });

  it("keeps a symbol the cap cut off from its neighbours in the map, with its count of what is left out", () => {
    const hub: FlowGraph = {
      nodes: [
        node("hub", "changed"),
        ...[1, 2, 3].map((i) => node(`n${i}`, "unchanged")),
      ],
      edges: [1, 2, 3].map((i) => ({ from: "hub", to: `n${i}` })),
    };
    const shown = shownFlow(hub, { ...controls, cap: 1 });
    assert.deepStrictEqual(
      shown.nodes.map((n) => [n.id, n.hidden]),
      [["hub", 3]]
    );
    assert.deepStrictEqual(shown.callless, []);
  });

  it("keeps them for the list: the list view has a picture when only they are left", () => {
    const lone: FlowGraph = {
      nodes: [node("x", "changed"), node("y", "changed")],
      edges: [],
    };
    const offers = (view: "map" | "list") =>
      flowOffers({
        view,
        flow: shownFlow(lone, controls),
        hops: 1,
        showAll: false,
        showTests: false,
        languages: [{ outcome: "answered" }],
        problem: false,
      });
    assert.strictEqual(offers("list").picture, true);
    assert.strictEqual(offers("map").picture, false);
    assert.match(
      offers("map").empty!,
      /^2 symbols have no calls to draw\. The List view lists them\.$/
    );
  });

  it("says how many the map leaves out while it draws others", () => {
    const offers = flowOffers({
      view: "map",
      flow: shownFlow(graph, controls),
      hops: 1,
      showAll: false,
      showTests: false,
      languages: [{ outcome: "answered" }],
      problem: false,
    });
    assert.strictEqual(offers.callless, 2);
  });
});

describe("Code Flow with removed symbols hidden", () => {
  const removed = (id: string): FlowNode => ({
    id,
    name: id,
    path: `old/${id}.py`,
    line: 1,
    status: "removed",
    side: "base",
  });
  /**
   * kept (changed) calls dropped (removed) and shared (unchanged);
   * dropped calls only_via_removed; gone (removed) calls shared.
   */
  const graph: FlowGraph = {
    nodes: [
      node("kept", "changed"),
      removed("dropped"),
      node("shared", "unchanged"),
      node("only_via_removed", "unchanged"),
      removed("gone"),
    ],
    edges: [
      { from: "kept", to: "dropped" },
      { from: "kept", to: "shared" },
      { from: "dropped", to: "only_via_removed" },
      { from: "gone", to: "shared" },
    ],
  };
  const shown = (showRemoved: boolean, hops: 0 | 1 | 2 = 2) =>
    shownFlow(graph, { hops, showAll: true, showRemoved });

  it("leaves out removed symbols and every edge to or from them", () => {
    const flow = shown(false);
    const drawn = [...flow.nodes, ...flow.callless].map((n) => n.id).sort();
    assert.deepStrictEqual(drawn, ["kept", "shared"]);
    assert.deepStrictEqual(flow.edges, [{ from: "kept", to: "shared" }]);
  });

  it("leaves out a symbol reached only through a removed one", () => {
    const drawn = shown(false).nodes.map((n) => n.id);
    assert.ok(!drawn.includes("only_via_removed"));
  });

  it("counts the removed symbols within the hops it left out", () => {
    assert.strictEqual(shown(false).removedHidden, 2);
    assert.strictEqual(shown(false, 0).removedHidden, 2);
  });

  it("brings them back, with what only they reach, once shown, and counts none hidden", () => {
    const flow = shown(true);
    assert.deepStrictEqual(
      [...flow.nodes, ...flow.callless].map((n) => n.id).sort(),
      ["dropped", "gone", "kept", "only_via_removed", "shared"]
    );
    assert.strictEqual(flow.removedHidden, 0);
  });

  it("offers no removed symbol as an entry point while they are hidden", () => {
    assert.deepStrictEqual(
      shown(false).entries.map((e) => e.id),
      ["kept"]
    );
    assert.deepStrictEqual(
      shown(true).entries.map((e) => e.id),
      ["kept", "dropped", "gone"]
    );
  });

  it("gives the graph without removed symbols", () => {
    assert.deepStrictEqual(ids(withoutRemoved(graph)), [
      "kept",
      "only_via_removed",
      "shared",
    ]);
  });

  it("says so when a Change only deletes code", () => {
    const deletes: FlowGraph = {
      nodes: [removed("a"), removed("b")],
      edges: [{ from: "a", to: "b" }],
    };
    const flow = shownFlow(deletes, { hops: 1, showAll: false });
    const offers = flowOffers({
      view: "map",
      flow,
      hops: 1,
      showAll: false,
      showTests: false,
      showRemoved: false,
      languages: [{ outcome: "answered" }],
      problem: false,
    });
    assert.deepStrictEqual(
      [offers.picture, offers.empty],
      [
        false,
        "Every symbol this Change touches is in a deleted file, which is hidden.",
      ]
    );
  });
});

describe("Where Code Flow starts", () => {
  const wide = (count: number): FlowGraph => ({
    nodes: [
      node("hub", "changed"),
      ...Array.from({ length: count }, (_, i) => node(`n${i}`, "unchanged")),
    ],
    edges: Array.from({ length: count }, (_, i) => ({
      from: "hub",
      to: `n${i}`,
    })),
  });

  it("starts one hop out when that fits the cap", () => {
    assert.strictEqual(initialHops(wide(NODE_CAP - 1)), 1);
    assert.strictEqual(initialHops(wide(NODE_CAP - 1), NODE_CAP), 1);
  });

  it("starts at Changed only when one hop is over the cap", () => {
    assert.strictEqual(initialHops(wide(NODE_CAP)), 0);
    assert.strictEqual(initialHops(wide(5), 3), 0);
  });

  it("does not count test or removed symbols, which start hidden", () => {
    const tests: FlowGraph = {
      nodes: [
        node("hub", "changed"),
        ...Array.from({ length: 10 }, (_, i) => ({
          ...node(`t${i}`, "unchanged"),
          path: `tests/test_${i}.py`,
        })),
      ],
      edges: Array.from({ length: 10 }, (_, i) => ({
        from: `t${i}`,
        to: "hub",
      })),
    };
    assert.strictEqual(initialHops(tests, 3), 1);
  });
});

describe("The default entry point of the swimlanes", () => {
  it("is the changed symbol that makes the most calls", () => {
    const graph: FlowGraph = {
      nodes: [
        node("quiet", "changed"),
        node("busy", "changed"),
        node("x", "unchanged"),
        node("y", "unchanged"),
      ],
      edges: [
        { from: "quiet", to: "x" },
        { from: "busy", to: "x" },
        { from: "busy", to: "y" },
      ],
    };
    const shown = shownFlow(graph, { hops: 1, showAll: false });
    assert.strictEqual(shown.entry, "busy");
    assert.deepStrictEqual(
      shown.entries.map((e) => e.id),
      ["quiet", "busy"]
    );
  });

  it("is the first when they make as many, and a chosen one wins", () => {
    const graph: FlowGraph = {
      nodes: [
        node("a", "changed"),
        node("b", "changed"),
        node("x", "unchanged"),
      ],
      edges: [
        { from: "a", to: "x" },
        { from: "b", to: "x" },
      ],
    };
    assert.strictEqual(
      shownFlow(graph, { hops: 1, showAll: false }).entry,
      "a"
    );
    assert.strictEqual(
      shownFlow(graph, { hops: 1, showAll: false, entry: "b" }).entry,
      "b"
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
    assert.deepStrictEqual(
      shown.entries.map((e) => e.id),
      ["a", "x"]
    );
    assert.strictEqual(shown.entry, "a");
    assert.strictEqual(
      shownFlow(chain, { ...controls, entry: "x" }).entry,
      "x"
    );
  });

  it("offers no symbol that calls nothing as an entry point", () => {
    const quiet: FlowGraph = {
      nodes: [
        node("idle", "changed"),
        node("caller", "new"),
        node("callee", "unchanged"),
        node("gone", "removed"),
      ],
      edges: [{ from: "caller", to: "callee" }],
    };
    assert.deepStrictEqual(
      shownFlow(quiet, controls).entries.map((e) => e.id),
      ["caller"]
    );
  });

  it("chooses the first symbol that makes calls by default, and falls back to it from an entry that no longer qualifies", () => {
    const later: FlowGraph = {
      nodes: [
        node("idle", "changed"),
        node("caller", "changed"),
        node("callee", "unchanged"),
      ],
      edges: [{ from: "caller", to: "callee" }],
    };
    assert.strictEqual(shownFlow(later, controls).entry, "caller");
    assert.strictEqual(
      shownFlow(later, { ...controls, entry: "idle" }).entry,
      "caller"
    );
    assert.strictEqual(
      shownFlow(later, { ...controls, entry: "nowhere" }).entry,
      "caller"
    );
    assert.deepStrictEqual(shownFlow(later, controls).lanes, [
      "src/caller.py",
      "src/callee.py",
    ]);
  });

  it("decides on the whole graph, so the call map's hops and cap change no entry", () => {
    const many = shownFlow(chain, { ...controls, hops: 0 });
    assert.deepStrictEqual(
      many.entries.map((e) => e.id),
      ["a", "x"]
    );
    const capped = shownFlow(chain, { ...controls, cap: 1 });
    assert.deepStrictEqual(
      capped.entries.map((e) => e.id),
      ["a", "x"]
    );
  });

  it("has no entry point when no symbol calls anything", () => {
    const idle: FlowGraph = {
      nodes: [node("a", "changed"), node("b", "new")],
      edges: [],
    };
    const shown = shownFlow(idle, controls);
    assert.deepStrictEqual(
      [shown.entries, shown.entry, shown.lanes, shown.calls, shown.changed],
      [[], undefined, [], [], 2]
    );
  });

  it("draws the lanes from the entry point", () => {
    const shown = shownFlow(chain, { ...controls, entry: "a" });
    assert.deepStrictEqual(shown.lanes, [
      "src/a.py",
      "src/b.py",
      "src/c.py",
      "src/d.py",
    ]);
    assert.strictEqual(shown.calls.length, 3);
  });

  it("marks a symbol with neighbours the cap left out", () => {
    const many: FlowGraph = {
      nodes: [
        node("hub", "changed"),
        ...[1, 2, 3].map((i) => node(`n${i}`, "unchanged")),
      ],
      edges: [1, 2, 3].map((i) => ({ from: "hub", to: `n${i}` })),
    };
    const shown = shownFlow(many, { ...controls, cap: 2 });
    assert.strictEqual(shown.nodes.length, 2);
    assert.strictEqual(shown.nodes.find((n) => n.id === "hub")!.hidden, 2);
    assert.strictEqual(
      shownFlow(many, { ...controls, cap: 2, showAll: true }).nodes.length,
      4
    );
  });

  it("tells entry points of one name apart by where they are", () => {
    const twins: FlowGraph = {
      nodes: [
        {
          ...node("s1", "changed"),
          name: "save",
          path: "pkg/store.py",
          line: 12,
        },
        {
          ...node("s2", "changed"),
          name: "save",
          path: "pkg/cache.py",
          line: 3,
        },
        {
          ...node("s3", "removed"),
          name: "save",
          path: "old.py",
          line: 7,
          side: "base",
        },
        { ...node("load", "changed"), name: "load" },
        node("sink", "unchanged"),
      ],
      edges: ["s1", "s2", "s3", "load"].map((from) => ({ from, to: "sink" })),
    };
    assert.deepStrictEqual(
      shownFlow(twins, { ...controls, showRemoved: true }).entries.map(
        (e) => e.label
      ),
      [
        "save · pkg/store.py:12",
        "save · pkg/cache.py:3",
        "save · before: old.py:7",
        "load",
      ]
    );
  });

  const hub: FlowGraph = {
    nodes: [
      node("hub", "changed"),
      node("side", "changed"),
      ...[1, 2, 3].map((i) => node(`n${i}`, "unchanged")),
    ],
    edges: [1, 2, 3].map((i) => ({ from: "hub", to: `n${i}` })),
  };

  it("counts the symbols within the hops the cap left out, none once all are drawn", () => {
    const capped = shownFlow(hub, { ...controls, cap: 3 });
    assert.deepStrictEqual([capped.undrawn, capped.overCap], [2, true]);
    const all = shownFlow(hub, { ...controls, cap: 3, showAll: true });
    assert.deepStrictEqual([all.undrawn, all.overCap], [0, true]);
    const fits = shownFlow(hub, controls);
    assert.deepStrictEqual([fits.undrawn, fits.overCap], [0, false]);
  });

  it("draws every neighbour of a symbol the Reviewer expanded, past the cap", () => {
    const shown = shownFlow(hub, { ...controls, cap: 3, expanded: ["hub"] });
    assert.deepStrictEqual(shown.nodes.map((n) => n.id).sort(), [
      "hub",
      "n1",
      "n2",
      "n3",
    ]);
    assert.deepStrictEqual(
      shown.callless.map((n) => n.id),
      ["side"]
    );
    assert.strictEqual(shown.nodes.find((n) => n.id === "hub")!.hidden, 0);
    assert.strictEqual(shown.undrawn, 0);
  });

  it("has no entry point when nothing changed", () => {
    const quiet: FlowGraph = { nodes: [node("a", "unchanged")], edges: [] };
    const shown = shownFlow(quiet, controls);
    assert.deepStrictEqual(
      [shown.nodes, shown.entries, shown.entry],
      [[], [], undefined]
    );
  });
});

describe("Code Flow with test code hidden", () => {
  const at = (
    id: string,
    path: string,
    status: FlowNode["status"]
  ): FlowNode => ({
    id,
    name: id,
    path,
    line: 1,
    status,
  });

  /**
   * prod (changed) is called by t1 (a changed test) and calls shared;
   * t1 calls only_via_test, and t2 (an unchanged test) calls shared.
   * helper (unchanged) is called by prod and by t1, so a test and
   * production code both reach it.
   */
  const graph: FlowGraph = {
    nodes: [
      at("prod", "src/pay.py", "changed"),
      at("t1", "tests/test_pay.py", "changed"),
      at("t2", "tests/test_other.py", "unchanged"),
      at("shared", "src/shared.py", "unchanged"),
      at("only_via_test", "src/rare.py", "unchanged"),
      at("helper", "src/helper.py", "unchanged"),
    ],
    edges: [
      { from: "t1", to: "prod" },
      { from: "prod", to: "shared" },
      { from: "t1", to: "only_via_test" },
      { from: "t2", to: "shared" },
      { from: "prod", to: "helper" },
      { from: "t1", to: "helper" },
    ],
  };

  const shown = (showTests: boolean, hops: 0 | 1 | 2 = 2) =>
    shownFlow(graph, { hops, showAll: true, showTests });

  it("leaves out test symbols and every edge to or from them", () => {
    const flow = shown(false);
    assert.deepStrictEqual(flow.nodes.map((n) => n.id).sort(), [
      "helper",
      "prod",
      "shared",
    ]);
    assert.deepStrictEqual(flow.edges, [
      { from: "prod", to: "shared" },
      { from: "prod", to: "helper" },
    ]);
  });

  it("leaves out a symbol reached only through a test, and keeps one reached through production code too", () => {
    const ids = shown(false).nodes.map((n) => n.id);
    assert.ok(!ids.includes("only_via_test"));
    assert.ok(ids.includes("helper"));
  });

  it("counts the test symbols within the hops it left out", () => {
    assert.strictEqual(shown(false).testsHidden, 2);
    assert.strictEqual(shown(false, 0).testsHidden, 1);
  });

  it("draws everything, and hides nothing, once tests are shown", () => {
    const flow = shown(true);
    assert.strictEqual(flow.nodes.length, 6);
    assert.strictEqual(flow.testsHidden, 0);
  });

  it("offers no test function as an entry point while they are hidden", () => {
    assert.deepStrictEqual(
      shown(false).entries.map((e) => e.id),
      ["prod"]
    );
    assert.deepStrictEqual(
      shown(true).entries.map((e) => e.id),
      ["prod", "t1"]
    );
  });

  it("draws nothing for a Change whose changed symbols are all tests", () => {
    const onlyTests: FlowGraph = {
      nodes: [
        at("t1", "tests/test_pay.py", "changed"),
        at("shared", "src/shared.py", "unchanged"),
      ],
      edges: [{ from: "t1", to: "shared" }],
    };
    const flow = shownFlow(onlyTests, {
      hops: 1,
      showAll: false,
      showTests: false,
    });
    assert.deepStrictEqual(flow.nodes, []);
    assert.deepStrictEqual(flow.entries, []);
    assert.strictEqual(flow.testsHidden, 1);
  });

  it("gives the graph without test symbols", () => {
    assert.deepStrictEqual(
      withoutTests(graph).nodes.map((n) => n.id),
      ["prod", "shared", "only_via_test", "helper"]
    );
  });
});

describe("What the Code Flow tab offers around its picture", () => {
  const answered = [{ outcome: "answered" as const }];
  const offered = (
    graph: FlowGraph,
    view: "map" | "lanes" | "list",
    controls: Partial<Parameters<typeof shownFlow>[1]> = {},
    languages: { outcome: LanguageOutcome }[] = answered
  ) => {
    const all = { hops: 1 as const, showAll: false, ...controls };
    return flowOffers({
      view,
      flow: shownFlow(graph, all),
      hops: all.hops,
      showAll: all.showAll,
      showTests: false,
      showRemoved: false,
      languages,
      problem: false,
    });
  };
  const hub: FlowGraph = {
    nodes: [
      node("hub", "changed"),
      ...[1, 2, 3].map((i) => node(`n${i}`, "unchanged")),
    ],
    edges: [1, 2, 3].map((i) => ({ from: "hub", to: `n${i}` })),
  };

  it("offers the hops and the cap's notice in the call map and the list, which draw within them, not in the swimlanes", () => {
    for (const view of ["map", "list"] as const) {
      const offers = offered(hub, view, { cap: 2 });
      assert.deepStrictEqual([offers.hops, offers.undrawn], [true, 2], view);
    }
    const lanes = offered(hub, "lanes", { cap: 2 });
    assert.deepStrictEqual([lanes.hops, lanes.undrawn], [false, 0]);
  });

  it("offers a way back once Show all drew past the cap, and none when everything fits", () => {
    assert.strictEqual(
      offered(hub, "map", { cap: 2, showAll: true }).showingAll,
      4
    );
    assert.strictEqual(
      offered(hub, "lanes", { cap: 2, showAll: true }).showingAll,
      undefined
    );
    assert.strictEqual(
      offered(hub, "map", { showAll: true }).showingAll,
      undefined
    );
  });

  it("suggests a hop when no changed symbol calls another at zero hops", () => {
    assert.strictEqual(offered(hub, "map", { hops: 0 }).tryHop, true);
    assert.strictEqual(offered(hub, "list", { hops: 0 }).tryHop, true);
    assert.strictEqual(offered(hub, "map", { hops: 1 }).tryHop, false);
    const pair: FlowGraph = {
      nodes: [node("a", "changed"), node("b", "changed")],
      edges: [{ from: "a", to: "b" }],
    };
    assert.strictEqual(offered(pair, "map", { hops: 0 }).tryHop, false);
    assert.strictEqual(
      offered(hub, "map", { hops: 0 }, [{ outcome: "noCalls" }]).tryHop,
      false,
      "no hop brings calls a server doesn't give"
    );
  });

  it("draws the swimlanes of the entry's calls, and says so when no symbol calls anything", () => {
    assert.deepStrictEqual(
      [offered(hub, "lanes").picture, offered(hub, "lanes").empty],
      [true, undefined]
    );
    const lone: FlowGraph = { nodes: [node("save", "changed")], edges: [] };
    assert.deepStrictEqual(
      [offered(lone, "lanes").picture, offered(lone, "lanes").empty],
      [false, "No symbol this Change touches calls anything."]
    );
    assert.strictEqual(
      offered(lone, "lanes", {}, [{ outcome: "noCalls" }]).empty,
      "No calls from the symbols this Change touches are known."
    );
    assert.strictEqual(
      offered(lone, "map").empty,
      "1 symbol has no calls to draw. The List view lists it.",
      "the call map leaves the symbol out and says so"
    );
    assert.strictEqual(
      offered(lone, "list").empty,
      undefined,
      "the list still lists the symbol"
    );
  });

  it("says nothing of calls in the swimlanes when there is no entry to follow, as when no language server answered", () => {
    const none: FlowGraph = { nodes: [], edges: [] };
    const offers = offered(none, "lanes", {}, [{ outcome: "none" }]);
    assert.deepStrictEqual([offers.picture, offers.empty], [false, undefined]);
  });

  it("says when the Change touches nothing Code Flow can draw, in every view", () => {
    const none: FlowGraph = { nodes: [], edges: [] };
    for (const view of ["map", "lanes", "list"] as const)
      assert.strictEqual(
        offered(none, view).empty,
        "This Change touches no functions or methods Code Flow can draw.",
        view
      );
  });
});
