import * as assert from "assert";
import { quickFixLabels } from "../../src/findingActions";

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
