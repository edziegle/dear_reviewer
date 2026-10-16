import * as assert from "assert";
import {
  firstLineOf,
  isVerdict,
  refusalOf,
  summaryNeeded,
  verdictsFor,
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

describe("The verdicts a pull request takes", () => {
  it("offers all three on someone else's pull request", () => {
    assert.deepStrictEqual(verdictsFor(false), [
      "comment",
      "approve",
      "requestChanges",
    ]);
  });

  it("offers only Comment on the Reviewer's own, as GitHub takes no other", () => {
    assert.deepStrictEqual(verdictsFor(true), ["comment"]);
  });
});

describe("Why GitHub didn't take a Review, in plain words", () => {
  it("says a verdict on your own pull request can only be a comment", () => {
    assert.match(
      refusalOf("Review Can not approve your own pull request").text,
      /^GitHub takes only a comment on your own pull request/
    );
    assert.match(
      refusalOf("Can not request changes on your own pull request").text,
      /^GitHub takes only a comment/
    );
  });

  it("asks for a summary when GitHub wants one", () => {
    assert.match(refusalOf("Review body is required").text, /^Write a summary/);
  });

  it("says the pending Review is gone when it was submitted or discarded elsewhere", () => {
    assert.match(
      refusalOf("Could not resolve to a node with the global id of 'PRR_1'")
        .text,
      /submitted or discarded elsewhere/
    );
  });

  it("says what is known of any other refusal, never GitHub's own words", () => {
    const { text } = refusalOf("Something odd: PRR_kwDO123");
    assert.strictEqual(
      text,
      "GitHub didn't take your Review. Your draft is kept. Submit again, or open the pull request on GitHub."
    );
    assert.ok(!text.includes("Something odd"));
  });

  it("keeps GitHub's own words as the detail, for a Reviewer who wants them", () => {
    assert.strictEqual(
      refusalOf("Something odd: PRR_kwDO123").detail,
      "Something odd: PRR_kwDO123"
    );
    assert.strictEqual(
      refusalOf("Review body is required").detail,
      "Review body is required"
    );
  });
});
