import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  assistantRuns,
  fakeClaudePath,
  loginChecks,
  loginStatus,
  renderedPanel,
  replyTurn,
  retryAssistant,
  scriptClaude,
  scriptClaudeLogin,
  setClaudePath,
  showAssistant,
  summaryNote,
} from "../assistant";
import { overviewTake } from "../timeline";
import { buildFixtureRepo } from "../fixtures";
import { closeChange, eventually, openChange, short } from "../reviewer";

describe("Setting up the Assistant", () => {
  const repo = buildFixtureRepo("setup");
  const changeOf = (base: string, head: string) => ({
    request: { repository: repo.path, base, head },
    title: `${path.basename(repo.path)} ${short(base)}..${short(head)}`,
  });
  // Even after a failing test, the next starts signed in.
  afterEach(() => scriptClaudeLogin());

  it("finds claude on its own unless the Reviewer gives a path", () => {
    const setting = vscode.workspace
      .getConfiguration("dearReviewer")
      .inspect("claudePath");
    assert.strictEqual(setting?.defaultValue, "");
  });

  it("says clearly when claude isn't at the configured path", async () => {
    const missing = path.join(
      process.env.DEAR_REVIEWER_FIXTURES!,
      "nowhere",
      "claude"
    );
    const { request, title } = changeOf(
      repo.commits.renamed,
      repo.commits.documented
    );
    scriptClaudeLogin();
    await scriptClaude(request, {});
    await setClaudePath(missing);
    try {
      await openChange(request);
      await showAssistant(request);

      await eventually(async () => {
        const panel = await renderedPanel(title);
        assert.ok(panel?.problem, "the panel shows a problem");
        assert.ok(panel.problem.includes(missing), panel.problem);
        assert.match(panel.problem, /Claude Command/);
        assert.strictEqual(panel.problemAction, "Set Claude Command");
        assert.strictEqual(panel.busy, false);
        assert.deepStrictEqual(panel.messages, []);
      });
      const status = await loginStatus();
      assert.strictEqual(
        status?.text,
        "$(dear-reviewer-logo) Assistant: Claude not found"
      );
      assert.strictEqual(status.warning, true);
      assert.match(status.tooltip ?? "", /^\**Dear Reviewer Assistant\**/);
      assert.ok(status.tooltip?.includes(missing), "the tooltip has the error");
      assert.deepStrictEqual(loginChecks(), []);
      assert.deepStrictEqual(await assistantRuns(request), []);
      // The overview opens on its own, maybe after the Assistant's panel.
      await eventually(async () => {
        const take = await overviewTake(title);
        assert.ok(take?.problem?.includes(missing), "the overview says so too");
        assert.strictEqual(take?.problemAction, "Set Claude Command");
        assert.strictEqual(take?.reading, false);
      });
    } finally {
      await setClaudePath(fakeClaudePath());
      await closeChange(request);
    }
  });

  it("says clearly when claude isn't signed in, and leaves signing in to Claude Code", async () => {
    scriptClaudeLogin({
      authStatus: {
        loggedIn: false,
        authMethod: "none",
        apiProvider: "firstParty",
      },
    });
    const { request, title } = changeOf(
      repo.commits.renamed,
      repo.commits.restructured
    );
    await scriptClaude(request, {});
    try {
      await openChange(request);

      await showAssistant(request);

      await eventually(async () => {
        const panel = await renderedPanel(title);
        assert.match(panel?.problem ?? "", /isn't signed in/);
        assert.match(panel?.problem ?? "", /run `claude` in a terminal/i);
        assert.strictEqual(panel?.problemAction, "Open a Terminal");
        assert.strictEqual(panel?.busy, false);
      });
      const status = await loginStatus();
      assert.strictEqual(
        status?.text,
        "$(dear-reviewer-logo) Assistant: not signed in"
      );
      assert.strictEqual(status.warning, true);
      assert.deepStrictEqual(
        await assistantRuns(request),
        [],
        "the Assistant didn't start"
      );
    } finally {
      await closeChange(request);
    }
  });

  it("starts the Assistant on Retry once Claude Code is signed in", async () => {
    scriptClaudeLogin({
      authStatus: {
        loggedIn: false,
        authMethod: "none",
        apiProvider: "firstParty",
      },
    });
    const { request, title } = changeOf(
      repo.commits.initial,
      repo.commits.restructured
    );
    await scriptClaude(request, { turns: [replyTurn("A summary.")] });
    await openChange(request);
    await showAssistant(request);
    await eventually(async () => {
      const panel = await renderedPanel(title);
      assert.match(panel?.problem ?? "", /then choose Retry/);
      assert.strictEqual(panel?.unavailable, true, "Send is off");
      assert.strictEqual((await overviewTake(title))?.canRetry, true);
    });

    scriptClaudeLogin();
    await retryAssistant(title);

    await eventually(async () => {
      const panel = await renderedPanel(title);
      assert.strictEqual(panel?.problem, undefined);
      assert.strictEqual(panel?.unavailable, undefined);
      const take = await overviewTake(title);
      assert.strictEqual(take?.problem, undefined);
      assert.strictEqual(take?.text, "A summary.");
    });
    assert.strictEqual(
      (await assistantRuns(request)).length,
      1,
      "the Assistant started"
    );

    await closeChange(request);
  });

  it("ignores a claude path set in the workspace's settings", async () => {
    const marker = path.join(
      process.env.DEAR_REVIEWER_FIXTURES!,
      "ran-workspace-claude"
    );
    const planted = path.join(
      process.env.DEAR_REVIEWER_FIXTURES!,
      "workspace-claude"
    );
    fs.writeFileSync(planted, `#!/bin/sh\ntouch '${marker}'\n`, {
      mode: 0o755,
    });
    // In a multi-root window, workspace settings live in the workspace file.
    const workspaceFile = vscode.workspace.workspaceFile!.fsPath;
    const original = fs.readFileSync(workspaceFile, "utf8");
    const config = () => vscode.workspace.getConfiguration("dearReviewer");
    const repositories = config().get("repositories");
    fs.writeFileSync(
      workspaceFile,
      JSON.stringify({
        ...JSON.parse(original),
        settings: {
          "dearReviewer.claudePath": planted,
          "dearReviewer.claudeCommand": [planted],
          // Shows when VS Code has read the file.
          "dearReviewer.repositories": ["acme/planted"],
        },
      })
    );
    const { request, title } = changeOf(
      repo.commits.documented,
      repo.commits.restructured
    );
    await scriptClaude(request, {});
    try {
      await eventually(() =>
        assert.deepStrictEqual(config().get("repositories"), ["acme/planted"])
      );

      await openChange(request);

      await showAssistant(request);

      await eventually(async () =>
        assert.strictEqual((await renderedPanel(title))?.messages.length, 1)
      );
      assert.ok(!fs.existsSync(marker), "the workspace's claude never ran");
      await eventually(async () =>
        assert.ok(
          (await assistantRuns(request)).length > 0,
          "the Reviewer's claude ran"
        )
      );
    } finally {
      await closeChange(request);
      const workspace = JSON.parse(fs.readFileSync(workspaceFile, "utf8"));
      delete workspace.settings;
      fs.writeFileSync(workspaceFile, JSON.stringify(workspace));
      await eventually(() =>
        assert.deepStrictEqual(config().get("repositories"), repositories)
      );
    }
  });
});
