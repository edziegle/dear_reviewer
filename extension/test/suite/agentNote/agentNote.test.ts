import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import {
  assistantRuns,
  releaseClaude,
  replyTurn,
  scriptClaude,
  showAssistant,
  summaryWritten,
  userMessages,
  waitFor,
} from "../assistant";
import { buildPullRequestFixture } from "../fixtures";
import {
  configure,
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
  addAgentNote,
  bodyText,
  cancelEditComment,
  comment,
  deleteComment,
  editComment,
  reply,
  saveComment,
  threadAt,
} from "../review";
import {
  catchErrors,
  catchNotifications,
  closeChange,
  eventually,
  foldersAddedSince,
  releaseErrors,
  releaseNotifications,
  short,
  workspaceFolders,
} from "../reviewer";

const viewer = { login: "reviewer", token: "test-token" };
const settingKeys = ["githubApiUrl", "repositories", "localClones"];

/** What the Assistant replies with a note. */
function noteTurn(note: string): Record<string, unknown>[] {
  return replyTurn(JSON.stringify({ note }));
}

// The Reviewer asks the Assistant for a short note for agents under a pending
// Comment on a pull request. The Comment on GitHub changes only when they
// save it.
describe("Agent notes under pending Comments on a pull request", () => {
  const pr = buildPullRequestFixture("agentnote", "acme/api", 41);
  const fakePullRequest: FakePullRequest = {
    repository: pr.repository,
    number: pr.number,
    title: "Restructure pkg, with Agent notes",
    author: "alice",
    reviewRequested: ["reviewer"],
    files: [
      { path: "pkg/core.py" },
      { path: "pkg/legacy.py" },
      { path: "pkg/sub/new.py" },
      { path: "util.py" },
    ],
    reviews: [
      {
        id: "PRR_alice",
        author: "alice",
        state: "COMMENTED",
        submittedAt: "2026-10-02T10:00:00Z",
        threads: [
          {
            id: "PRRT_core",
            path: "pkg/core.py",
            side: "RIGHT",
            line: 1,
            comments: [{ id: "PRRC_core", body: "Is 2 right?" }],
          },
        ],
      },
    ],
  };
  const change = {
    repository: pr.clone,
    base: pr.base,
    head: pr.head,
    pullRequest: { repository: pr.repository, number: pr.number },
  };
  const title = `${path.basename(pr.clone)} ${short(pr.base)}..${short(pr.head)}`;
  const found = new Map<string, unknown>();
  let head = "";

  /** The bodies of the Reviewer's pending Comments on GitHub, by file. */
  async function pendingOnGitHub(): Promise<[string, string[]][]> {
    return (await reviewsOnGitHub())
      .filter((r) => r.author === "reviewer" && r.state === "PENDING")
      .flatMap((r) => r.threads)
      .filter((t) => t.comments.length > 0)
      .map((t): [string, string[]] => [t.path, t.comments.map((c) => c.body)])
      .sort((a, b) => a[0].localeCompare(b[0]));
  }

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
    await scriptClaude(change, { turns: [replyTurn("A summary.")] });
    await refreshInbox();
    const before = workspaceFolders();
    await openFromInbox(
      inboxEntry(await inbox(), "Restructure pkg, with Agent notes")
    );
    [, head] = foldersAddedSince(before).map((f) => f.path);
    assert.ok(head, "the pull request opened as a Change");
    await summaryWritten(title);
    await showAssistant(change);
  });

  afterEach(async () => {
    await releaseNotifications();
    await releaseErrors();
  });

  after(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await closeChange(change);
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      await config.update(
        key,
        found.get(key),
        vscode.ConfigurationTarget.Global
      );
  });

  it("is offered on a pending Comment of a pull request, and on no other Comment", async () => {
    const menus = vscode.extensions.getExtension("edziegle.dear-reviewer")!
      .packageJSON.contributes.menus as Record<
      string,
      { command: string; when?: string }[]
    >;
    assert.deepStrictEqual(
      menus["comments/comment/title"]
        .filter((m) => m.command === "dearReviewer.addAgentNote")
        .map((m) => m.when),
      ["commentController == dearReviewer.review && comment == pending"]
    );

    const own = await comment(
      path.join(head, "util.py"),
      0,
      2,
      "Why a docstring?"
    );
    const theirs = await threadAt(path.join(head, "pkg/core.py"), 0);
    await reply(theirs, "It should be 3.");

    assert.deepStrictEqual(
      [own, theirs].map((t) => t.comments.map((c) => c.contextValue)),
      [["pending"], [undefined, "pending"]],
      "a new thread's Comment and a reply in someone else's thread went into the pending review; the published Comment has no context value"
    );
  });

  it("opens the Comment for editing with the note under the Reviewer's text, and leaves GitHub alone until they save", async () => {
    const thread = await threadAt(path.join(head, "util.py"), 0);
    const notifications = await catchNotifications();
    await scriptClaude(change, {
      turns: [
        noteTurn(
          "The docstring is gone from new_helper. Add a one-line docstring, as in `util.py:2`. ![x](https://evil.test/p?d=1) Ask @octocat."
        ),
      ],
    });

    await addAgentNote(thread.comments[0]);

    assert.strictEqual(
      bodyText(thread.comments[0]),
      "Why a docstring?\n\n**For agents:** The docstring is gone from new_helper. Add a one-line docstring, as in `util.py:2`. Ask `@octocat`."
    );
    assert.strictEqual(thread.comments[0].mode, vscode.CommentMode.Editing);
    assert.deepStrictEqual(
      notifications.map((n) => n.message),
      ["Repaired the Agent note: removed images and neutralised @mentions."]
    );
    assert.deepStrictEqual(await pendingOnGitHub(), [
      ["util.py", ["Why a docstring?"]],
    ]);
    const [run, ...others] = await assistantRuns(change);
    assert.deepStrictEqual(others, [], "one run of claude");
    const prompt = userMessages(run).at(-1);
    for (const expected of [
      "Why a docstring?",
      "util.py:1-3",
      "def new_helper():",
      '"""Two."""',
      "The Reviewer's Comment:",
    ])
      assert.ok(prompt?.includes(expected), `${expected} in ${prompt}`);
  });

  it("leaves the Comment on GitHub as it was when the Reviewer cancels", async () => {
    const thread = await threadAt(path.join(head, "util.py"), 0);

    await cancelEditComment(thread.comments[0]);

    assert.strictEqual(bodyText(thread.comments[0]), "Why a docstring?");
    assert.strictEqual(thread.comments[0].mode, vscode.CommentMode.Preview);
    assert.deepStrictEqual(
      (await pendingOnGitHub()).find(([file]) => file === "util.py"),
      ["util.py", ["Why a docstring?"]]
    );
  });

  it("puts the note in the pending review when the Reviewer saves", async () => {
    const thread = await threadAt(path.join(head, "util.py"), 0);
    await scriptClaude(change, {
      turns: [
        noteTurn(
          "Without a docstring, new_helper has no description. Add one, as in `util.py:2`."
        ),
      ],
    });

    await addAgentNote(thread.comments[0]);
    await saveComment(thread.comments[0]);

    const saved =
      "Why a docstring?\n\n**For agents:** Without a docstring, new_helper has no description. Add one, as in `util.py:2`.";
    assert.strictEqual(bodyText(thread.comments[0]), saved);
    assert.strictEqual(thread.comments[0].mode, vscode.CommentMode.Preview);
    await eventually(async () =>
      assert.deepStrictEqual(
        (await pendingOnGitHub()).find(([file]) => file === "util.py"),
        ["util.py", [saved]]
      )
    );
  });

  it("replaces the note when asked again, and keeps the Reviewer's text", async () => {
    const thread = await threadAt(path.join(head, "util.py"), 0);
    await scriptClaude(change, {
      turns: [noteTurn("Add a docstring to new_helper.")],
    });

    await addAgentNote(thread.comments[0]);

    assert.strictEqual(
      bodyText(thread.comments[0]),
      "Why a docstring?\n\n**For agents:** Add a docstring to new_helper."
    );
    const [run] = await assistantRuns(change);
    const prompt = userMessages(run).at(-1);
    assert.ok(
      !prompt?.includes("Without a docstring"),
      "the earlier note is not part of the Comment the Assistant is given"
    );
    await cancelEditComment(thread.comments[0]);
  });

  it("gives the Assistant the thread's earlier Comments, fenced, for a reply in someone else's thread", async () => {
    const thread = await threadAt(path.join(head, "pkg/core.py"), 0);
    await scriptClaude(change, {
      turns: [noteTurn("The value must be 3. Change `pkg/core.py:1`.")],
    });

    await addAgentNote(thread.comments[1]);

    assert.strictEqual(
      bodyText(thread.comments[1]),
      "It should be 3.\n\n**For agents:** The value must be 3. Change `pkg/core.py:1`."
    );
    const [run] = await assistantRuns(change);
    const prompt = userMessages(run).at(-1) ?? "";
    assert.ok(prompt.includes("by alice"), prompt);
    assert.ok(
      prompt.split("\n").includes("Is 2 right?"),
      "alice's Comment sits on a line of its own, inside a fence"
    );
    await cancelEditComment(thread.comments[1]);
  });

  it("adds no note when the Assistant gives none, and shows its reason", async () => {
    const thread = await threadAt(path.join(head, "util.py"), 0);
    const notifications = await catchNotifications();
    await scriptClaude(change, {
      turns: [
        replyTurn(
          JSON.stringify({
            noNote: "The Comment already says what to change.",
          })
        ),
      ],
    });
    const before = bodyText(thread.comments[0]);

    await addAgentNote(thread.comments[0]);

    assert.strictEqual(bodyText(thread.comments[0]), before);
    assert.strictEqual(thread.comments[0].mode, vscode.CommentMode.Preview);
    assert.deepStrictEqual(
      notifications.map((n) => n.message),
      ["No Agent note: The Comment already says what to change."]
    );
  });

  it("refuses a note over 600 characters, and a reply that is neither a note nor a reason", async () => {
    const thread = await threadAt(path.join(head, "util.py"), 0);
    const errors = await catchErrors();
    const before = bodyText(thread.comments[0]);
    await scriptClaude(change, { turns: [noteTurn("x".repeat(601))] });

    await addAgentNote(thread.comments[0]);
    await scriptClaude(change, {
      turns: [replyTurn("Here is a note: add a docstring.")],
    });
    await addAgentNote(thread.comments[0]);

    assert.strictEqual(bodyText(thread.comments[0]), before);
    assert.deepStrictEqual(
      errors.map((e) => e.message),
      [
        "The Assistant's note is 601 characters, over the 600 the Agent note may have. Try again.",
        "The Assistant's reply was not a note or a reason for none. Try again.",
      ]
    );
  });

  it("drops the note when the Comment is deleted while the Assistant writes", async () => {
    const thread = await comment(
      path.join(head, "pkg/sub/new.py"),
      0,
      0,
      "Is NEW used?"
    );
    const errors = await catchErrors();
    await scriptClaude(change, {
      turns: [
        [
          ...noteTurn("Find the callers of NEW.").slice(0, 2),
          waitFor("note-deleted"),
          ...noteTurn("Find the callers of NEW.").slice(2),
        ],
      ],
    });

    const asking = Promise.resolve(addAgentNote(thread.comments[0]));
    await eventually(async () =>
      assert.strictEqual((await assistantRuns(change)).length, 1)
    );
    await deleteComment(thread.comments[0]);
    releaseClaude("note-deleted");
    await asking;

    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(
      (await pendingOnGitHub()).map(([file]) => file),
      ["util.py"]
    );
  });

  it("puts the note under the body as it stands when the note arrives, if the Reviewer edited it meanwhile", async () => {
    const thread = await comment(
      path.join(head, "pkg/sub/new.py"),
      0,
      0,
      "Is NEW used?"
    );
    await scriptClaude(change, {
      turns: [
        [
          ...noteTurn("Find the callers of NEW.").slice(0, 2),
          waitFor("note-edited"),
          ...noteTurn("Find the callers of NEW.").slice(2),
        ],
      ],
    });

    const asking = Promise.resolve(addAgentNote(thread.comments[0]));
    await eventually(async () =>
      assert.strictEqual((await assistantRuns(change)).length, 1)
    );
    await editComment(thread.comments[0], "Is NEW used anywhere?");
    releaseClaude("note-edited");
    await asking;

    assert.strictEqual(
      bodyText(thread.comments[0]),
      "Is NEW used anywhere?\n\n**For agents:** Find the callers of NEW."
    );
    await cancelEditComment(thread.comments[0]);
  });
});
