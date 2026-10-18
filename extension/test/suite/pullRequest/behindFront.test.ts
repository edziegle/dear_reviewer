import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { activeDiff, changeFiles, entryAt, select } from "../changeFiles";
import { buildPullRequestFixture, pushToPullRequest } from "../fixtures";
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
  focusWindow,
  refreshRunning,
  setRefreshGap,
  short,
  workspaceFolders,
} from "../reviewer";
import { sentTimeline } from "../timeline";

const viewer = { login: "reviewer", token: "test-token" };
const settingKeys = ["githubApiUrl", "repositories", "localClones"];

// Coming back to the window checks every pull request it shows. One behind
// the Change in front takes its new head in place and leaves the front be.
describe("A Change behind the one in front that gets new commits", () => {
  const behind = buildPullRequestFixture("behindA", "acme/behind-a", 61);
  const front = buildPullRequestFixture("behindB", "acme/behind-b", 62);
  const requestOf = (pr: typeof behind, head: string) => ({
    repository: pr.clone,
    base: pr.base,
    head,
    pullRequest: { repository: pr.repository, number: pr.number },
  });
  const folderOf = (pr: typeof behind, head: string) =>
    `${path.basename(pr.clone)} head ${short(head)}`;
  const served = (pr: typeof behind, head: string, title: string) =>
    ({
      repository: pr.repository,
      number: pr.number,
      title,
      author: "alice",
      reviewRequested: ["reviewer"],
      headSha: head,
      files: [{ path: "pkg/core.py" }, { path: "util.py" }],
    }) satisfies FakePullRequest;
  const found = new Map<string, unknown>();
  let behindHead = behind.head;

  const serve = () =>
    serveGitHub({
      viewer,
      pullRequests: [
        served(behind, behindHead, "Behind me"),
        served(front, front.head, "In front"),
      ],
    });

  const openFrontFile = async () =>
    select(
      entryAt(
        await changeFiles(),
        `${path.basename(front.clone)} ${short(front.base)}..${short(front.head)}`,
        "pkg",
        "core.py"
      )
    );

  const folderNames = () => workspaceFolders().map((f) => f.name);

  before(async () => {
    await setRefreshGap(0);
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      found.set(key, config.inspect(key)?.globalValue);
    await serve();
    await configure({ repositories: [behind.repository, front.repository] });
    await config.update(
      "localClones",
      {
        [behind.repository]: behind.clone,
        [front.repository]: front.clone,
      },
      vscode.ConfigurationTarget.Global
    );
    await setToken(viewer.token);
    await refreshInbox();
    await openFromInbox(inboxEntry(await inbox(), "Behind me"));
    await eventually(() =>
      assert.ok(folderNames().includes(folderOf(behind, behind.head)))
    );
    await openFromInbox(inboxEntry(await inbox(), "In front"));
    await eventually(() =>
      assert.ok(folderNames().includes(folderOf(front, front.head)))
    );
    await openFrontFile();
  });

  after(async () => {
    await setRefreshGap();
    await closeChange(requestOf(behind, behindHead));
    await closeChange(requestOf(front, front.head));
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      await config.update(
        key,
        found.get(key),
        vscode.ConfigurationTarget.Global
      );
  });

  /** The author pushes a commit to the Change behind the front. */
  async function authorPushesToBehind(): Promise<string> {
    behindHead = pushToPullRequest(
      behind,
      behindHead,
      { "util.py": `PUSHED = "${short(behindHead)}"\n` },
      "push to the one behind"
    );
    await serve();
    return behindHead;
  }

  async function assertSwappedBehindTheFront(newHead: string): Promise<void> {
    await eventually(() =>
      assert.ok(
        folderNames().includes(folderOf(behind, newHead)),
        "the Change behind is at the new head"
      )
    );
    await eventually(async () =>
      assert.strictEqual(await refreshRunning(), false, "the check has ended")
    );
    const frontFolder = workspaceFolders().find(
      (f) => f.name === folderOf(front, front.head)
    )!;
    assert.strictEqual(
      activeDiff().modified.fsPath,
      path.join(frontFolder.path, "pkg", "core.py"),
      "the Change in front still shows its file"
    );
    // Going back to it, the Reviewer is told what arrived.
    await openFromInbox(inboxEntry(await inbox(), "Behind me"));
    await eventually(async () => {
      const overview = await sentTimeline(
        `${behind.repository} #${behind.number}`
      );
      assert.ok(
        overview.standing.includes("1 new commit arrived"),
        JSON.stringify(overview.standing)
      );
    });
    await openFromInbox(inboxEntry(await inbox(), "In front"));
    await openFrontFile();
  }

  it("takes its new head in place when the window regains focus", async () => {
    const newHead = await authorPushesToBehind();

    await focusWindow();

    await assertSwappedBehindTheFront(newHead);
  });

  it("takes its new head in place when Fetch Updates runs on it", async () => {
    const oldHead = behindHead;
    const newHead = await authorPushesToBehind();

    await vscode.commands.executeCommand(
      "dearReviewer.fetchUpdates",
      requestOf(behind, oldHead)
    );

    await assertSwappedBehindTheFront(newHead);
  });
});
