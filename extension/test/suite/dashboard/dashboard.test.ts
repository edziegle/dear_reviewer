import * as assert from "assert";
import * as vscode from "vscode";
import { changeFiles } from "../changeFiles";
import { sentTimeline, submitInOverview } from "../timeline";
import { buildFixtureRepo, buildPullRequestFixture } from "../fixtures";
import {
  configure,
  fakePullRequestId,
  forgetToken,
  refreshInbox,
  reviewsOnGitHub,
  serveGitHub,
  setToken,
  type FakePullRequest,
} from "../github";
import {
  actAsReviewWindow,
  askReviewWindow,
  clickDashboard,
  closeEveryChange,
  dashboardVisible,
  renderedDashboard,
  showDashboard,
} from "../dashboard";
import {
  closeChange,
  eventually,
  gitIn,
  openChange,
  shownChanges,
  short,
} from "../reviewer";

const viewer = { login: "reviewer", token: "test-token" };
const settingKeys = ["githubApiUrl", "repositories", "localClones"];
const hour = 60 * 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

describe("Dashboard", () => {
  const pr = buildPullRequestFixture("dashboard", "acme/api", 32);
  const local = buildFixtureRepo("dashboard-local");
  const prRequest = {
    repository: pr.clone,
    base: pr.base,
    head: pr.head,
    pullRequest: { repository: pr.repository, number: pr.number },
  };
  /** A local Change of the repository's commits from `base` to `head`, and its name. */
  const range = (base: string, head: string) => ({
    request: { repository: local.path, base, head },
    name: `${local.path.split("/").pop()} ${short(base)}..${short(head)}`,
  });
  // Requested two and a half hours ago, though opened nine days ago.
  const webhooks: FakePullRequest = {
    repository: pr.repository,
    number: pr.number,
    title: "Retry failed webhooks",
    author: "alice",
    createdAt: ago(9 * 24 * hour),
    reviewRequested: ["reviewer"],
    reviewRequestedAt: ago(2.5 * hour),
    headSha: pr.head,
    files: [
      { path: "pkg/core.py" },
      { path: "pkg/legacy.py" },
      { path: "pkg/sub/new.py" },
      { path: "util.py" },
    ],
    additions: 40,
    deletions: 8,
    checks: "FAILURE",
  };
  const token: FakePullRequest = {
    repository: pr.repository,
    number: 33,
    title: "Cache the token",
    author: "bob",
    createdAt: ago(7 * 24 * hour),
    reviewRequested: ["reviewer"],
    reviewRequestedAt: ago(6 * 24 * hour + 3 * hour),
    files: [{ path: "auth.py" }],
    additions: 5,
    deletions: 1,
    checks: "SUCCESS",
  };
  const mine: FakePullRequest = {
    repository: pr.repository,
    number: 40,
    title: "Add retries to the client",
    author: "reviewer",
    mergeable: "CONFLICTING",
    files: [{ path: "client.py" }],
    additions: 12,
    deletions: 3,
  };
  const found = new Map<string, unknown>();

  before(async () => {
    // A local branch one commit ahead of main, as the clone last fetched it.
    const main = gitIn(pr.clone, "rev-parse", "upstream/main");
    const tree = gitIn(pr.work, "rev-parse", `${main}^{tree}`);
    const ahead = gitIn(
      pr.work,
      "commit-tree",
      tree,
      "-p",
      main,
      "-m",
      "Retry webhooks"
    );
    gitIn(pr.clone, "fetch", "-q", pr.work, `+${ahead}:refs/heads/fix-retry`);
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      found.set(key, config.inspect(key)?.globalValue);
    await serveGitHub({
      viewer,
      pullRequests: [
        structuredClone(webhooks),
        structuredClone(token),
        structuredClone(mine),
      ],
    });
    await configure({ repositories: [pr.repository] });
    await config.update(
      "localClones",
      { [pr.repository]: pr.clone },
      vscode.ConfigurationTarget.Global
    );
    await setToken(viewer.token);
    await closeEveryChange();
    await refreshInbox();
    await showDashboard();
  });

  afterEach(async () => {
    await actAsReviewWindow(false);
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

  it("is the side bar outside the review window, and Change Files and Findings show only where a Change can be in front", () => {
    const contributes = vscode.extensions.getExtension(
      "edziegle.dear-reviewer"
    )!.packageJSON.contributes as {
      views: Record<string, { id: string; type?: string; when?: string }[]>;
      menus: Record<
        string,
        { command: string; when?: string; group?: string }[]
      >;
      keybindings: { command: string; key: string; when?: string }[];
    };
    assert.deepStrictEqual(
      contributes.views.dearReviewer.map((view) => [
        view.id,
        view.type,
        view.when,
      ]),
      [
        ["dearReviewer.dashboard", "webview", "!dearReviewer.inReviewWindow"],
        [
          "dearReviewer.changeFiles",
          undefined,
          "dearReviewer.inReviewWindow || dearReviewer.hasOpenChange",
        ],
        [
          "dearReviewer.findings",
          "webview",
          "dearReviewer.inReviewWindow || dearReviewer.hasOpenChange",
        ],
      ]
    );
    assert.deepStrictEqual(
      contributes.menus.commandPalette
        .filter((m) => m.command === "dearReviewer.showDashboard")
        .map((m) => m.when),
      ["!dearReviewer.inReviewWindow"]
    );
    assert.deepStrictEqual(
      contributes.keybindings
        .filter((k) => k.command === "dearReviewer.showDashboard")
        .map((k) => [k.key, k.when]),
      [["ctrl+alt+r h", "!dearReviewer.inReviewWindow"]]
    );
    // A Change's actions show only while a Change is open.
    for (const command of [
      "dearReviewer.findIssues",
      "dearReviewer.refreshChangeFiles",
      "dearReviewer.hideViewedFiles",
      "dearReviewer.showViewedFiles",
    ])
      for (const entry of contributes.menus["view/title"].filter(
        (m) => m.command === command
      ))
        assert.match(entry.when ?? "", /dearReviewer\.hasOpenChange/, command);
  });

  it("opens a pull request or branch from the palette, by name, as well as from the Dashboard", async () => {
    const { contributes } = vscode.extensions.getExtension(
      "edziegle.dear-reviewer"
    )!.packageJSON;
    assert.ok(
      contributes.commands.some(
        (c: { command: string; title: string }) =>
          c.command === "dearReviewer.openFromList" &&
          c.title === "Open Pull Request or Branch…"
      )
    );
    const hidden = contributes.menus.commandPalette.filter(
      (m: { when?: string }) => m.when === "false"
    );
    assert.ok(
      !hidden.some(
        (m: { command: string }) => m.command === "dearReviewer.openFromList"
      )
    );
    assert.ok(
      (await vscode.commands.getCommands(true)).includes(
        "dearReviewer.openFromList"
      )
    );
  });

  it("comes into sight with Show Dashboard", async () => {
    await vscode.commands.executeCommand("workbench.action.closeSidebar");
    await eventually(async () =>
      assert.strictEqual(await dashboardVisible(), false)
    );
    await showDashboard();
    await eventually(async () => {
      assert.strictEqual(await dashboardVisible(), true);
      assert.ok((await renderedDashboard()).facts);
    });
  });

  it("lists what's waiting on the Reviewer, longest wait first, with its size and checks", async () => {
    await eventually(async () => {
      const dashboard = await renderedDashboard();
      assert.strictEqual(dashboard.facts, "2 waiting on you · oldest 6 days");
      assert.deepStrictEqual(
        dashboard.waiting?.map(({ avatar, ...row }) => {
          assert.ok(
            avatar?.startsWith("https://"),
            `an avatar for ${row.author}: ${avatar}`
          );
          return row;
        }),
        [
          {
            id: "pull request acme/api#33",
            title: "Cache the token",
            name: "acme/api #33",
            author: "bob",
            waited: "6 days",
            size: { files: 1, additions: 5, deletions: 1 },
            checks: "passed",
            notes: [],
          },
          {
            id: "pull request acme/api#32",
            title: "Retry failed webhooks",
            name: "acme/api #32",
            author: "alice",
            waited: "2 hours",
            size: { files: 4, additions: 40, deletions: 8 },
            checks: "failed",
            notes: [],
          },
        ]
      );
      assert.deepStrictEqual(dashboard.next, {
        kind: "open",
        id: "pull request acme/api#33",
        label: "Review acme/api #33",
        place: "acme/api #33 has waited longest on you: 6 days",
      });
    });
  });

  it("lists the Reviewer's own pull requests, the ones they reviewed and their local branches, as the Inbox does", async () => {
    await eventually(async () => {
      const dashboard = await renderedDashboard();
      assert.deepStrictEqual(dashboard.reviewed, []);
      assert.deepStrictEqual(dashboard.authored, [
        {
          id: "pull request acme/api#40",
          title: "Add retries to the client",
          name: "acme/api #40",
          author: "reviewer",
          size: { files: 1, additions: 12, deletions: 3 },
          notes: ["merge conflicts"],
        },
      ]);
      assert.deepStrictEqual(
        dashboard.branches.map(({ id: _id, ...branch }) => branch),
        [
          {
            name: "fix-retry",
            repository: "acme/api",
            ahead: "1 commit ahead of main",
            notes: [],
          },
        ]
      );
    });
  });

  it("shows only the Active Change, with where the Reviewer stands, and its title brings it back to the front", async () => {
    const first = range(local.commits.renamed, local.commits.documented);
    const second = range(local.commits.documented, local.commits.restructured);
    await openChange(first.request);
    await openChange(second.request);
    try {
      await showDashboard();
      await eventually(async () => {
        const dashboard = await renderedDashboard();
        assert.deepStrictEqual(
          dashboard.inProgress.map(({ id: _id, ...row }) => row),
          [
            {
              title: second.name,
              byline: second.name.split(" ")[0],
              standing: ["0 of 3 viewed"],
            },
          ]
        );
        assert.strictEqual(dashboard.facts, "2 waiting on you · oldest 6 days");
        assert.deepStrictEqual(
          {
            kind: dashboard.next?.kind,
            label: dashboard.next?.label,
            place: dashboard.next?.place,
          },
          {
            kind: "resume",
            label: `Resume ${second.name}`,
            // The button names the Change and its row says where you stand.
            place: undefined,
          }
        );
      });

      await clickDashboard({
        type: "resume",
        id: (await renderedDashboard()).inProgress[0].id,
      });
      await eventually(async () => {
        assert.strictEqual((await shownChanges()).at(-1), second.name);
        assert.deepStrictEqual(
          (await changeFiles()).map((entry) => entry.label),
          [second.name],
          "Change Files follows the Active Change"
        );
      });
    } finally {
      await closeChange(second.request);
    }
  });

  it("leaves out a Change with no files to review", async () => {
    // A commit that changes nothing, such as one undone by the next.
    const documented = local.commits.documented;
    const unchanged = gitIn(
      local.path,
      "commit-tree",
      gitIn(local.path, "rev-parse", `${documented}^{tree}`),
      "-p",
      documented,
      "-m",
      "Change nothing"
    );
    const empty = range(documented, unchanged);
    const other = range(local.commits.renamed, documented);
    await openChange(empty.request);
    await openChange(other.request);
    try {
      await eventually(async () =>
        assert.deepStrictEqual((await shownChanges()).slice(-2), [
          empty.name,
          other.name,
        ])
      );
      await showDashboard();
      await eventually(async () => {
        const dashboard = await renderedDashboard();
        assert.deepStrictEqual(
          dashboard.inProgress.map((c) => c.title),
          [other.name],
          "only the Change with files to review is in progress"
        );
        assert.strictEqual(dashboard.next?.label, `Resume ${other.name}`);
      });
    } finally {
      await closeChange(other.request);
    }
  });

  it("opens a pull request waiting on the Reviewer, moving it to In progress with its wait, and finishes its Review there", async () => {
    await showDashboard();
    await eventually(async () =>
      assert.ok(
        (await renderedDashboard()).waiting?.some(
          (w) => w.id === "pull request acme/api#32"
        )
      )
    );
    await clickDashboard({ type: "open", id: "pull request acme/api#32" });
    try {
      await eventually(
        async () =>
          assert.strictEqual((await shownChanges()).at(-1), "acme/api #32"),
        30_000
      );

      await showDashboard();
      await eventually(async () => {
        const dashboard = await renderedDashboard();
        assert.deepStrictEqual(
          dashboard.inProgress.map(({ id: _id, avatar, ...row }) => {
            assert.ok(
              avatar?.startsWith("https://"),
              `an avatar for ${row.title}: ${avatar}`
            );
            return row;
          }),
          [
            {
              title: "Retry failed webhooks",
              byline: "acme/api #32 · waiting 2 hours · alice",
              size: { files: 4, additions: 40, deletions: 8 },
              checks: "failed",
              standing: ["0 of 4 viewed"],
            },
          ]
        );
        assert.deepStrictEqual(
          dashboard.waiting?.map((w) => w.id),
          ["pull request acme/api#33"],
          "an open pull request shows only in In progress"
        );
        assert.strictEqual(
          dashboard.facts,
          "2 waiting on you · oldest 6 days",
          "the facts line counts it still"
        );
      });

      const before = (await reviewsOnGitHub()).filter(
        (r) => r.author === "reviewer" && r.state !== "PENDING"
      ).length;
      await clickDashboard({
        type: "finish",
        id: (await renderedDashboard()).inProgress[0].id,
      });
      // Submit Review… opens the overview's Submit step, which approves.
      const overview = `${pr.repository} #${pr.number}`;
      await eventually(async () =>
        assert.ok(
          (await sentTimeline(overview)).submit,
          "the Submit step is open"
        )
      );
      await submitInOverview(overview, "approve", "");
      await eventually(async () => {
        const reviews = (await reviewsOnGitHub()).filter(
          (r) => r.author === "reviewer" && r.state !== "PENDING"
        );
        assert.strictEqual(reviews.length, before + 1);
        assert.strictEqual(
          reviews.at(-1)?.pullRequestId,
          fakePullRequestId(pr)
        );
      }, 20_000);
    } finally {
      await closeChange(prRequest);
    }
  });

  it("asks the review window to resume the Active Change it shows, which it does once it reads the request", async () => {
    const first = range(local.commits.initial, local.commits.renamed);
    await openChange(first.request);
    try {
      await eventually(async () =>
        assert.strictEqual((await shownChanges()).at(-1), first.name)
      );
      const shownBefore = (await shownChanges()).length;
      await showDashboard();
      let id: string | undefined;
      await eventually(async () => {
        id = (await renderedDashboard()).inProgress.find(
          (c) => c.title === first.name
        )?.id;
        assert.ok(id, `${first.name} is in progress`);
      });
      await askReviewWindow(id!, "resume");
      assert.strictEqual(
        (await shownChanges()).length,
        shownBefore,
        "only the review window carries it out"
      );
      await actAsReviewWindow(true);
      await eventually(async () =>
        assert.strictEqual((await shownChanges()).length, shownBefore + 1)
      );
    } finally {
      await closeChange(first.request);
    }
  });

  it("follows the Inbox: a new pull request on Refresh, and a sign-in to ask for", async () => {
    await showDashboard();
    await serveGitHub({
      viewer,
      pullRequests: [
        structuredClone(token),
        structuredClone(mine),
        {
          repository: pr.repository,
          number: 34,
          title: "Log retries",
          author: "carol",
          reviewRequested: ["reviewer"],
          reviewRequestedAt: ago(10 * 60_000),
        },
      ],
    });
    // #32 is left out: a test before may have reviewed it, which keeps it
    // out of Waiting on you for a while, as in the Inbox.
    await vscode.commands.executeCommand("dearReviewer.refreshInbox");
    await eventually(async () => {
      const dashboard = await renderedDashboard();
      assert.deepStrictEqual(
        dashboard.waiting?.map((w) => [w.name, w.waited]),
        [
          ["acme/api #33", "6 days"],
          ["acme/api #34", "10 minutes"],
        ]
      );
    });

    await forgetToken();
    try {
      await eventually(async () => {
        const dashboard = await renderedDashboard();
        assert.strictEqual(dashboard.waiting, undefined);
        assert.strictEqual(dashboard.facts, undefined);
        assert.deepStrictEqual(dashboard.setup, {
          text: "Sign in to GitHub to list the pull requests waiting on you and the ones you authored.",
          actions: [
            { id: "signIn", label: "Sign In to GitHub" },
            { id: "setToken", label: "Use a Personal Access Token" },
            { id: "openSetup", label: "Set Up Dear Reviewer" },
          ],
        });
      });
    } finally {
      await setToken(viewer.token);
      await refreshInbox();
    }
  });
});
