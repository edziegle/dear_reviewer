import * as assert from "assert";
import { MAX_NODE_LIMIT, worstCaseNodeCount } from "../fakeGitHub";

// The teams lookup once asked every organization the viewer is in for every
// team, with every member of each (see #221): the shape that made GitHub
// answer MAX_NODE_LIMIT_EXCEEDED for every user, whatever their token's
// scopes or organizations. These cases pin that regression to the fake's
// own GitHub-node-counting algorithm, and confirm the fix's queries stay
// well under the limit it enforces.
describe("worstCaseNodeCount", () => {
  it("exceeds GitHub's limit for the teams lookup's shape before #221's fix", () => {
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
      "the old shape must exceed the limit, or this fake wouldn't have caught #221"
    );
  });

  it("stays under the limit for one organization's teams and their ancestors, without members", () => {
    const query = `query OrganizationTeams($organization: String!, $login: String!) {
      organization(login: $organization) {
        teams(first: 100, userLogins: [$login]) {
          nodes {
            slug
            ancestors(first: 10) { nodes { slug } }
          }
        }
      }
    }`;

    assert.ok(worstCaseNodeCount(query) < MAX_NODE_LIMIT);
  });

  it("stays under the limit for a page of one team's members", () => {
    const query = `query TeamMembers($organization: String!, $slug: String!, $after: String) {
      organization(login: $organization) {
        team(slug: $slug) {
          members(first: 100, after: $after) { nodes { login } pageInfo { hasNextPage endCursor } }
        }
      }
    }`;

    assert.ok(worstCaseNodeCount(query) < MAX_NODE_LIMIT);
  });
});
