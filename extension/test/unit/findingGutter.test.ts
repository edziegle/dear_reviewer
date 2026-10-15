import * as assert from "assert";
import { gutterIcons, type LineSpan } from "../../src/findingGutter";

describe("Which icon a Finding's lines show in the gutter", () => {
  const icons = (...spans: LineSpan[]) => [...gutterIcons(spans)];

  it("shows the plain lightbulb on a one-line Finding", () => {
    assert.deepStrictEqual(icons({ first: 4, last: 4 }), [[4, "lightbulb"]]);
  });

  it("shows the lightbulb with a bar on a long Finding's first line, and the bar on the rest", () => {
    assert.deepStrictEqual(icons({ first: 0, last: 9 }), [
      [0, "lightbulbWithBar"],
      ...Array.from({ length: 9 }, (_, i) => [i + 1, "bar"]),
    ]);
  });

  it("starts each of two Findings on adjacent lines with its own lightbulb", () => {
    assert.deepStrictEqual(
      icons({ first: 0, last: 2 }, { first: 3, last: 4 }),
      [
        [0, "lightbulbWithBar"],
        [1, "bar"],
        [2, "bar"],
        [3, "lightbulbWithBar"],
        [4, "bar"],
      ]
    );
  });

  it("shows a one-line Finding right after a long one as the plain lightbulb", () => {
    assert.deepStrictEqual(
      icons({ first: 0, last: 1 }, { first: 2, last: 2 }),
      [
        [0, "lightbulbWithBar"],
        [1, "bar"],
        [2, "lightbulb"],
      ]
    );
  });

  it("starts a Finding inside a longer one with a lightbulb that keeps the bar", () => {
    assert.deepStrictEqual(
      icons({ first: 0, last: 4 }, { first: 2, last: 2 }),
      [
        [0, "lightbulbWithBar"],
        [1, "bar"],
        [2, "lightbulbWithBar"],
        [3, "bar"],
        [4, "bar"],
      ]
    );
  });

  it("keeps the bar on the lightbulb where a one-line Finding sits on a longer one's last line", () => {
    assert.deepStrictEqual(
      icons({ first: 3, last: 3 }, { first: 0, last: 3 }),
      [
        [0, "lightbulbWithBar"],
        [1, "bar"],
        [2, "bar"],
        [3, "lightbulbWithBar"],
      ]
    );
  });

  it("shows one icon on a line where two Findings start", () => {
    assert.deepStrictEqual(
      icons({ first: 1, last: 1 }, { first: 1, last: 2 }),
      [
        [1, "lightbulbWithBar"],
        [2, "bar"],
      ]
    );
    assert.deepStrictEqual(
      icons({ first: 1, last: 1 }, { first: 1, last: 1 }),
      [[1, "lightbulb"]]
    );
  });

  it("leaves lines between Findings bare", () => {
    assert.deepStrictEqual(
      icons({ first: 0, last: 1 }, { first: 5, last: 5 }),
      [
        [0, "lightbulbWithBar"],
        [1, "bar"],
        [5, "lightbulb"],
      ]
    );
  });

  it("shows nothing for no Findings", () => {
    assert.deepStrictEqual(icons(), []);
  });
});
