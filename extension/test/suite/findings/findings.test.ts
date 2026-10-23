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
import { shownText } from "../changeFiles";
import {
  clickHoverLink,
  convertFinding,
  dismissFinding,
  findIssues,
  findingAt,
  findingQuickFixes,
  hoversOpened,
  findingsView,
  gutterMarkers,
  nextHover,
  revealFinding,
  runQuickFix,
  type GutterMarker,
} from "../findings";
import { buildFixtureRepo, buildPullRequestFixture } from "../fixtures";
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
  openChange,
  short,
  workspaceFolders,
} from "../reviewer";

const viewer = { login: "reviewer", token: "test-token" };
const settingKeys = ["githubApiUrl", "repositories", "localClones"];
/** The review chord, as the Reviewer's platform writes it. */
const chord = process.platform === "darwin" ? "⌃⌥R" : "Ctrl+Alt+R";

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

// Findings over several lines, one overlapping another's last line.
const longFindingsReply = JSON.stringify({
  findings: [
    {
      path: "util.py",
      side: "head",
      startLine: 1,
      endLine: 3,
      message: "new_helper could be inlined.",
    },
    {
      path: "util.py",
      side: "base",
      startLine: 1,
      endLine: 2,
      message: "The base had no docstring.",
    },
    {
      path: "util.py",
      side: "base",
      startLine: 2,
      endLine: 2,
      message: "It returned 2 here too.",
    },
  ],
});

/** The marker of the file's Finding, on `line` if given, once its editor shows it. */
async function markerOf(file: string, line?: number): Promise<GutterMarker> {
  let found: GutterMarker | undefined;
  await eventually(async () => {
    found = (await gutterMarkers()).find(
      (m) => m.file === file && (line === undefined || m.lines[0] === line)
    );
    assert.ok(found, `a marker in ${file}`);
  });
  return found!;
}

