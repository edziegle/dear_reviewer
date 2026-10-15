import * as assert from "assert";
import { gutterIcons, type LineSpan } from "../../src/findingGutter";

describe("Which icon a Finding's lines show in the gutter", () => {
  const icons = (...spans: LineSpan[]) =>
    gutterIcons(spans).map(({ icon, first, last }) => [icon, first, last]);

  it("shows the plain lightbulb on a one-line Finding", () => {
    assert.deepStrictEqual(icons({ first: 4, last: 4 }), [["lightbulb", 4, 4]]);
  });

  it("shows the lightbulb with a bar on a long Finding's first line, and the bar on the rest", () => {
    assert.deepStrictEqual(icons({ first: 0, last: 9 }), [
      ["lightbulbWithBar", 0, 0],
      ["bar", 1, 9],
    ]);
  });

  it("starts each of two Findings on adjacent lines with its own lightbulb", () => {
    assert.deepStrictEqual(
      icons({ first: 3, last: 4 }, { first: 0, last: 2 }),
      [
        ["lightbulbWithBar", 0, 0],
        ["bar", 1, 2],
        ["lightbulbWithBar", 3, 3],
        ["bar", 4, 4],
      ]
    );
  });

  it("shows a one-line Finding right after a long one as the plain lightbulb", () => {
    assert.deepStrictEqual(
      icons({ first: 0, last: 1 }, { first: 2, last: 2 }),
      [
        ["lightbulbWithBar", 0, 0],
        ["bar", 1, 1],
        ["lightbulb", 2, 2],
      ]
    );
  });

  it("starts a Finding inside a longer one with a lightbulb that keeps the bar", () => {
    assert.deepStrictEqual(
      icons({ first: 0, last: 4 }, { first: 2, last: 2 }),
      [
        ["lightbulbWithBar", 0, 0],
        ["bar", 1, 1],
        ["lightbulbWithBar", 2, 2],
        ["bar", 3, 4],
      ]
    );
  });

  it("keeps the bar on the lightbulb where a one-line Finding sits on a longer one's last line", () => {
    assert.deepStrictEqual(
      icons({ first: 3, last: 3 }, { first: 0, last: 3 }),
      [
        ["lightbulbWithBar", 0, 0],
        ["bar", 1, 2],
        ["lightbulbWithBar", 3, 3],
      ]
    );
  });

  it("runs the bar on past a Finding that starts and ends inside a longer one", () => {
    assert.deepStrictEqual(
      icons({ first: 0, last: 9 }, { first: 2, last: 4 }),
      [
        ["lightbulbWithBar", 0, 0],
        ["bar", 1, 1],
        ["lightbulbWithBar", 2, 2],
        ["bar", 3, 9],
      ]
    );
  });

  it("shows one icon on a line where two Findings start", () => {
    assert.deepStrictEqual(
      icons({ first: 1, last: 1 }, { first: 1, last: 2 }),
      [
        ["lightbulbWithBar", 1, 1],
        ["bar", 2, 2],
      ]
    );
    assert.deepStrictEqual(
      icons({ first: 1, last: 1 }, { first: 1, last: 1 }),
      [["lightbulb", 1, 1]]
    );
  });

  it("leaves lines between Findings bare", () => {
    assert.deepStrictEqual(
      icons({ first: 0, last: 1 }, { first: 5, last: 5 }),
      [
        ["lightbulbWithBar", 0, 0],
        ["bar", 1, 1],
        ["lightbulb", 5, 5],
      ]
    );
  });

  it("shows nothing for no Findings", () => {
    assert.deepStrictEqual(icons(), []);
  });

  it("takes no longer for Findings over many lines than over a few", () => {
    const started = process.hrtime.bigint();
    const result = icons(
      { first: 0, last: 1e12 },
      { first: 5e11, last: 5e11 },
      { first: 7e11, last: 9e11 }
    );
    const ms = Number(process.hrtime.bigint() - started) / 1e6;

    assert.deepStrictEqual(result, [
      ["lightbulbWithBar", 0, 0],
      ["bar", 1, 5e11 - 1],
      ["lightbulbWithBar", 5e11, 5e11],
      ["bar", 5e11 + 1, 7e11 - 1],
      ["lightbulbWithBar", 7e11, 7e11],
      ["bar", 7e11 + 1, 1e12],
    ]);
    assert.ok(ms < 50, `took ${ms} ms`);
  });
});
