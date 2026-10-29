import * as assert from "assert";
import { MAX_NODE_LIMIT, worstCaseNodeCount } from "../fakeGitHub";
import {
  inboxQuery,
  inboxSearches,
  ORGANIZATION_TEAMS,
  PULL_REQUEST_COMMITS,
  TEAM_MEMBERS,
} from "../../src/github/queries";

// GitHub weighs a query's worst case before running it and refuses one over
// 500,000 nodes. The fake does the same, so a query the client sends that is
// too big fails the tests rather than only the Reviewer's Inbox (#221).
describe("worstCaseNodeCount", () => {
  it("counts a connection inside a named fragment at every spread", () => {
    const query = `query Two($a: String!, $b: String!) {
      first: search(query: $a, type: ISSUE, first: 100) { nodes { ...Reviews } }
      second: search(query: $b, type: ISSUE, first: 100) { nodes { ...Reviews } }
    }
    fragment Reviews on PullRequest {
      latestReviews(first: 100) { nodes { state } }
    }`;

    // Two searches at 100 each, and the fragment's 100 reviews under each.
    assert.strictEqual(worstCaseNodeCount(query), 100 + 100 + 10_000 + 10_000);
  });

  it("counts the operation whether the fragments come after it or before it", () => {
    const operation = `query One($a: String!) {
      search(query: $a, type: ISSUE, first: 100) { nodes { ...Reviews } }
    }`;
    const fragment = `fragment Reviews on PullRequest {
      latestReviews(first: 100) { nodes { state } }
    }`;

    assert.strictEqual(
      worstCaseNodeCount(`${fragment}\n${operation}`),
      worstCaseNodeCount(`${operation}\n${fragment}`),
      "a fragment before the operation counts the same as one after it"
    );
    assert.strictEqual(worstCaseNodeCount(`${fragment}\n${operation}`), 10_100);
  });

  it("exceeds the limit for the teams lookup's shape before #221's fix", () => {
    // The query as it stood: every organization the Reviewer is in, every
    // team in each, and the members of each team and of its ancestors. The
    // code is gone, so this is the only copy of it left.
    const query = `query ViewerTeams($reviewer: String!) {
      viewer {
        login
        organizations(first: 100) {
          nodes {
            login
            teams(first: 100, userLogins: [$reviewer]) {
              nodes {
                slug
                members(first: 100) { nodes { login } pageInfo { hasNextPage endCursor } }
                ancestors(first: 10) {
                  nodes {
                    slug
                    members(first: 100) { nodes { login } pageInfo { hasNextPage endCursor } }
                  }
                }
              }
            }
          }
        }
      }
    }`;

    assert.ok(
      worstCaseNodeCount(query) > MAX_NODE_LIMIT,
      "the old shape must exceed the limit, or the fake wouldn't catch #221"
    );
  });

  it("stays under the limit for the teams query the client sends", () => {
    assert.ok(
      worstCaseNodeCount(ORGANIZATION_TEAMS) < MAX_NODE_LIMIT,
      `ORGANIZATION_TEAMS costs ${worstCaseNodeCount(ORGANIZATION_TEAMS)}`
    );
  });

  it("stays under the limit for the team members query the client sends", () => {
    assert.ok(
      worstCaseNodeCount(TEAM_MEMBERS) < MAX_NODE_LIMIT,
      `TEAM_MEMBERS costs ${worstCaseNodeCount(TEAM_MEMBERS)}`
    );
  });

  // The Inbox sends one query per repository (#223). What matters is that a
  // query's cost doesn't grow with how many repositories are listed, since
  // the Repositories setting takes as many as the Reviewer cares to name.
  it("stays under the limit for a page of a pull request's commits", () => {
    const cost = worstCaseNodeCount(PULL_REQUEST_COMMITS);
    assert.ok(cost < MAX_NODE_LIMIT / 3, `PULL_REQUEST_COMMITS costs ${cost}`);
  });

  it("stays under the limit for one repository's Inbox searches, with and without the review history", () => {
    for (const withTeam of [false, true]) {
      const cost = worstCaseNodeCount(
        inboxQuery(inboxSearches("acme/api", 0, withTeam))
      );
      assert.ok(
        cost < MAX_NODE_LIMIT / 3,
        `one repository costs ${cost} with withTeam=${withTeam}, leaving too little room under ${MAX_NODE_LIMIT}`
      );
    }
  });

  it("would exceed the limit with four repositories' searches gathered into one query, as before #223's fix", () => {
    const repositories = ["acme/api", "acme/web", "acme/ledger", "acme/infra"];
    const together = repositories.flatMap((repository, i) =>
      inboxSearches(repository, i, true)
    );

    assert.ok(
      worstCaseNodeCount(inboxQuery(together)) > MAX_NODE_LIMIT,
      `four repositories in one query cost ${worstCaseNodeCount(inboxQuery(together))}`
    );
    for (const [i, repository] of repositories.entries())
      assert.ok(
        worstCaseNodeCount(inboxQuery(inboxSearches(repository, i, true))) <
          MAX_NODE_LIMIT,
        `${repository} on its own must fit`
      );
  });

  it("costs the same for a repository's Inbox searches however many repositories are listed", () => {
    const costOf = (count: number) =>
      Array.from({ length: count }, (_, i) =>
        worstCaseNodeCount(inboxQuery(inboxSearches(`acme/r${i}`, i, true)))
      );

    assert.deepStrictEqual(costOf(20), costOf(1).concat(costOf(20).slice(1)));
    for (const cost of costOf(20))
      assert.ok(cost < MAX_NODE_LIMIT, `a repository costs ${cost}`);
  });
});
