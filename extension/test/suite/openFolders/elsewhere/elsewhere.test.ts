import * as assert from "assert";
import * as vscode from "vscode";
import {
  addRepository,
  configure,
  forgetRepository,
  inbox,
  inboxEntry,
  locateClone,
  openFromInbox,
  refreshInbox,
  requestsToGitHub,
  searchedRepositories,
  serveGitHub,
  setToken,
} from "../../github";
import {
  closeChange,
  foldersAddedSince,
  gitIn,
  workspaceFolders,
  worktreesOf,
} from "../../reviewer";
import { pickUpElsewhere } from "../handoff";
import { keepUserSettings } from "../settings";

const viewer = { login: "reviewer", token: "test-token" };

// A window without the Reviewer's folders, as the review window is.
describe("Repositories remembered from other windows", () => {
  keepUserSettings();
  const handoff = pickUpElsewhere();
  const pullRequest = {
    repository: handoff.repository,
    number: handoff.number,
    title: "Restructure pkg",
    author: "alice",
    reviewRequested: ["reviewer"],
  };

  async function showInbox() {
    await serveGitHub({ viewer, pullRequests: [structuredClone(pullRequest)] });
    await refreshInbox();
    return inbox();
  }

  /** Opens the pull request from the Inbox, and gives the folders it added. */
  async function openThePullRequest() {
    const before = workspaceFolders();
    await openFromInbox(inboxEntry(await showInbox(), "Restructure pkg"));
    return foldersAddedSince(before);
  }

  async function closeThePullRequest(added: { path: string }[]) {
    const head = gitIn(added[1].path, "rev-parse", "HEAD");
    const base = gitIn(added[0].path, "rev-parse", "HEAD");
    await closeChange({
      repository: handoff.clone,
      base,
      head,
      pullRequest: { repository: handoff.repository, number: handoff.number },
    });
  }

  before(async () => {
    await configure({ repositories: [] });
    await vscode.workspace
      .getConfiguration("dearReviewer")
      .update("localClones", {}, vscode.ConfigurationTarget.Global);
    await setToken(viewer.token);
  });

  after(async () => {
    await forgetRepository(handoff.repository);
  });

  it("lists them in the Inbox, with no settings", async () => {
    assert.ok(
      !workspaceFolders().some((f) => f.path === handoff.clone),
      "precondition: the clone isn't open here"
    );

    const groups = await showInbox();

    assert.deepStrictEqual(await searchedRepositories(), ["acme/api"]);
    assert.ok(inboxEntry(groups, "Restructure pkg"));
  });

  it("opens their pull requests in the remembered clone", async () => {
    const added = await openThePullRequest();

    assert.strictEqual(added.length, 2, JSON.stringify(workspaceFolders()));
    const worktrees = worktreesOf(handoff.clone).map((w) => w.path);
    for (const folder of added) assert.ok(worktrees.includes(folder.path));
    await closeThePullRequest(added);
  });

  it("forgets a repository when the Reviewer asks", async () => {
    await forgetRepository(handoff.repository);

    assert.deepStrictEqual(await showInbox(), []);
    // Refreshing also asks for the state of pull requests with a saved
    // conversation, which earlier suites left; the Inbox itself asks nothing.
    assert.deepStrictEqual(
      (await requestsToGitHub()).filter(
        (r) =>
          !/\bquery PullRequestState\b/.test(
            String((r.body as { query?: string })?.query)
          )
      ),
      []
    );
  });

  it("asks where a clone is, and remembers the folder the Reviewer picks", async () => {
    await configure({ repositories: [handoff.repository] });
    assert.deepStrictEqual(
      await openThePullRequest(),
      [],
      "nothing opens while the clone is unknown"
    );

    assert.strictEqual(
      await locateClone(handoff.repository, handoff.clone),
      handoff.clone
    );

    const added = await openThePullRequest();
    assert.strictEqual(added.length, 2, JSON.stringify(workspaceFolders()));
    await closeThePullRequest(added);
  });

  it("won't take a folder that isn't a clone of the repository", async () => {
    await forgetRepository(handoff.repository);

    assert.strictEqual(
      await locateClone(handoff.repository, handoff.otherRepository),
      undefined
    );

    assert.deepStrictEqual(await openThePullRequest(), []);
  });

  it("adds the repository of a folder to the Inbox in one action", async () => {
    await configure({ repositories: [] });
    assert.deepStrictEqual(await showInbox(), []);

    assert.strictEqual(await addRepository(handoff.clone), handoff.repository);

    await showInbox();
    assert.deepStrictEqual(await searchedRepositories(), ["acme/api"]);
  });
});
