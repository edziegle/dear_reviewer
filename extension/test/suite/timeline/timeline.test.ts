import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import {
  activeDiff,
  changeFiles,
  entryAt,
  markViewed,
  onTab,
  select,
} from "../changeFiles";
import { buildFixtureRepo, buildPullRequestFixture } from "../fixtures";
import {
  avatarServedFor,
  configure,
  fakePullRequestId,
  inbox,
  inboxEntry,
  openFromInbox,
  refreshInbox,
  reviewsOnGitHub,
  serveGitHub,
  setToken,
  type FakePullRequest,
} from "../github";
import { comment, commentingLines, submitReview } from "../review";
import {
  activeTabLabel,
  closeChange,
  eventually,
  foldersAddedSince,
  openChange,
  short,
  workspaceFolders,
} from "../reviewer";
import {
  avatarBytes,
  cancelSubmit,
  catchLinks,
  clickPendingComment,
  clickLink,
  clickOverview,
  clickProblemAction,
  clickRefresh,
  releaseLinks,
  renderedTimeline,
  sentTimeline,
  showTimeline,
  submitInOverview,
  type Timeline,
  type TimelineItem,
} from "../timeline";
import { assistantInSight, closeAssistant, webviewTabs } from "../assistant";
import { standInForTrust } from "../trust";

const viewer = { login: "reviewer", token: "test-token" };
const settingKeys = ["githubApiUrl", "repositories", "localClones"];

/** The timeline without avatar URIs or rendered Markdown, which the tests check separately. */
/**
 * The history and header as the panel shows them, without avatars or
 * rendered Markdown, and without the overview's live parts, which change as
 * the Assistant writes and the Reviewer works.
 */
function withoutAvatars(
  timeline: (Partial<Timeline> & Pick<Timeline, "items">) | undefined
) {
  if (!timeline) return timeline;
  const {
    take: _take,
    readingOrder: _readingOrder,
    standing: _standing,
    review: _review,
    progress: _progress,
    navigationOff: _navigationOff,
    finished: _finished,
    pending: _pending,
    brief: _brief,
    finishAsked: _finishAsked,
    size: _size,
    ...rest
  } = timeline;
  return {
    ...rest,
    items: timeline.items.map((item) => {
      const { html: _, ...plain } = item as TimelineItem & { html?: string };
      return { ...plain, author: { login: item.author.login } };
    }),
  };
}

