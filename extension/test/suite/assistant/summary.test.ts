import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  assistantRuns,
  callsToClaude,
  flag,
  loginStatus,
  renderedPanel,
  replyTurn,
  scriptClaude,
  userMessages,
  type RecordedClaudeCall,
  webviewTabs,
  showAssistant,
} from "../assistant";
import {
  clickOverview,
  clickTakeReference,
  overviewTake,
  sentTimeline,
} from "../timeline";
import { buildFixtureRepo } from "../fixtures";
import {
  activeTabLabel,
  closeChange,
  eventually,
  foldersAddedSince,
  openChange,
  short,
  workspaceFolders,
} from "../reviewer";

function addedDirs(run: RecordedClaudeCall): string[] {
  return run.args.flatMap((arg, i) =>
    run.args[i - 1] === "--add-dir" ? [arg] : []
  );
}

describe("The Assistant's summary when a Change opens", () => {
  const repo = buildFixtureRepo("summary");
  const changeOf = (base: string, head: string) => ({
    request: { repository: repo.path, base, head },
    title: `${path.basename(repo.path)} ${short(base)}..${short(head)}`,
  });

  it("shows the Assistant's short summary in the overview, which opens alone, and opens no Assistant panel", async () => {
    const summary =
      "Renames old_helper to new_helper and deletes obsolete.py. Start with util.py:1, where the rename happens, not README.md:1.";
    scriptClaude({ turns: [replyTurn(summary)] });
    const { request, title } = changeOf(
      repo.commits.initial,
      repo.commits.renamed
    );
    const before = workspaceFolders();

    await openChange(request);

    const [base, head] = foldersAddedSince(before);
    await eventually(async () =>
      assert.deepStrictEqual(await overviewTake(title), {
        label: "Assistant",
        reading: false,
        text: summary,
        start: { path: "util.py", startLine: 1, endLine: 1 },
      })
    );
    assert.strictEqual(activeTabLabel(), title, "the overview is in front");
    assert.deepStrictEqual(webviewTabs(), [title]);

    const [run] = assistantRuns();
    // The session lives in a folder of its own, which outlasts the worktrees.
    for (const worktree of [head.path, base.path])
      assert.ok(
        !fs.realpathSync(run.cwd).startsWith(fs.realpathSync(worktree)),
        `claude runs outside the worktree ${worktree}`
      );
    assert.deepStrictEqual(addedDirs(run), [head.path, base.path]);
    assert.ok(run.args.includes("-p"), run.args.join(" "));
    assert.strictEqual(flag(run, "--input-format"), "stream-json");
    assert.strictEqual(flag(run, "--output-format"), "stream-json");
    const [prompt] = userMessages(run);
    for (const expected of [
      "util.py",
      "main.py",
      "obsolete.py",
      "added.py",
      repo.commits.initial,
      repo.commits.renamed,
      "at most three sentences",
      "where to start reading",
    ]) {
      assert.ok(prompt.includes(expected), `the prompt mentions ${expected}`);
    }

    await closeChange(request);

    await eventually(() => assert.deepStrictEqual(webviewTabs(), []));
  });

  it("orients the Reviewer in a local Change's overview: its commits, size and standing, and where to start", async () => {
    scriptClaude({
      turns: [
        replyTurn(
          "Adds a docstring. Start with util.py:2, not elsewhere.py:1."
        ),
      ],
    });
    const { request, title } = changeOf(
      repo.commits.initial,
      repo.commits.documented
    );
    const before = workspaceFolders();
    await openChange(request);
    const [, head] = foldersAddedSince(before);

    await eventually(async () => {
      const overview = await sentTimeline(title);
      assert.strictEqual(overview.take.reading, false);
      assert.strictEqual(overview.loading, false);
      assert.ok(overview.size, "the size is counted");
    });
    const overview = await sentTimeline(title);
    const commits = overview.items.length;
    assert.ok(commits > 0, "the history lists the Change's commits");
    assert.ok(overview.items.every((item) => item.kind === "commit"));
    assert.strictEqual(overview.history, "Commits");
    assert.strictEqual(overview.finish, "Write Brief…");
    assert.strictEqual(
      overview.byline,
      `${path.basename(repo.path)} · ${commits} commit${commits === 1 ? "" : "s"}`
    );
    assert.match(overview.standing.at(-1) ?? "", /^0 of \d+ viewed$/);
    const html = (overview.take as { html?: string }).html ?? "";
    assert.ok(
      html.includes('<a data-path="util.py" data-start="2" data-end="2">'),
      html
    );
    assert.ok(
      !html.includes('data-path="elsewhere.py"'),
      `only the Change's files are references: ${html}`
    );

    await clickTakeReference(title, {
      path: "util.py",
      startLine: 2,
      endLine: 2,
    });
    await eventually(() =>
      assert.strictEqual(
        vscode.window.activeTextEditor?.document.uri.fsPath,
        path.join(head.path, "util.py")
      )
    );

    await clickOverview(title, "nextFile");
    await eventually(() =>
      assert.ok(
        vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof
          vscode.TabInputTextDiff,
        "a file's diff opens"
      )
    );

    await clickOverview(title, "ask");
    await eventually(() =>
      assert.ok(
        webviewTabs().includes(`Assistant · ${title}`),
        `the Assistant opens: ${webviewTabs().join(", ")}`
      )
    );

    await closeChange(request);
  });

  it("shows which Claude login the Assistant runs on, as claude auth status reports it", async () => {
    scriptClaude({
      authStatus: {
        loggedIn: true,
        authMethod: "api_key",
        apiProvider: "firstParty",
      },
    });
    const { request, title } = changeOf(
      repo.commits.initial,
      repo.commits.documented
    );

    await openChange(request);
    await showAssistant(request);

    await eventually(async () => {
      const panel = await renderedPanel(title);
      assert.strictEqual(panel?.login, "API key, billed per token");
      assert.strictEqual(panel?.busy, false);
    });
    const status = await loginStatus();
    assert.match(status?.text ?? "", /Claude: API key, billed per token/);
    assert.ok(
      callsToClaude().some((c) => c.args.join(" ") === "auth status"),
      "asked claude auth status"
    );

    await closeChange(request);
  });

  it("runs claude without credential variables, with only read-only tools, in a mode that never prompts", async () => {
    const credentials = {
      ANTHROPIC_API_KEY: "sk-ant-test",
      ANTHROPIC_AUTH_TOKEN: "bearer-test",
      CLAUDE_CODE_OAUTH_TOKEN: "oauth-test",
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CODE_USE_VERTEX: "1",
      CLAUDE_CODE_USE_FOUNDRY: "1",
    };
    Object.assign(process.env, credentials);
    scriptClaude({});
    const { request, title } = changeOf(
      repo.commits.initial,
      repo.commits.restructured
    );
    try {
      await openChange(request);

      await eventually(async () =>
        assert.strictEqual((await overviewTake(title))?.reading, false)
      );
      const calls = callsToClaude();
      assert.ok(calls.length >= 2, "auth status and the Assistant both ran");
      for (const call of calls) {
        assert.deepStrictEqual(
          Object.keys(call.env).filter(
            (key) =>
              key in credentials ||
              key.startsWith("CLAUDE_CODE_USE_") ||
              key.startsWith("ANTHROPIC_")
          ),
          [],
          `claude ${call.args.join(" ")} got no credential variables`
        );
      }
      const [run] = assistantRuns();
      assert.strictEqual(flag(run, "--tools"), "Read,Grep,Glob");
      assert.strictEqual(flag(run, "--allowedTools"), "Read,Grep,Glob");
      assert.strictEqual(flag(run, "--permission-mode"), "dontAsk");
      assert.deepStrictEqual(
        run.args.filter((arg) =>
          /dangerously|bypassPermissions|Bash|Edit|Write|NotebookEdit|WebFetch/.test(
            arg
          )
        ),
        []
      );
    } finally {
      for (const key of Object.keys(credentials)) delete process.env[key];
      await closeChange(request);
    }
  });

  it("gives claude only the variables it needs to find itself, its login and the network", async () => {
    const variables = {
      ANTHROPIC_BASE_URL: "https://elsewhere.example",
      DEAR_REVIEWER_UNRELATED: "dropped",
      HTTPS_PROXY: "http://proxy.example:3128",
      no_proxy: "localhost",
    };
    Object.assign(process.env, variables);
    scriptClaude({});
    const { request, title } = changeOf(
      repo.commits.renamed,
      repo.commits.restructured
    );
    try {
      await openChange(request);

      await eventually(async () =>
        assert.strictEqual((await overviewTake(title))?.reading, false)
      );
      const calls = callsToClaude();
      assert.ok(calls.length >= 2, "auth status and the Assistant both ran");
      for (const call of calls) {
        const what = `claude ${call.args.join(" ")}`;
        assert.strictEqual(call.env.ANTHROPIC_BASE_URL, undefined, what);
        assert.strictEqual(call.env.DEAR_REVIEWER_UNRELATED, undefined, what);
        assert.strictEqual(call.env.HTTPS_PROXY, variables.HTTPS_PROXY, what);
        assert.strictEqual(call.env.no_proxy, variables.no_proxy, what);
        assert.strictEqual(call.env.HOME, process.env.HOME, what);
      }
    } finally {
      for (const key of Object.keys(variables)) delete process.env[key];
      await closeChange(request);
    }
  });
});
