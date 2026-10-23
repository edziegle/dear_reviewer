import * as assert from "assert";
import { quickFixLabels, selectedLines } from "../../src/findingActions";

describe("Which lines a Quick Fix request asks about", () => {
  const at = (line: number, character: number) => ({ line, character });

  it("is the cursor's line", () => {
    assert.deepStrictEqual(selectedLines(at(4, 7), at(4, 7)), {
      first: 4,
      last: 4,
    });
  });

  it("leaves out the line after a selection of whole lines", () => {
    assert.deepStrictEqual(selectedLines(at(4, 0), at(6, 0)), {
      first: 4,
      last: 5,
    });
  });

  it("keeps the last line of a selection that ends inside it", () => {
    assert.deepStrictEqual(selectedLines(at(4, 0), at(6, 1)), {
      first: 4,
      last: 6,
    });
  });

  it("keeps the line of an empty selection at the start of a line", () => {
    assert.deepStrictEqual(selectedLines(at(4, 0), at(4, 0)), {
      first: 4,
      last: 4,
    });
  });
});

describe("What a Finding's Quick Fix actions are called", () => {
  it("calls a Finding alone on the line plain Finding", () => {
    assert.deepStrictEqual(
      quickFixLabels([{ first: 12, last: 14, message: "Unchecked null" }]),
      ["Finding"]
    );
  });

  it("names each of several Findings by its lines and the start of its message", () => {
    assert.deepStrictEqual(
      quickFixLabels([
        { first: 12, last: 14, message: "Unchecked null" },
        { first: 13, last: 13, message: "Off by one" },
      ]),
      [
        "Finding on lines 12–14, “Unchecked null”",
        "Finding on line 13, “Off by one”",
      ]
    );
  });

  it("takes only the message's first line, cut to 40 characters", () => {
    const [, label] = quickFixLabels([
      { first: 1, last: 1, message: "Short" },
      {
        first: 1,
        last: 1,
        message:
          "This message runs on far longer than any menu should show it\nand has a second line",
      },
    ]);

    assert.strictEqual(
      label,
      "Finding on line 1, “This message runs on far longer than any…”"
    );
  });

  it("cuts the message by whole characters, never inside a surrogate pair or before a combining mark", () => {
    const label = (message: string) =>
      quickFixLabels([
        { first: 1, last: 1, message: "Short" },
        { first: 1, last: 1, message },
      ])[1];

    assert.strictEqual(
      label(`${"a".repeat(39)}😀😀`),
      `Finding on line 1, “${"a".repeat(39)}😀…”`
    );
    assert.strictEqual(
      label(`${"a".repeat(39)}e\u0301 and more`),
      `Finding on line 1, “${"a".repeat(39)}e\u0301…”`
    );
    assert.strictEqual(
      label(`${"😀".repeat(40)}`),
      `Finding on line 1, “${"😀".repeat(40)}”`,
      "forty emoji are forty characters"
    );
  });

  it("leaves out control and direction characters the message holds", () => {
    const [, label] = quickFixLabels([
      { first: 1, last: 1, message: "Short" },
      { first: 1, last: 1, message: "  Pay‮\u0007  ​now\t\tplease " },
    ]);

    assert.strictEqual(label, "Finding on line 1, “Pay now please”");
  });

  it("numbers Findings that would otherwise read the same", () => {
    assert.deepStrictEqual(
      quickFixLabels([
        { first: 3, last: 3, message: "Same" },
        { first: 3, last: 3, message: "Same" },
      ]),
      ["Finding 1 on line 3, “Same”", "Finding 2 on line 3, “Same”"]
    );
  });

  it("names nothing for no Findings", () => {
    assert.deepStrictEqual(quickFixLabels([]), []);
  });
});
