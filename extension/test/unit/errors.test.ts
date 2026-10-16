import * as assert from "assert";
import { reviewThreadsProblem } from "../../src/errors";

describe("The problem shown when review threads don't load", () => {
  it("says GitHub couldn't be reached when the network or host was", () => {
    const unreachable = new TypeError("fetch failed", {
      cause: { code: "ENOTFOUND" },
    });
    assert.strictEqual(
      reviewThreadsProblem("acme/api #12", unreachable),
      "Couldn't reach GitHub to load the review threads of acme/api #12. Check the connection, then retry."
    );
  });

  it("gives GitHub's reason when it was reached", () => {
    assert.strictEqual(
      reviewThreadsProblem("acme/api #12", new Error("ReviewThreads failed")),
      "Couldn't load the review threads of acme/api #12: ReviewThreads failed"
    );
  });
});
