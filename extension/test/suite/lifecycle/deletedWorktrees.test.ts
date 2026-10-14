import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { changeFiles, render } from "../changeFiles";
import { buildFixtureRepo } from "../fixtures";
import { configure, refreshInbox, serveGitHub, setToken } from "../github";
import {
  closeChange,
  foldersAddedSince,
  gitIn,
  openChange,
  workspaceFolders,
  worktreesOf,
} from "../reviewer";

const viewer = { login: "reviewer", token: "test-token" };
const settingKeys = ["githubApiUrl", "repositories"];

/** Deletes the folders as the Reviewer might, in a terminal, without git. */
function deleteOutsideDearReviewer(folders: { path: string }[]): void {
  for (const folder of folders)
    fs.rmSync(folder.path, { recursive: true, force: true });
}

describe("A Change whose worktrees were deleted outside Dear Reviewer", () => {
  const found = new Map<string, unknown>();

  before(async () => {
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      found.set(key, config.inspect(key)?.globalValue);
    await serveGitHub({ viewer, pullRequests: [] });
    await configure({ repositories: [] });
    await setToken(viewer.token);
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

  it("gets its worktrees back when it is opened again", async () => {
    const repo = buildFixtureRepo("recreate");
    const request = {
      repository: repo.path,
      base: repo.commits.initial,
      head: repo.commits.renamed,
    };
    const before = workspaceFolders();
    await openChange(request);
    const [base, head] = foldersAddedSince(before);
    deleteOutsideDearReviewer([base, head]);

    await openChange(request);

    assert.deepStrictEqual(foldersAddedSince(before), [base, head]);
    assert.strictEqual(
      gitIn(base.path, "rev-parse", "HEAD"),
      repo.commits.initial
    );
    assert.strictEqual(
      gitIn(head.path, "rev-parse", "HEAD"),
      repo.commits.renamed
    );
    assert.deepStrictEqual(
      worktreesOf(repo.path).map((w) => w.path),
      [repo.path, base.path, head.path]
    );
    await closeChange(request);
  });

  it("is closed when the Inbox refreshes, and git's records of its worktrees are pruned", async () => {
    const repo = buildFixtureRepo("deleted");
    const request = {
      repository: repo.path,
      base: repo.commits.initial,
      head: repo.commits.renamed,
    };
    const before = workspaceFolders();
    await openChange(request);
    deleteOutsideDearReviewer(foldersAddedSince(before));

    await refreshInbox();

    assert.deepStrictEqual(workspaceFolders(), before);
    assert.deepStrictEqual(
      worktreesOf(repo.path).map((w) => w.path),
      [repo.path]
    );
    const name = path.basename(repo.path);
    assert.deepStrictEqual(
      render(await changeFiles()).filter((line) => line.includes(name)),
      [],
      "the Change is no longer open"
    );

    await openChange(request);

    const [base, head] = foldersAddedSince(before);
    assert.strictEqual(
      gitIn(base.path, "rev-parse", "HEAD"),
      repo.commits.initial
    );
    assert.strictEqual(
      gitIn(head.path, "rev-parse", "HEAD"),
      repo.commits.renamed
    );
    await closeChange(request);
  });

  it("is closed when only one of its worktrees was deleted, removing the other", async () => {
    const repo = buildFixtureRepo("half");
    const request = {
      repository: repo.path,
      base: repo.commits.initial,
      head: repo.commits.renamed,
    };
    const before = workspaceFolders();
    await openChange(request);
    const [base, head] = foldersAddedSince(before);
    deleteOutsideDearReviewer([base]);

    await refreshInbox();

    assert.deepStrictEqual(workspaceFolders(), before);
    assert.ok(!fs.existsSync(head.path), `${head.path} was deleted`);
    assert.deepStrictEqual(
      worktreesOf(repo.path).map((w) => w.path),
      [repo.path]
    );
  });

  it("is closed when its repository was deleted", async () => {
    const repo = buildFixtureRepo("gone");
    const request = {
      repository: repo.path,
      base: repo.commits.initial,
      head: repo.commits.renamed,
    };
    const before = workspaceFolders();
    await openChange(request);
    const [base, head] = foldersAddedSince(before);
    fs.rmSync(repo.path, { recursive: true, force: true });

    await refreshInbox();

    assert.deepStrictEqual(workspaceFolders(), before);
    for (const folder of [base, head])
      assert.ok(!fs.existsSync(folder.path), `${folder.path} was deleted`);
  });

  // Last: it deletes all of Dear Reviewer's storage, as the Reviewer might to
  // reclaim space, which also forgets which Changes were open.
  it("leaves the window when Dear Reviewer's storage was deleted, keeping its first folder", async () => {
    const repo = buildFixtureRepo("storage");
    const request = {
      repository: repo.path,
      base: repo.commits.initial,
      head: repo.commits.renamed,
    };
    const before = workspaceFolders();
    await openChange(request);
    const [, head] = foldersAddedSince(before);
    const storage = head.path.slice(
      0,
      head.path.indexOf(path.join("globalStorage", "edziegle.dear-reviewer")) +
        path.join("globalStorage", "edziegle.dear-reviewer").length
    );
    fs.rmSync(storage, { recursive: true, force: true });

    await refreshInbox();

    assert.deepStrictEqual(workspaceFolders(), before);
  });
});
