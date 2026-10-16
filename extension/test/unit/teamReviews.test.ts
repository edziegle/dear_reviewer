import * as assert from "assert";
import {
  answeredByTeam,
  reviewedByLabel,
  requestedViaTeam,
  teamNotes,
  viaLabel,
  type MyTeam,
  type RequestChange,
  type SubmittedReview,
} from "../../src/github/teamReviews";

const owners: MyTeam = {
  name: "acme/api-owners",
  members: ["octocat", "hubot", "reviewer"],
};
const platform: MyTeam = {
  name: "acme/platform",
  members: ["mona", "reviewer"],
};
const asked = (
  team: string,
  at: string,
  kind: RequestChange["kind"] = "requested"
): RequestChange => ({ kind, at, reviewer: { kind: "team", team } });
const askedUser = (login: string, at: string): RequestChange => ({
  kind: "requested",
  at,
  reviewer: { kind: "user", login },
});
const review = (
  author: string,
  verdict: SubmittedReview["verdict"],
  at: string
): SubmittedReview => ({ author, verdict, at });

describe("The team a pending request came through", () => {
  const team = (name: string) => ({ kind: "team" as const, team: name });
  const user = (login: string) => ({ kind: "user" as const, login });

  it("is the team of the Team request, when the Reviewer is on it", () => {
    assert.strictEqual(
      requestedViaTeam(
        [team("acme/api-owners")],
        [owners, platform],
        "reviewer"
      ),
      "acme/api-owners"
    );
  });

  it("is none when the Reviewer was also asked personally", () => {
    assert.strictEqual(
      requestedViaTeam(
        [team("acme/api-owners"), user("Reviewer")],
        [owners],
        "reviewer"
      ),
      undefined
    );
  });

  it("is none for a team the Reviewer isn't on, and for a request to someone else", () => {
    assert.strictEqual(
      requestedViaTeam(
        [team("acme/docs"), user("octocat")],
        [owners],
        "reviewer"
      ),
      undefined
    );
  });

  it("names a parent team the Reviewer is on through a child team", () => {
    const parent: MyTeam = { name: "acme/eng", members: ["reviewer"] };
    assert.strictEqual(
      requestedViaTeam([team("acme/eng")], [owners, parent], "reviewer"),
      "acme/eng"
    );
  });

  it("matches teams and logins whatever their case", () => {
    assert.strictEqual(
      requestedViaTeam([team("Acme/API-Owners")], [owners], "reviewer"),
      "Acme/API-Owners"
    );
  });

  it("is none when nothing is pending", () => {
    assert.strictEqual(requestedViaTeam([], [owners], "reviewer"), undefined);
  });
});

