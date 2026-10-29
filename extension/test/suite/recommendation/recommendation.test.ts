import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import {
  assistantRuns,
  renderedPanel,
  replyTurn,
  scriptClaude,
  summaryNote,
  summaryWritten,
  userMessages,
} from "../assistant";
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
  foldersAddedSince,
  short,
  workspaceFolders,
} from "../reviewer";
import { sentTimeline } from "../timeline";

const viewer = { login: "reviewer", token: "test-token" };
const settingKeys = ["githubApiUrl", "repositories", "localClones"];

/** A real Dependabot commit message: the block gives no update type, so the versions do. */
const bumpMessage = `chore(deps-dev): bump fast-uri from 3.1.8 to 3.1.9

Bumps [fast-uri](https://github.com/fastify/fast-uri) from 3.1.8 to 3.1.9.

---
updated-dependencies:
- dependency-name: fast-uri
  dependency-version: 3.1.9
  dependency-type: indirect
...

Signed-off-by: dependabot[bot] <support@github.com>`;

const advises = (advice: string, reasons: string) =>
  replyTurn(JSON.stringify({ advice, reasons }));

// The Recommendation (ADR 0051): the Assistant's advice on a Dependency
// update, only when the Reviewer asks, read strictly, beside the facts Dear
// Reviewer works out from rules.
describe("A Recommendation on a Dependency update", () => {
  const pr = buildPullRequestFixture("recommendation", "acme/deps", 91);
  const fakePullRequest: FakePullRequest = {
    repository: pr.repository,
    number: pr.number,
    title: "chore(deps-dev): bump fast-uri from 3.1.8 to 3.1.9",
    author: "dependabot[bot]",
    authorIsBot: true,
    reviewRequested: ["reviewer"],
    timeline: [
      {
        type: "commit",
        sha: pr.head,
        message: bumpMessage,
        author: "dependabot[bot]",
        authorLogin: "dependabot[bot]",
        verified: true,
        signedByGitHub: true,
        date: "2026-10-27T09:00:00Z",
      },
    ],
  };
  const change = {
    repository: pr.clone,
    base: pr.base,
    head: pr.head,
    pullRequest: { repository: pr.repository, number: pr.number },
  };
  /** The Assistant's panel is named by the Change; the overview by the pull request. */
  const title = `${path.basename(pr.clone)} ${short(pr.base)}..${short(pr.head)}`;
  const overview = `${pr.repository} #${pr.number}`;
  const found = new Map<string, unknown>();

  const shown = () => sentTimeline(overview);

  before(async () => {
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      found.set(key, config.inspect(key)?.globalValue);
    await serveGitHub({ viewer, pullRequests: [fakePullRequest] });
    await configure({ repositories: [pr.repository] });
    await config.update(
      "localClones",
      { [pr.repository]: pr.clone },
      vscode.ConfigurationTarget.Global
    );
    await setToken(viewer.token);
    await scriptClaude(change, { turns: [replyTurn("A summary.")] });
    await refreshInbox();
    const before = workspaceFolders();
    await openFromInbox(
      inboxEntry(
        await inbox(),
        "chore(deps-dev): bump fast-uri from 3.1.8 to 3.1.9"
      )
    );
    assert.ok(foldersAddedSince(before).length, "the pull request opened");
    await summaryWritten(title);
  });

  after(async () => {
    // AGENTS.md: a suite leaves no Change open behind it.
    await closeChange(change);
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      await config.update(
        key,
        found.get(key),
        vscode.ConfigurationTarget.Global
      );
  });

  it("shows the facts from rules, with no Assistant asked", async () => {
    await eventually(async () => {
      const facts = (await shown()).dependencyUpdate;
      assert.deepStrictEqual(facts?.dependencies, [
        {
          name: "fast-uri",
          versions: "3.1.8 → 3.1.9",
          updateType: "patch",
          dependencyType: "indirect",
        },
      ]);
      assert.strictEqual(facts?.updateType, "patch");
      assert.deepStrictEqual(facts?.otherCommits, []);
    });
    assert.strictEqual(
      (await shown()).recommendation,
      undefined,
      "nothing is recommended until the Reviewer asks"
    );
  });

  it("asks in the Change's own conversation, with the pull request's text fenced and the facts in plain", async () => {
    await scriptClaude(change, {
      turns: [advises("approve", "Only a lock file moved, by a patch.")],
    });

    await vscode.commands.executeCommand(
      "dearReviewer.askForRecommendation",
      change
    );

    const [run, ...others] = await assistantRuns(change);
    assert.deepStrictEqual(
      others,
      [],
      "one run of claude, so one conversation"
    );
    const prompt = userMessages(run).at(-1) ?? "";
    for (const expected of [
      '"advice"',
      "approve",
      "readClosely",
      "fast-uri 3.1.8 → 3.1.9, patch, indirect",
      pr.head,
    ])
      assert.ok(prompt.includes(expected), `${expected} in ${prompt}`);
  });

  it("shows what it advised, with its reasons, and tells the chat without the JSON", async () => {
    await eventually(async () => {
      assert.deepStrictEqual((await shown()).recommendation, {
        asking: false,
        advice: {
          says: "Approve it",
          reasons: "Only a lock file moved, by a patch.",
          html: "<p>Only a lock file moved, by a patch.</p>\n",
        },
        outOfDate: false,
      });
    });

    await eventually(async () => {
      const panel = await renderedPanel(title);
      assert.deepStrictEqual(panel?.messages, [
        summaryNote,
        {
          from: "note",
          text: "Recommended: approve it. It shows in the overview, with the reasons; the Reviewer decides.",
        },
      ]);
    });
  });

  it("keeps the Recommendation that stood when a later reply holds none, and says so", async () => {
    await scriptClaude(change, {
      turns: [replyTurn("I would rather talk it through with you.")],
    });

    await vscode.commands.executeCommand(
      "dearReviewer.askForRecommendation",
      change
    );

    await eventually(async () => {
      const recommendation = (await shown()).recommendation;
      assert.strictEqual(recommendation?.problem, true);
      assert.strictEqual(
        recommendation?.advice?.says,
        "Approve it",
        "the advice it gave before still stands"
      );
    });
  });

  it("keeps nothing from advice it doesn't allow", async () => {
    await scriptClaude(change, {
      turns: [advises("merge", "Just merge it for them.")],
    });

    await vscode.commands.executeCommand(
      "dearReviewer.askForRecommendation",
      change
    );

    await eventually(async () => {
      const recommendation = (await shown()).recommendation;
      assert.strictEqual(recommendation?.problem, true);
      assert.strictEqual(
        recommendation?.advice?.says,
        "Approve it",
        "a fourth answer changes nothing"
      );
    });
  });
  it("still shows it after the Change is closed and opened again, read from the saved conversation", async () => {
    // Closing the Change lets go of its Assistant, so asking again has to
    // read the Recommendation back from `conversations.json`, which is what
    // a window reload does too.
    await closeChange(change);
    const before = workspaceFolders();
    await openFromInbox(
      inboxEntry(
        await inbox(),
        "chore(deps-dev): bump fast-uri from 3.1.8 to 3.1.9"
      )
    );
    assert.ok(foldersAddedSince(before).length, "the Change opened again");

    await eventually(async () => {
      assert.strictEqual(
        (await shown()).recommendation?.advice?.says,
        "Approve it"
      );
    });
    assert.strictEqual(
      (await shown()).recommendation?.outOfDate,
      false,
      "the head hasn't moved"
    );
  });

  it("shows as given before the latest commits once the author pushes", async () => {
    const newHead = pushToPullRequest(
      pr,
      pr.head,
      { "package-lock.json": '{"lockfileVersion": 3}\n' },
      "chore(deps-dev): bump fast-uri from 3.1.9 to 3.1.10"
    );
    await serveGitHub({
      viewer,
      pullRequests: [{ ...fakePullRequest, headSha: newHead }],
    });
    await refreshInbox();
    await openFromInbox(
      inboxEntry(
        await inbox(),
        "chore(deps-dev): bump fast-uri from 3.1.8 to 3.1.9"
      )
    );

    await eventually(async () => {
      const recommendation = (await shown()).recommendation;
      assert.strictEqual(
        recommendation?.outOfDate,
        true,
        "it was given for the head before this one"
      );
      assert.strictEqual(
        recommendation?.advice?.says,
        "Approve it",
        "what it advised is still shown, marked as out of date"
      );
    });
  });
});
