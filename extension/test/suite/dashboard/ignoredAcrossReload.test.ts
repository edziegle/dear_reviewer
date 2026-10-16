import * as assert from "assert";
import { clickDashboard, renderedDashboard, showDashboard } from "../dashboard";
import {
  configure,
  refreshInbox,
  serveGitHub,
  setToken,
  type FakePullRequest,
} from "../github";
import { eventually } from "../reviewer";

const viewer = { login: "reviewer", token: "test-token" };

/** The pull requests waiting on the Reviewer; the launch after the reload is served the same ones. */
const waitingForReload: FakePullRequest[] = [
  {
    repository: "acme/reload",
    number: 61,
    title: "Cache the token",
    author: "bob",
    reviewRequested: ["reviewer"],
  },
  {
    repository: "acme/reload",
    number: 62,
    title: "Retry failed webhooks",
    author: "alice",
    reviewRequested: ["reviewer"],
  },
];

// Leaves a pull request ignored, for dashboard/afterReload to find after the
// window reloads and to put back.
describe("Dashboard: a pull request ignored before a reload", () => {
  // The settings stay for dashboard/afterReload, which clears them: putting
  // them back here would take the repository out of the Inbox, which forgets
  // the pull request that was ignored.
  before(async () => {
    await configure({ repositories: ["acme/reload"] });
    await setToken(viewer.token);
    await serveGitHub({
      viewer,
      pullRequests: waitingForReload.map((p) => structuredClone(p)),
    });
    await refreshInbox();
    await showDashboard();
  });

  it("is set aside", async () => {
    await eventually(async () =>
      assert.deepStrictEqual(
        (await renderedDashboard()).waiting?.map((w) => w.name),
        ["acme/reload #61", "acme/reload #62"]
      )
    );
    await clickDashboard({
      type: "ignore",
      id: "pull request acme/reload#61",
    });

    await eventually(async () => {
      const dashboard = await renderedDashboard();
      assert.deepStrictEqual(
        dashboard.waiting?.map((w) => w.name),
        ["acme/reload #62"]
      );
      assert.deepStrictEqual(
        dashboard.ignored?.map((w) => w.name),
        ["acme/reload #61"]
      );
    });
  });
});
