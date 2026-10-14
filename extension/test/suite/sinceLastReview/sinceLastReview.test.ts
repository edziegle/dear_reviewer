import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import {
  askAssistant,
  assistantRuns,
  flag,
  renderedPanel,
  replyTurn,
  scriptClaude,
  sendSelection,
  userMessages,
} from "../assistant";
import { buildPullRequestFixture, pushToPullRequest } from "../fixtures";
import {
  configure,
  fakePullRequestId,
  inbox,
  inboxEntry,
  openFromInbox,
  refreshInbox,
  requestsToGitHub,
  reviewsOnGitHub,
  serveGitHub,
  setToken,
  type FakePullRequest,
} from "../github";
import { showChangesSinceLastReview, submitReview } from "../review";
import {
  activeTabLabel,
  closeChange,
  eventually,
  multiDiffSides,
  short,
  workspaceFolders,
} from "../reviewer";

const viewer = { login: "reviewer", token: "test-token" };
const settingKeys = ["githubApiUrl", "repositories", "localClones"];

// The Reviewer submits a Review, the author pushes new commits, and the
// Reviewer comes back to see only what changed since.
describe("What changed since my last Review", () => {
  const pr = buildPullRequestFixture("since", "acme/since", 41);
  const elsewhere = buildPullRequestFixture("elsewhere", "acme/elsewhere", 42);
  const docstring = 'def new_helper():\n    """Three."""\n    return 3\n';
  let newHead = "";
  const fakePullRequest: FakePullRequest = {
    repository: pr.repository,
    number: pr.number,
    title: "Restructure pkg",
    author: "alice",
    reviewRequested: ["reviewer"],
    headSha: pr.head,
    files: [
      { path: "pkg/core.py" },
      { path: "pkg/legacy.py" },
      { path: "pkg/sub/new.py" },
      { path: "util.py" },
    ],
  };
  // Reviewed on github.com, at a commit before its latest.
  const reviewedElsewhere: FakePullRequest = {
    repository: elsewhere.repository,
    number: elsewhere.number,
    title: "Reviewed on github.com",
    author: "bob",
    reviewRequested: ["reviewer"],
    headSha: elsewhere.head,
    reviews: [
      {
        id: "PRR_web",
        author: "reviewer",
        state: "COMMENTED",
        submittedAt: "2026-10-02T10:00:00Z",
        commit: elsewhere.base,
        threads: [],
      },
      {
        id: "PRR_carol",
        author: "carol",
        state: "APPROVED",
        submittedAt: "2026-10-03T10:00:00Z",
        commit: elsewhere.head,
        threads: [],
      },
    ],
  };
  const requestAt = (head: string) => ({
    repository: pr.clone,
    base: pr.base,
    head,
    pullRequest: { repository: pr.repository, number: pr.number },
  });
  const titleAt = (head: string) =>
    `${path.basename(pr.clone)} ${short(pr.base)}..${short(head)}`;
  const found = new Map<string, unknown>();

  async function entry(title: string) {
    await refreshInbox();
    return inboxEntry(await inbox(), title);
  }

  before(async () => {
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      found.set(key, config.inspect(key)?.globalValue);
    await serveGitHub({
      viewer,
      pullRequests: [fakePullRequest, reviewedElsewhere],
    });
    await configure({
      repositories: [pr.repository, elsewhere.repository],
    });
    await config.update(
      "localClones",
      { [pr.repository]: pr.clone, [elsewhere.repository]: elsewhere.clone },
      vscode.ConfigurationTarget.Global
    );
    await setToken(viewer.token);
  });

  after(async () => {
    await closeChange(requestAt(pr.head));
    if (newHead) await closeChange(requestAt(newHead));
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      await config.update(
        key,
        found.get(key),
        vscode.ConfigurationTarget.Global
      );
  });

  it("marks an Inbox entry whose pull request has commits after the Reviewer's last Review on GitHub", async () => {
    assert.strictEqual(
      (await entry("Reviewed on github.com")).description,
      "acme/elsewhere #42 · new commits since my Review"
    );
    assert.strictEqual(
      (await entry("Restructure pkg")).description,
      "acme/since #41",
      "never reviewed, so nothing to compare with"
    );
  });

  it("records the head commit a submitted Review covered", async () => {
    scriptClaude({ turns: [replyTurn("A summary.")] });
    await openFromInbox(await entry("Restructure pkg"));
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(titleAt(pr.head)))?.busy, false)
    );

    await submitReview(requestAt(pr.head), "approve", "Looks good.");

    const started = (await requestsToGitHub()).flatMap((r) => {
      const body = r.body as { query?: string; variables?: { input?: object } };
      return body?.query?.includes("addPullRequestReview(")
        ? [body.variables?.input]
        : [];
    });
    assert.deepStrictEqual(
      started,
      [{ pullRequestId: fakePullRequestId(pr), commitOID: pr.head }],
      "the Review starts at the head of the Change the Reviewer read"
    );
    assert.deepStrictEqual(
      (await reviewsOnGitHub())
        .filter((r) => r.author === "reviewer")
        .map((r) => [r.state, r.commit]),
      [
        ["APPROVED", pr.head],
        ["COMMENTED", elsewhere.base],
      ]
    );
    assert.strictEqual(
      (await entry("Restructure pkg")).description,
      "acme/since #41",
      "reviewed at its head"
    );
  });

  it("has no changes to show while the Change is at the reviewed commit", async () => {
    await showChangesSinceLastReview(requestAt(pr.head));

    assert.ok(
      !activeTabLabel()?.includes("since my last Review"),
      `no diff since the last Review opened: ${activeTabLabel()}`
    );
  });

  it("marks the Inbox entry once the author pushes new commits", async () => {
    newHead = pushToPullRequest(
      pr,
      pr.head,
      { "util.py": docstring, "since.py": "SINCE = True\n" },
      "return three"
    );
    await serveGitHub({
      viewer,
      pullRequests: [
        {
          ...fakePullRequest,
          headSha: newHead,
          files: [...fakePullRequest.files!, { path: "since.py" }],
          reviews: (await reviewsOnGitHub())
            .filter((r) => r.pullRequestId.includes(pr.repository))
            .map(({ pullRequestId: _, ...review }) => review),
        },
        reviewedElsewhere,
      ],
    });

    assert.strictEqual(
      (await entry("Restructure pkg")).description,
      "acme/since #41 · new commits since my Review"
    );
  });

  it("has the Assistant explain in its panel what changed since the last Review", async () => {
    scriptClaude({
      turns: [replyTurn("new_helper now returns 3, and since.py is new.")],
    });

    await openFromInbox(await entry("Restructure pkg"));

    const title = titleAt(newHead);
    await eventually(async () =>
      assert.deepStrictEqual(await renderedPanel(title), {
        title,
        login: "Claude subscription (Max)",
        busy: false,
        messages: [
          { from: "assistant", text: "A summary." },
          {
            from: "note",
            text: `New commits: the Change is now at ${short(newHead)}, after ${short(pr.head)}.`,
          },
          {
            from: "note",
            text: `What changed since your last Review, at ${short(pr.head)}:`,
          },
          {
            from: "assistant",
            text: "new_helper now returns 3, and since.py is new.",
          },
        ],
      })
    );
    const [run, ...others] = assistantRuns();
    assert.deepStrictEqual(others, [], "one explanation");
    assert.ok(flag(run, "--resume"), "the Change's conversation carries on");
    const [prompt] = userMessages(run);
    for (const expected of [pr.head, newHead, "since.py", '"""Three."""'])
      assert.ok(prompt.includes(expected), `${expected} in ${prompt}`);
    assert.ok(
      !prompt.includes("pkg/core.py"),
      `only what changed since the Review: ${prompt}`
    );
  });

  it("doesn't explain the same commits again when the Change opens again", async () => {
    const title = titleAt(newHead);
    const before = (await renderedPanel(title))?.messages;
    scriptClaude({ turns: [replyTurn("Again?")] });
    await closeChange(requestAt(newHead));

    await openFromInbox(await entry("Restructure pkg"));

    await eventually(async () =>
      assert.deepStrictEqual((await renderedPanel(title))?.messages, before)
    );
    // Long enough for an explanation to have started.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.deepStrictEqual(assistantRuns(), []);
    assert.strictEqual((await renderedPanel(title))?.busy, false);
  });

  it("opens a diff of only what changed since the last Review", async () => {
    const head = workspaceFolders().find(
      (f) => f.name === `${path.basename(pr.clone)} head ${short(newHead)}`
    )!.path;
    // Only the diff's editors are then visible.
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    await showChangesSinceLastReview(requestAt(newHead));

    await eventually(() => {
      assert.strictEqual(
        activeTabLabel(),
        `${path.basename(pr.clone)} ${short(pr.head)}..${short(newHead)} since my last Review (2 files)`
      );
      // The old side is the reviewed commit's file; an added file has none.
      assert.deepStrictEqual(
        multiDiffSides().map(({ original, modified }) => [
          original.file ??
            (original.scheme === "dear-reviewer-commit" ? "commit" : "none"),
          original.text,
          modified.file,
          modified.text,
        ]),
        [
          ["none", "", path.join(head, "since.py"), "SINCE = True\n"],
          [
            "commit",
            'def new_helper():\n    """Two."""\n    return 2\n',
            path.join(head, "util.py"),
            docstring,
          ],
        ]
      );
    });
  });

  it("sends lines of the reviewed commit's side to the Assistant, as lines at that commit", async () => {
    const title = titleAt(newHead);
    const reviewed = vscode.window.visibleTextEditors.find(
      (editor) => editor.document.uri.scheme === "dear-reviewer-commit"
    )?.document.uri;
    assert.ok(reviewed, "the diff since the last Review is still open");
    scriptClaude({ turns: [replyTurn("It returned 2.")] });
    // The last test closed every editor, the Assistant panel included.
    await vscode.commands.executeCommand(
      "dearReviewer.showAssistant",
      requestAt(newHead)
    );

    await sendSelection(reviewed, 0, 2);

    await eventually(async () =>
      assert.deepStrictEqual((await renderedPanel(title))?.context, [
        {
          path: "util.py",
          side: "commit",
          commit: pr.head,
          startLine: 1,
          endLine: 3,
          text: 'def new_helper():\n    """Two."""\n    return 2',
        },
      ])
    );

    await askAssistant(title, "What did it return?");

    await eventually(async () =>
      assert.deepStrictEqual((await renderedPanel(title))?.messages.at(-1), {
        from: "assistant",
        text: "It returned 2.",
      })
    );
    const [prompt] = userMessages(assistantRuns()[0]);
    assert.ok(
      prompt.includes(`lines 1–3 of util.py at commit ${pr.head}`),
      prompt
    );
  });
});
