import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { buildFixtureRepo, buildPullRequestFixture } from "../fixtures";
import {
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
import {
  addReviewComment,
  bodyText,
  cancelEdit,
  comment,
  commentingLines,
  commentThreads,
  deleteComment,
  editComment,
  reviewInProgressFiles,
  reviewThreads,
  threadAt,
  withoutIds,
} from "../review";
import {
  closeChange,
  eventually,
  foldersAddedSince,
  openChange,
  workspaceFolders,
} from "../reviewer";
import { leaveForReload } from "./handoff";

const viewer = { login: "reviewer", token: "test-token" };
const settingKeys = ["githubApiUrl", "repositories", "localClones"];

// The first launch: Comments go into a pending review on GitHub. The second
// launch (afterReload) finds them again and submits the Review.
describe("Commenting on a pull request", () => {
  const pr = buildPullRequestFixture("review", "acme/api", 12);
  const fakePullRequest: FakePullRequest = {
    repository: pr.repository,
    number: pr.number,
    title: "Restructure pkg",
    author: "alice",
    reviewRequested: ["reviewer"],
    files: [
      { path: "pkg/core.py" },
      { path: "pkg/legacy.py" },
      { path: "pkg/sub/new.py" },
      { path: "util.py" },
    ],
  };
  const change = {
    repository: pr.clone,
    base: pr.base,
    head: pr.head,
    pullRequest: { repository: pr.repository, number: pr.number },
  };
  const found = new Map<string, unknown>();
  let base = "";
  let head = "";

  before(async () => {
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      found.set(key, config.inspect(key)?.globalValue);
    await serveGitHub({ viewer, pullRequests: [fakePullRequest] });
    await configure({ repositories: [pr.repository] });
    await config.update(
      "localClones",
      { [pr.repository]: pr.clone },
      vscode.ConfigurationTarget.Global
    );
    await setToken(viewer.token);
    await refreshInbox();
    const before = workspaceFolders();
    await openFromInbox(inboxEntry(await inbox(), "Restructure pkg"));
    [base, head] = foldersAddedSince(before).map((f) => f.path);
    assert.ok(base && head, "the pull request opened as a Change");
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

  it("offers Comments on the diff's lines of both sides, and nowhere else", async () => {
    assert.deepStrictEqual(await commentingLines(path.join(head, "util.py")), [
      [0, 2],
    ]);
    assert.deepStrictEqual(await commentingLines(path.join(base, "util.py")), [
      [0, 1],
    ]);
    assert.deepStrictEqual(
      await commentingLines(path.join(base, "pkg/legacy.py")),
      [[0, 0]]
    );
    assert.deepStrictEqual(
      await commentingLines(path.join(head, "pkg/sub/new.py")),
      [[0, 0]]
    );
    assert.deepStrictEqual(
      await commentingLines(path.join(head, "main.py")),
      [],
      "main.py is not part of the pull request"
    );
  });

  it("saves a Comment on a range of the head side to a new pending review", async () => {
    const thread = await comment(
      path.join(head, "util.py"),
      0,
      2,
      "Why a docstring?"
    );

    assert.deepStrictEqual((await reviewsOnGitHub()).map(withoutIds), [
      {
        author: "reviewer",
        state: "PENDING",
        threads: [
          {
            path: "util.py",
            side: "RIGHT",
            startLine: 1,
            line: 3,
            comments: ["Why a docstring?"],
          },
        ],
      },
    ]);
    assert.deepStrictEqual(
      thread.comments.map((c) => bodyText(c)),
      ["Why a docstring?"]
    );
    assert.strictEqual(thread.canReply, true, "it takes follow-up Comments");
  });

  it("adds Comments on the base side to the same pending review", async () => {
    await comment(path.join(base, "pkg/legacy.py"), 0, 0, "Who used this?");
    await comment(path.join(base, "util.py"), 0, 1, "The old helper.");

    const reviews = await reviewsOnGitHub();
    assert.strictEqual(reviews.length, 1, "one pending review");
    assert.strictEqual(reviews[0].pullRequestId, fakePullRequestId(pr));
    assert.deepStrictEqual(withoutIds(reviews[0]).threads, [
      {
        path: "pkg/legacy.py",
        side: "LEFT",
        line: 1,
        comments: ["Who used this?"],
      },
      {
        path: "util.py",
        side: "LEFT",
        startLine: 1,
        line: 2,
        comments: ["The old helper."],
      },
      {
        path: "util.py",
        side: "RIGHT",
        startLine: 1,
        line: 3,
        comments: ["Why a docstring?"],
      },
    ]);
    assert.deepStrictEqual(await commentThreads(), [
      {
        file: path.join(base, "pkg/legacy.py"),
        lines: [0, 0],
        comments: ["Who used this?"],
        editable: [true],
      },
      {
        file: path.join(base, "util.py"),
        lines: [0, 1],
        comments: ["The old helper."],
        editable: [true],
      },
      {
        file: path.join(head, "util.py"),
        lines: [0, 2],
        comments: ["Why a docstring?"],
        editable: [true],
      },
    ]);
  });

  it("labels a new thread's button by its own Change's Review: Add Review Comment once one is in progress, else Start Review", async () => {
    const sides = (dirs: string[], file: string) =>
      dirs.map((dir) => path.join(dir, file));
    const pullRequestFiles = [
      "pkg/core.py",
      "pkg/legacy.py",
      "pkg/sub/new.py",
      "util.py",
    ].flatMap((file) => sides([base, head], file));
    await eventually(async () =>
      assert.deepStrictEqual(
        [...(await reviewInProgressFiles())].sort(),
        pullRequestFiles.sort()
      )
    );

    const repo = buildFixtureRepo("start-review");
    const local = {
      repository: repo.path,
      base: repo.commits.renamed,
      head: repo.commits.restructured,
    };
    const before = workspaceFolders();
    await openChange(local);
    const localDirs = foldersAddedSince(before).map((f) => f.path);
    try {
      const localUtil = sides(localDirs, "util.py");
      const inProgress = async (file: string) =>
        (await reviewInProgressFiles()).includes(file);
      for (const file of localUtil)
        assert.ok(!(await inProgress(file)), "the local Change has no Review");

      const first = await comment(localUtil[1], 0, 0, "Why?", "startReview");
      await eventually(async () => {
        for (const file of localUtil) assert.ok(await inProgress(file));
      });
      const second = await comment(
        localUtil[1],
        2,
        2,
        "And this?",
        "addToReview"
      );
      assert.deepStrictEqual(
        [first, second].map((t) => t.comments.map((c) => bodyText(c))),
        [["Why?"], ["And this?"]]
      );

      await deleteComment(first.comments[0]);
      await deleteComment(second.comments[0]);
      await eventually(async () => {
        for (const file of localUtil) assert.ok(!(await inProgress(file)));
      });
    } finally {
      await closeChange(local);
    }
    // Opening the local Change stopped the pull request's; its Review waits.
    await openFromInbox(inboxEntry(await inbox(), "Restructure pkg"));
    await eventually(async () =>
      assert.ok(
        (await reviewInProgressFiles()).includes(path.join(head, "util.py")),
        "the pull request's Review is still in progress"
      )
    );
  });

  it("offers Start Review and Add Review Comment, not Add Comment, on a new thread", () => {
    const menus = vscode.extensions.getExtension("edziegle.dear-reviewer")!
      .packageJSON.contributes.menus as Record<
      string,
      { command: string; when?: string }[]
    >;
    const ours = "commentController == dearReviewer.review";
    assert.deepStrictEqual(
      menus["comments/commentThread/context"]
        .filter((m) => m.when?.includes("&& commentThreadIsEmpty"))
        .map((m) => [m.command, m.when]),
      [
        [
          "dearReviewer.startReview",
          `${ours} && commentThreadIsEmpty && resourcePath not in dearReviewer.reviewInProgressFiles`,
        ],
        [
          "dearReviewer.addToReview",
          `${ours} && commentThreadIsEmpty && resourcePath in dearReviewer.reviewInProgressFiles`,
        ],
      ]
    );
  });

  it("edits a Comment on GitHub", async () => {
    const thread = await threadAt(path.join(head, "util.py"), 0);

    await editComment(thread.comments[0], "Why a docstring here?");

    const [review] = (await reviewsOnGitHub()).map(withoutIds);
    assert.deepStrictEqual(
      review.threads.find((t) => t.side === "RIGHT")?.comments,
      ["Why a docstring here?"]
    );
    assert.strictEqual(
      thread.comments[0].mode,
      vscode.CommentMode.Preview,
      "the Comment is no longer being edited"
    );
  });

  it("keeps the saved text when an edit is cancelled", async () => {
    const thread = await threadAt(path.join(base, "util.py"), 0);

    await cancelEdit(thread.comments[0], "Never mind.");

    assert.deepStrictEqual(
      thread.comments.map((c) => [bodyText(c), c.mode]),
      [["The old helper.", vscode.CommentMode.Preview]]
    );
    const [review] = (await reviewsOnGitHub()).map(withoutIds);
    assert.deepStrictEqual(
      review.threads.find((t) => t.path === "util.py" && t.side === "LEFT")
        ?.comments,
      ["The old helper."]
    );
  });

  it("deletes a Comment from GitHub, and its thread with it", async () => {
    const thread = await threadAt(path.join(base, "pkg/legacy.py"), 0);

    await deleteComment(thread.comments[0]);

    const [review] = (await reviewsOnGitHub()).map(withoutIds);
    assert.deepStrictEqual(
      review.threads.map((t) => [t.path, t.side]),
      [
        ["util.py", "LEFT"],
        ["util.py", "RIGHT"],
      ]
    );
    assert.deepStrictEqual(
      (await commentThreads()).map((t) => [t.file, t.comments]),
      [
        [path.join(base, "util.py"), ["The old helper."]],
        [path.join(head, "util.py"), ["Why a docstring here?"]],
      ]
    );
  });

  it("adds a follow-up Comment to a pending thread, in the same pending review", async () => {
    const file = path.join(base, "pkg/legacy.py");
    const thread = await comment(file, 0, 0, "Who used this?", "addToReview");

    await addReviewComment(thread, "Check the docs too.");

    const reviews = await reviewsOnGitHub();
    assert.strictEqual(reviews.length, 1, "no review of its own for the reply");
    const onGitHub = reviews[0].threads.find((t) => t.path === "pkg/legacy.py");
    assert.deepStrictEqual(
      onGitHub?.comments.map((c) => c.body),
      ["Who used this?", "Check the docs too."]
    );
    assert.strictEqual(
      onGitHub?.comments[1].reviewId,
      reviews[0].id,
      "the reply went in with the pending review's id"
    );
    assert.deepStrictEqual(
      (await reviewThreads()).find((t) => t.file === file),
      {
        file,
        lines: [0, 0],
        comments: [
          { author: "reviewer", body: "Who used this?", pending: true },
          { author: "reviewer", body: "Check the docs too.", pending: true },
        ],
        resolved: false,
        canReply: true,
      }
    );
  });

  it("edits and deletes a follow-up Comment on its own", async () => {
    const thread = await threadAt(path.join(base, "pkg/legacy.py"), 0);
    await addReviewComment(thread, "Never mind.");

    await editComment(thread.comments[1], "Check the docs and tests too.");
    await deleteComment(thread.comments[2]);

    const [review] = (await reviewsOnGitHub()).map(withoutIds);
    assert.deepStrictEqual(
      review.threads.find((t) => t.path === "pkg/legacy.py")?.comments,
      ["Who used this?", "Check the docs and tests too."]
    );
    assert.deepStrictEqual(
      thread.comments.map((c) => bodyText(c)),
      ["Who used this?", "Check the docs and tests too."]
    );
  });

  it("keeps a thread whose first Comment is deleted, with its follow-up Comments, as GitHub does", async () => {
    const file = path.join(base, "pkg/legacy.py");
    const thread = await threadAt(file, 0);
    await addReviewComment(thread, "And the changelog.");

    await deleteComment(thread.comments[0]);

    const [review] = (await reviewsOnGitHub()).map(withoutIds);
    assert.deepStrictEqual(
      review.threads.find((t) => t.path === "pkg/legacy.py")?.comments,
      ["Check the docs and tests too.", "And the changelog."]
    );
    assert.deepStrictEqual(
      (await commentThreads()).find((t) => t.file === file),
      {
        file,
        lines: [0, 0],
        comments: ["Check the docs and tests too.", "And the changelog."],
        editable: [true, true],
      }
    );
  });

  it("offers Add Review Comment in a pending thread's reply box, and Reply in the others", () => {
    const menus = vscode.extensions.getExtension("edziegle.dear-reviewer")!
      .packageJSON.contributes.menus as Record<
      string,
      { command: string; when?: string }[]
    >;
    const ours = "commentController == dearReviewer.review";
    assert.deepStrictEqual(
      menus["comments/commentThread/context"]
        .filter((m) => m.when?.includes("!commentThreadIsEmpty"))
        .map((m) => [m.command, m.when]),
      [
        [
          "dearReviewer.replyToThread",
          `${ours} && !commentThreadIsEmpty && commentThread != pending`,
        ],
        [
          "dearReviewer.addToReview",
          `${ours} && !commentThreadIsEmpty && commentThread == pending`,
        ],
      ]
    );
  });

  it("leaves the pending review for the next launch", () => {
    leaveForReload({ change, baseDir: base, headDir: head });
  });
});
