import * as assert from "assert";
import { reviewStanding } from "../../src/reviewStanding";

// The times are local, as the Reviewer's clock shows them, and their
// wording follows Node's locale, so the checks leave the format open.
describe("How the overview's standing line opens with the last Review", () => {
  const now = new Date(2026, 9, 14, 18, 5);
  const today = new Date(2026, 9, 14, 14, 32).toISOString();
  const earlier = new Date(2026, 9, 3, 9, 41).toISOString();
  const review = { commit: "abc1234" };

  it("names each verdict", () => {
    assert.deepStrictEqual(
      (["approved", "changesRequested", "commented"] as const).map((verdict) =>
        reviewStanding({ ...review, verdict }, now)
      ),
      [
        { verdict: "approved", text: "You approved" },
        { verdict: "changesRequested", text: "You requested changes" },
        { verdict: "commented", text: "You commented" },
      ]
    );
  });

  it("has no standing for a dismissed Review, or one without a verdict", () => {
    assert.strictEqual(
      reviewStanding({ ...review, verdict: "dismissed" }, now),
      undefined
    );
    assert.strictEqual(reviewStanding(review, now), undefined);
  });

  it("gives only the time of a Review submitted today", () => {
    const standing = reviewStanding(
      { ...review, verdict: "approved", submittedAt: today },
      now
    );
    assert.match(standing?.text ?? "", /^You approved at \D*\d{1,2}\D32\b/);
    assert.doesNotMatch(standing?.text ?? "", /2026/);
  });

  it("gives the date of a Review submitted before today", () => {
    const standing = reviewStanding(
      { ...review, verdict: "changesRequested", submittedAt: earlier },
      now
    );
    assert.match(
      standing?.text ?? "",
      /^You requested changes on .*2026.*\b41\b/
    );
  });

  it("leaves out a time GitHub gave that isn't one", () => {
    assert.strictEqual(
      reviewStanding(
        { ...review, verdict: "commented", submittedAt: "not a time" },
        now
      )?.text,
      "You commented"
    );
  });

  it("counts the Comments the Review published", () => {
    assert.deepStrictEqual(
      [1, 3].map(
        (comments) =>
          reviewStanding({ ...review, verdict: "approved", comments }, now)
            ?.text
      ),
      [
        "You approved · 1 Comment published",
        "You approved · 3 Comments published",
      ]
    );
  });
});
