import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  assistantRuns,
  flag,
  assistantTake,
  renderedPanel,
  showAssistant,
  replyTurn,
  scriptClaude,
  userMessages,
} from "../../assistant";
import {
  inbox,
  inboxEntry,
  openBranchFromInbox,
  refreshInbox,
  setToken,
} from "../../github";
import {
  commentThreads,
  copyBrief,
  showChangesSinceLastReview,
  writeBrief,
} from "../../review";
import {
  activeTabLabel,
  closeChange,
  eventually,
  gitIn,
  multiDiffSides,
  short,
  workspaceFolders,
} from "../../reviewer";
import { pickUpAfterReload } from "../handoff";

const settingKeys = ["githubApiUrl", "repositories", "localClones"];

const brief = [
  "# Brief",
  "",
  "1. In `util.py:1-3`, drop the docstring of `new_helper`, or say why it is there.",
  "2. Find out who used `pkg/legacy.py:1` before deleting it.",
  "",
].join("\n");

// The second launch: the Comments come back, and the Reviewer ends the
// Review with a Brief, which records the head it covered. The agent then
// adds commits, and the Reviewer sees only what changed since.
describe("Ending a local Review with a Brief", () => {
  const { clone, change, baseDir, headDir } = pickUpAfterReload();
  const repo = path.basename(clone);
  const title = `${repo} ${short(change.base)}..${short(change.head)}`;
  let newHead = "";
  const requestAt = (head: string) => ({ ...change, head });

  before(async () => {
    // The token was kept in memory only, so it went with the reload.
    await setToken("test-token");
  });

  after(async () => {
    await closeChange(change);
    if (newHead) await closeChange(requestAt(newHead));
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      await config.update(key, undefined, vscode.ConfigurationTarget.Global);
  });

  it("shows the Comments again after a reload", async () => {
    await eventually(async () =>
      assert.deepStrictEqual(await commentThreads(), [
        {
          file: path.join(baseDir, "pkg/legacy.py"),
          lines: [0, 0],
          comments: ["Who used this?"],
          editable: [true],
        },
        {
          file: path.join(headDir, "util.py"),
          lines: [0, 2],
          comments: ["Why a docstring here?"],
          editable: [true],
        },
      ])
    );
  });

  it("keeps the Review going when the Assistant can't write the Brief", async () => {
    await showAssistant(change);
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(title))?.busy, false)
    );
    scriptClaude({
      turns: [
        [
          {
            type: "result",
            subtype: "error_during_execution",
            is_error: true,
            session_id: "",
            result: "an overloaded server",
          },
        ],
      ],
    });

    await writeBrief(change);

    await eventually(async () =>
      assert.strictEqual(
        (await renderedPanel(title))?.problem,
        "Claude Code reported an overloaded server"
      )
    );
    assert.strictEqual((await commentThreads()).length, 2);
    assert.ok(
      !activeTabLabel()?.startsWith("Brief "),
      `no Brief opened: ${activeTabLabel()}`
    );
  });

  it("asks the Assistant for a Brief built from the Comments, with file and line references", async () => {
    scriptClaude({ turns: [replyTurn(brief)] });

    await writeBrief(change);

    const [run, ...others] = assistantRuns();
    assert.deepStrictEqual(others, [], "one run of claude");
    assert.ok(flag(run, "--resume"), "in the Change's own conversation");
    const [prompt] = userMessages(run);
    for (const expected of [
      "util.py:1-3",
      "Why a docstring here?",
      '"""Two."""',
      "pkg/legacy.py:1",
      "Who used this?",
      "LEGACY = True",
      "agent/docs",
      change.head,
    ])
      assert.ok(prompt.includes(expected), `${expected} in ${prompt}`);
  });

  it("opens the Brief as a Markdown document to edit", async () => {
    const editor = vscode.window.activeTextEditor;
    assert.ok(editor, "an editor is active");
    assert.strictEqual(editor.document.languageId, "markdown");
    assert.strictEqual(editor.document.getText(), brief);
    assert.match(activeTabLabel() ?? "", /^Brief /);
    assert.ok(fs.existsSync(editor.document.uri.fsPath), "kept on disk");
  });

  it("keeps only a note about the Brief in the Assistant's panel", async () => {
    await eventually(async () => {
      const panel = await renderedPanel(title);
      assert.strictEqual(panel?.busy, false);
      assert.deepStrictEqual(panel?.messages.at(-1), {
        from: "note",
        text: "Wrote a Brief from your 2 Comments. It is open in the editor.",
      });
      assert.ok(
        !panel?.messages.some((m) => m.text.includes("drop the docstring")),
        "the Brief itself stays out of the panel"
      );
    });
  });

  it("keeps the Review going, with its Comments in the gutter, until the Brief is copied", async () => {
    assert.strictEqual((await commentThreads()).length, 2);
  });

  it("copies the Brief, with the Reviewer's edits, to the clipboard", async () => {
    const editor = vscode.window.activeTextEditor!;
    const end = editor.document.lineAt(editor.document.lineCount - 1).range.end;
    await editor.edit((edit) => edit.insert(end, "3. Run the tests.\n"));
    await vscode.env.clipboard.writeText("");

    await copyBrief();

    assert.strictEqual(
      await vscode.env.clipboard.readText(),
      `${brief}3. Run the tests.\n`
    );
    // Unsaved, it would hold up closing the editors.
    await editor.document.save();
  });

  it("ends the Review: its Comments leave the gutter, and nothing is new since", async () => {
    assert.deepStrictEqual(await commentThreads(), []);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    await showChangesSinceLastReview(change);

    assert.ok(
      !activeTabLabel()?.includes("since my last Review"),
      `no diff since the last Review opened: ${activeTabLabel()}`
    );
  });

  it("writes no Brief without Comments", async () => {
    scriptClaude({ turns: [replyTurn("An empty Brief.")] });

    await writeBrief(change);

    assert.deepStrictEqual(assistantRuns(), []);
  });

  it("marks the branch in the Inbox once the agent adds commits", async () => {
    fs.writeFileSync(path.join(clone, "since.py"), "SINCE = True\n");
    fs.writeFileSync(
      path.join(clone, "util.py"),
      "def new_helper():\n    return 2\n"
    );
    gitIn(clone, "add", "-A");
    gitIn(clone, "commit", "-q", "-m", "drop the docstring");
    newHead = gitIn(clone, "rev-parse", "HEAD");

    await refreshInbox();

    const entry = inboxEntry(await inbox(), "agent/docs");
    assert.strictEqual(
      entry.description,
      "acme/local · 3 commits ahead · new commits since my Review · open"
    );
  });

  it("has the Assistant explain what changed since the Brief", async () => {
    scriptClaude({ turns: [replyTurn("since.py is new.")] });

    await openBranchFromInbox(inboxEntry(await inbox(), "agent/docs"));

    const newTitle = `${repo} ${short(change.base)}..${short(newHead)}`;
    await eventually(async () =>
      assert.deepStrictEqual(await assistantTake(newTitle), {
        label: `Since your Review at ${short(change.head)}`,
        reading: false,
        text: "since.py is new.",
      })
    );
    const [run] = assistantRuns();
    const [prompt] = userMessages(run);
    for (const expected of [change.head, newHead, "since.py"])
      assert.ok(prompt.includes(expected), `${expected} in ${prompt}`);
    assert.ok(
      !prompt.includes("pkg/core.py"),
      `only what changed since the Brief: ${prompt}`
    );
  });

  it("opens a diff of only what changed since the Brief", async () => {
    const head = workspaceFolders().find(
      (f) => f.name === `${repo} head ${short(newHead)}`
    )!.path;
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    await showChangesSinceLastReview(requestAt(newHead));

    await eventually(() => {
      assert.strictEqual(
        activeTabLabel(),
        `${repo} ${short(change.head)}..${short(newHead)} since my last Review (2 files)`
      );
      // VSCodium can still list a closed diff's editors as visible, so this
      // looks for the new diff's own files among them.
      const sides = multiDiffSides().map(({ original, modified }) => [
        original.file ??
          (original.scheme === "dear-reviewer-commit" ? "commit" : "none"),
        original.text,
        modified.file,
      ]);
      for (const expected of [
        ["none", "", path.join(head, "since.py")],
        [
          "commit",
          'def new_helper():\n    """Two."""\n    return 2\n',
          path.join(head, "util.py"),
        ],
      ])
        assert.ok(
          sides.some((s) => JSON.stringify(s) === JSON.stringify(expected)),
          `${JSON.stringify(expected)} in ${JSON.stringify(sides)}`
        );
    });
  });
});
