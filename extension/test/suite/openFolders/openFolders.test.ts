import * as assert from "assert";
import * as cp from "child_process";
import * as fs from "fs";
import * as vscode from "vscode";
import { buildPullRequestFixture, remotesOnHost } from "../fixtures";
import {
  click,
  configure,
  fakeGitHubUrl,
  inbox,
  inboxEntry,
  refreshInbox,
  requestsToGitHub,
  searchedRepositories,
  serveGitHub,
  setToken,
} from "../github";
import {
  closeChange,
  eventually,
  foldersAddedSince,
  workspaceFolders,
  worktreesOf,
} from "../reviewer";
import { leaveForElsewhere } from "./handoff";
import { keepUserSettings } from "./settings";

const viewer = { login: "reviewer", token: "test-token" };

describe("Repositories of the folders open in VSCodium", () => {
  keepUserSettings();
  const host = new URL(fakeGitHubUrl()).hostname;
  const pr = buildPullRequestFixture("open", "acme/api", 7);
  remotesOnHost(pr, host);
  const run = (cwd: string, ...args: string[]) =>
    cp.execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  // An agent's branch in the clone, one commit ahead of main.
  run(pr.clone, "config", "user.email", "reviewer@example.com");
  run(pr.clone, "config", "user.name", "Reviewer");
  const agentWork = run(
    pr.clone,
    "commit-tree",
    "upstream/main^{tree}",
    "-p",
    "upstream/main",
    "-m",
    "agent work"
  );
  run(pr.clone, "update-ref", "refs/heads/agent/fix", agentWork);

  /** A git repository whose remotes are on another host, or don't name a repository GitHub could have. */
  const other = `${pr.clone}-other`;
  fs.rmSync(other, { recursive: true, force: true });
  fs.mkdirSync(other);
  run(other, "init", "-q", "-b", "main");
  run(
    other,
    "remote",
    "add",
    "origin",
    "https://elsewhere.example/acme/web.git"
  );
  run(
    other,
    "remote",
    "add",
    "sneaky",
    `https://${host}/acme/web+is:merged.git`
  );

  const pullRequest = {
    repository: pr.repository,
    number: pr.number,
    title: "Restructure pkg",
    author: "alice",
    reviewRequested: ["reviewer"],
  };

  async function showInbox() {
    await serveGitHub({ viewer, pullRequests: [structuredClone(pullRequest)] });
    await refreshInbox();
    return inbox();
  }

  before(async () => {
    await configure({ repositories: [] });
    await vscode.workspace
      .getConfiguration("dearReviewer")
      .update("localClones", {}, vscode.ConfigurationTarget.Global);
    await setToken(viewer.token);
  });

  it("lists the repository of a folder open in this window, with no settings", async () => {
    assert.ok(vscode.workspace.isTrusted, "precondition: a trusted window");
    await addFolder(pr.clone);

    await eventually(async () => {
      const groups = await showInbox();
      assert.deepStrictEqual(
        groups
          .find((g) => g.label === "Awaiting my review")
          ?.entries.map((e) => e.label),
        ["Restructure pkg"],
        JSON.stringify(groups)
      );
    });
    assert.deepStrictEqual(
      await searchedRepositories(),
      ["acme/api"],
      "the upstream repository, not the Reviewer's fork in origin"
    );
  });

  it("opens a pull request of that repository with a click, and no settings", async () => {
    const before = workspaceFolders();

    await click(inboxEntry(await showInbox(), "Restructure pkg"));

    const added = foldersAddedSince(before);
    assert.strictEqual(added.length, 2, JSON.stringify(workspaceFolders()));
    const worktrees = worktreesOf(pr.clone).map((w) => w.path);
    for (const folder of added)
      assert.ok(
        worktrees.includes(folder.path),
        `${folder.path} is a worktree of the open folder`
      );
  });

  it("lists the folder's local branches once, not again for its Change's worktrees", async () => {
    const groups = await showInbox();

    const branches = groups.find((g) => g.label === "Local branches");
    assert.deepStrictEqual(
      branches?.entries.map((e) => e.label),
      ["agent/fix"],
      JSON.stringify(groups)
    );
    assert.strictEqual(
      branches?.entries[0].command?.command,
      "dearReviewer.openLocalBranch",
      "a click opens the branch"
    );

    await closeChange({
      repository: pr.clone,
      base: pr.base,
      head: pr.head,
      pullRequest: { repository: pr.repository, number: pr.number },
    });
  });

  it("leaves out remotes on another host, and names GitHub couldn't have", async () => {
    await addFolder(other);

    await showInbox();

    assert.deepStrictEqual(await searchedRepositories(), ["acme/api"]);
  });

  it("ignores Repositories entries that aren't owner/name", async () => {
    const config = vscode.workspace.getConfiguration("dearReviewer");
    await config.update(
      "repositories",
      ["acme/api is:closed", "acme/web"],
      vscode.ConfigurationTarget.Workspace
    );
    try {
      await showInbox();

      const queries = JSON.stringify(
        (await requestsToGitHub()).map((r) => r.body)
      );
      assert.ok(!queries.includes("is:closed"), queries);
      assert.deepStrictEqual(await searchedRepositories(), [
        "acme/api",
        "acme/web",
      ]);
    } finally {
      await config.update(
        "repositories",
        undefined,
        vscode.ConfigurationTarget.Workspace
      );
    }
  });

  it("remembers the repository and its clone after the folder is closed", async () => {
    await removeFolder(other);
    await removeFolder(pr.clone);

    await showInbox();

    assert.deepStrictEqual(await searchedRepositories(), ["acme/api"]);
    leaveForElsewhere({
      repository: pr.repository,
      clone: pr.clone,
      number: pr.number,
      otherRepository: other,
    });
  });
});

function addFolder(folder: string): Promise<void> {
  const start = vscode.workspace.workspaceFolders?.length ?? 0;
  return changeFolders(() =>
    vscode.workspace.updateWorkspaceFolders(start, 0, {
      uri: vscode.Uri.file(folder),
    })
  );
}

function removeFolder(folder: string): Promise<void> {
  const index = (vscode.workspace.workspaceFolders ?? []).findIndex(
    (f) => f.uri.fsPath === folder
  );
  assert.ok(index > 0, `${folder} is open, after the first folder`);
  return changeFolders(() => vscode.workspace.updateWorkspaceFolders(index, 1));
}

function changeFolders(change: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const listener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      listener.dispose();
      resolve();
    });
    if (!change()) {
      listener.dispose();
      reject(new Error("VS Code refused to change the workspace folders"));
    }
  });
}
