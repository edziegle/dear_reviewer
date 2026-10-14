import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { buildPullRequestFixture } from "../fixtures";
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
  bodyText,
  cancelEdit,
  comment,
  commentingLines,
  commentThreads,
  deleteComment,
  editComment,
  threadAt,
  withoutIds,
} from "../review";
import {
  closeChange,
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
    assert.strictEqual(thread.canReply, false);
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

  it("offers no Comments on a local Change", async () => {
    const local = { repository: pr.clone, base: pr.base, head: pr.head };
    const before = workspaceFolders();
    await openChange(local);
    const [localBase, localHead] = foldersAddedSince(before).map((f) => f.path);

    const lines = [
      await commentingLines(path.join(localHead, "util.py")),
      await commentingLines(path.join(localBase, "util.py")),
    ];

    await closeChange(local);
    assert.deepStrictEqual(lines, [[], []]);
  });

  it("leaves the pending review for the next launch", () => {
    leaveForReload({ change, baseDir: base, headDir: head });
  });
});
