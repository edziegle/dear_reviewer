import * as fs from "fs";
import * as vscode from "vscode";
import { buildFixtureRepo, buildPullRequestFixture } from "../fixtures";
import {
  configure,
  inbox,
  inboxEntry,
  openFromInbox,
  refreshInbox,
  serveGitHub,
  setToken,
  type FakePullRequest,
} from "../github";
import { foldersAddedSince, openChange, workspaceFolders } from "../reviewer";
import { leaveForReload } from "./handoff";

const viewer = { login: "reviewer", token: "test-token" };

// Runs last in the first launch: the window reloads with both Changes open,
// one with its worktrees deleted and one whose pull request was merged.
describe("Changes that end while the window is closed", () => {
  const repo = buildFixtureRepo("while-closed");
  const pr = buildPullRequestFixture("merged-later", "acme/later", 41);
  const pullRequest: FakePullRequest = {
    repository: pr.repository,
    number: pr.number,
    title: "Merged later",
    author: "alice",
    reviewRequested: ["reviewer"],
  };

  it("leaves a deleted local Change and a merged pull request's Change in the window", async () => {
    await serveGitHub({ viewer, pullRequests: [pullRequest] });
    await configure({ repositories: [pr.repository] });
    await vscode.workspace
      .getConfiguration("dearReviewer")
      .update(
        "localClones",
        { [pr.repository]: pr.clone },
        vscode.ConfigurationTarget.Global
      );
    await setToken(viewer.token);
    const before = workspaceFolders();
    const deleted = {
      repository: repo.path,
      base: repo.commits.initial,
      head: repo.commits.renamed,
    };
    await openChange(deleted);
    const deletedFolders = foldersAddedSince(before).map((f) => f.path);
    await refreshInbox();
    const was = workspaceFolders();
    await openFromInbox(inboxEntry(await inbox(), "Merged later"));
    const mergedFolders = foldersAddedSince(was).map((f) => f.path);

    for (const folder of deletedFolders)
      fs.rmSync(folder, { recursive: true, force: true });
    await serveGitHub({
      viewer,
      pullRequests: [{ ...pullRequest, state: "MERGED" }],
    });

    leaveForReload({
      before,
      deleted: { change: deleted, folders: deletedFolders },
      merged: {
        change: {
          repository: pr.clone,
          base: pr.base,
          head: pr.head,
          pullRequest: { repository: pr.repository, number: pr.number },
        },
        folders: mergedFolders,
      },
    });
  });
});
