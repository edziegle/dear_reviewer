import * as assert from "assert";
import {
  byLongestWait,
  dashboardFacts,
  nextStep,
  waitedFor,
  type InProgress,
  type Waiting,
} from "../../src/dashboard/dashboardState";
import { requestedOfReviewerAt } from "../../src/github/reviewRequests";

const now = Date.parse("2026-10-15T12:00:00Z");
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
const hour = 60;
const day = 24 * hour;

function inProgress(fields: Partial<InProgress> = {}): InProgress {
  return {
    id: "api-7",
    name: "acme/api #7",
    reviewed: false,
    pending: 0,
    viewed: 3,
    total: 12,
    finish: "Submit Review…",
    ...fields,
  };
}

function waiting(fields: Partial<Waiting> = {}): Waiting {
  return {
    id: "web-9",
    name: "acme/web #9",
    since: ago(2 * day),
    open: false,
    ...fields,
  };
}

describe("How long a pull request has waited", () => {
  it("is in the largest whole unit", () => {
    assert.deepStrictEqual(
      [
        ago(0.5),
        ago(1),
        ago(40),
        ago(hour),
        ago(5 * hour + 59),
        ago(day),
        ago(6 * day + 23 * hour),
      ].map((since) => waitedFor(since, now)),
      [
        "under a minute",
        "1 minute",
        "40 minutes",
        "1 hour",
        "5 hours",
        "1 day",
        "6 days",
      ]
    );
  });

  it("is under a minute for a time in the future, as from a clock that runs ahead", () => {
    assert.strictEqual(waitedFor(ago(-5), now), "under a minute");
  });
});

describe("The order pull requests wait on the Reviewer in", () => {
  it("puts the one that has waited longest first, whatever repository it is in", () => {
    const listed = [
      waiting({ id: "api-1", since: ago(hour) }),
      waiting({ id: "web-2", since: ago(6 * day) }),
      waiting({ id: "api-3", since: ago(2 * day) }),
    ];
    assert.deepStrictEqual(
      byLongestWait(listed).map((w) => w.id),
      ["web-2", "api-3", "api-1"]
    );
  });
});

describe("The Dashboard's facts line", () => {
  it("counts the pull requests waiting, with the oldest's wait", () => {
    assert.strictEqual(
      dashboardFacts([{ since: ago(hour) }, { since: ago(6 * day) }], now),
      "2 waiting on you · oldest 6 days"
    );
  });

  it("says when nothing is waiting", () => {
    assert.strictEqual(dashboardFacts([], now), "Nothing waiting on you");
  });

  it("is nothing while the Dashboard can't tell what's waiting", () => {
    assert.strictEqual(dashboardFacts(undefined, now), undefined);
  });
});

describe("The Dashboard's next step", () => {
  it("resumes the Change shown last that still needs the Reviewer", () => {
    assert.deepStrictEqual(
      nextStep(
        [
          inProgress({ id: "older", name: "acme/api #1" }),
          inProgress({ pending: 2 }),
        ],
        [waiting()],
        now
      ),
      {
        kind: "resume",
        id: "api-7",
        label: "Resume acme/api #7",
        place:
          "You were last in acme/api #7 · 3 of 12 viewed · 2 pending Comments",
      }
    );
  });

  it("finishes the Review once every file is viewed", () => {
    assert.deepStrictEqual(
      nextStep([inProgress({ viewed: 12, pending: 1 })], [], now),
      {
        kind: "finish",
        id: "api-7",
        label: "Submit Review…",
        place: "You've viewed every file of acme/api #7 · 1 pending Comment",
      }
    );
    assert.strictEqual(
      nextStep(
        [inProgress({ name: "fix-retry", viewed: 12, finish: "Write Brief…" })],
        [],
        now
      )?.label,
      "Write Brief…"
    );
  });

  it("passes over a Change whose last Review covers its head, with nothing pending", () => {
    assert.strictEqual(
      nextStep(
        [inProgress({ id: "earlier" }), inProgress({ reviewed: true })],
        [],
        now
      )?.id,
      "earlier"
    );
    assert.strictEqual(
      nextStep([inProgress({ reviewed: true, pending: 1 })], [], now)?.kind,
      "resume"
    );
  });

  it("leaves out how many files are viewed while that's unknown", () => {
    assert.deepStrictEqual(
      nextStep([inProgress({ viewed: undefined, total: 2 })], [], now),
      {
        kind: "resume",
        id: "api-7",
        label: "Resume acme/api #7",
        place: "You were last in acme/api #7",
      }
    );
  });

  it("passes over a Change with no files to review", () => {
    assert.strictEqual(
      nextStep(
        [
          inProgress({ id: "earlier" }),
          inProgress({ id: "main", viewed: 0, total: 0 }),
        ],
        [],
        now
      )?.id,
      "earlier"
    );
    assert.strictEqual(
      nextStep([inProgress({ viewed: 0, total: 0 })], [], now),
      undefined
    );
  });

  it("is the pull request that has waited longest when nothing is in progress", () => {
    assert.deepStrictEqual(
      nextStep(
        [inProgress({ reviewed: true })],
        [
          waiting({ id: "newer", since: ago(hour) }),
          waiting({ id: "opened", since: ago(9 * day), open: true }),
          waiting({ id: "oldest", name: "acme/web #3", since: ago(6 * day) }),
        ],
        now
      ),
      {
        kind: "open",
        id: "oldest",
        label: "Review acme/web #3",
        place: "acme/web #3 has waited longest on you: 6 days",
      }
    );
  });

  it("is nothing when nothing needs the Reviewer", () => {
    assert.strictEqual(nextStep([], [waiting({ open: true })], now), undefined);
  });
});

describe("When a pull request last asked the Reviewer for a review", () => {
  const me = { kind: "user", login: "reviewer" } as const;
  const team = { kind: "team" } as const;

  it("is the latest request of them personally, made again or not", () => {
    assert.strictEqual(
      requestedOfReviewerAt(
        [
          { createdAt: "2026-10-01T09:00:00Z", reviewer: me },
          {
            createdAt: "2026-10-03T09:00:00Z",
            reviewer: { kind: "user", login: "bob" },
          },
          {
            createdAt: "2026-10-02T09:00:00Z",
            reviewer: { kind: "user", login: "Reviewer" },
          },
          { createdAt: "2026-10-04T09:00:00Z", reviewer: team },
        ],
        "reviewer"
      ),
      "2026-10-02T09:00:00Z"
    );
  });

  it("is the latest Team request when none asked them personally", () => {
    assert.strictEqual(
      requestedOfReviewerAt(
        [
          { createdAt: "2026-10-01T09:00:00Z", reviewer: team },
          { createdAt: "2026-10-05T09:00:00Z", reviewer: team },
          { createdAt: "2026-10-06T09:00:00Z" },
        ],
        "reviewer"
      ),
      "2026-10-05T09:00:00Z"
    );
  });

  it("is unknown when no request is listed", () => {
    assert.strictEqual(requestedOfReviewerAt([], "reviewer"), undefined);
  });
});
