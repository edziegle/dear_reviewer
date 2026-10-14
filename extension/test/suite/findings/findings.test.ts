import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import {
  assistantRuns,
  renderedPanel,
  showAssistant,
  summaryNote,
  summaryWritten,
  replyTurn,
  scriptClaude,
  userMessages,
} from "../assistant";
import {
  convertFinding,
  dismissFinding,
  findIssues,
  findingAt,
  findingsView,
  gutterMarkers,
} from "../findings";
import { buildPullRequestFixture } from "../fixtures";
import {
  configure,
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
import { commentThreads, threadAt, withoutIds } from "../review";
import {
  closeChange,
  eventually,
  foldersAddedSince,
  short,
  workspaceFolders,
} from "../reviewer";

const viewer = { login: "reviewer", token: "test-token" };
const settingKeys = ["githubApiUrl", "repositories", "localClones"];

// What the Assistant replies when asked for Findings: three on the diff,
// and four Dear Reviewer must leave out.
const findingsReply = [
  "Here are the Findings:",
  "```json",
  JSON.stringify({
    findings: [
      {
        path: "util.py",
        side: "head",
        startLine: 2,
        endLine: 2,
        message:
          "The docstring says **Two**; see [this](command:workbench.action.terminal.new).",
      },
      {
        path: "pkg/legacy.py",
        side: "base",
        startLine: 1,
        endLine: 1,
        message: "Something may still read LEGACY.",
      },
      {
        // The fake claude writes the head worktree's path here.
        path: "{head}/pkg/sub/new.py",
        side: "head",
        startLine: 1,
        endLine: 1,
        message: "NEW isn't used anywhere.",
      },
      {
        path: "../outside.py",
        side: "head",
        startLine: 1,
        endLine: 1,
        message: "Outside the worktree.",
      },
      {
        path: "main.py",
        side: "head",
        startLine: 1,
        endLine: 1,
        message: "Not part of the diff.",
      },
      {
        path: "util.py",
        side: "head",
        startLine: 3,
        endLine: 9,
        message: "Past the end of the file.",
      },
      {
        path: "pkg/core.py",
        side: "left",
        startLine: 1,
        endLine: 1,
        message: "No such side.",
      },
    ],
  }),
  "```",
].join("\n");

// Findings only when the Reviewer asks for them, in the gutter of a pull
// request's diff, turned into Comments or dismissed.
describe("Findings on request", () => {
  const pr = buildPullRequestFixture("findings", "acme/api", 31);
  const fakePullRequest: FakePullRequest = {
    repository: pr.repository,
    number: pr.number,
    title: "Restructure pkg, with Findings",
    author: "alice",
    reviewRequested: ["reviewer"],
    files: [
      { path: "pkg/core.py" },
      { path: "pkg/legacy.py" },
      { path: "pkg/sub/new.py" },
      { path: "util.py" },
    ],
  };
  const change = {
    repository: pr.clone,
    base: pr.base,
    head: pr.head,
    pullRequest: { repository: pr.repository, number: pr.number },
  };
  const title = `${path.basename(pr.clone)} ${short(pr.base)}..${short(pr.head)}`;
  const found = new Map<string, unknown>();
  let base = "";
  let head = "";

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
    // One claude runs the whole conversation, so every turn is scripted here.
    scriptClaude({
      turns: [
        replyTurn("A summary."),
        replyTurn(findingsReply),
        replyTurn("Sorry, I would rather chat about it."),
        replyTurn(findingsReply),
        replyTurn('{"findings": []}'),
      ],
    });
    await refreshInbox();
    const before = workspaceFolders();
    await openFromInbox(
      inboxEntry(await inbox(), "Restructure pkg, with Findings")
    );
    [base, head] = foldersAddedSince(before).map((f) => f.path);
    assert.ok(base && head, "the pull request opened as a Change");
    await summaryWritten(title);
    await showAssistant(change);
  });

  after(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await closeChange(change);
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      await config.update(
        key,
        found.get(key),
        vscode.ConfigurationTarget.Global
      );
  });

  it("raises no Findings until the Reviewer asks", async () => {
    assert.deepStrictEqual(await findingsView(), []);
    assert.deepStrictEqual(await gutterMarkers(), []);
    const [run] = assistantRuns();
    assert.deepStrictEqual(
      userMessages(run).length,
      1,
      "only the summary was asked for"
    );
  });

  it("asks the Assistant for Findings as JSON, in the Change's own conversation", async () => {
    await findIssues(change);

    const [run, ...others] = assistantRuns();
    assert.deepStrictEqual(others, [], "one run of claude");
    const prompt = userMessages(run)[1];
    for (const expected of [
      '"findings"',
      '"side"',
      '"startLine"',
      "pkg/legacy.py",
      '+    """Two."""',
      pr.head,
    ])
      assert.ok(prompt?.includes(expected), `${expected} in ${prompt}`);
  });

  it("lists the Findings on the diff's lines, inside the worktrees, and leaves out the rest", async () => {
    assert.deepStrictEqual(
      (await findingsView()).map(({ change, message, where }) => ({
        change,
        message,
        where,
      })),
      [
        {
          change: "acme/api #31",
          message:
            "The docstring says **Two**; see [this](command:workbench.action.terminal.new).",
          where: "util.py:2",
        },
        {
          change: "acme/api #31",
          message: "Something may still read LEGACY.",
          where: "pkg/legacy.py:1 (base)",
        },
        {
          change: "acme/api #31",
          message: "NEW isn't used anywhere.",
          where: "pkg/sub/new.py:1",
        },
      ]
    );
  });

  it("keeps only a note about the Findings in the Assistant's panel", async () => {
    await eventually(async () => {
      const panel = await renderedPanel(title);
      assert.strictEqual(panel?.busy, false);
      assert.deepStrictEqual(panel?.messages, [
        summaryNote,
        {
          from: "note",
          text: "Raised 3 Findings, marked in the gutter of the diff and listed in the Findings view. Left out 4 that weren't on the lines of the diff.",
        },
      ]);
    });
  });

  it("marks the Findings in the gutter of their files, with no Comment thread in the diff", async () => {
    await vscode.window.showTextDocument(
      vscode.Uri.file(path.join(head, "util.py")),
      { viewColumn: vscode.ViewColumn.One, preview: false }
    );
    await vscode.window.showTextDocument(
      vscode.Uri.file(path.join(base, "pkg/legacy.py")),
      { viewColumn: vscode.ViewColumn.Two, preview: false }
    );

    const opened = [
      path.join(base, "pkg/legacy.py"),
      path.join(head, "util.py"),
    ];
    // The Change's multi-file diff may show other files too.
    await eventually(async () =>
      assert.deepStrictEqual(
        (await gutterMarkers())
          .filter((m) => opened.includes(m.file))
          .map(({ file, lines }) => ({ file, lines })),
        [
          { file: opened[0], lines: [0, 0] },
          { file: opened[1], lines: [1, 1] },
        ]
      )
    );
    assert.deepStrictEqual(await commentThreads(), []);
  });

  it("steps from Finding to Finding, and round again, with the review keys", async () => {
    const at = () => {
      const editor = vscode.window.activeTextEditor!;
      return `${editor.document.uri.fsPath}:${editor.selection.start.line}`;
    };
    const visited: string[] = [];
    for (let i = 0; i < 4; i++) {
      await vscode.commands.executeCommand("dearReviewer.nextFinding");
      visited.push(at());
    }

    assert.deepStrictEqual(
      [...visited.slice(0, 3)].sort(),
      [
        `${path.join(base, "pkg/legacy.py")}:0`,
        `${path.join(head, "pkg/sub/new.py")}:0`,
        `${path.join(head, "util.py")}:1`,
      ].sort()
    );
    assert.strictEqual(visited[3], visited[0], "goes round");
    await vscode.commands.executeCommand("dearReviewer.previousFinding");
    assert.strictEqual(at(), visited[2]);
  });

  it("shows the Assistant's message in the hover as plain text, with only Dismiss and Convert to run", async () => {
    const marker = (await gutterMarkers()).find(
      (m) => m.file === path.join(head, "util.py")
    );

    assert.ok(marker, "util.py has a marker");
    assert.deepStrictEqual(marker.enabledCommands, [
      "dearReviewer.convertFinding",
      "dearReviewer.dismissFinding",
    ]);
    assert.ok(marker.hover.includes("docstring"), marker.hover);
    assert.ok(
      !marker.hover.includes("**Two**") &&
        !marker.hover.includes("](command:workbench"),
      `the message can't format or link: ${marker.hover}`
    );
    assert.match(marker.hover, /\]\(command:dearReviewer\.convertFinding\?/);
    assert.match(marker.hover, /\]\(command:dearReviewer\.dismissFinding\?/);
  });

  it("opens a Finding's file at its lines from the view", async () => {
    const entry = await findingAt("pkg/sub/new.py:1");

    await vscode.commands.executeCommand(
      entry.command!.command,
      ...(entry.command!.arguments ?? [])
    );

    const editor = vscode.window.activeTextEditor;
    assert.strictEqual(
      editor?.document.uri.fsPath,
      path.join(head, "pkg/sub/new.py")
    );
    assert.strictEqual(editor?.selection.start.line, 0);
  });

  it("dismisses a Finding", async () => {
    await dismissFinding(await findingAt("pkg/sub/new.py:1"));

    assert.deepStrictEqual(
      (await findingsView()).map((e) => e.where),
      ["util.py:2", "pkg/legacy.py:1 (base)"]
    );
    assert.ok(
      !(await gutterMarkers()).some((m) => m.file.endsWith("new.py")),
      "its marker is gone"
    );
  });

  it("keeps the Findings when the Assistant's reply holds none", async () => {
    await findIssues(change);

    assert.deepStrictEqual(
      (await findingsView()).map((e) => e.where),
      ["util.py:2", "pkg/legacy.py:1 (base)"]
    );
  });

  it("turns a Finding into a draft Comment at the same place, without reaching GitHub", async () => {
    await convertFinding(await findingAt("pkg/legacy.py:1 (base)"));

    const thread = await threadAt(path.join(base, "pkg/legacy.py"), 0);
    assert.deepStrictEqual(
      thread.comments.map((c) => [c.body, c.mode, c.contextValue]),
      [
        [
          "Something may still read LEGACY.",
          vscode.CommentMode.Editing,
          "draft",
        ],
      ]
    );
    assert.deepStrictEqual(
      (await findingsView()).map((e) => e.where),
      ["util.py:2"]
    );
    assert.deepStrictEqual(await reviewsOnGitHub(), []);
    assert.ok(
      !(await requestsToGitHub()).some((r) =>
        JSON.stringify(r.body ?? "").includes("mutation")
      ),
      "nothing was written to GitHub"
    );
  });

  it("saves the Comment, as the Reviewer edited it, to the pending review, and publishes nothing", async () => {
    const thread = await threadAt(path.join(base, "pkg/legacy.py"), 0);
    const [draft] = thread.comments;
    draft.body = "Does anything still read LEGACY?";

    await vscode.commands.executeCommand("dearReviewer.saveComment", draft);

    assert.deepStrictEqual((await reviewsOnGitHub()).map(withoutIds), [
      {
        author: "reviewer",
        state: "PENDING",
        threads: [
          {
            path: "pkg/legacy.py",
            side: "LEFT",
            line: 1,
            comments: ["Does anything still read LEGACY?"],
          },
        ],
      },
    ]);
    assert.deepStrictEqual(await commentThreads(), [
      {
        file: path.join(base, "pkg/legacy.py"),
        lines: [0, 0],
        comments: ["Does anything still read LEGACY?"],
        editable: [true],
      },
    ]);
  });

  it("drops a draft Comment the Reviewer cancels", async () => {
    await convertFinding(await findingAt("util.py:2"));
    const [draft] = (await threadAt(path.join(head, "util.py"), 1)).comments;

    await vscode.commands.executeCommand(
      "dearReviewer.cancelEditComment",
      draft
    );

    assert.deepStrictEqual(
      (await commentThreads()).map((t) => t.file),
      [path.join(base, "pkg/legacy.py")]
    );
    assert.deepStrictEqual(
      (await reviewsOnGitHub()).flatMap((r) => r.threads).length,
      1
    );
    assert.deepStrictEqual(await findingsView(), []);
  });

  it("replaces the Findings each time the Reviewer asks", async () => {
    await findIssues(change);
    assert.strictEqual((await findingsView()).length, 3);

    await findIssues(change);

    assert.deepStrictEqual(await findingsView(), []);
    assert.deepStrictEqual(await gutterMarkers(), []);
    await eventually(async () =>
      assert.deepStrictEqual((await renderedPanel(title))?.messages.at(-1), {
        from: "note",
        text: "Raised no Findings.",
      })
    );
  });
});
