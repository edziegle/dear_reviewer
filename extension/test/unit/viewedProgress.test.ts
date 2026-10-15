import * as assert from "assert";
import { viewedProgress } from "../../src/viewedProgress";

describe("How far the Reviewer is through a Change's files, as its row shows it", () => {
  it("draws a bar of seven segments, then the count", () => {
    assert.deepStrictEqual(viewedProgress(3, 7), {
      text: "■■■□□□□ 3/7",
      label: "3 of 7 files viewed",
    });
  });

  it("leaves the bar empty while no file is viewed", () => {
    assert.strictEqual(viewedProgress(0, 7).text, "□□□□□□□ 0/7");
    assert.strictEqual(viewedProgress(0, 200).text, "□□□□□□□ 0/200");
  });

  it("fills the bar once every file is viewed", () => {
    assert.strictEqual(viewedProgress(7, 7).text, "■■■■■■■ 7/7");
    assert.strictEqual(viewedProgress(1, 1).text, "■■■■■■■ 1/1");
    assert.strictEqual(viewedProgress(200, 200).text, "■■■■■■■ 200/200");
  });

  it("fills a segment for any file viewed", () => {
    assert.strictEqual(viewedProgress(1, 200).text, "■□□□□□□ 1/200");
  });

  it("keeps a segment empty while any file isn't viewed", () => {
    assert.strictEqual(viewedProgress(199, 200).text, "■■■■■■□ 199/200");
  });

  it("fills the segments in proportion between", () => {
    assert.deepStrictEqual(
      [1, 2, 3].map((viewed) => viewedProgress(viewed, 4).text),
      ["■■□□□□□ 1/4", "■■■■□□□ 2/4", "■■■■■□□ 3/4"]
    );
  });

  it("leaves the bar empty for a Change of no files", () => {
    assert.deepStrictEqual(viewedProgress(0, 0), {
      text: "□□□□□□□ 0/0",
      label: "0 of 0 files viewed",
    });
  });

  it("says one file in the singular", () => {
    assert.strictEqual(viewedProgress(0, 1).label, "0 of 1 file viewed");
  });
});