/** The place a hover gives its Finding, `n` of `Finding n of N`. */
function positionIn(hover: string): number {
  const count = /\*\*Finding (\d+) of \d+\*\*/.exec(hover);
  assert.ok(count, `a count in ${hover}`);
  return Number(count[1]);
}

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
    await scriptClaude(change, { turns: [replyTurn("A summary.")] });
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
    const [run] = await assistantRuns(change);
    assert.deepStrictEqual(
      userMessages(run).length,
      1,
      "only the summary was asked for"
    );
  });

  it("asks the Assistant for Findings as JSON, in the Change's own conversation", async () => {
    await scriptClaude(change, { turns: [replyTurn(findingsReply)] });

    await findIssues(change);

    const [run, ...others] = await assistantRuns(change);
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
          text: `Raised 3 Findings, marked in the gutter of the diff and listed in the Findings view. ${chord} F steps through them, and ${chord} Shift+F back. Left out 4 that weren't on the lines of the diff.`,
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
          .map(({ file, lines, gutter }) => ({ file, lines, gutter })),
        [
          { file: opened[0], lines: [0, 0], gutter: ["cat"] },
          { file: opened[1], lines: [1, 1], gutter: ["cat"] },
        ]
      )
    );
    assert.deepStrictEqual(await commentThreads(), []);
  });

  // The editor opens a hover at the cursor, so where it opens is where the
  // step left the cursor.
  it("steps from Finding to Finding, and round again, with the review keys, opening each one's hover on its first line", async () => {
    const step = async (command: string) => {
      const before = await hoversOpened();
      await vscode.commands.executeCommand(command);
      const { file, line } = await nextHover(before);
      return `${file}:${line}`;
    };
    const visited: string[] = [];
    for (let i = 0; i < 4; i++)
      visited.push(await step("dearReviewer.nextFinding"));

    assert.deepStrictEqual(
      [...visited.slice(0, 3)].sort(),
      [
        `${path.join(base, "pkg/legacy.py")}:0`,
        `${path.join(head, "pkg/sub/new.py")}:0`,
        `${path.join(head, "util.py")}:1`,
      ].sort()
    );
    assert.strictEqual(visited[3], visited[0], "goes round");
    assert.strictEqual(await step("dearReviewer.previousFinding"), visited[2]);
  });

  it("shows the Assistant's message in the hover as plain text, with its place among the Findings, and only Convert, Dismiss, Next and Previous to run", async () => {
    await vscode.window.showTextDocument(
      vscode.Uri.file(path.join(head, "util.py")),
      { viewColumn: vscode.ViewColumn.One, preview: false }
    );
    const marker = await markerOf(path.join(head, "util.py"));

    assert.deepStrictEqual(marker.enabledCommands, [
      "dearReviewer.convertFinding",
      "dearReviewer.dismissFinding",
      "dearReviewer.nextFinding",
      "dearReviewer.previousFinding",
    ]);
    assert.ok(marker.hover.includes("docstring"), marker.hover);
    assert.ok(
      !marker.hover.includes("**Two**") &&
        !marker.hover.includes("](command:workbench"),
      `the message can't format or link: ${marker.hover}`
    );
    assert.match(marker.hover, /\*\*Finding [1-3] of 3\*\* from the Assistant/);
    const entry = await findingAt("util.py:2");
    const args = encodeURIComponent(JSON.stringify(entry.command!.arguments));
    for (const command of [
      "convertFinding",
      "dismissFinding",
      "previousFinding",
      "nextFinding",
    ])
      assert.ok(
        marker.hover.includes(`](command:dearReviewer.${command}?${args})`),
        `${command} with the Finding's id in ${marker.hover}`
      );
  });

  it("offers a Finding's Convert to Comment and Dismiss in Quick Fix on its lines, on either side", async () => {
    const idOf = async (where: string) =>
      (await findingAt(where)).command!.arguments![0];
    const actionsOf = (id: unknown) => [
      {
        title: "Finding: Convert to Comment",
        kind: "quickfix",
        command: "dearReviewer.convertFinding",
        arguments: [id],
      },
      {
        title: "Finding: Dismiss",
        kind: "quickfix",
        command: "dearReviewer.dismissFinding",
        arguments: [id],
      },
    ];

    assert.deepStrictEqual(
      await findingQuickFixes(path.join(head, "util.py"), 1),
      actionsOf(await idOf("util.py:2"))
    );
    assert.deepStrictEqual(
      await findingQuickFixes(path.join(base, "pkg/legacy.py"), 0),
      actionsOf(await idOf("pkg/legacy.py:1 (base)"))
    );
    assert.deepStrictEqual(
      await findingQuickFixes(path.join(head, "util.py"), 0),
      [],
      "no Finding on the line"
    );
    assert.deepStrictEqual(
      await findingQuickFixes(
        path.join(head, "util.py"),
        new vscode.Range(0, 0, 1, 0)
      ),
      [],
      "a selection of the whole line above ends where the Finding starts"
    );
    assert.deepStrictEqual(
      (
        await findingQuickFixes(
          path.join(head, "util.py"),
          new vscode.Range(0, 0, 1, 1)
        )
      ).map((a) => a.title),
      ["Finding: Convert to Comment", "Finding: Dismiss"],
      "a selection into the Finding's line"
    );
  });

  it("opens a Finding's file from the view with the cursor on its first line and its hover open", async () => {
    const entry = await findingAt("pkg/sub/new.py:1");
    const before = await hoversOpened();

    await vscode.commands.executeCommand(
      entry.command!.command,
      ...(entry.command!.arguments ?? [])
    );

    assert.deepStrictEqual(await nextHover(before), {
      file: path.join(head, "pkg/sub/new.py"),
      line: 0,
    });
  });

  it("steps from the Finding whose hover's link is clicked, not from the cursor", async () => {
    const legacy = path.join(base, "pkg/legacy.py");
    await revealFinding(await findingAt("pkg/legacy.py:1 (base)"));
    const from = await markerOf(legacy);
    const position = positionIn(from.hover);
    await revealFinding(await findingAt("util.py:2"));
    const before = await hoversOpened();

    await clickHoverLink(from.hover, "dearReviewer.nextFinding");

    const opened = await nextHover(before);
    const marker = await markerOf(opened.file, opened.line);
    assert.strictEqual(positionIn(marker.hover), (position % 3) + 1);
  });

  it("dismisses a Finding, and counts the rest again", async () => {
    await dismissFinding(await findingAt("pkg/sub/new.py:1"));

    assert.deepStrictEqual(
      (await findingsView()).map((e) => e.where),
      ["util.py:2", "pkg/legacy.py:1 (base)"]
    );
    assert.ok(
      !(await gutterMarkers()).some((m) => m.file.endsWith("new.py")),
      "its marker is gone"
    );
    await vscode.window.showTextDocument(
      vscode.Uri.file(path.join(head, "util.py")),
      { viewColumn: vscode.ViewColumn.One, preview: false }
    );
    assert.match(
      (await markerOf(path.join(head, "util.py"))).hover,
      /\*\*Finding [12] of 2\*\*/
    );
  });

  it("keeps the Findings when the Assistant's reply holds none", async () => {
    await scriptClaude(change, {
      turns: [replyTurn("Sorry, I would rather chat about it.")],
    });

    await findIssues(change);

    assert.deepStrictEqual(
      (await findingsView()).map((e) => e.where),
      ["util.py:2", "pkg/legacy.py:1 (base)"]
    );
  });

  it("turns a Finding into a draft Comment at the same place, without reaching GitHub, opening its file without a hover", async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    const hovers = await hoversOpened();

    await convertFinding(await findingAt("pkg/legacy.py:1 (base)"));

    await eventually(() =>
      assert.strictEqual(shownText().fsPath, path.join(base, "pkg/legacy.py"))
    );
    assert.strictEqual(await hoversOpened(), hovers, "no hover");
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

  it("drops a draft Comment the Reviewer cancels, converted from Quick Fix", async () => {
    const [convert] = await findingQuickFixes(path.join(head, "util.py"), 1);
    await runQuickFix(convert);
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

  it("lists only the Active Change's Findings, and drops a Change's when it stops", async () => {
    await scriptClaude(change, { turns: [replyTurn(findingsReply)] });
    await findIssues(change);
    const listed = async () =>
      (await findingsView()).map(({ change, where }) => `${change} ${where}`);
    const raised = [
      "acme/api #31 util.py:2",
      "acme/api #31 pkg/legacy.py:1 (base)",
      "acme/api #31 pkg/sub/new.py:1",
    ];
    assert.deepStrictEqual(await listed(), raised);
    const repo = buildFixtureRepo("behind-findings");
    const other = {
      repository: repo.path,
      base: repo.commits.initial,
      head: repo.commits.renamed,
    };

    await openChange(other);
    try {
      // Once its summary is in, so a refresh then can't bring back the wrong Findings.
      await summaryWritten(
        `${path.basename(repo.path)} ${short(other.base)}..${short(other.head)}`
      );
      assert.deepStrictEqual(await findingsView(), []);

      await openFromInbox(
        inboxEntry(await inbox(), "Restructure pkg, with Findings")
      );

      // Findings are not kept when a Change stops; the Reviewer asks again.
      assert.deepStrictEqual(await listed(), []);
    } finally {
      await closeChange(other);
      // Showing the other Change closed this one's Assistant panel.
      await showAssistant(change);
    }
  });

  it("replaces the Findings each time the Reviewer asks", async () => {
    await scriptClaude(change, {
      turns: [replyTurn(findingsReply), replyTurn('{"findings": []}')],
    });
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

  it("marks a Finding over several lines with one cat and a bar down the rest, and one icon per line where Findings overlap", async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    const headFile = path.join(head, "util.py");
    const baseFile = path.join(base, "util.py");
    await vscode.window.showTextDocument(vscode.Uri.file(headFile), {
      viewColumn: vscode.ViewColumn.One,
      preview: false,
    });
    await vscode.window.showTextDocument(vscode.Uri.file(baseFile), {
      viewColumn: vscode.ViewColumn.Two,
      preview: false,
    });
    await scriptClaude(change, { turns: [replyTurn(longFindingsReply)] });

    await findIssues(change);

    await eventually(async () =>
      assert.deepStrictEqual(
        (await gutterMarkers()).map(({ file, lines, gutter }) => ({
          file,
          lines,
          gutter,
        })),
        [
          {
            file: baseFile,
            lines: [0, 1],
            gutter: ["cat", "cat"],
          },
          { file: baseFile, lines: [1, 1], gutter: ["cat"] },
          {
            file: headFile,
            lines: [0, 2],
            gutter: ["cat", "bar", "bar"],
          },
        ].sort((a, b) => a.file.localeCompare(b.file))
      )
    );
    const hovers = (await gutterMarkers())
      .filter((m) => m.file === headFile)
      .map((m) => m.hover);
    assert.strictEqual(hovers.length, 1, "one hover over the whole Finding");
    assert.ok(hovers[0].includes("inlined."), hovers[0]);
    assert.match(hovers[0], /\]\(command:dearReviewer\.dismissFinding\?/);
  });

  it("finds the Finding under the cursor on any of its lines", async () => {
    await scriptClaude(change, { turns: [replyTurn(longFindingsReply)] });
    await findIssues(change);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    const editor = await vscode.window.showTextDocument(
      vscode.Uri.file(path.join(head, "util.py"))
    );
    editor.selection = new vscode.Selection(2, 0, 2, 0);
    await eventually(async () =>
      assert.strictEqual(vscode.window.activeTextEditor, editor)
    );

    await vscode.commands.executeCommand("dearReviewer.dismissFinding");

    assert.deepStrictEqual(
      (await findingsView()).map((e) => e.where),
      ["util.py:1-2 (base)", "util.py:2 (base)"]
    );
  });

  it("offers each Finding on a line its own Quick Fix actions, told apart by their titles", async () => {
    await scriptClaude(change, { turns: [replyTurn(longFindingsReply)] });
    await findIssues(change);
    const baseFile = path.join(base, "util.py");

    const actions = await findingQuickFixes(baseFile, 1);

    assert.deepStrictEqual(
      actions.map((a) => a.title),
      [
        "Finding on lines 1–2, “The base had no docstring.”: Convert to Comment",
        "Finding on lines 1–2, “The base had no docstring.”: Dismiss",
        "Finding on line 2, “It returned 2 here too.”: Convert to Comment",
        "Finding on line 2, “It returned 2 here too.”: Dismiss",
      ]
    );
    await runQuickFix(actions[3]);
    assert.deepStrictEqual(
      (await findingsView()).map((e) => e.where),
      ["util.py:1-3", "util.py:1-2 (base)"]
    );
    assert.deepStrictEqual(
      (await findingQuickFixes(baseFile, 1)).map((a) => a.title),
      ["Finding: Convert to Comment", "Finding: Dismiss"]
    );
  });

  it("reaches each of two Findings that start on the same line, and steps back from a Finding of several lines to the one before it", async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    const file = path.join(head, "util.py");
    await scriptClaude(change, {
      turns: [
        replyTurn(
          JSON.stringify({
            findings: [
              {
                path: "util.py",
                side: "head",
                startLine: 1,
                endLine: 1,
                message: "Tie one.",
              },
              {
                path: "util.py",
                side: "head",
                startLine: 1,
                endLine: 1,
                message: "Tie two.",
              },
              {
                path: "util.py",
                side: "head",
                startLine: 2,
                endLine: 3,
                message: "Spans two lines.",
              },
            ],
          })
        ),
      ],
    });
    await findIssues(change);
    await revealFinding(await findingAt("util.py:1"));
    let ties: GutterMarker[] = [];
    await eventually(async () => {
      ties = (await gutterMarkers()).filter(
        (m) => m.file === file && m.lines[0] === 0
      );
      assert.deepStrictEqual(
        ties.map((m) => positionIn(m.hover)).sort(),
        [1, 2],
        "two places for two Findings on one line"
      );
    });
    const first = ties.find((m) => positionIn(m.hover) === 1)!;
    // Waits for a hover where the step should open one, so that a hover
    // late from an earlier step can't pass for it.
    const step = async (
      run: () => Thenable<unknown>,
      expected: { file: string; line: number }
    ) => {
      const before = await hoversOpened();
      await run();
      await eventually(async () =>
        assert.deepStrictEqual(await nextHover(before), expected)
      );
    };
    // Closed, so the click opens the file again with a hover of its own.
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    await step(() => clickHoverLink(first.hover, "dearReviewer.nextFinding"), {
      file,
      line: 0,
    });
    // On from the second tie goes past both: from the first, it would stay
    // on line 0.
    await step(
      () => vscode.commands.executeCommand("dearReviewer.nextFinding"),
      { file, line: 1 }
    );
    const editor = vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.fsPath === file
    )!;
    editor.selection = new vscode.Selection(2, 0, 2, 0);
    await eventually(() =>
      assert.strictEqual(
        vscode.window.activeTextEditor?.selection.active.line,
        2
      )
    );

    await step(
      () => vscode.commands.executeCommand("dearReviewer.previousFinding"),
      { file, line: 0 }
    );
  });

  describe("opening another Change with a Comment being written", () => {
    const repo = buildFixtureRepo("discard-prompt");
    const other = {
      repository: repo.path,
      base: repo.commits.initial,
      head: repo.commits.renamed,
    };

    async function discardApi() {
      const extension = vscode.extensions.getExtension<{
        reviewWindow: {
          answerDiscardQuestion(discard?: boolean): void;
          discardQuestions(): readonly string[];
        };
      }>("edziegle.dear-reviewer");
      return (await extension!.activate()).reviewWindow;
    }

    afterEach(async () => (await discardApi()).answerDiscardQuestion());

    it("asks first, and Cancel keeps the Active Change and opens nothing", async () => {
      await scriptClaude(change, { turns: [replyTurn(findingsReply)] });
      await findIssues(change);
      await convertFinding(await findingAt("util.py:2"));
      const api = await discardApi();
      api.answerDiscardQuestion(false);
      const before = workspaceFolders();

      await openChange(other);

      assert.deepStrictEqual(api.discardQuestions().slice(-1), [
        "Discard the Comment you're writing on acme/api #31?",
      ]);
      assert.deepStrictEqual(workspaceFolders(), before);
      assert.ok(
        await threadAt(path.join(head, "util.py"), 1),
        "the Comment is still being written"
      );
    });

    it("opens the other Change once the Reviewer discards the Comment", async () => {
      const api = await discardApi();
      api.answerDiscardQuestion(true);
      const before = workspaceFolders();

      await openChange(other);

      try {
        assert.strictEqual(foldersAddedSince(before).length, 2);
        assert.ok(
          !workspaceFolders().some((f) => f.path === head),
          "the pull request's folders are gone"
        );
      } finally {
        await closeChange(other);
      }
    });
  });
});
