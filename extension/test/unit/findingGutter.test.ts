import * as assert from "assert";
import { gutterIcons, type LineSpan } from "../../src/findingGutter";

describe("Which icon a Finding's lines show in the gutter", () => {
  const icons = (...spans: LineSpan[]) =>
    gutterIcons(spans).map(({ icon, first, last }) => [icon, first, last]);

  it("shows the cat on a one-line Finding", () => {
    assert.deepStrictEqual(icons({ first: 4, last: 4 }), [["cat", 4, 4]]);
  });

  it("shows the cat on a long Finding's first line, and the bar on the rest", () => {
    assert.deepStrictEqual(icons({ first: 0, last: 9 }), [
      ["cat", 0, 0],
      ["bar", 1, 9],
    ]);
  });

  it("starts each of two Findings on adjacent lines with its own cat", () => {
    assert.deepStrictEqual(
      icons({ first: 3, last: 4 }, { first: 0, last: 2 }),
      [
        ["cat", 0, 0],
        ["bar", 1, 2],
        ["cat", 3, 3],
        ["bar", 4, 4],
      ]
    );
  });

  it("starts two adjacent one-line Findings each with a cat", () => {
    assert.deepStrictEqual(
      icons({ first: 0, last: 0 }, { first: 1, last: 1 }),
      [
        ["cat", 0, 0],
        ["cat", 1, 1],
      ]
    );
  });

  it("starts a Finding inside a longer one with a cat and keeps the bar after it", () => {
    assert.deepStrictEqual(
      icons({ first: 0, last: 4 }, { first: 2, last: 2 }),
      [
        ["cat", 0, 0],
        ["bar", 1, 1],
        ["cat", 2, 2],
        ["bar", 3, 4],
      ]
    );
  });

  it("shows the cat where a one-line Finding sits on a longer one's last line", () => {
    assert.deepStrictEqual(
      icons({ first: 3, last: 3 }, { first: 0, last: 3 }),
      [
        ["cat", 0, 0],
        ["bar", 1, 2],
        ["cat", 3, 3],
      ]
    );
  });

  it("runs the bar on past a Finding that starts and ends inside a longer one", () => {
    assert.deepStrictEqual(
      icons({ first: 0, last: 9 }, { first: 2, last: 4 }),
      [
        ["cat", 0, 0],
        ["bar", 1, 1],
        ["cat", 2, 2],
        ["bar", 3, 9],
      ]
    );
  });

  it("shows one icon on a line where two Findings start", () => {
    assert.deepStrictEqual(
      icons({ first: 1, last: 1 }, { first: 1, last: 2 }),
      [
        ["cat", 1, 1],
        ["bar", 2, 2],
      ]
    );
    assert.deepStrictEqual(
      icons({ first: 1, last: 1 }, { first: 1, last: 1 }),
      [["cat", 1, 1]]
    );
  });

  it("leaves lines between Findings bare", () => {
    assert.deepStrictEqual(
      icons({ first: 0, last: 1 }, { first: 5, last: 5 }),
      [
        ["cat", 0, 0],
        ["bar", 1, 1],
        ["cat", 5, 5],
      ]
    );
  });

  it("shows nothing for no Findings", () => {
    assert.deepStrictEqual(icons(), []);
  });

  // A line-by-line walk would never finish over a trillion lines.
  it("works by span, whatever the number of lines the Findings cover", () => {
    const result = icons(
      { first: 0, last: 1e12 },
      { first: 5e11, last: 5e11 },
      { first: 7e11, last: 9e11 }
    );

    assert.deepStrictEqual(result, [
      ["cat", 0, 0],
      ["bar", 1, 5e11 - 1],
      ["cat", 5e11, 5e11],
      ["bar", 5e11 + 1, 7e11 - 1],
      ["cat", 7e11, 7e11],
      ["bar", 7e11 + 1, 1e12],
    ]);
  });
});
