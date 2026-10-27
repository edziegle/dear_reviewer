// The GraphQL queries that read the Reviewer's teams. They sit apart from the
// client so a unit test can weigh what the client sends without loading
// `vscode`, which the client reaches through `GitHubAuth`.

const TEAM_MEMBERS_FIELDS = `members(first: 100) { nodes { login } pageInfo { hasNextPage endCursor } }`;

/**
 * The teams the viewer is on in one organization, the teams above them, and
 * the first page of each team's members.
 *
 * Asking one organization at a time is what keeps this under GitHub's limit
 * of 500,000 nodes: its worst case is about 111,000. Wrapping the same
 * selection in `organizations(first: 100)` multiplied that by a hundred and
 * GitHub refused the query outright (#221).
 */
export const ORGANIZATION_TEAMS = `query OrganizationTeams($organization: String!, $login: String!) {
  organization(login: $organization) {
    teams(first: 100, userLogins: [$login]) {
      nodes {
        slug
        ${TEAM_MEMBERS_FIELDS}
        ancestors(first: 10) { nodes { slug ${TEAM_MEMBERS_FIELDS} } }
      }
    }
  }
}`;

/** The members after the first page, for a team of more than a hundred. */
export const TEAM_MEMBERS = `query TeamMembers($organization: String!, $slug: String!, $after: String) {
  organization(login: $organization) {
    team(slug: $slug) {
      members(first: 100, after: $after) { nodes { login } pageInfo { hasNextPage endCursor } }
    }
  }
}`;
