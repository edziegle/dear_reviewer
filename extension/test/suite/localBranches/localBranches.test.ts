import * as assert from "assert";
import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { buildFixtureRepo, type FixtureRepo } from "../fixtures";
import {
  configure,
  inbox,
  inboxEntry,
  openBranchFromInbox,
  refreshInbox,
  serveGitHub,
  setToken,
} from "../github";
import {
  closeChange,
  foldersAddedSince,
  gitIn,
  short,
  workspaceFolders,
  worktreesOf,
} from "../reviewer";

const viewer = { login: "reviewer", token: "test-token" };
const settingKeys = ["githubApiUrl", "repositories", "localClones"];

interface BranchesFixture {
  repo: FixtureRepo;
  /** A clone of `acme/tools` whose origin/HEAD points at main, at `renamed`. */
  clone: string;
  /** A commit off `initial` with `restructured`'s tree: ahead, but not off main's tip. */
  diverged: string;
}

/**
 * A bare repository standing in for GitHub's `acme/tools`, with main at
 * `renamed`, and the Reviewer's clone of it with local branches: one ahead of
 * main by two commits, one ahead by one commit from an older merge base, one
 * behind main, and one at main.
 */
function buildBranchesFixture(): BranchesFixture {
  const repo = buildFixtureRepo("branches");
  const bare = `${repo.path}-tools.git`;
  const clone = `${repo.path}-clone`;
  const run = (cwd: string, ...args: string[]) =>
    cp.execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  fs.rmSync(bare, { recursive: true, force: true });
  fs.rmSync(clone, { recursive: true, force: true });
  fs.mkdirSync(bare);
  run(bare, "init", "-q", "--bare", "-b", "main");
  run(
    bare,
    "fetch",
    "-q",
    repo.path,
    `+${repo.commits.renamed}:refs/heads/main`
  );
  run(path.dirname(clone), "clone", "-q", bare, clone);

  const tree = repo.git("rev-parse", `${repo.commits.restructured}^{tree}`);
  const diverged = repo.git(
    "commit-tree",
    tree,
    "-p",
    repo.commits.initial,
    "-m",
    "restructure from the start"
  );
  run(
    clone,
    "fetch",
    "-q",
    repo.path,
    `+${repo.commits.restructured}:refs/heads/agent/restructure`,
    `+${diverged}:refs/heads/agent/diverged`,
    `+${repo.commits.initial}:refs/heads/stale`,
    `+${repo.commits.renamed}:refs/heads/at-main`
  );
  return { repo, clone, diverged };
}

describe("Local branches in the Inbox", () => {
  const fixture = buildBranchesFixture();
  const found = new Map<string, unknown>();

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

  async function showInbox(localClones: Record<string, string>) {
    await serveGitHub({ viewer, pullRequests: [] });
    await vscode.workspace
      .getConfiguration("dearReviewer")
      .update("localClones", localClones, vscode.ConfigurationTarget.Global);
    await configure({ repositories: Object.keys(localClones) });
    await setToken(viewer.token);
    await refreshInbox();
    return inbox();
  }

  function localBranches(groups: Awaited<ReturnType<typeof inbox>>) {
    const group = groups.find((g) => g.label === "Local branches");
    assert.ok(group, `groups: ${JSON.stringify(groups)}`);
    return group;
  }

  it("lists branches ahead of the clone's main branch, with how many commits ahead", async () => {
    const groups = await showInbox({ "acme/tools": fixture.clone });

    const group = localBranches(groups);
    assert.deepStrictEqual(
      group.entries
        .map(({ label, description }) => ({ label, description }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      [
        { label: "agent/diverged", description: "acme/tools · 1 commit ahead" },
        {
          label: "agent/restructure",
          description: "acme/tools · 2 commits ahead",
        },
      ]
    );
    assert.strictEqual(group.description, "2");
  });

  it("finds main without a remote, from the local main branch", async () => {
    const repo = fixture.repo;
    repo.git("branch", "-f", "feature", fixture.diverged);

    const groups = await showInbox({ "acme/local": repo.path });

    // main is at `restructured`; `feature` forks from `initial`.
    assert.deepStrictEqual(
      localBranches(groups).entries.map((e) => [e.label, e.description]),
      [["feature", "acme/local · 1 commit ahead"]]
    );
  });

  it("opens a branch as a local Change from the merge base to the branch head", async () => {
    const groups = await showInbox({ "acme/tools": fixture.clone });
    const before = workspaceFolders();

    await openBranchFromInbox(inboxEntry(groups, "agent/diverged"));

    const added = foldersAddedSince(before);
    const name = path.basename(fixture.clone);
    const mergeBase = fixture.repo.commits.initial;
    assert.deepStrictEqual(
      added.map((f) => f.name),
      [
        `${name} base ${short(mergeBase)}`,
        `${name} head ${short(fixture.diverged)}`,
      ]
    );
    const [base, head] = added.map((f) => f.path);
    assert.strictEqual(gitIn(base, "rev-parse", "HEAD"), mergeBase);
    assert.strictEqual(gitIn(head, "rev-parse", "HEAD"), fixture.diverged);
    const worktrees = worktreesOf(fixture.clone);
    for (const dir of [base, head])
      assert.ok(
        worktrees.some((w) => w.path === dir && w.detached),
        `${dir} is a detached worktree of the clone`
      );

    await closeChange({
      repository: fixture.clone,
      base: mergeBase,
      head: fixture.diverged,
    });
    assert.ok(!fs.existsSync(head), "the head worktree was removed");
  });

  it("says so when a clone can't be read, and still lists the others", async () => {
    const missing = path.join(path.dirname(fixture.clone), "no-such-clone");

    const groups = await showInbox({
      "acme/tools": fixture.clone,
      "acme/gone": missing,
    });

    const entries = localBranches(groups).entries;
    assert.deepStrictEqual(
      entries
        .filter((e) => e.icon !== "$(error)")
        .map((e) => e.label)
        .sort(),
      ["agent/diverged", "agent/restructure"]
    );
    const problems = entries.filter((e) => e.icon === "$(error)");
    assert.strictEqual(problems.length, 1, JSON.stringify(entries));
    assert.match(problems[0].label, /acme\/gone/);
  });

  it("leaves the group out when no Inbox repository has a local clone", async () => {
    const groups = await showInbox({});

    assert.deepStrictEqual(
      groups.map((g) => g.label),
      ["Awaiting my review", "Authored by me"]
    );
  });
});
