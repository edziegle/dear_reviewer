import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  assistantRuns,
  callsToClaude,
  fakeClaudePath,
  loginStatus,
  renderedPanel,
  scriptClaude,
  setClaudePath,
} from "../assistant";
import { buildFixtureRepo } from "../fixtures";
import { closeChange, eventually, openChange, short } from "../reviewer";

describe("Setting up the Assistant", () => {
  const repo = buildFixtureRepo("setup");
  const changeOf = (base: string, head: string) => ({
    request: { repository: repo.path, base, head },
    title: `${path.basename(repo.path)} ${short(base)}..${short(head)}`,
  });

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
    scriptClaude({});
    await setClaudePath(missing);
    const { request, title } = changeOf(
      repo.commits.renamed,
      repo.commits.documented
    );
    try {
      await openChange(request);

      await eventually(async () => {
        const panel = await renderedPanel(title);
        assert.ok(panel?.problem, "the panel shows a problem");
        assert.ok(panel.problem.includes(missing), panel.problem);
        assert.match(panel.problem, /Claude Path/);
        assert.strictEqual(panel.problemAction, "Set Claude Path");
        assert.strictEqual(panel.busy, false);
        assert.deepStrictEqual(panel.messages, []);
      });
      assert.match((await loginStatus())?.text ?? "", /Claude: not found/);
      assert.deepStrictEqual(callsToClaude(), []);
    } finally {
      await setClaudePath(fakeClaudePath());
      await closeChange(request);
    }
  });

  it("says clearly when claude isn't signed in, and leaves signing in to Claude Code", async () => {
    scriptClaude({
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

    await openChange(request);

    await eventually(async () => {
      const panel = await renderedPanel(title);
      assert.match(panel?.problem ?? "", /isn't signed in/);
      assert.match(panel?.problem ?? "", /run `claude` in a terminal/i);
      assert.strictEqual(panel?.problemAction, "Open a Terminal");
      assert.strictEqual(panel?.busy, false);
    });
    assert.match((await loginStatus())?.text ?? "", /Claude: not signed in/);
    assert.deepStrictEqual(assistantRuns(), [], "the Assistant didn't start");

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
          // Shows when VS Code has read the file.
          "dearReviewer.repositories": ["acme/planted"],
        },
      })
    );
    scriptClaude({});
    const { request, title } = changeOf(
      repo.commits.documented,
      repo.commits.restructured
    );
    try {
      await eventually(() =>
        assert.deepStrictEqual(config().get("repositories"), ["acme/planted"])
      );

      await openChange(request);

      await eventually(async () =>
        assert.strictEqual((await renderedPanel(title))?.messages.length, 1)
      );
      assert.ok(!fs.existsSync(marker), "the workspace's claude never ran");
      assert.ok(assistantRuns().length > 0, "the Reviewer's claude ran");
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
