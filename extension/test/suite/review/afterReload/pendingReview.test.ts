import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { configure, reviewsOnGitHub, setToken } from "../../github";
import {
  comment,
  commentThreads,
  discardReview,
  reviewInProgressFiles,
  submitReview,
  withoutIds,
} from "../../review";
import { closeChange, eventually } from "../../reviewer";
import { pickUpAfterReload } from "../handoff";

const viewer = { login: "reviewer", token: "test-token" };
const settingKeys = ["githubApiUrl", "repositories"];

// A second launch of the workspace the first review launch left with a pull
// request open and four Comments in its pending review, two of them in one
// thread. The fake GitHub kept the pending review; the token, kept in
// memory, did not survive.
describe("A pull request Review after a reload", () => {
  const { change, baseDir: base, headDir: head } = pickUpAfterReload();
  const found = new Map<string, unknown>();

  before(async () => {
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      found.set(key, config.inspect(key)?.globalValue);
    await configure({ repositories: [change.pullRequest!.repository] });
    await setToken(viewer.token);
  });

  after(async () => {
    await closeChange(change);
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      await config.update(
        key,
        found.get(key),
        vscode.ConfigurationTarget.Global
      );
  });

  it("shows the pending review's Comments again, at their lines and sides", async () => {
    await eventually(async () =>
      assert.deepStrictEqual(await commentThreads(), [
        {
          file: path.join(base, "pkg/legacy.py"),
          lines: [0, 0],
          comments: ["Check the docs and tests too.", "And the changelog."],
          editable: [true, true],
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
          comments: ["Why a docstring here?"],
          editable: [true],
        },
      ])
    );
    await eventually(async () =>
      assert.ok(
        (await reviewInProgressFiles()).includes(path.join(base, "util.py")),
        "a new thread offers Add Review Comment"
      )
    );
  });

  it("submits the Review with its verdict, summary and Comments", async () => {
    await submitReview(
      change,
      "requestChanges",
      "Please explain the docstring."
    );

    assert.deepStrictEqual((await reviewsOnGitHub()).map(withoutIds), [
      {
        author: "reviewer",
        state: "CHANGES_REQUESTED",
        body: "Please explain the docstring.",
        threads: [
          {
            path: "pkg/legacy.py",
            side: "LEFT",
            line: 1,
            comments: ["Check the docs and tests too.", "And the changelog."],
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
            comments: ["Why a docstring here?"],
          },
        ],
      },
    ]);
  });

  it("ends the Review: its Comments stay on the diff, published, and no pending review is left", async () => {
    assert.deepStrictEqual(await commentThreads(), [
      {
        file: path.join(base, "pkg/legacy.py"),
        lines: [0, 0],
        comments: ["Check the docs and tests too.", "And the changelog."],
        editable: [false, false],
      },
      {
        file: path.join(base, "util.py"),
        lines: [0, 1],
        comments: ["The old helper."],
        editable: [false],
      },
      {
        file: path.join(head, "util.py"),
        lines: [0, 2],
        comments: ["Why a docstring here?"],
        editable: [false],
      },
    ]);
    assert.ok(
      (await reviewsOnGitHub()).every((r) => r.state !== "PENDING"),
      "no pending review on GitHub"
    );
    await eventually(async () =>
      assert.deepStrictEqual(
        await reviewInProgressFiles(),
        [],
        "a new thread offers Start Review"
      )
    );
  });

  it("starts a new pending review with the next Comment", async () => {
    await comment(path.join(head, "pkg/sub/new.py"), 0, 0, "Is NEW used?");

    const reviews = await reviewsOnGitHub();
    assert.deepStrictEqual(
      reviews.map((r) => r.state),
      ["CHANGES_REQUESTED", "PENDING"]
    );
    assert.notStrictEqual(reviews[1].id, reviews[0].id);
    assert.deepStrictEqual(withoutIds(reviews[1]).threads, [
      {
        path: "pkg/sub/new.py",
        side: "RIGHT",
        line: 1,
        comments: ["Is NEW used?"],
      },
    ]);
    await eventually(async () =>
      assert.ok(
        (await reviewInProgressFiles()).includes(path.join(head, "util.py"))
      )
    );
  });

  it("submits that one as an approval", async () => {
    await submitReview(change, "approve", "Looks good.");

    const reviews = (await reviewsOnGitHub()).map(withoutIds);
    assert.deepStrictEqual(
      reviews.map((r) => [r.state, r.body, r.threads.length]),
      [
        ["CHANGES_REQUESTED", "Please explain the docstring.", 3],
        ["APPROVED", "Looks good.", 1],
      ]
    );
    assert.deepStrictEqual(
      (await commentThreads()).map((t) => [t.comments, t.editable]),
      [
        [
          ["Check the docs and tests too.", "And the changelog."],
          [false, false],
        ],
        [["The old helper."], [false]],
        [["Is NEW used?"], [false]],
        [["Why a docstring here?"], [false]],
      ]
    );
  });

  it("submits a Review with no Comments, as a plain comment", async () => {
    await submitReview(change, "comment", "Just a note.");

    const reviews = (await reviewsOnGitHub()).map(withoutIds);
    assert.deepStrictEqual(reviews[2], {
      author: "reviewer",
      state: "COMMENTED",
      body: "Just a note.",
      threads: [],
    });
    assert.strictEqual(reviews.length, 3);
  });

  it("discards a pending review with its Comments, publishing nothing", async () => {
    await comment(path.join(head, "util.py"), 0, 0, "Never mind this.");
    assert.strictEqual(
      (await reviewsOnGitHub()).filter((r) => r.state === "PENDING").length,
      1
    );

    await discardReview(change);

    const reviews = (await reviewsOnGitHub()).map(withoutIds);
    assert.deepStrictEqual(
      reviews.map((r) => r.state),
      ["CHANGES_REQUESTED", "APPROVED", "COMMENTED"]
    );
    assert.ok(
      !(await commentThreads()).some((t) =>
        t.comments.includes("Never mind this.")
      ),
      "the discarded Comment left the gutter"
    );
    await eventually(async () =>
      assert.deepStrictEqual(await reviewInProgressFiles(), [])
    );
  });
});
