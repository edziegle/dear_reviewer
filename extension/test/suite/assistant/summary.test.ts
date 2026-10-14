import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
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
} from "../assistant";
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

  it("shows the Assistant's summary in a panel beside the diff, not inline in it", async () => {
    const summary =
      "Renames old_helper to new_helper and deletes obsolete.py. Risk: anything outside this repository that imports old_helper breaks.";
    scriptClaude({ turns: [replyTurn(summary)] });
    const { request, title } = changeOf(
      repo.commits.initial,
      repo.commits.renamed
    );
    const before = workspaceFolders();

    await openChange(request);

    const [base, head] = foldersAddedSince(before);
    await eventually(async () =>
      assert.deepStrictEqual(await renderedPanel(title), {
        title,
        login: "Claude subscription (Max)",
        busy: false,
        messages: [{ from: "assistant", text: summary }],
      })
    );
    assert.ok(
      activeTabLabel()?.includes(title.split(" ").pop()!),
      `the diff stays the active editor, not "${activeTabLabel()}"`
    );
    assert.deepStrictEqual(webviewTabs(), [`Assistant: ${title}`]);

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
    ]) {
      assert.ok(prompt.includes(expected), `the prompt mentions ${expected}`);
    }

    await closeChange(request);

    await eventually(() => assert.deepStrictEqual(webviewTabs(), []));
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
    Object.assign(process.env, credentials, {
      DEAR_REVIEWER_UNRELATED: "kept",
    });
    scriptClaude({});
    const { request, title } = changeOf(
      repo.commits.initial,
      repo.commits.restructured
    );
    try {
      await openChange(request);

      await eventually(async () =>
        assert.strictEqual((await renderedPanel(title))?.messages.length, 1)
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
        assert.strictEqual(call.env.DEAR_REVIEWER_UNRELATED, "kept");
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
      for (const key of [
        ...Object.keys(credentials),
        "DEAR_REVIEWER_UNRELATED",
      ])
        delete process.env[key];
      await closeChange(request);
    }
  });
});
