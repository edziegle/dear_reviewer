import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { renderedPanel, replyTurn, scriptClaude } from "../assistant";
import { buildFixtureRepo } from "../fixtures";
import {
  configure,
  inbox,
  inboxEntry,
  openBranchFromInbox,
  refreshInbox,
  reviewsOnGitHub,
  serveGitHub,
  setToken,
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
} from "../review";
import {
  eventually,
  foldersAddedSince,
  short,
  workspaceFolders,
} from "../reviewer";
import { leaveForReload } from "./handoff";

const viewer = { login: "reviewer", token: "test-token" };

// The first launch: the Reviewer comments on an agent's local branch, and
// the extension keeps the Comments. The second launch (afterReload) finds
// them again and ends the Review with a Brief.
describe("Commenting on a local Change", () => {
  // main is at `renamed`; agent/docs adds `documented` and `restructured`.
  const repo = buildFixtureRepo("local-review");
  repo.git("checkout", "-q", "-b", "agent/docs");
  repo.git("branch", "-f", "main", repo.commits.renamed);
  const change = {
    repository: repo.path,
    base: repo.commits.renamed,
    head: repo.commits.restructured,
  };
  const title = `${path.basename(repo.path)} ${short(change.base)}..${short(change.head)}`;
  let base = "";
  let head = "";

  before(async () => {
    await serveGitHub({ viewer, pullRequests: [] });
    await configure({ repositories: ["acme/local"] });
    await vscode.workspace
      .getConfiguration("dearReviewer")
      .update(
        "localClones",
        { "acme/local": repo.path },
        vscode.ConfigurationTarget.Global
      );
    await setToken(viewer.token);
    scriptClaude({ turns: [replyTurn("A summary.")] });
    await refreshInbox();
    const before = workspaceFolders();
    await openBranchFromInbox(inboxEntry(await inbox(), "agent/docs"));
    [base, head] = foldersAddedSince(before).map((f) => f.path);
    assert.ok(base && head, "the branch opened as a Change");
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(title))?.busy, false)
    );
  });

  it("offers Comments on the diff's lines of both sides, as on a pull request", async () => {
    assert.deepStrictEqual(await commentingLines(path.join(head, "util.py")), [
      [0, 2],
    ]);
    assert.deepStrictEqual(await commentingLines(path.join(base, "util.py")), [
      [0, 1],
    ]);
    assert.deepStrictEqual(
      await commentingLines(path.join(head, "main.py")),
      [],
      "main.py is not part of the Change"
    );
  });

  it("keeps a Comment on a range of the head side, without reaching GitHub", async () => {
    const thread = await comment(
      path.join(head, "util.py"),
      0,
      2,
      "Why a docstring?"
    );

    assert.deepStrictEqual(
      thread.comments.map((c) => bodyText(c)),
      ["Why a docstring?"]
    );
    assert.strictEqual(thread.canReply, false);
    assert.deepStrictEqual(await reviewsOnGitHub(), []);
  });

  it("adds Comments on the base side too", async () => {
    await comment(path.join(base, "pkg/legacy.py"), 0, 0, "Who used this?");
    await comment(path.join(head, "pkg/core.py"), 0, 0, "Never mind this.");

    assert.deepStrictEqual(await commentThreads(), [
      {
        file: path.join(base, "pkg/legacy.py"),
        lines: [0, 0],
        comments: ["Who used this?"],
        editable: [true],
      },
      {
        file: path.join(head, "pkg/core.py"),
        lines: [0, 0],
        comments: ["Never mind this."],
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

  it("edits a Comment", async () => {
    const thread = await threadAt(path.join(head, "util.py"), 0);

    await editComment(thread.comments[0], "Why a docstring here?");

    assert.deepStrictEqual(
      thread.comments.map((c) => [bodyText(c), c.mode]),
      [["Why a docstring here?", vscode.CommentMode.Preview]]
    );
  });

  it("keeps the saved text when an edit is cancelled", async () => {
    const thread = await threadAt(path.join(base, "pkg/legacy.py"), 0);

    await cancelEdit(thread.comments[0], "Forget it.");

    assert.deepStrictEqual(
      thread.comments.map((c) => bodyText(c)),
      ["Who used this?"]
    );
  });

  it("deletes a Comment, and its thread with it", async () => {
    const thread = await threadAt(path.join(head, "pkg/core.py"), 0);

    await deleteComment(thread.comments[0]);

    assert.deepStrictEqual(
      (await commentThreads()).map((t) => [t.file, t.comments]),
      [
        [path.join(base, "pkg/legacy.py"), ["Who used this?"]],
        [path.join(head, "util.py"), ["Why a docstring here?"]],
      ]
    );
  });

  it("leaves the Comments for the next launch", () => {
    leaveForReload({ clone: repo.path, change, baseDir: base, headDir: head });
  });
});
