import * as assert from "assert";
import { MAX_NODE_LIMIT, worstCaseNodeCount } from "../fakeGitHub";
import { ORGANIZATION_TEAMS, TEAM_MEMBERS } from "../../src/github/queries";

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
});
