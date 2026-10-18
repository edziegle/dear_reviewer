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
import { changeFiles, render } from "../changeFiles";
import { buildPullRequestFixture, type PullRequestFixture } from "../fixtures";
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
import {
  closeChange,
  eventually,
  foldersAddedSince,
  short,
  workspaceFolders,
  worktreesOf,
} from "../reviewer";

const viewer = { login: "reviewer", token: "test-token" };
const settingKeys = ["githubApiUrl", "repositories", "localClones"];

describe("Pull requests that are merged or closed", () => {
  const merged = buildPullRequestFixture("merged", "acme/merged", 31);
  const closed = buildPullRequestFixture("closed", "acme/closed", 32);
  const open = buildPullRequestFixture("open", "acme/open", 33);
  const titles = new Map([
    [merged, "Merged work"],
    [closed, "Closed work"],
    [open, "Open work"],
  ]);
  const states = new Map<PullRequestFixture, FakePullRequest["state"]>();
  const found = new Map<string, unknown>();

  /** The Change's title, as its Assistant panel and the files view name it. */
  const changeTitle = (pr: PullRequestFixture) =>
    `${path.basename(pr.clone)} ${short(pr.base)}..${short(pr.head)}`;
  const requestFor = (pr: PullRequestFixture) => ({
    repository: pr.clone,
    base: pr.base,
    head: pr.head,
    pullRequest: { repository: pr.repository, number: pr.number },
  });

  async function serve(): Promise<void> {
    await serveGitHub({
      viewer,
      pullRequests: [...titles].map(([pr, title]) => ({
        repository: pr.repository,
        number: pr.number,
        title,
        author: "alice",
        reviewRequested: ["reviewer"],
        state: states.get(pr) ?? "OPEN",
      })),
    });
  }

  async function openFromTheInbox(pr: PullRequestFixture): Promise<void> {
    await refreshInbox();
    await openFromInbox(inboxEntry(await inbox(), titles.get(pr)!));
    // The Assistant's summary is saved as the start of the conversation.
    await summaryWritten(changeTitle(pr));
  }

  before(async () => {
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      found.set(key, config.inspect(key)?.globalValue);
    await serve();
    await configure({
      repositories: [...titles.keys()].map((pr) => pr.repository),
    });
    await config.update(
      "localClones",
      Object.fromEntries(
        [...titles.keys()].map((pr) => [pr.repository, pr.clone])
      ),
      vscode.ConfigurationTarget.Global
    );
    await setToken(viewer.token);
  });

  after(async () => {
    for (const pr of titles.keys()) await closeChange(requestFor(pr));
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      await config.update(
        key,
        found.get(key),
        vscode.ConfigurationTarget.Global
      );
  });

  it("lose their worktrees and folders when the Inbox refreshes, while an open one keeps theirs", async () => {
    for (const pr of titles.keys())
      await scriptClaude(requestFor(pr), { turns: [replyTurn("A summary.")] });
    const before = workspaceFolders();
    // Only one Change is the Active Change, so each ends in its turn.
    for (const [pr, state] of [
      [merged, "MERGED"],
      [closed, "CLOSED"],
    ] as const) {
      const was = workspaceFolders();
      await openFromTheInbox(pr);
      const added = foldersAddedSince(was);
      states.set(pr, state);
      await serve();

      await refreshInbox();

      assert.deepStrictEqual(workspaceFolders(), before);
      assert.deepStrictEqual(
        worktreesOf(pr.clone).map((w) => w.path),
        [pr.clone]
      );
      for (const folder of added)
        assert.ok(!fs.existsSync(folder.path), `${folder.path} was deleted`);
      assert.strictEqual(
        await assistantTake(changeTitle(pr)),
        undefined,
        `${titles.get(pr)} has no Assistant running`
      );
    }
    const was = workspaceFolders();
    await openFromTheInbox(open);
    const added = foldersAddedSince(was);

    await refreshInbox();

    assert.deepStrictEqual(workspaceFolders(), [...before, ...added]);
    assert.deepStrictEqual(workspaceFolders()[0], before[0]);
    assert.strictEqual(worktreesOf(open.clone).length, 3);
    assert.deepStrictEqual(
      render(await changeFiles())
        .filter((line) => !line.startsWith(" "))
        .map((line) => line.split(" — ")[0])
        .filter((title) =>
          [...titles.keys()].some((pr) => title === changeTitle(pr))
        ),
      [changeTitle(open)]
    );
  });

  it("forget their Assistant conversation, so a reopened pull request starts a new one", async () => {
    states.set(closed, "OPEN");
    await serve();
    await scriptClaude(requestFor(closed), {
      turns: [replyTurn("A new summary.")],
    });

    await openFromTheInbox(closed);

    const [run] = await assistantRuns(requestFor(closed));
    assert.ok(run, "the Assistant ran");
    assert.strictEqual(flag(run, "--resume"), undefined);
    assert.strictEqual(
      (await assistantTake(changeTitle(closed)))?.text,
      "A new summary."
    );
  });

  it("forget the conversation of a Change the Reviewer had already closed", async () => {
    await closeChange(requestFor(open));
    states.set(open, "CLOSED");
    await serve();
    await refreshInbox();
    states.set(open, "OPEN");
    await serve();
    await scriptClaude(requestFor(open), {
      turns: [replyTurn("Another new summary.")],
    });

    await openFromTheInbox(open);

    const [run] = await assistantRuns(requestFor(open));
    assert.ok(run, "the Assistant ran");
    assert.strictEqual(flag(run, "--resume"), undefined);
    assert.strictEqual(
      (await assistantTake(changeTitle(open)))?.text,
      "Another new summary."
    );
  });
});
