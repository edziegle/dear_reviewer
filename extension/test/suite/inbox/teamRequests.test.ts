import * as assert from "assert";
import {
  configure,
  inbox,
  markReviewed,
  refreshInbox,
  requestsToGitHub,
  serveGitHub,
  setToken,
  type FakePullRequest,
} from "../github";
import type { FakeGitHubState } from "../../fakeGitHub";

const viewer = { login: "reviewer", token: "test-token" };

// Teams: the Reviewer is on api-core, a child of api-owners, so a request to
// api-owners reaches them too. Octocat and hubot are on api-owners.
const teams: FakeGitHubState["teams"] = [
  { org: "acme", slug: "api-owners", members: ["octocat", "hubot"] },
  {
    org: "acme",
    slug: "api-core",
    parent: "api-owners",
    members: ["reviewer"],
  },
  { org: "acme", slug: "docs", members: ["mona"] },
];
const owners = "acme/api-owners";
const at = (day: number) => `2026-10-${String(day).padStart(2, "0")}T09:00:00Z`;
const review = (
  author: string,
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED",
  day: number
) => ({
  id: `${author}-${day}`,
  author,
  state,
  submittedAt: at(day),
  threads: [],
});
const pr = (
  number: number,
  title: string,
  more: Partial<FakePullRequest> = {}
): FakePullRequest => ({
  repository: "acme/api",
  number,
  title,
  author: "alice",
  updatedAt: at(30 - number),
  ...more,
});

const waitingOnTeam = pr(1, "Asked of the team", {
  reviewRequestedTeams: [owners],
});
const waitingOnBoth = pr(2, "Asked of the team and of me", {
  reviewRequested: ["reviewer"],
  reviewRequestedTeams: [owners],
});
const approved = pr(3, "Approved by a teammate", {
  requestHistory: [{ type: "requested", team: owners, at: at(1) }],
  reviews: [review("octocat", "APPROVED", 2)],
});
const changesRequested = pr(4, "Changes requested by a teammate", {
  requestHistory: [{ type: "requested", team: owners, at: at(1) }],
  reviews: [
    review("octocat", "APPROVED", 2),
    review("hubot", "CHANGES_REQUESTED", 3),
  ],
});
const mine = pr(5, "Mine", {
  author: "reviewer",
  requestHistory: [{ type: "requested", team: owners, at: at(1) }],
  reviews: [review("octocat", "APPROVED", 2)],
});
const iReviewed = pr(6, "Reviewed by me too", {
  requestHistory: [{ type: "requested", team: owners, at: at(1) }],
  reviews: [
    review("octocat", "APPROVED", 2),
    review("reviewer", "COMMENTED", 3),
  ],
});
const reassigned = pr(7, "Reassigned by GitHub", {
  reviewRequested: ["octocat"],
  requestHistory: [
    { type: "requested", team: owners, at: at(1) },
    { type: "removed", team: owners, at: at(1) },
  ],
  reviews: [review("octocat", "APPROVED", 2)],
});
const otherTeam = pr(8, "Asked of another team", {
  requestHistory: [{ type: "requested", team: "acme/docs", at: at(1) }],
  reviews: [review("mona", "APPROVED", 2)],
});
const outsider = pr(9, "Reviewed by someone outside the team", {
  requestHistory: [{ type: "requested", team: owners, at: at(1) }],
  reviews: [review("mona", "APPROVED", 2)],
});

const labels = (group?: { entries: { label: string }[] }) =>
  group?.entries.map((e) => e.label);

