import * as assert from "assert";
import * as vscode from "vscode";
import { buildPullRequestFixture } from "../fixtures";
import {
  avatarServedFor,
  configure,
  inbox,
  inboxEntry,
  openFromInbox,
  refreshInbox,
  serveGitHub,
  setToken,
  type FakePullRequest,
} from "../github";
import { submitReview } from "../review";
import {
  activeTabLabel,
  closeChange,
  eventually,
  openChange,
  short,
} from "../reviewer";
import {
  avatarBytes,
  catchLinks,
  clickLink,
  clickProblemAction,
  clickRefresh,
  releaseLinks,
  renderedTimeline,
  sentTimeline,
  showTimeline,
  type Timeline,
  type TimelineItem,
} from "../timeline";
import { webviewTabs } from "../assistant";

const viewer = { login: "reviewer", token: "test-token" };
const settingKeys = ["githubApiUrl", "repositories", "localClones"];

/** The timeline without avatar URIs, which the tests check separately. */
function withoutAvatars(timeline: Timeline | undefined) {
  if (!timeline) return timeline;
  return {
    ...timeline,
    items: timeline.items.map((item) => ({
      ...item,
      author: { login: item.author.login },
    })),
  };
}

function timelineTab(title: string): vscode.Tab | undefined {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .find(
      (tab) =>
        tab.input instanceof vscode.TabInputWebview && tab.label === title
    );
}

