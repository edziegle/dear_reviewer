import * as assert from "assert";
import type { FlowGraph, FlowNode } from "../../src/codeFlow";
import {
  parseWalkthrough,
  shownSteps,
  symbolKeys,
  walkthroughGraph,
  withDataLabels,
} from "../../src/flowWalkthrough";

function node(
  id: string,
  status: FlowNode["status"] = "unchanged",
  path = `src/${id}.py`
): FlowNode {
  return { id, name: id, path, line: 1, status };
}

/** handle (changed) calls check (new) then save; check calls parse; nothing calls handle. */
const graph: FlowGraph = {
  nodes: [
    node("handle", "changed"),
    node("check", "new"),
    node("save"),
    node("parse"),
  ],
  edges: [
    { from: "handle", to: "check", label: "check(body)" },
    { from: "handle", to: "save" },
    { from: "check", to: "parse" },
  ],
};

/** The keys the prompt gives the symbols above. */
const [handle, check, save, parse] = ["s1", "s2", "s3", "s4"];

function reply(value: unknown): string {
  return JSON.stringify(value);
}

describe("The Code Flow walkthrough's input", () => {
  it("keeps the symbols that have a call, without test code or deleted files", () => {
    const full: FlowGraph = {
      nodes: [
        node("a", "changed"),
        node("b"),
        node("lonely", "changed"),
        node("t", "unchanged", "tests/t.py"),
        node("gone", "removed"),
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "t", to: "a" },
        { from: "gone", to: "b" },
      ],
    };
    const given = walkthroughGraph(full);
    assert.deepStrictEqual(
      given.nodes.map((n) => n.id),
      ["a", "b"]
    );
    assert.deepStrictEqual(given.edges, [{ from: "a", to: "b" }]);
  });

  it("has no calls to give when nothing calls anything", () => {
    assert.deepStrictEqual(
      walkthroughGraph({ nodes: [node("a", "changed")], edges: [] }).edges,
      []
    );
  });

  it("leaves out a call of a symbol to itself", () => {
    const given = walkthroughGraph({
      nodes: [node("a", "changed"), node("b")],
      edges: [
        { from: "a", to: "a" },
        { from: "a", to: "b" },
      ],
    });
    assert.deepStrictEqual(given.edges, [{ from: "a", to: "b" }]);
  });

  it("keys the symbols s1, s2 and so on, in the graph's order", () => {
    assert.deepStrictEqual(
      [...symbolKeys(graph)].map(([key, n]) => [key, n.id]),
      [
        ["s1", "handle"],
        ["s2", "check"],
        ["s3", "save"],
        ["s4", "parse"],
      ]
    );
  });
});

