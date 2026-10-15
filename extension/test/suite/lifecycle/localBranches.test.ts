import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  assistantRuns,
  flag,
  assistantTake,
  summaryWritten,
  replyTurn,
  scriptClaude,
} from "../assistant";
import { buildFixtureRepo, type FixtureRepo } from "../fixtures";
import { configure, refreshInbox, serveGitHub, setToken } from "../github";
import { comment, commentingLines, commentThreads } from "../review";
import {
  closeChange,
  eventually,
  foldersAddedSince,
  openChange,
  short,
  workspaceFolders,
  worktreesOf,
  type ChangeRequest,
} from "../reviewer";

const viewer = { login: "reviewer", token: "test-token" };
const settingKeys = ["githubApiUrl", "repositories"];

describe("Local branches that are merged or deleted", () => {
  const found = new Map<string, unknown>();

  /** A commit on top of main, as an agent's branch has, that changes pkg back. */
  function agentCommit(repo: FixtureRepo): string {
    return repo.git(
      "commit-tree",
      `${repo.commits.renamed}^{tree}`,
      "-p",
      repo.commits.restructured,
      "-m",
      "agent work"
    );
  }

  /** The branch's Change, from main as it is now; the branch's head, by name. */
  function branchChange(repo: FixtureRepo, branch: string): ChangeRequest {
    return {
      repository: repo.path,
      base: repo.commits.restructured,
      head: `refs/heads/${branch}`,
    };
  }

  function titleOf(repo: FixtureRepo, head: string): string {
    return `${path.basename(repo.path)} ${short(repo.commits.restructured)}..${short(head)}`;
  }

  /** Opens the Change, waits for the Assistant's summary, and gives its folders. */
  async function open(request: ChangeRequest, title: string) {
    const before = workspaceFolders();
    await openChange(request);
    await summaryWritten(title);
    return foldersAddedSince(before);
  }

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

  it("ends a branch's Change once main has all its commits, with its conversation and Comments", async () => {
    const repo = buildFixtureRepo("merged-branch");
    const work = agentCommit(repo);
    repo.git("branch", "agent/merged", work);
    const request = branchChange(repo, "agent/merged");
    const title = titleOf(repo, work);
    const before = workspaceFolders();
    scriptClaude(request, { turns: [replyTurn("A summary.")] });
    const [, head] = await open(request, title);
    const [[first, last]] = await commentingLines(
      path.join(head.path, "pkg", "core.py")
    );
    await comment(
      path.join(head.path, "pkg", "core.py"),
      first,
      last,
      "Why back?"
    );

    await refreshInbox();

    assert.strictEqual(
      foldersAddedSince(before).length,
      2,
      "open while main lacks its commit"
    );

    repo.git("update-ref", "refs/heads/main", work);
    await refreshInbox();

    assert.deepStrictEqual(workspaceFolders(), before);
    assert.deepStrictEqual(
      worktreesOf(repo.path).map((w) => w.path),
      [repo.path]
    );
    assert.strictEqual(await assistantTake(title), undefined);

    // Main goes back, so the branch has something to review again.
    repo.git("update-ref", "refs/heads/main", repo.commits.restructured);
    scriptClaude(request, { turns: [replyTurn("A new summary.")] });
    const [, again] = await open(request, title);

    const [run] = assistantRuns(request);
    assert.ok(run, "the Assistant ran");
    assert.strictEqual(flag(run, "--resume"), undefined);
    assert.strictEqual((await assistantTake(title))?.text, "A new summary.");
    // Long enough for kept Comments to have come back.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.deepStrictEqual(
      (await commentThreads()).filter((t) => t.file.startsWith(again.path)),
      [],
      "its Comments are gone"
    );
    await closeChange(request);
  });

  it("ends a branch's Change once the branch is deleted, even after the Reviewer closed it", async () => {
    const repo = buildFixtureRepo("deleted-branch");
    const work = agentCommit(repo);
    repo.git("branch", "agent/gone", work);
    const request = branchChange(repo, "agent/gone");
    const title = titleOf(repo, work);
    scriptClaude(request, { turns: [replyTurn("A summary.")] });
    await open(request, title);
    await closeChange(request);

    repo.git("branch", "-D", "agent/gone");
    await refreshInbox();

    repo.git("branch", "agent/gone", work);
    scriptClaude(request, { turns: [replyTurn("A new summary.")] });
    await open(request, title);

    const [run] = assistantRuns(request);
    assert.ok(run, "the Assistant ran");
    assert.strictEqual(flag(run, "--resume"), undefined);
    assert.strictEqual((await assistantTake(title))?.text, "A new summary.");
    await closeChange(request);
  });

  it("keeps a Change of commits that aren't a branch, and one of main itself", async () => {
    const repo = buildFixtureRepo("not-a-branch");
    const work = agentCommit(repo);
    const range = {
      repository: repo.path,
      base: repo.commits.restructured,
      head: work,
    };
    // HEAD names main, which the fixture has checked out.
    const main = {
      repository: repo.path,
      base: repo.commits.initial,
      head: "HEAD",
    };
    for (const change of [range, main])
      scriptClaude(change, { turns: [replyTurn("A summary.")] });
    const before = workspaceFolders();
    await open(range, titleOf(repo, work));
    await open(
      main,
      `${path.basename(repo.path)} ${short(repo.commits.initial)}..${short(repo.commits.restructured)}`
    );
    const added = foldersAddedSince(before);
    assert.strictEqual(added.length, 4);

    repo.git("update-ref", "refs/heads/main", work);
    await refreshInbox();

    assert.deepStrictEqual(foldersAddedSince(before), added);
    for (const folder of added) assert.ok(fs.existsSync(folder.path));
    await closeChange(range);
    // main moved, so name its old head by commit.
    await closeChange({ ...main, head: repo.commits.restructured });
  });
});
