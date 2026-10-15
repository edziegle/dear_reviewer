import * as assert from "assert";
import * as vscode from "vscode";
import { changeFiles } from "../changeFiles";
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
  clickHome,
  homePanel,
  renderedHome,
  showHome,
} from "../home";
import {
  activeTabLabel,
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

describe("Home", () => {
  const pr = buildPullRequestFixture("home", "acme/api", 32);
  const local = buildFixtureRepo("home-local");
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
    await refreshInbox();
  });

  afterEach(async () => {
    await actAsReviewWindow(false);
  });

  after(async () => {
    (await homePanel()) &&
      (await vscode.commands.executeCommand(
        "workbench.action.closeAllEditors"
      ));
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      await config.update(
        key,
        found.get(key),
        vscode.ConfigurationTarget.Global
      );
  });

  it("takes the Inbox's place in the review window, and is offered there only", () => {
    const contributes = vscode.extensions.getExtension(
      "edziegle.dear-reviewer"
    )!.packageJSON.contributes as {
      views: Record<string, { id: string; when?: string }[]>;
      menus: Record<
        string,
        { command: string; when?: string; group?: string }[]
      >;
      keybindings: { command: string; key: string; when?: string }[];
    };
    assert.deepStrictEqual(
      contributes.views.dearReviewer.map((view) => [view.id, view.when]),
      [
        ["dearReviewer.inbox", "!dearReviewer.inReviewWindow"],
        ["dearReviewer.changeFiles", undefined],
        ["dearReviewer.findings", undefined],
      ]
    );
    const showHomeIn = (menu: string) =>
      contributes.menus[menu]
        .filter((m) => m.command === "dearReviewer.showHome")
        .map((m) => [m.when, m.group]);
    assert.deepStrictEqual(showHomeIn("view/title"), [
      [
        "(view == dearReviewer.changeFiles || view == dearReviewer.findings) && dearReviewer.inReviewWindow",
        "navigation@0",
      ],
    ]);
    assert.deepStrictEqual(showHomeIn("commandPalette"), [
      ["dearReviewer.inReviewWindow", undefined],
    ]);
    assert.deepStrictEqual(
      contributes.keybindings
        .filter((k) => k.command === "dearReviewer.showHome")
        .map((k) => [k.key, k.when]),
      [["ctrl+alt+r h", "dearReviewer.inReviewWindow"]]
    );
  });

  it("opens in the review window when its last Change closes, and gives way when a Change comes to the front", async () => {
    const change = range(local.commits.initial, local.commits.renamed);
    await openChange(change.request);
    await closeChange(change.request);
    assert.strictEqual(
      await homePanel(),
      undefined,
      "never on its own outside the review window"
    );

    await actAsReviewWindow(true);
    await openChange(change.request);
    await eventually(async () =>
      assert.strictEqual((await shownChanges()).at(-1), change.name)
    );
    assert.strictEqual(
      await homePanel(),
      undefined,
      "not while a Change is in front"
    );
    await closeChange(change.request);
    await eventually(async () => {
      const panel = await homePanel();
      assert.ok(panel, "Home opens once the last Change closes");
      assert.ok(panel.active, "alone in front, with the focus");
      assert.strictEqual(panel.title, "Home");
      assert.deepStrictEqual((await renderedHome()).inProgress, []);
    });
    assert.deepStrictEqual(
      vscode.window.tabGroups.all.flatMap((g) => g.tabs.map((t) => t.label)),
      ["Home"]
    );
  });

  it("lists what's waiting on the Reviewer, longest wait first, with its size and checks", async () => {
    await actAsReviewWindow(true);
    await showHome();
    await eventually(async () => {
      const home = await renderedHome();
      assert.strictEqual(
        home.facts,
        "Nothing in progress · 2 waiting on you · oldest 6 days"
      );
      assert.deepStrictEqual(
        home.waiting?.map(({ avatar, ...row }) => {
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
      assert.deepStrictEqual(home.next, {
        kind: "open",
        id: "pull request acme/api#33",
        label: "Review acme/api #33",
        place: "acme/api #33 has waited longest on you: 6 days",
      });
    });
  });

  it("lists the Reviewer's own pull requests and their local branches, as the Inbox does", async () => {
    await actAsReviewWindow(true);
    await showHome();
    await eventually(async () => {
      const home = await renderedHome();
      assert.deepStrictEqual(home.authored, [
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
        home.branches.map(({ id: _id, ...branch }) => branch),
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

  it("shows each Change in progress with where the Reviewer stands, and Resume brings one back to the front", async () => {
    const first = range(local.commits.renamed, local.commits.documented);
    const second = range(local.commits.documented, local.commits.restructured);
    await actAsReviewWindow(true);
    await openChange(first.request);
    await openChange(second.request);
    // Its overview in front, so showing it doesn't close Home behind.
    await eventually(() => assert.strictEqual(activeTabLabel(), second.name));
    try {
      await showHome();
      await eventually(async () => {
        const home = await renderedHome();
        assert.deepStrictEqual(
          home.inProgress.map(({ id: _id, ...row }) => row),
          [
            {
              title: first.name,
              byline: first.name.split(" ")[0],
              standing: ["0 of 1 viewed"],
              finish: "Write Brief…",
            },
            {
              title: second.name,
              byline: second.name.split(" ")[0],
              standing: ["0 of 3 viewed"],
              finish: "Write Brief…",
            },
          ]
        );
        assert.strictEqual(
          home.facts,
          "2 in progress · 2 waiting on you · oldest 6 days"
        );
        assert.deepStrictEqual(
          {
            kind: home.next?.kind,
            label: home.next?.label,
            place: home.next?.place,
          },
          {
            kind: "resume",
            label: `Resume ${second.name}`,
            place: `You were last in ${second.name} · 0 of 3 viewed`,
          }
        );
      });

      await clickHome({
        type: "resume",
        id: (await renderedHome()).inProgress[0].id,
      });
      await eventually(async () => {
        assert.strictEqual((await shownChanges()).at(-1), first.name);
        assert.deepStrictEqual(
          (await changeFiles()).map((entry) => entry.label),
          [first.name],
          "Change Files follows the Change resumed"
        );
        assert.strictEqual(
          await homePanel(),
          undefined,
          "Home gives way to its overview"
        );
      });
    } finally {
      await closeChange(first.request);
      await closeChange(second.request);
    }
  });

  it("opens a pull request waiting on the Reviewer, and finishes its Review from In progress", async () => {
    await actAsReviewWindow(true);
    await showHome();
    await eventually(async () =>
      assert.ok(
        (await renderedHome()).waiting?.some(
          (w) => w.id === "pull request acme/api#32"
        )
      )
    );
    await clickHome({ type: "open", id: "pull request acme/api#32" });
    try {
      await eventually(async () => {
        assert.strictEqual((await shownChanges()).at(-1), "acme/api #32");
        assert.strictEqual(await homePanel(), undefined);
      }, 30_000);

      await showHome();
      await eventually(async () => {
        const home = await renderedHome();
        assert.deepStrictEqual(
          home.inProgress.map(({ id: _id, ...row }) => row),
          [
            {
              title: "Retry failed webhooks",
              byline: "acme/api #32 · alice → main",
              standing: ["0 of 4 viewed"],
              finish: "Submit Review…",
            },
          ]
        );
        assert.deepStrictEqual(
          home.waiting?.find((w) => w.id === "pull request acme/api#32")?.notes,
          ["open"]
        );
      });

      const before = (await reviewsOnGitHub()).filter(
        (r) => r.author === "reviewer" && r.state !== "PENDING"
      ).length;
      await clickHome({
        type: "finish",
        id: (await renderedHome()).inProgress[0].id,
      });
      // Submit Review… asks for a verdict and a summary; the first choice and an empty one.
      await eventually(async () => {
        await vscode.commands.executeCommand(
          "workbench.action.acceptSelectedQuickOpenItem"
        );
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

  it("follows the Inbox: a new pull request on Refresh, and a sign-in to ask for", async () => {
    await actAsReviewWindow(true);
    await showHome();
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
    await clickHome({ type: "refresh" });
    await eventually(async () => {
      const home = await renderedHome();
      assert.deepStrictEqual(
        home.waiting?.map((w) => [w.name, w.waited]),
        [
          ["acme/api #33", "6 days"],
          ["acme/api #34", "10 minutes"],
        ]
      );
    });

    await forgetToken();
    try {
      await eventually(async () => {
        const home = await renderedHome();
        assert.strictEqual(home.waiting, undefined);
        assert.strictEqual(home.facts, "Nothing in progress");
        assert.deepStrictEqual(home.setup, {
          id: "signIn",
          text: "Sign in to GitHub to list the pull requests waiting on you.",
          action: "Sign In to GitHub",
        });
      });
    } finally {
      await setToken(viewer.token);
      await refreshInbox();
    }
  });
});
