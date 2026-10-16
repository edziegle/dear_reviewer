import * as assert from "assert";
import * as vscode from "vscode";
import { renderedDashboard, showDashboard } from "../dashboard";
import {
  configure,
  refreshInbox,
  serveGitHub,
  setToken,
  type FakePullRequest,
} from "../github";
import { eventually } from "../reviewer";

const viewer = { login: "reviewer", token: "test-token" };
const settingKeys = ["githubApiUrl", "repositories", "localClones"];
const owners = "acme/api-owners";
const at = (day: number) => `2026-10-${String(day).padStart(2, "0")}T09:00:00Z`;

const waitingOnTeam: FakePullRequest = {
  repository: "acme/teams",
  number: 71,
  title: "Asked of the team",
  author: "alice",
  reviewRequestedTeams: [owners],
  reviewRequestedAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
};
const waitingOnMe: FakePullRequest = {
  repository: "acme/teams",
  number: 72,
  title: "Asked of me and the team",
  author: "bob",
  reviewRequested: ["reviewer"],
  reviewRequestedTeams: [owners],
  reviewRequestedAt: new Date(Date.now() - 5 * 60 * 60_000).toISOString(),
};
const answered: FakePullRequest = {
  repository: "acme/teams",
  number: 73,
  title: "Approved by a teammate",
  author: "carol",
  requestHistory: [{ type: "requested", team: owners, at: at(1) }],
  reviews: [
    {
      id: "r1",
      author: "octocat",
      state: "APPROVED",
      submittedAt: at(2),
      threads: [],
    },
  ],
};

// Team requests (see GLOSSARY.md) on the Dashboard: a pending one names its
// team in Waiting on you, and one a teammate answered is listed apart, for no
// one waits on the Reviewer for it.
//
// This file is named to run before ignoredAcrossReload.test.ts: the Inbox
// forgets what the Reviewer ignored once a pull request leaves it, which
// listing other repositories here does to the one that test leaves ignored.
describe("Dashboard: Team requests", () => {
  const found = new Map<string, unknown>();

  before(async () => {
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      found.set(key, config.inspect(key)?.globalValue);
    await configure({ repositories: ["acme/teams"] });
    await setToken(viewer.token);
    await serveGitHub({
      viewer,
      teams: [
        { org: "acme", slug: "api-owners", members: ["octocat"] },
        {
          org: "acme",
          slug: "api-core",
          parent: "api-owners",
          members: ["reviewer"],
        },
      ],
      pullRequests: [waitingOnTeam, waitingOnMe, answered].map((p) =>
        structuredClone(p)
      ),
    });
    await refreshInbox();
    await showDashboard();
  });

  after(async () => {
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      await config.update(
        key,
        found.get(key),
        vscode.ConfigurationTarget.Global
      );
  });

  it("names the team of a pending Team request in Waiting on you, and none for one that asks the Reviewer too", async () => {
    await eventually(async () => {
      const dashboard = await renderedDashboard();
      assert.deepStrictEqual(
        dashboard.waiting?.map((w) => [w.name, w.notes]),
        [
          ["acme/teams #72", []],
          ["acme/teams #71", ["via @acme/api-owners"]],
        ]
      );
    });
  });

  it("lists a pull request a teammate reviewed apart from Waiting on you, with who reviewed, how, and the team, and leaves it out of the count", async () => {
    await eventually(async () => {
      const dashboard = await renderedDashboard();
      assert.deepStrictEqual(
        dashboard.teamReviewed?.map((w) => [w.name, w.notes]),
        [["acme/teams #73", ["Approved by @octocat", "via @acme/api-owners"]]]
      );
      assert.ok(
        dashboard.facts?.startsWith("2 waiting on you"),
        `facts: ${dashboard.facts}`
      );
    });
  });
});