function htmlOf(item: TimelineItem | undefined): string {
  return item && "html" in item ? (item.html ?? "") : "";
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
  const title = "acme/api #21";
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
  const expected: Omit<Timeline, "take" | "standing"> = {
    title: "Restructure pkg",
    byline: "acme/api #21 · alice → main",
    finish: "Submit Review…",
    history: "Timeline",
    url: "https://github.com/acme/api/pull/21",
    loading: false,
    items: expectedItems,
    checks: {
      commit: short(pr.head),
      status: "failed",
      // What needs the Reviewer leads.
      runs: [
        {
          name: "lint",
          status: "failed",
          url: "https://ci.example.com/runs/2",
        },
        { name: "deploy preview", status: "running" },
        {
          name: "test",
          status: "passed",
          url: "https://ci.example.com/runs/1",
        },
        {
          name: "ci/legacy",
          status: "passed",
          url: "https://legacy-ci.example.com/build/9",
        },
        {
          name: "docs",
          status: "skipped",
          url: "https://ci.example.com/runs/4",
        },
      ],
      attention: 2,
      summary: "1 failed · 1 running · 2 passed · 1 skipped",
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
    if (other.opened) await closeChange(other.request);
    await releaseLinks();
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      await config.update(
        key,
        found.get(key),
        vscode.ConfigurationTarget.Global
      );
  });

  it("opens with the pull request's overview alone, in front, listing the description, commits, Comments and reviews in order", async () => {
    // An earlier test may have left the Assistant's view open.
    await closeAssistant();
    await openFromInbox(inboxEntry(await inbox(), "Restructure pkg"));

    await eventually(async () =>
      assert.deepStrictEqual(
        withoutAvatars(await renderedTimeline(title)),
        withoutAvatars(expected)
      )
    );
    assert.strictEqual(activeTabLabel(), title, "the overview is in front");
    assert.deepStrictEqual(
      vscode.window.tabGroups.all.flatMap((g) => g.tabs.map((t) => t.label)),
      [title],
      "nothing else opens: no diff, no other tab"
    );
    assert.strictEqual(
      await assistantInSight(),
      undefined,
      "the Assistant's view waits until the Reviewer asks"
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

  it("counts the files viewed, and says when navigation is off, with a way to trust the review window", async () => {
    const sent = await sentTimeline(title);
    assert.strictEqual(sent.progress?.viewed, 0);
    assert.ok((sent.progress?.total ?? 0) > 0, "the files are counted");
    assert.notStrictEqual(sent.navigationOff, true);

    let shown = 0;
    await standInForTrust({
      isTrusted: false,
      isReviewWindow: true,
      showWorkspaceTrust: () => shown++,
    });
    try {
      await eventually(async () =>
        assert.strictEqual((await renderedTimeline(title))?.navigationOff, true)
      );
      await clickOverview(title, "trust");
      await eventually(async () => assert.strictEqual(shown, 1));
    } finally {
      await standInForTrust({ isTrusted: true, isReviewWindow: false });
    }
    await eventually(async () =>
      assert.strictEqual((await renderedTimeline(title))?.navigationOff, false)
    );
  });

  it("renders descriptions, Comments and reviews as Markdown, without raw HTML, scripts or remote images", async () => {
    const markdown = structuredClone(fakePullRequest);
    markdown.body = [
      "## Why",
      "",
      "**Bold** and `code`, see [the docs](https://docs.example.com/guide).",
      "",
      '<script>alert("description")</script>',
      '<img src="https://evil.example.com/pixel.png" onerror="alert(1)">',
      "",
      "![screenshot](https://evil.example.com/shot.png)",
      "[sneaky](javascript:alert(2))",
      "",
      "```python",
      "print('hi')",
      "```",
    ].join("\n");
    markdown.timeline![1] = {
      type: "comment",
      author: "bob",
      body: '- one\n- two <b onclick="alert(3)">bold</b>',
      date: "2026-10-01T10:00:00Z",
    };
    markdown.reviews![0].body = "Please *keep* legacy.py.";
    await serveGitHub({ viewer, pullRequests: [markdown] });
    const opened = await catchLinks();
    try {
      await clickRefresh(title);

      await eventually(async () => {
        const items = (await renderedTimeline(title))?.items ?? [];
        assert.strictEqual(items[0]?.kind, "description");
        assert.strictEqual(
          (items[0] as { body: string }).body,
          markdown.body,
          "the body stays as GitHub has it"
        );
      });
      const items = (await renderedTimeline(title))!.items;
      const description = htmlOf(items[0]);
      for (const expected of [
        // Two levels below the overview's own headings.
        "<h4>Why</h4>",
        "<strong>Bold</strong>",
        "<code>code</code>",
        '<a data-href="https://docs.example.com/guide">the docs</a>',
        "<pre><code>print('hi')\n</code></pre>",
      ])
        assert.ok(
          description.includes(expected),
          `${expected} in ${description}`
        );
      for (const html of [description, htmlOf(items[2]), htmlOf(items[4])]) {
        assert.doesNotMatch(html, /<(script|img|b)\b/i, html);
        assert.doesNotMatch(
          html,
          /\son\w+=|(?<![\w-])(href|src)=|data-href="(?!https:)/i,
          html
        );
        assert.doesNotMatch(
          html,
          /alert\("/,
          "a script's text is dropped with it"
        );
      }
      assert.ok(htmlOf(items[2]).includes("<li>one</li>"), htmlOf(items[2]));
      assert.ok(htmlOf(items[4]).includes("<em>keep</em>"), htmlOf(items[4]));
      // The image is a link to it, not an image the webview would load.
      assert.ok(
        description.includes('data-href="https://evil.example.com/shot.png"'),
        description
      );

      await clickLink(title, "https://docs.example.com/guide");
      await clickLink(title, "javascript:alert(2)");
      await clickLink(title, "https://other.example.com/");

      assert.deepStrictEqual(opened, ["https://docs.example.com/guide"]);
    } finally {
      await releaseLinks();
      await serveGitHub({
        viewer,
        pullRequests: [structuredClone(fakePullRequest)],
      });
      await clickRefresh(title);
      await eventually(async () =>
        assert.deepStrictEqual(
          withoutAvatars(await renderedTimeline(title)),
          withoutAvatars(expected)
        )
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
          attention: 0,
          summary: "1 passed",
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
      assert.strictEqual(htmlOf(last), "<p>Looks good.</p>\n");
      const { html: _, ...plain } = last as TimelineItem & { html?: string };
      assert.deepStrictEqual(
        { ...plain, author: { login: last.author.login } },
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
    assert.strictEqual(activeTabLabel(), title, "it comes back in front");
  });

  /** A local Change opened beside the pull request's, so a command can't just take the only one. */
  const otherRepo = buildFixtureRepo("timelineOther");
  const other = {
    request: {
      repository: otherRepo.path,
      base: otherRepo.commits.initial,
      head: otherRepo.commits.restructured,
    },
    title: `${path.basename(otherRepo.path)} ${short(otherRepo.commits.initial)}..${short(otherRepo.commits.restructured)}`,
    opened: false,
    folders: [] as string[],
  };

  /**
   * Opens the other Change, or shows it again, as the Change in front, and
   * puts one of its files in front.
   */
  async function inFrontOfOtherChange(): Promise<void> {
    const before = workspaceFolders();
    await openChange(other.request);
    if (!other.opened) {
      other.opened = true;
      other.folders = foldersAddedSince(before).map((f) => f.path);
    }
    await select(entryAt(await changeFiles(), other.title, "main.py"));
    await eventually(() =>
      assert.ok(activeTabLabel()?.startsWith("main.py"), activeTabLabel())
    );
  }

  /** A file of the pull request's Change, in its head worktree. */
  function pullRequestFile(file: string): vscode.Uri {
    const head = workspaceFolders().find(
      (f) =>
        f.name.endsWith(`head ${short(pr.head)}`) &&
        !other.folders.includes(f.path)
    );
    assert.ok(head, "the pull request's head worktree is open");
    return vscode.Uri.file(path.join(head.path, file));
  }

  /**
   * Waits for the overview's Submit step to open in front, with the focus,
   * then approves with an empty summary, until GitHub has one more Review of
   * the pull request.
   */
  async function approveInSubmitStep(reviewsBefore: number): Promise<void> {
    await eventually(async () => {
      assert.strictEqual(activeTabLabel(), title);
      assert.ok((await sentTimeline(title)).submit, "the Submit step is open");
    });
    await submitInOverview(title, "approve", "");
    await eventually(async () => {
      const reviews = (await reviewsOnGitHub()).filter(
        (r) => r.author === "reviewer" && r.state !== "PENDING"
      );
      assert.strictEqual(reviews.length, reviewsBefore + 1);
      assert.strictEqual(reviews.at(-1)?.pullRequestId, fakePullRequestId(pr));
      assert.strictEqual((await sentTimeline(title)).submit, undefined);
    }, 20_000);
  }

  async function submittedReviews(): Promise<number> {
    return (await reviewsOnGitHub()).filter(
      (r) => r.author === "reviewer" && r.state !== "PENDING"
    ).length;
  }

  it("offers Show Overview on a Change's files and Change Files, and Submit Review… and Write Brief… in the palette", () => {
    const menus = vscode.extensions.getExtension("edziegle.dear-reviewer")!
      .packageJSON.contributes.menus as Record<
      string,
      { command: string; when?: string; group?: string }[]
    >;
    const entries = (menu: string, ...commands: string[]) =>
      menus[menu]
        .filter((m) => commands.includes(m.command))
        .map((m) => [m.command, m.when, m.group]);
    const onChangeFile =
      "resourcePath =~ /edziegle\\.dear-reviewer\\/changes\\// || resourceScheme == dear-reviewer-commit";
    assert.deepStrictEqual(
      entries(
        "editor/title",
        "dearReviewer.showTimeline",
        "dearReviewer.finishReview"
      ),
      // Off the navigation group, in the editor's … menu. Finishing is in
      // the overview it brings back.
      [["dearReviewer.showTimeline", onChangeFile, "1_dearReviewer@1"]]
    );
    // One name for each way to finish; the key runs whichever fits.
    assert.deepStrictEqual(
      entries(
        "commandPalette",
        "dearReviewer.submitReview",
        "dearReviewer.writeBrief",
        "dearReviewer.finishReview"
      ),
      [
        [
          "dearReviewer.submitReview",
          "dearReviewer.hasOpenChange && dearReviewer.frontIsPullRequest",
          undefined,
        ],
        [
          "dearReviewer.writeBrief",
          "dearReviewer.hasOpenChange && !dearReviewer.frontIsPullRequest && dearReviewer.frontHasComments",
          undefined,
        ],
        ["dearReviewer.finishReview", "false", undefined],
      ]
    );
    const onChangeFiles =
      "view == dearReviewer.changeFiles && dearReviewer.hasOpenChange";
    assert.deepStrictEqual(
      entries(
        "view/title",
        "dearReviewer.finishReview",
        "dearReviewer.showTimeline"
      ),
      [["dearReviewer.showTimeline", onChangeFiles, "navigation@1"]]
    );
  });

  it("shows the overview of the Change in front from Change Files' title bar", async () => {
    await inFrontOfOtherChange();
    const tab = timelineTab(other.title);
    if (tab) await vscode.window.tabGroups.close(tab);

    // A view's title bar runs the command with no argument.
    await vscode.commands.executeCommand("dearReviewer.showTimeline");

    await eventually(() => assert.strictEqual(activeTabLabel(), other.title));
  });

  it("comes back from a file's title bar for that file's Change, with another Change's file in front", async () => {
    const tab = timelineTab(title);
    if (tab) await vscode.window.tabGroups.close(tab);
    await inFrontOfOtherChange();

    await onTab("showTimeline", pullRequestFile("util.py"));

    await eventually(() => assert.strictEqual(activeTabLabel(), title));
  });

  it("does nothing from the title bar of a file of no Change open here, rather than act on the Change in front", async () => {
    await inFrontOfOtherChange();
    const tab = timelineTab(other.title);
    if (tab) await vscode.window.tabGroups.close(tab);
    const closedChangeFile = vscode.Uri.file(
      path.join(
        path.dirname(other.folders[0]),
        "edziegle.dear-reviewer/changes/closed/head/util.py"
      )
    );

    await onTab("showTimeline", closedChangeFile);

    assert.ok(activeTabLabel()?.startsWith("main.py"), activeTabLabel());
    assert.strictEqual(timelineTab(other.title), undefined);
  });

  it("ends the Review in the overview's Submit step, listing the Comments it publishes", async () => {
    const file = pullRequestFile("util.py").fsPath;
    const [[line]] = await commentingLines(file);
    await comment(file, line, line, "Rename this.\n\nIt reads better.");
    await inFrontOfOtherChange();
    const before = await submittedReviews();

    await vscode.commands.executeCommand("dearReviewer.submitReview", change);

    await eventually(async () => {
      assert.strictEqual(activeTabLabel(), title);
      const step = (await sentTimeline(title)).submit;
      assert.deepStrictEqual(
        step?.verdicts.map((v) => v.label),
        ["Comment", "Approve", "Request Changes"]
      );
      assert.deepStrictEqual(step?.comments, [
        {
          path: "util.py",
          side: "RIGHT",
          line: line + 1,
          text: "Rename this.",
        },
      ]);
      // A Comment is something to say, so every verdict can go without a summary.
      assert.deepStrictEqual(step?.needsSummary, {});
    });

    await clickPendingComment(title, 0);
    await eventually(() =>
      assert.strictEqual(
        vscode.window.activeTextEditor?.document.uri.fsPath,
        file
      )
    );

    await submitInOverview(title, "comment", "");
    await eventually(async () => {
      assert.strictEqual(await submittedReviews(), before + 1);
      const timeline = await sentTimeline(title);
      assert.strictEqual(timeline.submit, undefined);
      assert.strictEqual(
        timeline.submitted?.text,
        "Commented on acme/api #21 and published 1 Comment."
      );
      assert.strictEqual(timeline.review?.verdict, "commented");
    }, 20_000);
  });

  it("opens the Submit step for a file's Change from its finishing key, and says why GitHub would refuse a verdict", async () => {
    await inFrontOfOtherChange();
    const before = await submittedReviews();

    void onTab("finishReview", pullRequestFile("util.py"));

    await eventually(async () => {
      assert.strictEqual(activeTabLabel(), title);
      const step = (await sentTimeline(title)).submit;
      assert.deepStrictEqual(step?.comments, []);
      assert.deepStrictEqual(Object.keys(step?.needsSummary ?? {}).sort(), [
        "comment",
        "requestChanges",
      ]);
    });

    await submitInOverview(title, "requestChanges", "  ");
    await eventually(async () =>
      assert.match(
        (await sentTimeline(title)).submit?.problem ?? "",
        /^Write a summary/
      )
    );
    assert.strictEqual(await submittedReviews(), before);

    await cancelSubmit(title);
    await eventually(async () =>
      assert.strictEqual((await sentTimeline(title)).submit, undefined)
    );

    void onTab("finishReview", pullRequestFile("util.py"));
    await approveInSubmitStep(before);
    assert.strictEqual(
      (await sentTimeline(title)).submitted?.text,
      "Approved acme/api #21."
    );
  });

  it("offers only Comment on the Reviewer's own pull request, which GitHub takes no other verdict on", async () => {
    await serveGitHub({
      viewer,
      pullRequests: [
        { ...structuredClone(fakePullRequest), author: "reviewer" },
      ],
    });
    try {
      await clickRefresh(title);
      await eventually(async () =>
        assert.match((await sentTimeline(title)).byline, /reviewer → /)
      );

      await vscode.commands.executeCommand("dearReviewer.submitReview", change);

      await eventually(async () => {
        const step = (await sentTimeline(title)).submit;
        assert.deepStrictEqual(
          step?.verdicts.map((v) => v.label),
          ["Comment"]
        );
        assert.match(step?.note ?? "", /own pull request/);
      });
      await cancelSubmit(title);
    } finally {
      await serveGitHub({
        viewer,
        pullRequests: [structuredClone(fakePullRequest)],
      });
      await clickRefresh(title);
    }
  });

  it("offers to finish the Review once stepping finds every file viewed", async () => {
    // Change Files lists only the Change in front.
    await openChange(change);
    await markViewed(
      entryAt(
        await changeFiles(),
        `${path.basename(pr.clone)} ${short(pr.base)}..${short(pr.head)}`
      )
    );
    await inFrontOfOtherChange();
    const before = await submittedReviews();

    await vscode.commands.executeCommand(
      "dearReviewer.nextUnviewedFile",
      change
    );
    // The overview comes forward, with the focus on its filled Submit Review….
    await eventually(async () => {
      assert.strictEqual(activeTabLabel(), title);
      assert.ok((await sentTimeline(title)).finishAsked, "asked to focus it");
    });
    await clickOverview(title, "finish");
    await approveInSubmitStep(before);
  });

  it("closes with the Change, from the Close Change that ends its Review", async () => {
    await clickOverview(title, "closeChange");

    await eventually(() => assert.strictEqual(timelineTab(title), undefined));
  });

  it("counts a local Change's pending Comments for its overview, none before its first", async () => {
    const local = { repository: pr.clone, base: pr.base, head: pr.head };
    const localTitle = `${path.basename(pr.clone)} ${short(pr.base)}..${short(pr.head)}`;
    await openChange(local);
    try {
      await eventually(async () =>
        assert.strictEqual((await sentTimeline(localTitle)).pending, 0)
      );
    } finally {
      await closeChange(local);
    }
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

  it("leaves a file the Reviewer opens as the Change opens in front, once the overview has loaded", async () => {
    const local = { repository: pr.clone, base: pr.base, head: pr.head };
    const localTitle = `${path.basename(pr.clone)} ${short(pr.base)}..${short(pr.head)}`;
    await openChange(local);
    try {
      // On a slow machine the overview's webview is still loading here, and
      // takes the focus it was shown with only once it is ready.
      await select(entryAt(await changeFiles(), localTitle, "pkg", "core.py"));
      await eventually(async () =>
        assert.ok(await renderedTimeline(localTitle), "the overview rendered")
      );

      assert.strictEqual(
        path.basename(activeDiff().modified.fsPath),
        "core.py",
        "the file is in front"
      );
    } finally {
      await closeChange(local);
    }
  });
});
