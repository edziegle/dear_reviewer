import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { findingTurn, replyTurn, scriptClaude } from "../assistant";
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
import { closeChange, short } from "../reviewer";
import { inReviewWindow, runInReviewWindow } from "../reviewWindowProbe";

const viewer = { login: "reviewer", token: "test-token" };
const settingKeys = ["githubApiUrl", "repositories", "localClones"];

describe("Pull request merged, seen from a single-folder window", () => {
  const merged = buildPullRequestFixture("mergedElsewhere", "acme/merged", 41);
  const open = buildPullRequestFixture("stillOpen", "acme/open", 42);
  const titles = new Map([
    [merged, "Merged work"],
    [open, "Open work"],
  ]);
  const states = new Map<PullRequestFixture, FakePullRequest["state"]>();
  const found = new Map<string, unknown>();

  const requestFor = (pr: PullRequestFixture) => ({
    repository: pr.clone,
    base: pr.base,
    head: pr.head,
    pullRequest: { repository: pr.repository, number: pr.number },
  });
  const changeTitle = (pr: PullRequestFixture) =>
    `${path.basename(pr.clone)} ${short(pr.base)}..${short(pr.head)}`;

  /** How Findings name a pull request Change. */
  const findingsName = (pr: PullRequestFixture) =>
    `${pr.repository} #${pr.number}`;

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
    // Closed pull requests leave nothing kept for a later tidy to ask GitHub
    // about, which a test of the Inbox would notice.
    for (const pr of titles.keys()) states.set(pr, "CLOSED");
    await serve();
    await refreshInbox();
    await closeChange(requestFor(merged));
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      await config.update(
        key,
        found.get(key),
        vscode.ConfigurationTarget.Global
      );
  });

  it("lets go of what the review window holds for the Active Change when it ends because its pull request merged here", async () => {
    for (const [i, pr] of [...titles.keys()].entries())
      await scriptClaude(requestFor(pr), {
        turns: [replyTurn("A summary."), findingTurn(1, `Finding ${i}.`)],
      });
    await refreshInbox();
    await openFromInbox(inboxEntry(await inbox(), titles.get(merged)!));
    await runInReviewWindow("dearReviewer.findIssues", requestFor(merged));
    await inReviewWindow((report) => {
      assert.deepStrictEqual(report.held.findings, [findingsName(merged)]);
    });

    states.set(merged, "MERGED");
    await serve();
    await refreshInbox();

    await inReviewWindow((report) => {
      assert.deepStrictEqual(report.held.findings, []);
      assert.ok(
        !report.held.assistants.includes(changeTitle(merged)),
        `the review window still holds ${changeTitle(merged)}'s Assistant`
      );
      assert.ok(
        !report.held.timelines.includes(changeTitle(merged)),
        `the review window still holds ${changeTitle(merged)}'s overview`
      );
    });
  });
});
