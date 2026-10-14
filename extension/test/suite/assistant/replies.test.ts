import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import {
  askAssistant,
  clickReference,
  clickReplyLink,
  releaseClaude,
  renderedPanel,
  renderedPanelWithHtml,
  replyTurn,
  scriptClaude,
  toolUse,
  waitFor,
  showAssistant,
  summaryNote,
} from "../assistant";
import { buildFixtureRepo } from "../fixtures";
import {
  activeTabLabel,
  catchLinks,
  closeChange,
  eventually,
  foldersAddedSince,
  openChange,
  releaseLinks,
  short,
  workspaceFolders,
  type ChangeRequest,
} from "../reviewer";

describe("The Assistant's work and replies in its panel", () => {
  const repo = buildFixtureRepo("replies");
  const changeOf = (base: string, head: string) => {
    const request = { repository: repo.path, base, head };
    opened.push(request);
    return {
      request,
      title: `${path.basename(repo.path)} ${short(base)}..${short(head)}`,
    };
  };
  // Closed after each test, even a failing one, so no panel outlives it.
  const opened: ChangeRequest[] = [];
  afterEach(async () => {
    await releaseLinks();
    for (const request of opened.splice(0)) await closeChange(request);
  });

  it("shows what the Assistant is doing while a turn runs, with paths relative to the worktree", async () => {
    const answer = "new_helper is only called from main.py and added.py.";
    const [init, ...rest] = replyTurn(answer);
    scriptClaude({
      turns: [
        replyTurn("A summary."),
        [
          init,
          ...toolUse("Read", { file_path: "{head}/util.py" }),
          ...toolUse("Grep", { pattern: "new_helper", path: "{head}" }),
          waitFor("steps-two"),
          ...toolUse("Glob", { pattern: "**/*.py", path: "{base}" }),
          ...toolUse("Read", { file_path: "{base}/util.py" }),
          ...toolUse("Read", { file_path: "/etc/hosts" }),
          waitFor("steps-done"),
          ...rest,
        ],
      ],
    });
    const { request, title } = changeOf(
      repo.commits.initial,
      repo.commits.renamed
    );
    await openChange(request);
    await showAssistant(request);
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(title))?.busy, false)
    );
    assert.strictEqual((await renderedPanel(title))?.steps, undefined);

    await askAssistant(title, "Who calls new_helper?");

    await eventually(async () => {
      const panel = await renderedPanel(title);
      assert.strictEqual(panel?.busy, true);
      assert.deepStrictEqual(panel?.steps, [
        { doing: "Reading", subject: "util.py" },
        { doing: "Searching for", subject: "new_helper" },
      ]);
      assert.deepStrictEqual(
        panel?.messages.map((m) => m.from),
        ["note", "reviewer"],
        "no empty reply while the Assistant only uses tools"
      );
    });
    releaseClaude("steps-two");
    await eventually(async () =>
      assert.deepStrictEqual((await renderedPanel(title))?.steps?.slice(2), [
        { doing: "Finding files matching", subject: "**/*.py" },
        { doing: "Reading the base side of", subject: "util.py" },
        { doing: "Reading", subject: "/etc/hosts" },
      ])
    );
    releaseClaude("steps-done");
    await eventually(async () => {
      const panel = await renderedPanel(title);
      assert.strictEqual(panel?.busy, false);
      assert.strictEqual(panel?.steps, undefined);
      assert.deepStrictEqual(panel?.messages.at(-1), {
        from: "assistant",
        text: answer,
      });
    });
  });

  it("renders replies as Markdown, without raw HTML, scripts or remote images, and opens links through the extension", async () => {
    const reply = [
      "## Summary",
      "",
      "**Renames** `old_helper` to `new_helper`; see [the guide](https://docs.example.com/guide).",
      "",
      '<script>alert("reply")</script><img src="https://evil.example.com/x.png" onerror="alert(1)">',
      "![tracker](https://evil.example.com/pixel.png) [sneaky](javascript:alert(2))",
      "",
      "```python",
      "print(new_helper())",
      "```",
    ].join("\n");
    scriptClaude({ turns: [replyTurn("A summary."), replyTurn(reply)] });
    const { request, title } = changeOf(
      repo.commits.initial,
      repo.commits.documented
    );
    await openChange(request);
    await showAssistant(request);
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(title))?.busy, false)
    );
    await askAssistant(title, "What does it do?");
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(title))?.messages.length, 3)
    );
    const message = (await renderedPanelWithHtml(title))!.messages[2];
    assert.strictEqual(message.text, reply, "the reply's text stays as it was");
    const html = message.html ?? "";
    for (const expected of [
      "<h2>Summary</h2>",
      "<strong>Renames</strong>",
      "<code>old_helper</code>",
      '<a data-href="https://docs.example.com/guide">the guide</a>',
      "<pre><code>print(new_helper())\n</code></pre>",
    ])
      assert.ok(html.includes(expected), `${expected} in ${html}`);
    assert.doesNotMatch(html, /<(script|img)\b/i, html);
    assert.doesNotMatch(
      html,
      /\son\w+=|(?<![\w-])(href|src)=|data-href="(?!https:)/i,
      html
    );
    assert.doesNotMatch(html, /alert\("/, "a script's text is dropped with it");

    const opened = await catchLinks();
    try {
      await clickReplyLink(title, "https://docs.example.com/guide");
      await clickReplyLink(title, "https://evil.example.com/");
      await clickReplyLink(title, "javascript:alert(2)");
      await clickReplyLink(title, "command:workbench.action.terminal.new");

      assert.deepStrictEqual(opened, ["https://docs.example.com/guide"]);
    } finally {
      await releaseLinks();
    }
  });

  it("opens path:line and path:start-end references at that range in the Change's worktrees, and nowhere else", async () => {
    const reply =
      "See `util.py:1-2`, main.py:3 and pkg/core.py:1, not 10:30 or ../outside.py:1.";
    scriptClaude({ turns: [replyTurn("A summary."), replyTurn(reply)] });
    const { request, title } = changeOf(
      repo.commits.initial,
      repo.commits.restructured
    );
    const before = workspaceFolders();
    await openChange(request);
    await showAssistant(request);
    const [base, head] = foldersAddedSince(before);
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(title))?.busy, false)
    );
    await askAssistant(title, "Where should I look?");
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(title))?.messages.length, 3)
    );
    const html = (await renderedPanelWithHtml(title))!.messages[2].html ?? "";
    for (const expected of [
      '<a data-path="util.py" data-start="1" data-end="2"><code>util.py:1-2</code></a>',
      '<a data-path="main.py" data-start="3" data-end="3">main.py:3</a>',
      '<a data-path="pkg/core.py" data-start="1" data-end="1">pkg/core.py:1</a>',
    ])
      assert.ok(html.includes(expected), `${expected} in ${html}`);
    assert.ok(!html.includes('data-path="10"'), html);
    // The Reviewer clicks once the diff is showing, so it can't take the editor back.
    await eventually(() =>
      assert.ok(activeTabLabel()?.includes(short(repo.commits.restructured)))
    );
    // The lines selected in the text editor tab that shows the file, not in
    // the multi-file diff, whose editors show the file too.
    const shown = (file: string) => {
      const tab = vscode.window.tabGroups.all
        .map((group) => group.activeTab)
        .find(
          (tab) =>
            tab?.input instanceof vscode.TabInputText &&
            tab.input.uri.fsPath === file
        );
      const editor =
        tab &&
        vscode.window.visibleTextEditors.find(
          (e) =>
            e.document.uri.fsPath === file &&
            e.viewColumn === tab.group.viewColumn
        );
      return (
        editor && {
          start: editor.selection.start.line,
          end: editor.selection.end.line,
        }
      );
    };
    const tabsOf = (files: string[]) =>
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .filter(
          (tab) =>
            tab.input instanceof vscode.TabInputText &&
            files.includes(tab.input.uri.fsPath)
        );

    await clickReference(title, { path: "util.py", startLine: 1, endLine: 2 });

    await eventually(() =>
      assert.deepStrictEqual(shown(path.join(head.path, "util.py")), {
        start: 0,
        end: 1,
      })
    );

    await clickReference(title, {
      path: path.join(base.path, "main.py"),
      startLine: 3,
      endLine: 3,
    });

    await eventually(() =>
      assert.deepStrictEqual(shown(path.join(base.path, "main.py")), {
        start: 2,
        end: 2,
      })
    );

    const outside = [
      path.resolve(head.path, "../../outside.py"),
      path.join(repo.path, "util.py"),
      "/etc/hosts",
      path.join(head.path, "does-not-exist.py"),
    ];
    for (const file of [
      "../../outside.py",
      path.join(repo.path, "util.py"),
      path.relative(head.path, path.join(repo.path, "util.py")),
      "/etc/hosts",
      "does-not-exist.py",
    ])
      await clickReference(title, { path: file, startLine: 1, endLine: 1 });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.deepStrictEqual(
      tabsOf(outside).map((tab) => tab.label),
      [],
      "nothing outside the worktrees opened"
    );
    assert.deepStrictEqual(shown(path.join(base.path, "main.py")), {
      start: 2,
      end: 2,
    });
  });
});
