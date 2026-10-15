import * as assert from "assert";
import { authoredStateLook, authoredStates } from "../../src/authoredStates";
import type { LatestReview, PullRequestSummary } from "../../src/github/client";

const head = "a".repeat(40);
const older = "b".repeat(40);

function pr(fields: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    repository: "acme/api",
    number: 1,
    title: "Mine",
    url: "https://github.com/acme/api/pull/1",
    updatedAt: "2026-10-01T00:00:00Z",
    author: { login: "reviewer", avatarUrl: "" },
    headRefName: "feature",
    headSha: head,
    baseRefName: "main",
    isDraft: false,
    mergeable: "mergeable",
    latestReviews: [],
    ...fields,
  };
}

function review(
  author: string,
  verdict: LatestReview["verdict"],
  commit = head
): LatestReview {
  return { author, verdict, commit };
}

describe("The states of a pull request the Reviewer authored", () => {
  it("has none while it waits for review", () => {
    assert.deepStrictEqual(authoredStates(pr()), []);
  });

  it("has failed checks when its checks failed, and only then", () => {
    assert.deepStrictEqual(authoredStates(pr({ checks: "failed" })), [
      "checksFailed",
    ]);
    assert.deepStrictEqual(authoredStates(pr({ checks: "running" })), []);
  });

  it("has merge conflicts when GitHub says it conflicts with its base", () => {
    assert.deepStrictEqual(authoredStates(pr({ mergeable: "conflicting" })), [
      "mergeConflicts",
    ]);
  });

  it("has changes requested when some reviewer's latest review requests them", () => {
    assert.deepStrictEqual(
      authoredStates(
        pr({ latestReviews: [review("alice", "changesRequested", older)] })
      ),
      ["changesRequested"]
    );
  });

  it("has a comment only from a comment-only review at the current head", () => {
    assert.deepStrictEqual(
      authoredStates(pr({ latestReviews: [review("alice", "commented")] })),
      ["commented"]
    );
    assert.deepStrictEqual(
      authoredStates(
        pr({ latestReviews: [review("alice", "commented", older)] })
      ),
      []
    );
  });

  it("leaves out the author's own reviews", () => {
    assert.deepStrictEqual(
      authoredStates(
        pr({
          latestReviews: [
            review("Reviewer", "commented"),
            review("reviewer", "approved"),
          ],
        })
      ),
      []
    );
  });

  it("is ready to merge when approved, with checks passed or none, and no conflicts", () => {
    assert.deepStrictEqual(
      authoredStates(pr({ reviewDecision: "approved", checks: "passed" })),
      ["readyToMerge"]
    );
    assert.deepStrictEqual(authoredStates(pr({ reviewDecision: "approved" })), [
      "readyToMerge",
    ]);
  });

  it("without a review decision, is ready to merge on an approval and no request for changes", () => {
    assert.deepStrictEqual(
      authoredStates(pr({ latestReviews: [review("alice", "approved")] })),
      ["readyToMerge"]
    );
    assert.deepStrictEqual(
      authoredStates(
        pr({
          latestReviews: [
            review("alice", "approved"),
            review("bob", "changesRequested"),
          ],
        })
      ),
      ["changesRequested"]
    );
  });

  it("isn't ready to merge while a review is required, or after a dismissal alone", () => {
    assert.deepStrictEqual(
      authoredStates(
        pr({
          reviewDecision: "reviewRequired",
          latestReviews: [review("alice", "approved")],
        })
      ),
      []
    );
    assert.deepStrictEqual(
      authoredStates(pr({ latestReviews: [review("alice", "dismissed")] })),
      []
    );
  });

  it("isn't ready to merge as a draft, with checks running, or with mergeability unknown", () => {
    const approved = { reviewDecision: "approved" } as const;
    for (const fields of [
      { isDraft: true },
      { checks: "running" },
      { mergeable: "unknown" },
    ] as const)
      assert.deepStrictEqual(
        authoredStates(pr({ ...approved, ...fields })),
        [],
        JSON.stringify(fields)
      );
  });

  it("lists every state that applies, in the order the icon picks one", () => {
    assert.deepStrictEqual(
      authoredStates(
        pr({
          checks: "failed",
          mergeable: "conflicting",
          latestReviews: [
            review("alice", "commented"),
            review("bob", "changesRequested"),
          ],
        })
      ),
      ["checksFailed", "mergeConflicts", "changesRequested", "commented"]
    );
    assert.deepStrictEqual(
      authoredStates(
        pr({
          reviewDecision: "approved",
          latestReviews: [
            review("alice", "approved"),
            review("bob", "commented"),
          ],
        })
      ),
      ["commented", "readyToMerge"]
    );
  });
});

describe("How a state looks on the Reviewer's own pull request", () => {
  it("names the reviewers who requested changes or commented", () => {
    const mine = pr({
      latestReviews: [
        review("alice", "changesRequested"),
        review("bob", "commented"),
        review("carol", "commented", older),
        review("dave", "changesRequested"),
      ],
    });
    assert.strictEqual(
      authoredStateLook("changesRequested", mine).tooltip,
      "Changes requested by alice, dave"
    );
    assert.strictEqual(
      authoredStateLook("commented", mine).tooltip,
      "Commented on the latest commit by bob"
    );
  });

  it("gives each state its own icon and colour", () => {
    const looks = (
      [
        "checksFailed",
        "mergeConflicts",
        "changesRequested",
        "commented",
        "readyToMerge",
      ] as const
    ).map((state) => authoredStateLook(state, pr()));
    assert.strictEqual(new Set(looks.map((l) => l.icon)).size, looks.length);
    assert.deepStrictEqual(
      looks.map((l) => l.description),
      [
        "checks failed",
        "merge conflicts",
        "changes requested",
        "commented",
        "ready to merge",
      ]
    );
  });
});