describe("A Team request a teammate answered", () => {
  const answer = (over: Partial<Parameters<typeof answeredByTeam>[0]> = {}) =>
    answeredByTeam({
      changes: [asked("acme/api-owners", "2026-10-01T09:00:00Z")],
      pending: [],
      reviews: [review("octocat", "approved", "2026-10-02T09:00:00Z")],
      myTeams: [owners, platform],
      author: "alice",
      ...over,
    });

  it("gives the team, the teammate and their verdict", () => {
    assert.deepStrictEqual(answer(), {
      team: "acme/api-owners",
      reviewer: "octocat",
      verdict: "approved",
    });
  });

  it("gives the latest review by a member of the team", () => {
    assert.deepStrictEqual(
      answer({
        reviews: [
          review("octocat", "approved", "2026-10-02T09:00:00Z"),
          review("hubot", "changesRequested", "2026-10-03T09:00:00Z"),
          review("octocat", "commented", "2026-10-02T12:00:00Z"),
        ],
      }),
      {
        team: "acme/api-owners",
        reviewer: "hubot",
        verdict: "changesRequested",
      }
    );
  });

  it("isn't answered by a review from before the request, or from someone outside the team", () => {
    assert.strictEqual(
      answer({
        reviews: [
          review("octocat", "approved", "2026-09-30T09:00:00Z"),
          review("mona", "approved", "2026-10-02T09:00:00Z"),
        ],
      }),
      undefined
    );
  });

  it("isn't answered by the pull request's author, a dismissed review, or none", () => {
    assert.strictEqual(
      answer({
        author: "octocat",
        reviews: [
          review("octocat", "approved", "2026-10-02T09:00:00Z"),
          review("hubot", "dismissed", "2026-10-02T10:00:00Z"),
        ],
      }),
      undefined
    );
    assert.strictEqual(answer({ reviews: [] }), undefined);
  });

  it("isn't answered while the team is asked again", () => {
    assert.strictEqual(
      answer({
        pending: [{ kind: "team", team: "acme/api-owners" }],
      }),
      undefined
    );
  });

  it("only counts the review that followed the latest request", () => {
    assert.strictEqual(
      answer({
        changes: [
          asked("acme/api-owners", "2026-10-01T09:00:00Z"),
          asked("acme/api-owners", "2026-10-04T09:00:00Z"),
        ],
      }),
      undefined
    );
  });

  it("is none once GitHub took the team's request away, as its automatic assignment does, whoever reviews", () => {
    assert.strictEqual(
      answer({
        changes: [
          asked("acme/api-owners", "2026-10-01T09:00:00Z"),
          asked("acme/api-owners", "2026-10-01T09:00:05Z", "removed"),
          askedUser("octocat", "2026-10-01T09:00:05Z"),
        ],
      }),
      undefined
    );
  });

  it("is none for a team the Reviewer isn't on", () => {
    assert.strictEqual(
      answer({
        changes: [asked("acme/docs", "2026-10-01T09:00:00Z")],
        reviews: [review("octocat", "approved", "2026-10-02T09:00:00Z")],
      }),
      undefined
    );
  });

  it("is none when nobody asked a team", () => {
    assert.strictEqual(
      answer({ changes: [askedUser("reviewer", "2026-10-01T09:00:00Z")] }),
      undefined
    );
  });

  it("names the team whose answer came last, when the Reviewer is on several", () => {
    assert.deepStrictEqual(
      answer({
        changes: [
          asked("acme/api-owners", "2026-10-01T09:00:00Z"),
          asked("acme/platform", "2026-10-01T09:00:00Z"),
        ],
        reviews: [
          review("octocat", "approved", "2026-10-02T09:00:00Z"),
          review("mona", "commented", "2026-10-05T09:00:00Z"),
        ],
      }),
      { team: "acme/platform", reviewer: "mona", verdict: "commented" }
    );
  });
});

describe("What a row says of a Team request", () => {
  it("says who reviewed and how", () => {
    assert.strictEqual(
      reviewedByLabel({
        team: "x/y",
        reviewer: "octocat",
        verdict: "approved",
      }),
      "Approved by @octocat"
    );
    assert.strictEqual(
      reviewedByLabel({
        team: "x/y",
        reviewer: "octocat",
        verdict: "changesRequested",
      }),
      "Changes requested by @octocat"
    );
    assert.strictEqual(
      reviewedByLabel({
        team: "x/y",
        reviewer: "octocat",
        verdict: "commented",
      }),
      "Commented by @octocat"
    );
  });

  it("says which team was asked", () => {
    assert.strictEqual(viaLabel("acme/api-owners"), "via @acme/api-owners");
  });

  it("gives, for a row, who reviewed and the team, or the team of a pending request, or nothing", () => {
    assert.deepStrictEqual(
      teamNotes({
        reviewedByTeam: {
          team: "acme/api-owners",
          reviewer: "octocat",
          verdict: "approved",
        },
      }),
      ["Approved by @octocat", "via @acme/api-owners"]
    );
    assert.deepStrictEqual(teamNotes({ requestedViaTeam: "acme/docs" }), [
      "via @acme/docs",
    ]);
    assert.deepStrictEqual(teamNotes({}), []);
  });
});