describe("Reading the Assistant's walkthrough", () => {
  it("keeps the steps, their branches and what they take and give, in order", () => {
    const written = parseWalkthrough(
      reply({
        steps: [
          {
            symbol: handle,
            takes: "a request",
            gives: "a response",
            note: "now checks the body first",
            calls: [
              {
                symbol: check,
                when: "the body is not empty",
                takes: "the body",
                gives: "a verdict",
                note: "new",
                calls: [{ symbol: parse, takes: "text", gives: "fields" }],
              },
              { symbol: save },
            ],
          },
        ],
        data: [{ from: handle, to: check, data: "body" }],
      }),
      graph
    );
    assert.deepStrictEqual(written, {
      steps: [
        {
          symbol: "handle",
          takes: "a request",
          gives: "a response",
          note: "now checks the body first",
          calls: [
            {
              symbol: "check",
              when: "the body is not empty",
              takes: "the body",
              gives: "a verdict",
              note: "new",
              calls: [
                {
                  symbol: "parse",
                  takes: "text",
                  gives: "fields",
                  calls: [],
                },
              ],
            },
            { symbol: "save", calls: [] },
          ],
        },
      ],
      labels: [{ from: "handle", to: "check", data: "body" }],
    });
  });

  it("drops a step that cites a symbol the calls don't hold, with what is under it", () => {
    const written = parseWalkthrough(
      reply({
        steps: [
          { symbol: "s99", calls: [{ symbol: check }] },
          { symbol: "handle" },
          { symbol: handle, calls: [{ symbol: "s9" }, { symbol: save }] },
        ],
      }),
      graph
    );
    assert.deepStrictEqual(written?.steps, [
      { symbol: "handle", calls: [{ symbol: "save", calls: [] }] },
    ]);
  });

  it("drops a step under one that doesn't call it", () => {
    const written = parseWalkthrough(
      reply({
        steps: [
          {
            symbol: handle,
            calls: [
              // handle does not call parse, though check does; and save calls nothing.
              { symbol: parse },
              { symbol: save, calls: [{ symbol: check }] },
            ],
          },
        ],
      }),
      graph
    );
    assert.deepStrictEqual(written?.steps, [
      {
        symbol: "handle",
        calls: [{ symbol: "save", calls: [] }],
      },
    ]);
  });

  it("does not follow a call back to a symbol already on the way", () => {
    const looping: FlowGraph = {
      nodes: [node("a", "changed"), node("b")],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    };
    const written = parseWalkthrough(
      reply({
        steps: [
          {
            symbol: "s1",
            calls: [
              {
                symbol: "s2",
                calls: [{ symbol: "s1", calls: [{ symbol: "s2" }] }],
              },
            ],
          },
        ],
      }),
      looping
    );
    assert.deepStrictEqual(written?.steps, [
      {
        symbol: "a",
        calls: [
          {
            symbol: "b",
            calls: [{ symbol: "a", calls: [] }],
          },
        ],
      },
    ]);
  });

  it("keeps a note only on a symbol the Change touched", () => {
    const written = parseWalkthrough(
      reply({
        steps: [
          {
            symbol: handle,
            note: "changed",
            calls: [{ symbol: save, note: "claims a change that isn't there" }],
          },
        ],
      }),
      graph
    );
    assert.strictEqual(written?.steps[0].note, "changed");
    assert.strictEqual("note" in written!.steps[0].calls[0], false);
  });

  it("cuts long text to one line and ignores what isn't text", () => {
    const written = parseWalkthrough(
      reply({
        steps: [
          {
            symbol: handle,
            takes: `a\n\n   request ${"x".repeat(300)}`,
            gives: 7,
            when: ["not text"],
            calls: "none",
          },
        ],
      }),
      graph
    );
    const step = written!.steps[0];
    assert.ok(step.takes!.startsWith("a request xxx"));
    assert.ok(step.takes!.length <= 120 && step.takes!.endsWith("…"));
    assert.deepStrictEqual(Object.keys(step).sort(), [
      "calls",
      "symbol",
      "takes",
    ]);
  });

  it("keeps a data label only for a call the graph holds, once", () => {
    const written = parseWalkthrough(
      reply({
        steps: [{ symbol: handle }],
        data: [
          { from: handle, to: check, data: "verdict, body" },
          { from: handle, to: check, data: "a second label" },
          // check does not call handle, and handle does not call parse.
          { from: check, to: handle, data: "backwards" },
          { from: handle, to: parse, data: "skipped a call" },
          { from: handle, to: "s99", data: "nobody" },
          { from: handle, to: save, data: "" },
          "not an object",
        ],
      }),
      graph
    );
    assert.deepStrictEqual(written?.labels, [
      { from: "handle", to: "check", data: "verdict, body" },
    ]);
  });

  it("reads the object inside a Markdown fence or after prose", () => {
    const json = reply({ steps: [{ symbol: handle }] });
    for (const text of [
      `Here it is:\n\`\`\`json\n${json}\n\`\`\`\nHope it helps.`,
      json,
    ]) {
      assert.strictEqual(parseWalkthrough(text, graph)?.steps.length, 1);
    }
  });

  it("gives nothing for a reply without a usable step", () => {
    for (const text of [
      "No walkthrough, sorry.",
      "{ not json }",
      reply({}),
      reply({ steps: "all of them" }),
      reply({ steps: [] }),
      reply({ steps: [{ symbol: "s99" }, 3, null, { calls: [] }] }),
      reply([{ symbol: handle }]),
    ]) {
      assert.strictEqual(parseWalkthrough(text, graph), undefined, text);
    }
  });

  it("keeps at most sixty steps, and eight levels", () => {
    const many = {
      nodes: [node("a", "changed"), node("b")],
      edges: [{ from: "a", to: "b" }],
    };
    const wide = parseWalkthrough(
      reply({ steps: Array.from({ length: 100 }, () => ({ symbol: "s1" })) }),
      many
    );
    assert.strictEqual(wide?.steps.length, 60);

    const chain: FlowGraph = {
      nodes: Array.from({ length: 12 }, (_, i) => node(`n${i}`, "changed")),
      edges: Array.from({ length: 11 }, (_, i) => ({
        from: `n${i}`,
        to: `n${i + 1}`,
      })),
    };
    const deep = (i: number): unknown =>
      i === 12 ? undefined : { symbol: `s${i + 1}`, calls: [deep(i + 1)] };
    let depth = 0;
    for (
      let step = parseWalkthrough(reply({ steps: [deep(0)] }), chain)?.steps[0];
      step;
      step = step.calls[0]
    ) {
      depth++;
    }
    assert.strictEqual(depth, 8);
  });
});

