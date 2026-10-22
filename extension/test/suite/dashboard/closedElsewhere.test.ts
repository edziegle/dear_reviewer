import * as assert from "assert";
import * as vscode from "vscode";
import { buildPullRequestFixture } from "../fixtures";
import {
  awaitingSearches,
  configure,
  inboxSettled,
  refreshInbox,
  serveGitHub,
  setToken,
  type FakePullRequest,
} from "../github";
import {
  clickDashboard,
  closeAsAnotherWindow,
  closeEveryChange,
  dashboardVisible,
  renderedDashboard,
  showDashboard,
} from "../dashboard";
import { eventually, shownChanges } from "../reviewer";

const viewer = { login: "reviewer", token: "test-token" };

describe("Dashboard when another window closes a Change", () => {
  const first = buildPullRequestFixture("closed-elsewhere", "acme/web", 51);
  const second = buildPullRequestFixture("closed-elsewhere-2", "acme/api", 52);
  const requestOf = (pr: typeof first) => ({
    repository: pr.clone,
    base: pr.base,
    head: pr.head,
    pullRequest: { repository: pr.repository, number: pr.number },
  });
  const waiting = (pr: typeof first, title: string): FakePullRequest => ({
    repository: pr.repository,
    number: pr.number,
    title,
    author: "alice",
    reviewRequested: ["reviewer"],
    headSha: pr.head,
    files: [
      { path: "pkg/core.py" },
      { path: "pkg/legacy.py" },
      { path: "pkg/sub/new.py" },
      { path: "util.py" },
    ],
  });
  /**
   * What GitHub lists once the Reviewer approved the pull request, while its
   * search still finds it awaiting their review.
   */
  const approved = (pr: typeof first, title: string): FakePullRequest => ({
    ...waiting(pr, title),
    reviewRequested: [],
    searchedAsRequested: ["reviewer"],
    requestHistory: [
      { type: "requested", user: "reviewer", at: "2026-10-01T09:00:00Z" },
    ],
    reviews: [
      {
        id: `review-${pr.number}`,
        author: "reviewer",
        state: "APPROVED",
        submittedAt: "2026-10-02T09:00:00Z",
        threads: [],
      },
    ],
  });
  const config = vscode.workspace.getConfiguration("dearReviewer");
  const found = new Map<string, unknown>();

  before(async () => {
    for (const key of ["repositories", "localClones"])
      found.set(key, config.inspect(key)?.globalValue);
    await closeEveryChange();
    await configure({ repositories: ["acme/web", "acme/api"] });
    await config.update(
      "localClones",
      { "acme/web": first.clone, "acme/api": second.clone },
      vscode.ConfigurationTarget.Global
    );
    await setToken(viewer.token);
    await refreshInbox();
    await showDashboard();
  });

  beforeEach(async () => {
    await serveGitHub({
      viewer,
      pullRequests: [waiting(first, "First"), waiting(second, "Second")],
    });
    await refreshInbox();
    await showDashboard();
  });

  afterEach(async () => {
    await closeEveryChange();
    await showDashboard();
  });

  after(async () => {
    for (const [key, value] of found)
      await config.update(key, value, vscode.ConfigurationTarget.Global);
  });

  /** Opens the pull request waiting on the Reviewer as the Dashboard's button does. */
  const openFromDashboard = async (pr: typeof first) => {
    const id = `pull request ${pr.repository}#${pr.number}`;
    await eventually(async () =>
      assert.ok((await renderedDashboard()).waiting?.some((w) => w.id === id))
    );
    await clickDashboard({ type: "open", id });
    // The Change shows once it's open and the folders are settled.
    await eventually(
      async () =>
        assert.strictEqual(
          (await shownChanges()).at(-1),
          `${pr.repository} #${pr.number}`
        ),
      60_000
    );
  };

  /** Waits for the pull requests to be in progress, which opening them takes a while to do. */
  const inProgress = (titles: string[]) =>
    eventually(
      async () =>
        assert.deepStrictEqual(
          (await renderedDashboard()).inProgress.map((c) => c.title).sort(),
          titles
        ),
      60_000
    );

  /** GitHub lists both pull requests as approved from here on, though its search lags, and the requests it saw are forgotten. */
  const reviewedOnGitHub = () =>
    serveGitHub({
      viewer,
      pullRequests: [approved(first, "First"), approved(second, "Second")],
    });

  it("takes the pull request out of In progress at once, and shows it under Reviewed by you after one reload", async () => {
    await openFromDashboard(first);
    await inProgress(["First"]);
    await reviewedOnGitHub();

    await closeAsAnotherWindow(requestOf(first).pullRequest);

    await eventually(async () => {
      const dashboard = await renderedDashboard();
      assert.deepStrictEqual(dashboard.inProgress, []);
      const listed = [
        ...(dashboard.waiting ?? []),
        ...(dashboard.reviewed ?? []),
      ].filter((row) => row.name === "acme/web #51");
      assert.strictEqual(listed.length, 1, "listed once while it reloads");
    });
    await inboxSettled();
    await eventually(async () => {
      const dashboard = await renderedDashboard();
      assert.deepStrictEqual(
        dashboard.reviewed?.map((r) => r.name),
        ["acme/web #51", "acme/api #52"]
      );
      assert.deepStrictEqual(dashboard.waiting, []);
    });
    assert.strictEqual((await awaitingSearches()).length, 1);
  });

  it("reloads in a window that doesn't show the Dashboard only once it shows", async () => {
    await openFromDashboard(first);
    await inProgress(["First"]);
    await vscode.commands.executeCommand("workbench.view.explorer");
    await eventually(async () => assert.ok(!(await dashboardVisible())));
    await reviewedOnGitHub();

    await closeAsAnotherWindow(requestOf(first).pullRequest);

    // The window hears of the close from the shared list; there's no signal
    // that it did and did nothing, so give it the time it takes.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await inboxSettled();
    assert.strictEqual((await awaitingSearches()).length, 0);

    await showDashboard();

    await eventually(async () => {
      const dashboard = await renderedDashboard();
      assert.deepStrictEqual(
        dashboard.reviewed?.map((r) => r.name),
        ["acme/web #51", "acme/api #52"]
      );
      assert.deepStrictEqual(dashboard.waiting, []);
    });
    await inboxSettled();
    assert.strictEqual((await awaitingSearches()).length, 1);
  });
});
