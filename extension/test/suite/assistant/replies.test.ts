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
} from "../reviewer";

describe("The Assistant's work and replies in its panel", () => {
  const repo = buildFixtureRepo("replies");
  const changeOf = (base: string, head: string) => ({
    request: { repository: repo.path, base, head },
    title: `${path.basename(repo.path)} ${short(base)}..${short(head)}`,
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
        ["assistant", "reviewer"],
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

    await closeChange(request);
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
    scriptClaude({ turns: [replyTurn(reply)] });
    const { request, title } = changeOf(
      repo.commits.initial,
      repo.commits.documented
    );
    await openChange(request);
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(title))?.busy, false)
    );
    const [message] = (await renderedPanelWithHtml(title))!.messages;
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
      await closeChange(request);
    }
  });

  it("opens path:line and path:start-end references at that range in the Change's worktrees, and nowhere else", async () => {
    const reply =
      "See `util.py:1-2`, main.py:3 and pkg/core.py:1, not 10:30 or ../outside.py:1.";
    scriptClaude({ turns: [replyTurn(reply)] });
    const { request, title } = changeOf(
      repo.commits.initial,
      repo.commits.restructured
    );
    const before = workspaceFolders();
    await openChange(request);
    const [base, head] = foldersAddedSince(before);
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(title))?.busy, false)
    );
    const html = (await renderedPanelWithHtml(title))!.messages[0].html ?? "";
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
    const editor = () => {
      const active = vscode.window.activeTextEditor;
      return (
        active && {
          file: active.document.uri.fsPath,
          start: active.selection.start.line,
          end: active.selection.end.line,
        }
      );
    };

    await clickReference(title, { path: "util.py", startLine: 1, endLine: 2 });

    await eventually(() =>
      assert.deepStrictEqual(editor(), {
        file: path.join(head.path, "util.py"),
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
      assert.deepStrictEqual(editor(), {
        file: path.join(base.path, "main.py"),
        start: 2,
        end: 2,
      })
    );

    for (const outside of [
      "../../outside.py",
      path.join(repo.path, "util.py"),
      path.relative(head.path, path.join(repo.path, "util.py")),
      "/etc/hosts",
      "does-not-exist.py",
    ])
      await clickReference(title, { path: outside, startLine: 1, endLine: 1 });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.strictEqual(
      editor()?.file,
      path.join(base.path, "main.py"),
      "nothing outside the worktrees opened"
    );

    await closeChange(request);
  });
});