describe("Inbox: Team requests", () => {
  async function serve(
    pullRequests: FakePullRequest[],
    teamsToServe = teams
  ): Promise<void> {
    await serveGitHub({
      viewer,
      teams: teamsToServe,
      pullRequests: pullRequests.map((p) => structuredClone(p)),
    });
    await refreshInbox();
  }

  before(async () => {
    await configure({ repositories: ["acme/api"] });
    await setToken(viewer.token);
  });

  const everything = [
    waitingOnTeam,
    waitingOnBoth,
    approved,
    changesRequested,
    mine,
    iReviewed,
    reassigned,
    otherTeam,
    outsider,
  ];

  it("marks a pull request awaiting me through a Team request with its team, and one also asked of me with none", async () => {
    await serve(everything);

    const awaiting = (await inbox()).find(
      (g) => g.label === "Awaiting my review"
    );

    assert.deepStrictEqual(
      awaiting?.entries.map(({ label, description }) => ({
        label,
        description,
      })),
      [
        {
          label: "Asked of the team",
          description: "acme/api #1 · via @acme/api-owners",
        },
        { label: "Asked of the team and of me", description: "acme/api #2" },
      ]
    );
  });

  it("lists, in Reviewed by my team, pull requests whose Team request a teammate answered, with who reviewed, how, and the team", async () => {
    await serve(everything);

    const group = (await inbox()).find(
      (g) => g.label === "Reviewed by my team"
    );

    assert.deepStrictEqual(
      group?.entries.map(({ label, description }) => ({ label, description })),
      [
        {
          label: "Approved by a teammate",
          description:
            "acme/api #3 · Approved by @octocat · via @acme/api-owners",
        },
        {
          label: "Changes requested by a teammate",
          description:
            "acme/api #4 · Changes requested by @hubot · via @acme/api-owners",
        },
      ]
    );
  });

  it("leaves out pull requests I authored or reviewed, ones GitHub reassigned to named members, another team's, and a review by someone outside the team", async () => {
    await serve(everything);

    const groups = await inbox();

    const team = labels(groups.find((g) => g.label === "Reviewed by my team"));
    for (const left of [mine, iReviewed, reassigned, otherTeam, outsider])
      assert.ok(!team?.includes(left.title), `${left.title} is not in it`);
    assert.deepStrictEqual(
      labels(groups.find((g) => g.label === "Authored by me")),
      ["Mine"]
    );
    assert.deepStrictEqual(
      labels(groups.find((g) => g.label === "Reviewed by me")),
      ["Reviewed by me too"]
    );
  });

  it("has no such group while no Team request was answered, nor when the Reviewer is on no team", async () => {
    await serve([waitingOnTeam]);
    assert.deepStrictEqual(
      (await inbox()).map((g) => g.label),
      ["Awaiting my review", "Authored by me", "Reviewed by me"]
    );

    await serve([approved], []);
    assert.deepStrictEqual(
      (await inbox()).map((g) => g.label),
      ["Awaiting my review", "Authored by me", "Reviewed by me"]
    );
  });

  it("reads a teammate's review that came since the last refresh, with nothing remembered", async () => {
    await serve([{ ...approved, reviews: [] }]);
    assert.strictEqual(
      (await inbox()).find((g) => g.label === "Reviewed by my team"),
      undefined
    );

    // The review was made while VSCodium was closed, as far as it knows.
    await serve([approved]);

    assert.deepStrictEqual(
      labels((await inbox()).find((g) => g.label === "Reviewed by my team")),
      ["Approved by a teammate"]
    );
  });

  it("moves a pull request to Reviewed by me once I review it, while search still lacks my review", async () => {
    await serve([approved]);

    await markReviewed(approved);

    const groups = await inbox();
    assert.strictEqual(
      groups.find((g) => g.label === "Reviewed by my team"),
      undefined
    );
    assert.deepStrictEqual(
      labels(groups.find((g) => g.label === "Reviewed by me")),
      ["Approved by a teammate"]
    );
    // A later load must not bring it back while search lags.
    await refreshInbox();
    assert.strictEqual(
      (await inbox()).find((g) => g.label === "Reviewed by my team"),
      undefined
    );
  });

  it("knows the members of a team of more than a hundred", async () => {
    const crowd = Array.from({ length: 150 }, (_, i) => `member${i}`);
    await serve(
      [
        pr(1, "Reviewed by the hundred and fortieth member", {
          requestHistory: [
            { type: "requested", team: "acme/crowd", at: at(1) },
          ],
          reviews: [review("member140", "APPROVED", 2)],
        }),
      ],
      [{ org: "acme", slug: "crowd", members: ["reviewer", ...crowd] }]
    );

    const group = (await inbox()).find(
      (g) => g.label === "Reviewed by my team"
    );

    assert.deepStrictEqual(
      group?.entries.map((e) => e.description),
      ["acme/api #1 · Approved by @member140 · via @acme/crowd"]
    );
  });

  it("still lists the Inbox when GitHub won't say which teams I'm on, as for a token without read:org", async () => {
    await serveGitHub({
      viewer,
      teams,
      failQueries: ["OrganizationTeams"],
      pullRequests: [structuredClone(waitingOnTeam), structuredClone(approved)],
    });
    await refreshInbox();

    const groups = await inbox();

    assert.deepStrictEqual(
      groups.map((g) => g.label),
      ["Awaiting my review", "Authored by me", "Reviewed by me"]
    );
    assert.deepStrictEqual(
      groups[0].entries.map((e) => e.description),
      ["acme/api #1"],
      "without its team, the request names none"
    );
  });

  it("still finds Team requests from an organization whose teams lookup succeeds when another's fails", async () => {
    const elsewhere = pr(10, "Approved by a teammate elsewhere", {
      repository: "other/svc",
      requestHistory: [{ type: "requested", team: "other/core", at: at(1) }],
      reviews: [review("dana", "APPROVED", 2)],
    });
    try {
      await serveGitHub({
        viewer,
        teams: [
          ...teams,
          { org: "other", slug: "core", members: ["reviewer", "dana"] },
        ],
        teamsLookupFailsFor: ["acme"],
        pullRequests: [structuredClone(elsewhere)],
      });
      await configure({ repositories: ["acme/api", "other/svc"] });
      await refreshInbox();

      const group = (await inbox()).find(
        (g) => g.label === "Reviewed by my team"
      );
      assert.deepStrictEqual(
        group?.entries.map((e) => e.description),
        ["other/svc #10 · Approved by @dana · via @other/core"]
      );
    } finally {
      await configure({ repositories: ["acme/api"] });
    }
  });

  it("asks once per organization and nothing more for teams of under a hundred", async () => {
    await serve([approved]);

    const operations = (await requestsToGitHub()).flatMap((r) => {
      const query = (r.body as { query?: string } | undefined)?.query ?? "";
      return /^\s*query\s+(\w+)/.exec(query)?.[1] ?? [];
    });

    assert.deepStrictEqual(
      operations.filter((o) => o === "OrganizationTeams").length,
      1,
      `one lookup for acme, the only owner: ${JSON.stringify(operations)}`
    );
    assert.deepStrictEqual(
      operations.filter((o) => o === "TeamMembers"),
      [],
      "the teams query carries the members of a team of under a hundred"
    );
  });

  it("keeps the Team requests of an organization alongside a repository whose owner is no organization", async () => {
    const personal = pr(11, "In my own repository", {
      repository: "reviewer/scratch",
      author: "reviewer",
    });
    try {
      await serveGitHub({
        viewer,
        teams,
        notOrganizations: ["reviewer"],
        pullRequests: [structuredClone(approved), structuredClone(personal)],
      });
      await configure({ repositories: ["acme/api", "reviewer/scratch"] });
      await refreshInbox();

      const groups = await inbox();
      assert.deepStrictEqual(
        labels(groups.find((g) => g.label === "Reviewed by my team")),
        ["Approved by a teammate"]
      );
      assert.deepStrictEqual(
        labels(groups.find((g) => g.label === "Authored by me")),
        ["In my own repository"]
      );
    } finally {
      await configure({ repositories: ["acme/api"] });
    }
  });

  it("reads review history only for open pull requests outside the other groups, and only when I'm on a team", async () => {
    await serve([approved], []);
    const without = JSON.stringify(await requestsToGitHub());
    assert.ok(
      !without.includes("-reviewed-by:@me -review-requested:@me"),
      "no search for pull requests answered by a team when I'm on none"
    );

    await serve([approved]);
    const searches = (await requestsToGitHub())
      .flatMap((r) =>
        Object.values(
          (r.body as { variables?: Record<string, unknown> } | undefined)
            ?.variables ?? {}
        )
      )
      .filter((v): v is string => typeof v === "string");
    assert.ok(
      searches.includes(
        "is:pr is:open archived:false repo:acme/api -author:@me -reviewed-by:@me -review-requested:@me sort:updated-desc"
      ),
      JSON.stringify(searches)
    );
  });
});
