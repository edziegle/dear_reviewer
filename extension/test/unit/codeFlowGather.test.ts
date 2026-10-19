import * as assert from "assert";
import type { FileChange } from "../../src/codeFlow";
import {
  gatherFlow,
  type CallItem,
  type CallLink,
  type FlowSource,
} from "../../src/codeFlowGather";

function item(name: string, path: string, line: number): CallItem {
  return {
    id: `${path}:${line}:${name}`,
    name,
    path,
    line,
    endLine: line + 4,
    handle: name,
  };
}

const submit = item("submit", "pay.py", 10);
const charge = item("charge", "bank.py", 3);
const checkout = item("checkout", "cart.py", 7);
const audit = item("audit", "audit.py", 1);
const refund = item("refund", "pay.py", 30);

/** A symbol of the base worktree, whose id keeps it apart from the head's symbol of the same place. */
function baseItem(name: string, path: string, line: number): CallItem {
  return {
    ...item(name, path, line),
    id: `base:${path}:${line}:${name}`,
    side: "base",
  };
}
const legacy = baseItem("legacy", "old.py", 1);
const user = baseItem("user", "pay.py", 12);

/** A fake language server: symbols per file, and calls by symbol name. */
function source({
  symbols = { "pay.py": [submit] },
  baseSymbols = {},
  calls = {},
  prepared = true,
  ...overrides
}: Partial<Omit<FlowSource, "symbols">> & {
  symbols?: Record<string, CallItem[]>;
  baseSymbols?: Record<string, CallItem[]>;
  calls?: Record<string, { in?: CallLink[]; out?: CallLink[] }>;
  prepared?: boolean;
} = {}): FlowSource {
  return {
    languageOf: (path) => (path.endsWith(".py") ? "python" : "typescript"),
    symbols: async (path, side) =>
      (side === "base" ? baseSymbols : symbols)[path] ?? [],
    prepare: async (symbol) => (prepared ? [symbol] : []),
    incoming: async (it) => calls[it.name]?.in ?? [],
    outgoing: async (it) => calls[it.name]?.out ?? [],
    ...overrides,
  };
}

const edited = (path: string, start: number, end: number): FileChange => ({
  path,
  isNewFile: false,
  addedLines: [],
  modifiedLines: [{ start, end }],
});

