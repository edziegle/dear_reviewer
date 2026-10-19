import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { shownDiff, changeFiles, entryAt, select } from "../changeFiles";
import { buildPullRequestFixture, pushToPullRequest } from "../fixtures";
import {
  configure,
  inbox,
  inboxEntry,
  openFromInbox,
  refreshInbox,
  requestsToGitHub,
  serveGitHub,
  setToken,
  type FakePullRequest,
} from "../github";
import {
  catchErrors,
  catchNotifications,
  closeChange,
  eventually,
  focusWindow,
  heldState,
  releaseErrors,
  refreshRunning,
  releaseNotifications,
  setRefreshGap,
  short,
  workspaceFolders,
} from "../reviewer";
import { sentTimeline } from "../timeline";

const viewer = { login: "reviewer", token: "test-token" };
const settingKeys = [
  "githubApiUrl",
  "repositories",
  "localClones",
  "autoRefreshChanges",
];

// The author pushes commits and a reviewer comments while the Reviewer is
// away; coming back, they find both.
describe("Refreshing a pull request's Change as its remote changes", () => {
  const pr = buildPullRequestFixture("refresh", "acme/refresh", 51);
  const request = (head: string) => ({
    repository: pr.clone,
    base: pr.base,
    head,
    pullRequest: { repository: pr.repository, number: pr.number },
  });
  const titleAt = (head: string) =>
    `${path.basename(pr.clone)} ${short(pr.base)}..${short(head)}`;
  const overviewTitle = `${pr.repository} #${pr.number}`;
  const thread = {
    id: "PRRT_1",
    path: "pkg/core.py",
    side: "RIGHT" as const,
    line: 1,
    comments: [{ id: "PRRC_1", body: "Why this name?" }],
  };
  const served = (
    overrides: Partial<FakePullRequest> = {}
  ): FakePullRequest => ({
    repository: pr.repository,
    number: pr.number,
    title: "Refresh me",
    author: "alice",
    reviewRequested: ["reviewer"],
    headSha: pr.head,
    files: [{ path: "pkg/core.py" }, { path: "util.py" }],
    ...(lastReviews && { reviews: lastReviews }),
    ...overrides,
  });
  const found = new Map<string, unknown>();
  /** The reviews last served, to serve again with something added. */
  let lastReviews: FakePullRequest["reviews"];
  let heads: string[] = [pr.head];

  async function serve(
    overrides?: Partial<FakePullRequest>,
    failQueries?: string[]
  ) {
    if (overrides?.reviews) lastReviews = overrides.reviews;
    await serveGitHub({
      viewer,
      pullRequests: [served(overrides)],
      ...(failQueries && { failQueries }),
    });
  }

  /** Pushes a commit to the pull request and serves it as the new head. */
  async function authorPushes(
    overrides: Partial<FakePullRequest> = {}
  ): Promise<string> {
    const head = pushToPullRequest(
      pr,
      heads.at(-1)!,
      { "util.py": `PUSHED = ${heads.length}\n` },
      `push ${heads.length}`
    );
    heads.push(head);
    await serve({ headSha: head, ...overrides });
    return head;
  }

  async function headRequests(): Promise<number> {
    return (await requestsToGitHub()).filter((r) =>
      JSON.stringify(r.body ?? "").includes("query PullRequestHead")
    ).length;
  }

  const changeFolderNames = () => workspaceFolders().map((f) => f.name);

  before(async () => {
    await setRefreshGap(0);
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      found.set(key, config.inspect(key)?.globalValue);
    await serve();
    await configure({ repositories: [pr.repository] });
    await config.update(
      "localClones",
      { [pr.repository]: pr.clone },
      vscode.ConfigurationTarget.Global
    );
    await setToken(viewer.token);
    await refreshInbox();
    await openFromInbox(inboxEntry(await inbox(), "Refresh me"));
    await eventually(() =>
      assert.ok(
        changeFolderNames().includes(
          `${path.basename(pr.clone)} head ${short(pr.head)}`
        )
      )
    );
  });

  after(async () => {
    await releaseErrors();
    await releaseNotifications();
    await setRefreshGap();
    for (const head of heads) await closeChange(request(head));
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      await config.update(
        key,
        found.get(key),
        vscode.ConfigurationTarget.Global
      );
  });

  it("swaps to the new head, reopens the file, and loads new threads when the window regains focus", async () => {
    await select(
      entryAt(await changeFiles(), titleAt(pr.head), "pkg", "core.py")
    );
    const newHead = await authorPushes({
      reviews: [
        {
          id: "PRR_1",
          author: "carol",
          state: "COMMENTED",
          submittedAt: "2026-10-02T10:00:00Z",
          commit: pr.head,
          threads: [thread],
        },
        // The Reviewer's own pending Comment, which lives on GitHub.
        {
          id: "PRR_2",
          author: "reviewer",
          state: "PENDING",
          commit: pr.head,
          threads: [
            {
              id: "PRRT_2",
              path: "util.py",
              side: "RIGHT" as const,
              line: 1,
              comments: [{ id: "PRRC_2", body: "Pending.", reviewId: "PRR_2" }],
            },
          ],
        },
      ],
    });
    const before = (await heldState()).threads;

    await focusWindow();

    await eventually(() =>
      assert.ok(
        changeFolderNames().includes(
          `${path.basename(pr.clone)} head ${short(newHead)}`
        ),
        "the Change is at the new head"
      )
    );
    assert.ok(
      !changeFolderNames().includes(
        `${path.basename(pr.clone)} head ${short(pr.head)}`
      ),
      "the older head is gone"
    );
    const newFolder = workspaceFolders().find(
      (f) => f.name === `${path.basename(pr.clone)} head ${short(newHead)}`
    )!;
    await eventually(() =>
      assert.strictEqual(
        shownDiff().modified.fsPath,
        path.join(newFolder.path, "pkg", "core.py"),
        "the file the Reviewer was on is open again, under the new head's folder"
      )
    );
    await eventually(async () => {
      const overview = await sentTimeline(overviewTitle);
      assert.ok(
        overview.standing.includes("1 new commit arrived"),
        JSON.stringify(overview.standing)
      );
    });
    await eventually(async () =>
      assert.strictEqual(
        (await heldState()).threads,
        before + 2,
        "the new thread and the pending Comment are shown on the new head"
      )
    );
    // The check holds the refresh gate until it ends, and a focus event
    // meanwhile would be remembered, not run now.
    await eventually(async () =>
      assert.strictEqual(await refreshRunning(), false, "the check has ended")
    );
  });

  it("loads new threads of a pull request whose head has not moved", async () => {
    const before = (await heldState()).threads;
    const head = heads.at(-1)!;
    const [carol, mine] = lastReviews!;
    await serve({
      headSha: head,
      reviews: [
        {
          ...carol,
          threads: [
            ...carol.threads,
            {
              id: "PRRT_3",
              path: "util.py",
              side: "RIGHT" as const,
              line: 1,
              comments: [{ id: "PRRC_3", body: "And this?" }],
            },
          ],
        },
        mine,
      ],
    });

    // A repeat focus is safe: one that arrives while a check runs is remembered.
    await eventually(async () => {
      await focusWindow();
      assert.strictEqual((await heldState()).threads, before + 1);
    });
    await eventually(async () => {
      const overview = await sentTimeline(overviewTitle);
      assert.ok(
        overview.standing.includes("1 new thread arrived"),
        JSON.stringify(overview.standing)
      );
    });
    // A repeated focus left a check owed, which runs after the one that
    // loaded the thread, and its request would land in the next test's count.
    await eventually(async () =>
      assert.strictEqual(await refreshRunning(), false, "the checks have ended")
    );
  });

  it("sends one request for a burst of focus changes within the gap of the last check", async () => {
    await setRefreshGap(0);
    const before = await headRequests();
    await focusWindow();
    await eventually(async () =>
      assert.strictEqual(await headRequests(), before + 1)
    );
    await eventually(async () =>
      assert.strictEqual(await refreshRunning(), false)
    );

    await setRefreshGap(60_000);
    await Promise.all([focusWindow(), focusWindow(), focusWindow()]);
    // A check that began is running until its request is counted.
    await eventually(async () =>
      assert.strictEqual(await refreshRunning(), false)
    );
    assert.strictEqual(
      await headRequests(),
      before + 1,
      "skipped within the gap"
    );
    await setRefreshGap(0);
  });

  it("sends one request for a burst that arrives while a check runs, and one more for what arrived", async () => {
    await setRefreshGap(0);
    const before = await headRequests();
    await Promise.all([focusWindow(), focusWindow(), focusWindow()]);
    await setRefreshGap(60_000);
    // The owed check runs although the gap would turn it away, and a check
    // that begins is running until its request is counted.
    await eventually(async () =>
      assert.strictEqual(await refreshRunning(), false)
    );
    assert.strictEqual(
      await headRequests(),
      before + 2,
      "one for the first focus, one owed for the rest"
    );
    await setRefreshGap(0);
  });

  it("says nothing and leaves the Change as it was when an automatic check fails, but says so when asked", async () => {
    const head = heads.at(-1)!;
    await serve({ headSha: head }, ["PullRequestHead"]);
    const errors = await catchErrors();
    const folders = changeFolderNames();
    const before = await headRequests();

    await focusWindow();
    await eventually(async () => assert.ok((await headRequests()) > before));
    assert.strictEqual(errors.length, 0, "no error for the automatic check");
    assert.deepStrictEqual(changeFolderNames(), folders);

    await vscode.commands.executeCommand("dearReviewer.fetchUpdates");
    await eventually(() => assert.strictEqual(errors.length, 1));
    assert.match(errors[0].message, /^Couldn't fetch updates for /);
    await releaseErrors();
    await serve({ headSha: head });
  });

  it("checks nothing by itself with the setting off, yet Fetch Updates brings in the new commits and says so", async () => {
    await vscode.workspace
      .getConfiguration("dearReviewer")
      .update("autoRefreshChanges", false, vscode.ConfigurationTarget.Global);
    const oldHead = heads.at(-1)!;
    const newHead = await authorPushes();
    const before = await headRequests();

    await focusWindow();
    // Nothing is sent, so there is nothing to wait for but a moment's quiet.
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.strictEqual(await headRequests(), before, "no check was sent");
    assert.ok(
      changeFolderNames().includes(
        `${path.basename(pr.clone)} head ${short(oldHead)}`
      )
    );

    const notifications = await catchNotifications();
    await vscode.commands.executeCommand("dearReviewer.fetchUpdates");

    await eventually(() =>
      assert.ok(
        changeFolderNames().includes(
          `${path.basename(pr.clone)} head ${short(newHead)}`
        )
      )
    );
    await eventually(() =>
      assert.deepStrictEqual(
        notifications.map((n) => n.message),
        [`${pr.repository} #${pr.number}: 1 new commit.`]
      )
    );
  });
});
