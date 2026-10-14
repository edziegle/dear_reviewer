import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { buildPullRequestFixture } from "../fixtures";
import {
  configure,
  inbox,
  inboxEntry,
  openFromInbox,
  refreshInbox,
  resolutionsOnGitHub,
  reviewsOnGitHub,
  serveGitHub,
  setToken,
  type FakePullRequest,
} from "../github";
import {
  reply,
  resolveThread,
  reviewThreads,
  submitReview,
  threadAt,
  unresolveThread,
} from "../review";
import {
  closeChange,
  eventually,
  foldersAddedSince,
  workspaceFolders,
} from "../reviewer";

const viewer = { login: "reviewer", token: "test-token" };
const settingKeys = ["githubApiUrl", "repositories", "localClones"];

// Review threads already on a pull request, the Reviewer's teammates' and
// their own, in the gutter of its diff.
describe("Existing review threads", () => {
  const pr = buildPullRequestFixture("threads", "acme/api", 21);
  const fakePullRequest: FakePullRequest = {
    repository: pr.repository,
    number: pr.number,
    title: "Restructure pkg, again",
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
            id: "PRRT_docstring",
            path: "util.py",
            side: "RIGHT",
            startLine: 1,
            line: 3,
            comments: [
              { id: "PRRC_docstring", body: "Why the **docstring**?" },
              {
                id: "PRRC_bob_reply",
                body: "I asked for it.",
                reviewId: "PRR_bob",
              },
            ],
          },
          {
            id: "PRRT_print",
            path: "main.py",
            side: "RIGHT",
            startLine: 2,
            line: 3,
            outdated: true,
            comments: [{ id: "PRRC_print", body: "This print should go." }],
          },
          {
            id: "PRRT_core",
            path: "pkg/core.py",
            side: "RIGHT",
            line: 4,
            outdated: true,
            comments: [{ id: "PRRC_core", body: "Is 2 right?" }],
          },
          {
            id: "PRRT_legacy",
            path: "pkg/legacy.py",
            side: "RIGHT",
            line: 1,
            outdated: true,
            comments: [{ id: "PRRC_legacy", body: "Still needed?" }],
          },
        ],
      },
      {
        id: "PRR_bob",
        author: "bob",
        state: "COMMENTED",
        submittedAt: "2026-10-03T10:00:00Z",
        threads: [
          {
            id: "PRRT_old_name",
            path: "util.py",
            side: "LEFT",
            line: 2,
            resolved: true,
            comments: [{ id: "PRRC_old_name", body: "Keep the old name?" }],
          },
        ],
      },
      {
        id: "PRR_mine",
        author: "reviewer",
        state: "PENDING",
        threads: [
          {
            id: "PRRT_new",
            path: "pkg/sub/new.py",
            side: "RIGHT",
            line: 1,
            comments: [{ id: "PRRC_new", body: "Is NEW used?" }],
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
    await openFromInbox(inboxEntry(await inbox(), "Restructure pkg, again"));
    [base, head] = foldersAddedSince(before).map((f) => f.path);
    assert.ok(base && head, "the pull request opened as a Change");
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

  it("shows every thread at its line and side, ranges included, and outdated ones where they were written", async () => {
    await eventually(async () =>
      assert.deepStrictEqual(await reviewThreads(), [
        {
          // Deleted from the head, so shown on the base's copy.
          file: path.join(base, "pkg/legacy.py"),
          lines: [0, 0],
          comments: [
            { author: "alice", body: "Still needed?", pending: false },
          ],
          label: "Outdated",
          resolved: false,
          canReply: true,
          offers: "resolve",
        },
        {
          file: path.join(base, "util.py"),
          lines: [1, 1],
          comments: [
            { author: "bob", body: "Keep the old name?", pending: false },
          ],
          resolved: true,
          canReply: true,
          offers: "unresolve",
        },
        {
          file: path.join(head, "main.py"),
          lines: [1, 2],
          comments: [
            { author: "alice", body: "This print should go.", pending: false },
          ],
          label: "Outdated",
          resolved: false,
          canReply: true,
          offers: "resolve",
        },
        {
          // Written on line 4; the head's file has one line.
          file: path.join(head, "pkg/core.py"),
          lines: [0, 0],
          comments: [{ author: "alice", body: "Is 2 right?", pending: false }],
          label: "Outdated",
          resolved: false,
          canReply: true,
          offers: "resolve",
        },
        {
          file: path.join(head, "pkg/sub/new.py"),
          lines: [0, 0],
          comments: [
            { author: "reviewer", body: "Is NEW used?", pending: true },
          ],
          resolved: false,
          canReply: false,
        },
        {
          file: path.join(head, "util.py"),
          lines: [0, 2],
          comments: [
            { author: "alice", body: "Why the **docstring**?", pending: false },
            { author: "bob", body: "I asked for it.", pending: false },
          ],
          resolved: false,
          canReply: true,
          offers: "resolve",
        },
      ])
    );
  });

  it("shows teammates' Comments as Markdown, with their avatars", async () => {
    const [first] = (await threadAt(path.join(head, "util.py"), 0)).comments;

    assert.ok(first.body instanceof vscode.MarkdownString);
    assert.strictEqual(first.body.isTrusted, false);
    assert.strictEqual(first.body.supportHtml, false);
    assert.ok(first.author.iconPath instanceof vscode.Uri);
    assert.strictEqual(first.author.iconPath.scheme, "file");
  });

  it("adds a reply to the pending review while one is open", async () => {
    await reply(await threadAt(path.join(head, "util.py"), 0), "Fair enough.");

    const reviews = await reviewsOnGitHub();
    assert.deepStrictEqual(
      reviews.map((r) => [r.id, r.state]),
      [
        ["PRR_alice", "COMMENTED"],
        ["PRR_bob", "COMMENTED"],
        ["PRR_mine", "PENDING"],
      ],
      "no review was published"
    );
    const docstring = reviews[0].threads.find((t) => t.id === "PRRT_docstring");
    assert.deepStrictEqual(
      docstring?.comments.at(-1) && {
        body: docstring.comments.at(-1)!.body,
        reviewId: docstring.comments.at(-1)!.reviewId,
      },
      { body: "Fair enough.", reviewId: "PRR_mine" }
    );
    const shown = (await reviewThreads()).find(
      (t) => t.file === path.join(head, "util.py")
    );
    assert.deepStrictEqual(shown?.comments.at(-1), {
      author: "reviewer",
      body: "Fair enough.",
      pending: true,
    });
  });

  it("keeps the threads after the Review is submitted, with its Comments published", async () => {
    await submitReview(change, "comment", "Two notes.");

    const threads = await reviewThreads();
    assert.strictEqual(threads.length, 6);
    assert.ok(
      threads.every((t) => t.comments.every((c) => !c.pending)),
      "no Comment is pending"
    );
    assert.deepStrictEqual(
      threads.find((t) => t.file === path.join(head, "pkg/sub/new.py")),
      {
        file: path.join(head, "pkg/sub/new.py"),
        lines: [0, 0],
        comments: [
          { author: "reviewer", body: "Is NEW used?", pending: false },
        ],
        resolved: false,
        canReply: true,
        offers: "resolve",
      }
    );
    assert.deepStrictEqual(
      threads
        .find((t) => t.file === path.join(head, "util.py"))
        ?.comments.map((c) => c.body),
      ["Why the **docstring**?", "I asked for it.", "Fair enough."]
    );
  });

  it("publishes a reply at once when no pending review is open", async () => {
    await reply(await threadAt(path.join(base, "util.py"), 1), "Not needed.");

    const reviews = await reviewsOnGitHub();
    assert.ok(
      reviews.every((r) => r.state !== "PENDING"),
      "no pending review was started"
    );
    const oldName = reviews
      .find((r) => r.id === "PRR_bob")
      ?.threads.find((t) => t.id === "PRRT_old_name");
    const replied = oldName?.comments.at(-1);
    assert.strictEqual(replied?.body, "Not needed.");
    const published = reviews.find((r) => r.id === replied?.reviewId);
    assert.deepStrictEqual(published && [published.author, published.state], [
      "reviewer",
      "COMMENTED",
    ]);
    const shown = (await reviewThreads()).find(
      (t) => t.file === path.join(base, "util.py")
    );
    assert.deepStrictEqual(shown?.comments.at(-1), {
      author: "reviewer",
      body: "Not needed.",
      pending: false,
    });
  });

  it("resolves a thread on GitHub", async () => {
    await resolveThread(await threadAt(path.join(head, "util.py"), 0));

    assert.deepStrictEqual(await resolutionsOnGitHub(), [
      { mutation: "resolveReviewThread", threadId: "PRRT_docstring" },
    ]);
    const shown = (await reviewThreads()).find(
      (t) => t.file === path.join(head, "util.py")
    );
    assert.deepStrictEqual(shown && [shown.resolved, shown.offers], [
      true,
      "unresolve",
    ]);
  });

  it("unresolves a thread on GitHub", async () => {
    await unresolveThread(await threadAt(path.join(base, "util.py"), 1));

    assert.deepStrictEqual((await resolutionsOnGitHub()).at(-1), {
      mutation: "unresolveReviewThread",
      threadId: "PRRT_old_name",
    });
    const oldName = (await reviewsOnGitHub())
      .find((r) => r.id === "PRR_bob")
      ?.threads.find((t) => t.id === "PRRT_old_name");
    assert.strictEqual(oldName?.resolved, false);
    const shown = (await reviewThreads()).find(
      (t) => t.file === path.join(base, "util.py")
    );
    assert.deepStrictEqual(shown && [shown.resolved, shown.offers], [
      false,
      "resolve",
    ]);
  });
});