describe("gathering a Code Flow", () => {
  it("starts from the symbols the diff reaches, marked changed", async () => {
    const flow = await gatherFlow(source(), [edited("pay.py", 12, 12)], {
      hops: 1,
      waitMs: 1000,
    });
    assert.deepStrictEqual(
      flow.graph.nodes.map((n) => [n.name, n.status]),
      [["submit", "changed"]]
    );
  });

  it("leaves out symbols the diff doesn't reach", async () => {
    const flow = await gatherFlow(source(), [edited("pay.py", 40, 41)], {
      hops: 1,
      waitMs: 1000,
    });
    assert.deepStrictEqual(flow.graph.nodes, []);
  });

  it("adds callers and callees a hop out, with the labels the server gave", async () => {
    const flow = await gatherFlow(
      source({
        calls: {
          submit: {
            in: [{ item: checkout, label: "checkout()" }],
            out: [{ item: charge, label: "charge(amount)" }],
          },
        },
      }),
      [edited("pay.py", 12, 12)],
      { hops: 1, waitMs: 1000 }
    );
    assert.deepStrictEqual(flow.graph.nodes.map((n) => n.name).sort(), [
      "charge",
      "checkout",
      "submit",
    ]);
    assert.deepStrictEqual(flow.graph.edges, [
      { from: checkout.id, to: submit.id, label: "checkout()" },
      { from: submit.id, to: charge.id, label: "charge(amount)" },
    ]);
  });

  it("walks as many hops as asked and no more", async () => {
    const calls = {
      submit: { out: [{ item: charge }] },
      charge: { out: [{ item: audit }] },
    };
    const one = await gatherFlow(
      source({ calls }),
      [edited("pay.py", 12, 12)],
      {
        hops: 1,
        waitMs: 1000,
      }
    );
    const two = await gatherFlow(
      source({ calls }),
      [edited("pay.py", 12, 12)],
      {
        hops: 2,
        waitMs: 1000,
      }
    );
    assert.strictEqual(one.graph.nodes.length, 2);
    assert.strictEqual(two.graph.nodes.length, 3);
  });

  it("says a language answered when its server found the symbol", async () => {
    const flow = await gatherFlow(source(), [edited("pay.py", 12, 12)], {
      hops: 1,
      waitMs: 1000,
    });
    assert.deepStrictEqual(flow.languages, [
      { language: "python", outcome: "answered" },
    ]);
  });

  it("says a server gave no calls when it knows symbols but gives no call hierarchy", async () => {
    const flow = await gatherFlow(
      source({ prepared: false }),
      [edited("pay.py", 12, 12)],
      { hops: 1, waitMs: 1000 }
    );
    assert.deepStrictEqual(flow.languages, [
      { language: "python", outcome: "noCalls" },
    ]);
  });

  it("tells a server with no call hierarchy from one that timed out", async () => {
    const empty = await gatherFlow(
      source({ prepare: async () => [] }),
      [edited("pay.py", 12, 12)],
      { hops: 1, waitMs: 20 }
    );
    const slow = await gatherFlow(
      source({ prepare: () => new Promise(() => undefined) }),
      [edited("pay.py", 12, 12)],
      { hops: 1, waitMs: 20 }
    );
    assert.strictEqual(empty.languages[0].outcome, "noCalls");
    assert.strictEqual(slow.languages[0].outcome, "silent");
  });

  it("says a server answered when one changed symbol has a call hierarchy and another has none", async () => {
    const flow = await gatherFlow(
      source({
        symbols: { "pay.py": [submit, refund] },
        prepare: async (symbol) => (symbol.id === submit.id ? [submit] : []),
      }),
      [edited("pay.py", 12, 12), edited("pay.py", 31, 31)],
      { hops: 1, waitMs: 1000 }
    );
    assert.deepStrictEqual(flow.languages, [
      { language: "python", outcome: "answered" },
    ]);
  });

  it("says a server timed out, not that it gave no calls, when one symbol is empty and another never answers", async () => {
    const flow = await gatherFlow(
      source({
        symbols: { "pay.py": [submit, refund] },
        prepare: (symbol) =>
          symbol.id === submit.id
            ? Promise.resolve([])
            : new Promise(() => undefined),
      }),
      [edited("pay.py", 12, 12), edited("pay.py", 31, 31)],
      { hops: 1, waitMs: 20 }
    );
    assert.deepStrictEqual(flow.languages, [
      { language: "python", outcome: "silent" },
    ]);
  });

  it("says there is no language server when nothing comes back for the file", async () => {
    const flow = await gatherFlow(
      source({ symbols: {} }),
      [edited("pay.py", 12, 12)],
      { hops: 1, waitMs: 1000 }
    );
    assert.deepStrictEqual(flow.languages, [
      { language: "python", outcome: "none" },
    ]);
  });

  it("gives up on a server that never answers, and says so", async () => {
    const flow = await gatherFlow(
      source({ prepare: () => new Promise(() => undefined) }),
      [edited("pay.py", 12, 12)],
      { hops: 1, waitMs: 20 }
    );
    assert.deepStrictEqual(flow.languages, [
      { language: "python", outcome: "silent" },
    ]);
  });

  it("keeps what answered when another language has no server", async () => {
    const flow = await gatherFlow(
      source({
        symbols: { "pay.py": [submit] },
        languageOf: (path) => (path.endsWith(".py") ? "python" : "rust"),
      }),
      [edited("pay.py", 12, 12), edited("lib.rs", 1, 5)],
      { hops: 1, waitMs: 1000 }
    );
    assert.deepStrictEqual(flow.languages, [
      { language: "python", outcome: "answered" },
      { language: "rust", outcome: "none" },
    ]);
    assert.strictEqual(flow.graph.nodes.length, 1);
  });

  it("marks a symbol in a new file as new", async () => {
    const flow = await gatherFlow(
      source(),
      [{ path: "pay.py", isNewFile: true, addedLines: [], modifiedLines: [] }],
      { hops: 1, waitMs: 1000 }
    );
    assert.strictEqual(flow.graph.nodes[0].status, "new");
  });

  it("says a server answered when its file has symbols but the diff reaches none", async () => {
    const flow = await gatherFlow(
      source({ prepared: false }),
      [edited("pay.py", 40, 41)],
      {
        hops: 1,
        waitMs: 1000,
      }
    );
    assert.deepStrictEqual(flow.languages, [
      { language: "python", outcome: "answered" },
    ]);
  });

  it("skips files whose language isn't code", async () => {
    const flow = await gatherFlow(
      source({
        languageOf: (path) => (path.endsWith(".md") ? undefined : "python"),
      }),
      [edited("README.md", 1, 5), edited("pay.py", 12, 12)],
      { hops: 1, waitMs: 1000 }
    );
    assert.deepStrictEqual(flow.languages, [
      { language: "python", outcome: "answered" },
    ]);
  });

  it("carries on when one file's language can't be told", async () => {
    const flow = await gatherFlow(
      source({
        languageOf: (path) => {
          if (path === "logo.png") {
            throw new Error("binary file");
          }
          return "python";
        },
      }),
      [edited("logo.png", 1, 1), edited("pay.py", 12, 12)],
      { hops: 1, waitMs: 1000 }
    );
    assert.strictEqual(flow.graph.nodes.length, 1);
  });

  it("marks a neighbour the diff reaches as changed", async () => {
    const flow = await gatherFlow(
      source({
        symbols: { "pay.py": [submit], "bank.py": [charge] },
        calls: { submit: { out: [{ item: charge }] } },
      }),
      [edited("pay.py", 12, 12), edited("bank.py", 4, 4)],
      { hops: 1, waitMs: 1000 }
    );
    assert.deepStrictEqual(
      flow.graph.nodes.map((n) => [n.name, n.status]),
      [
        ["submit", "changed"],
        ["charge", "changed"],
      ]
    );
  });

  it("draws a symbol once when the server names it differently", async () => {
    const renamed = {
      ...submit,
      id: "pay.py:10:submit(int)",
      name: "submit(int)",
    };
    const flow = await gatherFlow(
      source({
        prepare: async () => [renamed],
        calls: { "submit(int)": { out: [{ item: charge }] } },
      }),
      [edited("pay.py", 12, 12)],
      { hops: 1, waitMs: 1000 }
    );
    assert.deepStrictEqual(flow.graph.edges, [
      { from: submit.id, to: charge.id },
    ]);
    assert.strictEqual(
      flow.graph.nodes.filter((n) => n.path === "pay.py").length,
      1
    );
  });

  const deleted = (path: string): FileChange => ({
    path,
    isNewFile: false,
    isDeletedFile: true,
    addedLines: [],
    modifiedLines: [],
  });

  it("draws the functions of a deleted file from the base side, marked removed", async () => {
    const flow = await gatherFlow(
      source({ baseSymbols: { "old.py": [legacy] }, symbols: {} }),
      [deleted("old.py")],
      { hops: 1, waitMs: 1000 }
    );
    assert.deepStrictEqual(
      flow.graph.nodes.map((n) => [n.name, n.status, n.side]),
      [["legacy", "removed", "base"]]
    );
    assert.deepStrictEqual(flow.languages, [
      { language: "python", outcome: "answered" },
    ]);
  });

  it("asks for a deleted file's language from the base side", async () => {
    const asked: (string | undefined)[] = [];
    await gatherFlow(
      source({
        baseSymbols: { "old.py": [legacy] },
        languageOf: (_path, side) => {
          asked.push(side);
          return "python";
        },
      }),
      [deleted("old.py")],
      { hops: 1, waitMs: 1000 }
    );
    assert.deepStrictEqual(asked, ["base"]);
  });

  it("shows who called a removed function before the Change", async () => {
    const flow = await gatherFlow(
      source({
        baseSymbols: { "old.py": [legacy] },
        calls: { legacy: { in: [{ item: user, label: "user()" }] } },
      }),
      [deleted("old.py")],
      { hops: 1, waitMs: 1000 }
    );
    assert.deepStrictEqual(
      flow.graph.nodes.map((n) => [n.name, n.status, n.side]),
      [
        ["legacy", "removed", "base"],
        ["user", "unchanged", "base"],
      ]
    );
    assert.deepStrictEqual(flow.graph.edges, [
      { from: user.id, to: legacy.id, label: "user()" },
    ]);
  });

  it("doesn't mark a base-side neighbour by the head's diff", async () => {
    const flow = await gatherFlow(
      source({
        baseSymbols: { "old.py": [legacy] },
        calls: { legacy: { in: [{ item: user }] } },
      }),
      [deleted("old.py"), edited("pay.py", 12, 12)],
      { hops: 1, waitMs: 1000 }
    );
    assert.strictEqual(
      flow.graph.nodes.find((n) => n.id === user.id)!.status,
      "unchanged"
    );
  });
});
