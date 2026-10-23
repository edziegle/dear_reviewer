import * as assert from "assert";
import {
  byFile,
  countText,
  currentFinding,
  focusAfterRemoval,
  focusAfterRemovalScript,
  type Listed,
} from "../../src/findingsList";

const listed = (
  id: string,
  path: string,
  first: number,
  last = first,
  fields: Partial<Listed> = {}
): Listed => ({
  id,
  file: `file:///head/${path}`,
  path,
  first,
  last,
  base: false,
  message: `Message of ${id}.`,
  ...fields,
});

describe("The Findings view's rows", () => {
  it("groups the Findings under their file, keeping their order", () => {
    const files = byFile([
      listed("a1", "src/api/client.ts", 11),
      listed("a2", "src/api/client.ts", 15, 17),
      listed("b1", "README.md", 0),
    ]);
    assert.deepStrictEqual(
      files.map((f) => ({
        name: f.name,
        folder: f.folder,
        findings: f.findings.map((r) => [r.id, r.lines]),
      })),
      [
        {
          name: "client.ts",
          folder: "src/api",
          findings: [
            ["a1", "12"],
            ["a2", "16–18"],
          ],
        },
        { name: "README.md", folder: "", findings: [["b1", "1"]] },
      ]
    );
  });

  it("keeps a base-side file apart from the same path on the head side, and marks its Findings", () => {
    const files = byFile([
      listed("base", "util.py", 1, 1, {
        file: "file:///base/util.py",
        base: true,
      }),
      listed("head", "util.py", 1),
    ]);
    assert.deepStrictEqual(
      files.map((f) => f.findings.map((r) => [r.id, r.base])),
      [[["base", true]], [["head", false]]]
    );
    assert.notStrictEqual(files[0].key, files[1].key);
  });

  it("names each Finding for a screen reader by its file, lines and message", () => {
    const [file] = byFile([
      listed("one", "src/client.ts", 11, 11, {
        message: "charge is retried\nbut sends no idempotency key.",
      }),
      listed("range", "src/client.ts", 15, 17, { base: true }),
    ]);
    assert.deepStrictEqual(
      file.findings.map((r) => r.name),
      [
        "client.ts line 12: charge is retried but sends no idempotency key.",
        "client.ts lines 16 to 18, base: Message of range.",
      ]
    );
  });

  it("keeps the whole message, and its first line for the row", () => {
    const [file] = byFile([
      listed("a", "a.py", 0, 0, { message: "First line.\nSecond line." }),
    ]);
    assert.strictEqual(file.findings[0].message, "First line.\nSecond line.");
    assert.strictEqual(file.findings[0].firstLine, "First line.");
  });
});

describe("The current Finding", () => {
  const ordered = [
    listed("long", "a.py", 0, 9),
    listed("inner", "a.py", 3, 4),
    listed("other", "b.py", 5),
  ];

  it("is the one under the cursor, the one starting nearest above it where Findings overlap", () => {
    assert.strictEqual(
      currentFinding(
        ordered,
        { file: "file:///head/a.py", line: 4 },
        undefined
      ),
      "inner"
    );
    assert.strictEqual(
      currentFinding(ordered, { file: "file:///head/a.py", line: 7 }, "other"),
      "long"
    );
  });

  it("is the one stepped to last while the cursor is on its lines", () => {
    assert.strictEqual(
      currentFinding(ordered, { file: "file:///head/a.py", line: 4 }, "long"),
      "long"
    );
  });

  it("is otherwise the one stepped to or clicked last, while it still exists", () => {
    assert.strictEqual(
      currentFinding(ordered, { file: "file:///head/c.py", line: 0 }, "other"),
      "other"
    );
    assert.strictEqual(currentFinding(ordered, undefined, "inner"), "inner");
    assert.strictEqual(currentFinding(ordered, undefined, "gone"), undefined);
    assert.strictEqual(
      currentFinding(ordered, undefined, undefined),
      undefined
    );
  });
});

describe("The stepper's count", () => {
  const ordered = [listed("a", "a.py", 0), listed("b", "b.py", 0)];

  it("says which Finding is current, or how many there are", () => {
    assert.strictEqual(countText(ordered, "b"), "2 of 2");
    assert.strictEqual(countText(ordered, undefined), "2 Findings");
    assert.strictEqual(countText(ordered.slice(0, 1), undefined), "1 Finding");
  });
});

describe("Where the focus goes when its Finding goes", () => {
  it("stays on a Finding that's still listed", () => {
    assert.strictEqual(focusAfterRemoval(["a", "b"], ["b", "a"], "a"), "a");
  });

  it("goes to the Finding that takes its place", () => {
    assert.strictEqual(
      focusAfterRemoval(["a", "b", "c"], ["a", "c"], "b"),
      "c"
    );
    assert.strictEqual(
      focusAfterRemoval(["a", "b", "c", "d"], ["a", "d"], "b"),
      "d"
    );
  });

  it("goes to the one before it when it was last", () => {
    assert.strictEqual(
      focusAfterRemoval(["a", "b", "c"], ["a", "b"], "c"),
      "b"
    );
  });

  it("goes to the first Finding when none from before is left, as when a new Ask replaced them", () => {
    assert.strictEqual(focusAfterRemoval(["a", "b"], ["x", "y"], "b"), "x");
  });

  it("goes nowhere in the list when none is left", () => {
    assert.strictEqual(focusAfterRemoval(["a"], [], "a"), undefined);
  });

  it("is the script the webview runs, which uses nothing from outside itself", () => {
    const copy = new Function(
      `return (${focusAfterRemovalScript});`
    )() as typeof focusAfterRemoval;
    assert.strictEqual(copy(["a", "b", "c"], ["a", "c"], "b"), "c");
    assert.match(focusAfterRemovalScript, /^function focusAfterRemoval\(/);
  });
});
