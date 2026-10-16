import * as assert from "assert";
import {
  firstLineOf,
  isVerdict,
  summaryNeeded,
  verdictOrder,
  verdicts,
} from "../../src/reviewSubmission";

describe("Submitting a Review from the overview", () => {
  it("offers Comment, Approve and Request Changes, in GitHub's order", () => {
    assert.deepStrictEqual(
      verdictOrder.map((verdict) => verdicts[verdict].label),
      ["Comment", "Approve", "Request Changes"]
    );
  });

  it("knows a verdict from anything else", () => {
    assert.ok(isVerdict("requestChanges"));
    assert.ok(!isVerdict("REQUEST_CHANGES"));
    assert.ok(!isVerdict(undefined));
  });

  it("needs a summary to comment or request changes without a Comment", () => {
    const needed = summaryNeeded(0);
    assert.deepStrictEqual(Object.keys(needed).sort(), [
      "comment",
      "requestChanges",
    ]);
    assert.match(needed.comment ?? "", /^Write a summary/);
  });

  it("takes any verdict without a summary once a Comment is pending", () => {
    assert.deepStrictEqual(summaryNeeded(2), {});
  });
});

describe("A pending Comment's line in the overview", () => {
  it("is the first line with words, as plain text", () => {
    assert.strictEqual(
      firstLineOf("\n  Rename this to `retries`.\nIt reads better."),
      "Rename this to `retries`."
    );
  });

  it("drops Markdown's heading, quote and list marks", () => {
    assert.strictEqual(firstLineOf("## Naming"), "Naming");
    assert.strictEqual(firstLineOf("> quoted"), "quoted");
    assert.strictEqual(firstLineOf("- one\n- two"), "one");
    assert.strictEqual(firstLineOf("1. first"), "first");
  });

  it("skips code blocks, and names a suggestion that has no words", () => {
    assert.strictEqual(
      firstLineOf("```suggestion\nretries = 3\n```"),
      "Suggested change"
    );
    assert.strictEqual(
      firstLineOf("```py\nx = 1\n```\nWhy not 2?"),
      "Why not 2?"
    );
    assert.strictEqual(firstLineOf("```py\nx = 1\n```"), "");
  });

  it("cuts a long line short with an ellipsis", () => {
    const line = firstLineOf("a".repeat(300));
    assert.strictEqual(line.length, 120);
    assert.ok(line.endsWith("…"));
  });
});
