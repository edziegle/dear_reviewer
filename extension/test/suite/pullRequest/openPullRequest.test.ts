import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  activeDiff,
  changeFiles,
  entryAt,
  markViewed,
  render,
  select,
  unmarkViewed,
} from "../changeFiles";
import { buildPullRequestFixture } from "../fixtures";
import {
  configure,
  fakePullRequestId,
  inbox,
  inboxEntry,
  openFromInbox,
  refreshInbox,
  serveGitHub,
  setToken,
  viewedMarksOnGitHub,
  type FakePullRequest,
} from "../github";
import {
  activeTabLabel,
  closeChange,
  eventually,
  foldersAddedSince,
  gitIn,
  multiDiffFiles,
  short,
  workspaceFolders,
  worktreesOf,
} from "../reviewer";

const viewer = { login: "reviewer", token: "test-token" };
const settingKeys = ["githubApiUrl", "repositories", "localClones"];

describe("Opening a pull request from the Inbox", () => {
  const pr = buildPullRequestFixture("pr", "acme/api", 7);
  const title = `${path.basename(pr.clone)} ${short(pr.base)}..${short(pr.head)}`;
  const fakePullRequest: FakePullRequest = {
    repository: pr.repository,
    number: pr.number,
    title: "Restructure pkg",
    author: "alice",
    reviewRequested: ["reviewer"],
    files: [
      { path: "pkg/core.py", viewed: "VIEWED" },
      { path: "pkg/legacy.py" },
      { path: "pkg/sub/new.py" },
      // Viewed, then changed by a later commit: github.com shows it unviewed.
      { path: "util.py", viewed: "DISMISSED" },
    ],
  };
  const pullRequestRequest = {
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

  async function servePullRequest(): Promise<void> {
    await serveGitHub({
      viewer,
      pullRequests: [structuredClone(fakePullRequest)],
    });
    await configure({ repositories: [pr.repository] });
    await setToken(viewer.token);
    await refreshInbox();
  }

  async function openFromTheInbox(): Promise<void> {
    await openFromInbox(inboxEntry(await inbox(), "Restructure pkg"));
  }

  it("asks for the repository's local clone when none is set, and opens nothing", async () => {
    await vscode.workspace
      .getConfiguration("dearReviewer")
      .update("localClones", {}, vscode.ConfigurationTarget.Global);
    await servePullRequest();
    const before = workspaceFolders();

    await openFromTheInbox();

    assert.deepStrictEqual(workspaceFolders(), before);
  });

  it("fetches its head ref and creates worktrees at the merge base and head", async () => {
    await vscode.workspace
      .getConfiguration("dearReviewer")
      .update(
        "localClones",
        { "ACME/api": pr.clone },
        vscode.ConfigurationTarget.Global
      );
    await servePullRequest();
    assert.throws(
      () => gitIn(pr.clone, "cat-file", "-e", `${pr.head}^{commit}`),
      "the clone doesn't have the pull request's head yet"
    );
    const before = workspaceFolders();

    await openFromTheInbox();

    const added = foldersAddedSince(before);
    const name = path.basename(pr.clone);
    assert.deepStrictEqual(
      added.map((f) => f.name),
      [`${name} base ${short(pr.base)}`, `${name} head ${short(pr.head)}`]
    );
    [base, head] = added.map((f) => f.path);
    assert.strictEqual(gitIn(base, "rev-parse", "HEAD"), pr.base);
    assert.strictEqual(gitIn(head, "rev-parse", "HEAD"), pr.head);
    const worktrees = worktreesOf(pr.clone);
    for (const dir of [base, head]) {
      assert.deepStrictEqual(
        worktrees.find((w) => w.path === dir),
        { path: dir, detached: true },
        `${dir} is a detached worktree of the clone`
      );
    }
  });

  it("opens with its overview, and shows its diff and files as for a local Change once asked", async () => {
    const overview = `${pr.repository} #${pr.number}`;
    await eventually(() => assert.strictEqual(activeTabLabel(), overview));

    // Run from the overview, the command acts on its Change.
    await vscode.commands.executeCommand("dearReviewer.openAllChanges");

    await eventually(() =>
      assert.ok(
        activeTabLabel()?.startsWith(`${overview} · all changes`),
        activeTabLabel()
      )
    );
    await eventually(() =>
      assert.deepStrictEqual(multiDiffFiles(), [
        {
          original: path.join(base, "pkg/core.py"),
          modified: path.join(head, "pkg/core.py"),
        },
        { original: path.join(base, "pkg/legacy.py"), modified: undefined },
        { original: undefined, modified: path.join(head, "pkg/sub/new.py") },
        {
          original: path.join(base, "util.py"),
          modified: path.join(head, "util.py"),
        },
      ])
    );

    const tree = await changeFiles();
    await select(entryAt(tree, title, "pkg", "core.py"));
    await eventually(() => {
      const diff = activeDiff();
      assert.strictEqual(diff.original.fsPath, path.join(base, "pkg/core.py"));
      assert.strictEqual(diff.modified.fsPath, path.join(head, "pkg/core.py"));
    });
  });

  it("reads viewed state from GitHub", async () => {
    assert.deepStrictEqual(render(await changeFiles()), [
      `${title} — ▰▰▱▱▱▱▱ 1/4`,
      "  pkg",
      "    sub",
      "      new.py [A]",
      "    core.py [M] (viewed)",
      "    legacy.py [D]",
      "  util.py [M]",
    ]);
  });

  it("marks and unmarks files viewed on GitHub", async () => {
    let tree = await changeFiles();
    await markViewed(entryAt(tree, title, "pkg", "sub", "new.py"));
    await unmarkViewed(entryAt(tree, title, "pkg", "core.py"));
    tree = await changeFiles();
    await markViewed(entryAt(tree, title, "util.py"));

    const id = fakePullRequestId(pr);
    assert.deepStrictEqual(await viewedMarksOnGitHub(), [
      {
        mutation: "markFileAsViewed",
        pullRequestId: id,
        path: "pkg/sub/new.py",
      },
      {
        mutation: "unmarkFileAsViewed",
        pullRequestId: id,
        path: "pkg/core.py",
      },
      { mutation: "markFileAsViewed", pullRequestId: id, path: "util.py" },
    ]);
    assert.deepStrictEqual(render(await changeFiles()), [
      `${title} — ▰▰▰▰▱▱▱ 2/4`,
      "  pkg",
      "    sub",
      "      new.py [A] (viewed)",
      "    core.py [M]",
      "    legacy.py [D]",
      "  util.py [M] (viewed)",
    ]);
  });

  it("marks every file under a directory viewed on GitHub at once", async () => {
    await servePullRequest();

    await markViewed(entryAt(await changeFiles(), title, "pkg"));

    const id = fakePullRequestId(pr);
    assert.deepStrictEqual(
      (await viewedMarksOnGitHub()).map((m) => [m.mutation, m.path]),
      [
        ["markFileAsViewed", "pkg/core.py"],
        ["markFileAsViewed", "pkg/legacy.py"],
        ["markFileAsViewed", "pkg/sub/new.py"],
      ]
    );
    assert.ok(
      (await viewedMarksOnGitHub()).every((m) => m.pullRequestId === id)
    );
    assert.strictEqual(
      render(await changeFiles())[0],
      `${title} — ▰▰▰▰▰▱▱ 3/4`
    );
  });

  it("reuses its existing worktrees when it is opened again", async () => {
    assert.ok(head, "the pull request is open");
    const marker = path.join(head, "reviewer-was-here.txt");
    fs.writeFileSync(marker, "still here\n");
    const before = workspaceFolders();
    const worktreesBefore = worktreesOf(pr.clone);

    await openFromTheInbox();

    assert.deepStrictEqual(workspaceFolders(), before);
    assert.deepStrictEqual(worktreesOf(pr.clone), worktreesBefore);
    assert.ok(fs.existsSync(marker), "the head worktree was not recreated");
    fs.rmSync(marker);
  });

  it("leaves viewed state on GitHub when the Change is closed", async () => {
    await servePullRequest();

    await closeChange(pullRequestRequest);

    assert.deepStrictEqual(render(await changeFiles()), []);
    assert.deepStrictEqual(await viewedMarksOnGitHub(), []);
    assert.ok(!fs.existsSync(head), "the head worktree was removed");
  });

  it("says so in the files view when GitHub can't give the viewed state", async () => {
    await servePullRequest();
    await openFromTheInbox();
    await setToken("wrong-token");

    const lines = render(await changeFiles());

    await setToken(viewer.token);
    await closeChange(pullRequestRequest);
    assert.strictEqual(lines.length, 1, lines.join("\n"));
    assert.match(lines[0], /viewed state.*401/);
  });
});