describe("A pull request's timeline", () => {
  const pr = buildPullRequestFixture("timeline", "acme/api", 21);
  const title = "Timeline: acme/api #21";
  const fakePullRequest: FakePullRequest = {
    repository: pr.repository,
    number: pr.number,
    title: "Restructure pkg",
    author: "alice",
    body: "Moves the legacy code out of pkg.\n\nPart of the cleanup.",
    createdAt: "2026-10-01T09:00:00Z",
    reviewRequested: ["reviewer"],
    headSha: pr.head,
    files: [
      { path: "pkg/core.py" },
      { path: "pkg/legacy.py" },
      { path: "pkg/sub/new.py" },
      { path: "util.py" },
    ],
    checks: "FAILURE",
    checkRuns: [
      {
        type: "checkRun",
        name: "test",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        detailsUrl: "https://ci.example.com/runs/1",
      },
      {
        type: "checkRun",
        name: "lint",
        status: "COMPLETED",
        conclusion: "FAILURE",
        detailsUrl: "https://ci.example.com/runs/2",
      },
      { type: "checkRun", name: "deploy preview", status: "IN_PROGRESS" },
      {
        type: "checkRun",
        name: "docs",
        status: "COMPLETED",
        conclusion: "SKIPPED",
        detailsUrl: "https://ci.example.com/runs/4",
      },
      {
        type: "status",
        context: "ci/legacy",
        state: "SUCCESS",
        targetUrl: "https://legacy-ci.example.com/build/9",
      },
    ],
    timeline: [
      {
        type: "commit",
        sha: "1".repeat(40),
        message: "Move legacy code\n\nIt was only used by tests.",
        author: "alice",
        date: "2026-10-01T08:55:00Z",
      },
      {
        type: "comment",
        author: "bob",
        body: "Is legacy.py still imported anywhere?",
        date: "2026-10-01T10:00:00Z",
      },
      {
        type: "commit",
        sha: pr.head,
        message: "Restructure on top of the rename",
        author: "Alice Example",
        noAccount: true,
        date: "2026-10-01T10:30:00Z",
      },
    ],
    reviews: [
      {
        id: "PRR_bob",
        author: "bob",
        state: "CHANGES_REQUESTED",
        body: "Please keep legacy.py for one release.",
        submittedAt: "2026-10-01T11:00:00Z",
        threads: [
          {
            id: "PRRT_bob",
            path: "util.py",
            side: "RIGHT",
            line: 2,
            comments: [{ id: "PRRC_bob", body: "Nit." }],
          },
        ],
      },
      {
        id: "PRR_carol",
        author: "carol",
        state: "APPROVED",
        submittedAt: "2026-10-01T12:00:00Z",
        threads: [],
      },
      // Pending reviews are not on the timeline: the Reviewer's own is in
      // the gutter, and someone else's is invisible.
      { id: "PRR_mine", author: "reviewer", state: "PENDING", threads: [] },
      { id: "PRR_dave", author: "dave", state: "PENDING", threads: [] },
    ],
  };
  const change = {
    repository: pr.clone,
    base: pr.base,
    head: pr.head,
    pullRequest: { repository: pr.repository, number: pr.number },
  };
  const expectedItems: TimelineItem[] = [
    {
      kind: "description",
      author: { login: "alice" },
      date: "2026-10-01T09:00:00Z",
      body: "Moves the legacy code out of pkg.\n\nPart of the cleanup.",
    },
    {
      kind: "commit",
      author: { login: "alice" },
      date: "2026-10-01T08:55:00Z",
      sha: "1111111",
      headline: "Move legacy code",
    },
    {
      kind: "comment",
      author: { login: "bob" },
      date: "2026-10-01T10:00:00Z",
      body: "Is legacy.py still imported anywhere?",
    },
    {
      kind: "commit",
      author: { login: "Alice Example" },
      date: "2026-10-01T10:30:00Z",
      sha: short(pr.head),
      headline: "Restructure on top of the rename",
    },
    {
      kind: "review",
      author: { login: "bob" },
      date: "2026-10-01T11:00:00Z",
      verdict: "changesRequested",
      body: "Please keep legacy.py for one release.",
      comments: 1,
    },
    {
      kind: "review",
      author: { login: "carol" },
      date: "2026-10-01T12:00:00Z",
      verdict: "approved",
      body: "",
      comments: 0,
    },
  ];
  const expected: Timeline = {
    title: "Restructure pkg",
    pullRequest: "acme/api #21",
    url: "https://github.com/acme/api/pull/21",
    loading: false,
    items: expectedItems,
    checks: {
      commit: short(pr.head),
      status: "failed",
      runs: [
        {
          name: "test",
          status: "passed",
          url: "https://ci.example.com/runs/1",
        },
        {
          name: "lint",
          status: "failed",
          url: "https://ci.example.com/runs/2",
        },
        { name: "deploy preview", status: "running" },
        {
          name: "docs",
          status: "skipped",
          url: "https://ci.example.com/runs/4",
        },
        {
          name: "ci/legacy",
          status: "passed",
          url: "https://legacy-ci.example.com/build/9",
        },
      ],
    },
  };
  const found = new Map<string, unknown>();

  before(async () => {
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      found.set(key, config.inspect(key)?.globalValue);
    await serveGitHub({
      viewer,
      pullRequests: [structuredClone(fakePullRequest)],
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

  after(async () => {
    await releaseLinks();
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      await config.update(
        key,
        found.get(key),
        vscode.ConfigurationTarget.Global
      );
  });

  it("opens with the pull request beside the diff, listing the description, commits, Comments and reviews in order", async () => {
    await openFromInbox(inboxEntry(await inbox(), "Restructure pkg"));

    await eventually(async () =>
      assert.deepStrictEqual(
        withoutAvatars(await renderedTimeline(title)),
        withoutAvatars(expected)
      )
    );
    assert.ok(
      activeTabLabel()?.includes(short(pr.head)),
      `the diff stays the active editor, not "${activeTabLabel()}"`
    );
    const tab = timelineTab(title);
    assert.ok(tab, `a "${title}" tab among ${webviewTabs().join(", ")}`);
    assert.notStrictEqual(
      tab.group,
      vscode.window.tabGroups.activeTabGroup,
      "the timeline is beside the diff, not over it"
    );
    const assistant = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .find((t) => t.label.startsWith("Assistant: "));
    assert.strictEqual(
      tab.group,
      assistant?.group,
      "the timeline shares the Assistant's group instead of adding a column"
    );
  });

  it("shows each author's avatar from the cache, through the webview", async () => {
    const sent = await sentTimeline(title);
    for (const item of sent.items) {
      const { login, avatar } = item.author;
      assert.ok(avatar, `${login} has an avatar`);
      assert.ok(
        avatarBytes(avatar).equals(await avatarServedFor(login)),
        `${login}'s avatar is the one GitHub serves`
      );
    }
  });

  it("opens a check's details page through the extension, and nothing it didn't send", async () => {
    const opened = await catchLinks();
    try {
      await clickLink(title, "https://ci.example.com/runs/2");
      await clickLink(title, "https://github.com/acme/api/pull/21");
      await clickLink(title, "https://evil.example.com/");
      await clickLink(title, "command:workbench.action.terminal.new");

      assert.deepStrictEqual(opened, [
        "https://ci.example.com/runs/2",
        "https://github.com/acme/api/pull/21",
      ]);
    } finally {
      await releaseLinks();
    }
  });

  it("reloads from GitHub when the Reviewer refreshes it", async () => {
    const later = structuredClone(fakePullRequest);
    later.timeline!.push({
      type: "comment",
      author: "carol",
      body: "Ship it.",
      date: "2026-10-01T13:00:00Z",
    });
    later.checks = "SUCCESS";
    later.checkRuns = [
      {
        type: "checkRun",
        name: "lint",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        detailsUrl: "https://ci.example.com/runs/5",
      },
    ];
    await serveGitHub({ viewer, pullRequests: [later] });

    await clickRefresh(title);

    await eventually(async () =>
      assert.deepStrictEqual(withoutAvatars(await renderedTimeline(title)), {
        ...withoutAvatars(expected),
        items: [
          ...expectedItems,
          {
            kind: "comment",
            author: { login: "carol" },
            date: "2026-10-01T13:00:00Z",
            body: "Ship it.",
          },
        ],
        checks: {
          commit: short(pr.head),
          status: "passed",
          runs: [
            {
              name: "lint",
              status: "passed",
              url: "https://ci.example.com/runs/5",
            },
          ],
        },
      })
    );
  });

  it("says what went wrong when GitHub can't give the timeline", async () => {
    await serveGitHub({ viewer, pullRequests: [] });

    await clickRefresh(title);

    await eventually(async () => {
      const timeline = await renderedTimeline(title);
      assert.match(
        timeline?.problem ?? "",
        /^Couldn't load the timeline: No pull request acme\/api#21/
      );
      assert.strictEqual(timeline?.loading, false);
      assert.strictEqual(timeline?.problemAction, "Retry");
    });

    await serveGitHub({
      viewer,
      pullRequests: [structuredClone(fakePullRequest)],
    });
    await clickProblemAction(title);
    await eventually(async () =>
      assert.deepStrictEqual(
        withoutAvatars(await renderedTimeline(title)),
        withoutAvatars(expected)
      )
    );
  });

  it("shows the Reviewer's Review once it is submitted", async () => {
    await submitReview(change, "approve", "Looks good.");

    await eventually(async () => {
      const items = (await renderedTimeline(title))?.items ?? [];
      assert.strictEqual(items.length, expectedItems.length + 1);
      const last = items[items.length - 1];
      assert.deepStrictEqual(
        { ...last, author: { login: last.author.login } },
        {
          kind: "review",
          author: { login: "reviewer" },
          date: last.date,
          verdict: "approved",
          body: "Looks good.",
          comments: 0,
        }
      );
    });
  });

  it("comes back with Show Timeline after the Reviewer closes it", async () => {
    const tab = timelineTab(title);
    assert.ok(tab);
    await vscode.window.tabGroups.close(tab);
    await eventually(() => assert.strictEqual(timelineTab(title), undefined));

    await showTimeline(change);

    await eventually(async () => {
      assert.ok(timelineTab(title), "the timeline is open again");
      const timeline = await renderedTimeline(title);
      assert.strictEqual(timeline?.loading, false);
      assert.strictEqual(timeline?.title, "Restructure pkg");
    });
    assert.ok(
      activeTabLabel()?.includes(short(pr.head)),
      `the diff stays the active editor, not "${activeTabLabel()}"`
    );
  });

  it("closes with the Change", async () => {
    await closeChange(change);

    await eventually(() => assert.strictEqual(timelineTab(title), undefined));
  });

  it("has no timeline for a local Change", async () => {
    const local = { repository: pr.clone, base: pr.base, head: pr.head };
    await openChange(local);
    try {
      await showTimeline(local);

      assert.deepStrictEqual(
        webviewTabs().filter((label) => label.startsWith("Timeline:")),
        []
      );
    } finally {
      await closeChange(local);
    }
  });
});
