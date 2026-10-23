import * as assert from "assert";
import {
  findingAfter,
  placeAmong,
  stepOrder,
  type Placed,
} from "../../src/findingOrder";

const finding = (id: string, file: string, first: number, last = first) => ({
  id,
  file,
  first,
  last,
});

const ids = (findings: readonly Placed[]) => findings.map((f) => f.id);

describe("The order Findings are stepped through", () => {
  it("sorts by file, then by first line", () => {
    assert.deepStrictEqual(
      ids(
        stepOrder([
          finding("b2", "b.py", 9),
          finding("a7", "a.py", 7),
          finding("b1", "b.py", 1),
          finding("a10", "a.py", 10),
        ])
      ),
      ["a7", "a10", "b1", "b2"]
    );
  });

  it("keeps Findings that start on the same line in the order they came", () => {
    assert.deepStrictEqual(
      ids(
        stepOrder([
          finding("second", "a.py", 3, 5),
          finding("before", "a.py", 1),
          finding("third", "a.py", 3),
        ])
      ),
      ["before", "second", "third"]
    );
  });
});

describe("A Finding's place among the Findings", () => {
  const ordered = stepOrder([
    finding("one", "a.py", 1),
    finding("two", "a.py", 4),
    finding("three", "a.py", 4),
  ]);

  it("counts from 1, out of them all", () => {
    assert.deepStrictEqual(placeAmong(ordered, "one"), {
      position: 1,
      total: 3,
    });
    assert.deepStrictEqual(placeAmong(ordered, "three"), {
      position: 3,
      total: 3,
    });
  });

  it("gives Findings that start on the same line different places", () => {
    assert.notDeepStrictEqual(
      placeAmong(ordered, "two"),
      placeAmong(ordered, "three")
    );
  });

  it("gives no place to a Finding not among them", () => {
    assert.strictEqual(placeAmong(ordered, "elsewhere"), undefined);
  });
});

describe("The Finding a step goes to", () => {
  const ordered = stepOrder([
    finding("a1", "a.py", 1),
    finding("a5", "a.py", 5, 9),
    finding("a5b", "a.py", 5),
    finding("b2", "b.py", 2),
  ]);
  const step = (from: Parameters<typeof findingAfter>[1], direction: 1 | -1) =>
    findingAfter(ordered, from, direction)?.id;

  it("goes to a Finding's neighbours", () => {
    assert.strictEqual(step({ id: "a5" }, 1), "a5b");
    assert.strictEqual(step({ id: "a5b" }, -1), "a5");
  });

  it("goes round at either end", () => {
    assert.strictEqual(step({ id: "b2" }, 1), "a1");
    assert.strictEqual(step({ id: "a1" }, -1), "b2");
  });

  it("goes to the first or the last from nowhere", () => {
    assert.strictEqual(step(undefined, 1), "a1");
    assert.strictEqual(step(undefined, -1), "b2");
  });

  it("steps from the cursor when it's on no Finding", () => {
    assert.strictEqual(step({ file: "a.py", line: 3 }, 1), "a5");
    assert.strictEqual(step({ file: "a.py", line: 3 }, -1), "a1");
    assert.strictEqual(step({ file: "b.py", line: 7 }, 1), "a1");
    assert.strictEqual(step({ file: "c.py", line: 0 }, -1), "b2");
  });

  it("steps from the Finding under the cursor, on any of its lines", () => {
    assert.strictEqual(step({ file: "a.py", line: 9 }, -1), "a1");
    assert.strictEqual(step({ file: "a.py", line: 7 }, 1), "a5b");
  });

  it("steps from the Finding that starts nearest above the cursor, where one lies inside another", () => {
    const nested = stepOrder([
      finding("outer", "a.py", 0, 9),
      finding("inner", "a.py", 4, 5),
      finding("after", "a.py", 12),
    ]);
    const from = { file: "a.py", line: 5 };

    assert.strictEqual(findingAfter(nested, from, 1)?.id, "after");
    assert.strictEqual(findingAfter(nested, from, -1)?.id, "outer");
  });

  it("steps from the current Finding while the cursor is on its lines", () => {
    assert.strictEqual(
      step({ file: "a.py", line: 5, current: "a5b" }, 1),
      "b2"
    );
    assert.strictEqual(
      step({ file: "a.py", line: 5, current: "a5b" }, -1),
      "a5"
    );
  });

  it("forgets the current Finding once the cursor leaves its lines", () => {
    assert.strictEqual(
      step({ file: "a.py", line: 7, current: "a5b" }, 1),
      "a5b"
    );
  });

  it("reaches every Finding, ties included, stepping either way", () => {
    for (const direction of [1, -1] as const) {
      const visited: string[] = [];
      let from: { id: string } | undefined;
      for (let i = 0; i < ordered.length; i++) {
        const next = findingAfter(ordered, from, direction)!;
        visited.push(next.id);
        from = { id: next.id };
      }
      assert.deepStrictEqual(visited.sort(), ids(ordered).sort());
    }
  });

  it("goes nowhere when there are no Findings", () => {
    assert.strictEqual(findingAfter([], undefined, 1), undefined);
  });
});