describe("Showing the Assistant's walkthrough", () => {
  it("numbers the steps and their branches, and takes names and places from the Code Flow", () => {
    const shown = shownSteps(
      [
        {
          symbol: "handle",
          when: "always",
          takes: "request",
          gives: "response",
          note: "checks first",
          calls: [
            { symbol: "check", calls: [{ symbol: "parse", calls: [] }] },
            { symbol: "save", calls: [] },
          ],
        },
        { symbol: "save", calls: [] },
      ],
      graph
    );
    const numbers = (steps: typeof shown): unknown[] =>
      steps.map((s) => [s.number, s.name, numbers(s.calls)]);
    assert.deepStrictEqual(numbers(shown), [
      [
        "1",
        "handle",
        [
          ["1.1", "check", [["1.1.1", "parse", []]]],
          ["1.2", "save", []],
        ],
      ],
      ["2", "save", []],
    ]);
    assert.deepStrictEqual(shown[0], {
      number: "1",
      id: "handle",
      name: "handle",
      path: "src/handle.py",
      line: 1,
      status: "changed",
      when: "always",
      takes: "request",
      gives: "response",
      note: "checks first",
      calls: shown[0].calls,
    });
    assert.strictEqual(shown[0].calls[0].status, "new");
  });

  it("leaves out a step whose symbol the Code Flow no longer has", () => {
    const shown = shownSteps(
      [
        { symbol: "gone", calls: [] },
        { symbol: "save", calls: [] },
      ],
      graph
    );
    assert.deepStrictEqual(
      shown.map((s) => [s.number, s.name]),
      [["1", "save"]]
    );
  });
});

describe("Data labels on the Code Flow's calls", () => {
  it("shows the data a call carries beside the language server's label", () => {
    const labelled = withDataLabels(graph, [
      { from: "handle", to: "check", data: "verdict, body" },
    ]);
    assert.deepStrictEqual(labelled.edges[0], {
      from: "handle",
      to: "check",
      label: "check(body)",
      data: "verdict, body",
    });
    assert.deepStrictEqual(labelled.edges.slice(1), graph.edges.slice(1));
    assert.deepStrictEqual(graph.edges[0].data, undefined);
  });

  it("gives the graph back as it is with no labels", () => {
    assert.strictEqual(withDataLabels(graph, []), graph);
  });
});
