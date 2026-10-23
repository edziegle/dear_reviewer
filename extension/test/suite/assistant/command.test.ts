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
  scriptClaude,
  scriptClaudeLogin,
  setClaudeCommand,
  setClaudePath,
  showAssistant,
} from "../assistant";
import { buildFixtureRepo } from "../fixtures";
import { overviewTake } from "../timeline";
import { closeChange, eventually, openChange, short } from "../reviewer";

describe("The Reviewer's own command for claude", () => {
  const repo = buildFixtureRepo("command");
  const fixtures = process.env.DEAR_REVIEWER_FIXTURES!;
  const changeOf = (base: string, head: string) => ({
    request: { repository: repo.path, base, head },
    title: `${path.basename(repo.path)} ${short(base)}..${short(head)}`,
  });
  /**
   * A launcher that notes its first argument in `<that argument>.ran`, then
   * starts the fake `claude` with the arguments after it, as a Reviewer's
   * container or sandbox script would.
   */
  const launcher = path.join(fixtures, "launch-claude");
  before(() =>
    fs.writeFileSync(
      launcher,
      `#!/bin/sh\nmarker="$1"\nshift\nprintf '%s\\n' "$*" >> "$marker.ran"\nexec '${fakeClaudePath()}' "$@"\n`,
      { mode: 0o755 }
    )
  );
  // Even after a failing test, the next starts with the default way to run claude.
  afterEach(async () => {
    await setClaudeCommand([]);
    await setClaudePath(fakeClaudePath());
    scriptClaudeLogin();
  });

  it("shows Claude Path as deprecated in favour of Claude Command", () => {
    const properties = vscode.extensions.getExtension("edziegle.dear-reviewer")!
      .packageJSON.contributes.configuration.properties;
    assert.deepStrictEqual(
      properties["dearReviewer.claudeCommand"].default,
      []
    );
    assert.strictEqual(
      properties["dearReviewer.claudeCommand"].scope,
      "machine"
    );
    assert.match(
      properties["dearReviewer.claudeCommand"].markdownDescription,
      /dear_reviewer\/wiki\/custom-claude-command\)/
    );
    assert.match(
      properties["dearReviewer.claudePath"].markdownDeprecationMessage,
      /Claude Command/
    );
  });

  it("still runs the Assistant on a Claude Path alone", async () => {
    const { request, title } = changeOf(
      repo.commits.documented,
      repo.commits.restructured
    );
    await scriptClaude(request, { turns: [replyTurn("From the path.")] });
    try {
      await openChange(request);
      await showAssistant(request);

      await eventually(async () =>
        assert.strictEqual((await overviewTake(title))?.text, "From the path.")
      );
    } finally {
      await closeChange(request);
    }
  });

  it("starts claude through a command with arguments, which go before Dear Reviewer's own", async () => {
    const marker = path.join(fixtures, "summary-marker");
    const { request, title } = changeOf(
      repo.commits.renamed,
      repo.commits.restructured
    );
    await scriptClaude(request, {
      turns: [replyTurn("Through the launcher.")],
    });
    await setClaudeCommand([launcher, marker]);
    try {
      await openChange(request);
      await showAssistant(request);

      await eventually(async () =>
        assert.strictEqual(
          (await overviewTake(title))?.text,
          "Through the launcher."
        )
      );
      const [run] = await assistantRuns(request);
      assert.strictEqual(
        run.args[0],
        "-p",
        "the fake got Dear Reviewer's arguments"
      );
      const ran = fs.readFileSync(`${marker}.ran`, "utf8").split("\n");
      assert.ok(
        ran.some((line) => line.startsWith("-p ")),
        "the launcher started the conversation"
      );
      assert.ok(
        ran.includes("auth status"),
        "the launcher ran the login check"
      );
    } finally {
      await closeChange(request);
    }
  });

  it("checks the login through the command and shows the whole command", async () => {
    const marker = path.join(fixtures, "login-marker");
    scriptClaudeLogin();
    await setClaudeCommand([launcher, marker]);

    await vscode.commands.executeCommand("dearReviewer.checkClaudeLogin");

    await eventually(async () => {
      const [check] = loginChecks();
      assert.deepStrictEqual(check?.args, ["auth", "status"]);
      assert.strictEqual(
        fs.readFileSync(`${marker}.ran`, "utf8"),
        "auth status\n"
      );
      const status = await loginStatus();
      assert.ok(
        status?.tooltip?.includes(JSON.stringify([launcher, marker])),
        status?.tooltip
      );
    });
  });

  it("says the command isn't found when its program is missing", async () => {
    const missing = path.join(fixtures, "nowhere", "claude");
    const { request, title } = changeOf(
      repo.commits.initial,
      repo.commits.documented
    );
    await scriptClaude(request, {});
    await setClaudeCommand([missing, "exec"]);
    try {
      await openChange(request);
      await showAssistant(request);

      await eventually(async () => {
        const panel = await renderedPanel(title);
        assert.ok(
          panel?.problem?.includes(JSON.stringify([missing, "exec"])),
          panel?.problem
        );
        assert.strictEqual(panel?.problemAction, "Set Claude Command");
      });
    } finally {
      await closeChange(request);
    }
  });

  it("says so quietly when the git tools didn't start, and not when they did", async () => {
    const failed = changeOf(repo.commits.renamed, repo.commits.documented);
    const connected = changeOf(repo.commits.initial, repo.commits.restructured);
    const withGit = (status: string) => {
      const [init, ...rest] = replyTurn("A summary.");
      return [{ ...init, mcp_servers: [{ name: "git", status }] }, ...rest];
    };
    await scriptClaude(failed.request, {
      turns: [withGit("failed")],
      readingOrder: withGit("failed"),
    });
    await scriptClaude(connected.request, {
      turns: [withGit("connected")],
      readingOrder: withGit("connected"),
    });
    try {
      await openChange(failed.request);
      await showAssistant(failed.request);
      await eventually(async () => {
        const panel = await renderedPanel(failed.title);
        assert.strictEqual(panel?.gitToolsMissing, true);
        assert.strictEqual(panel?.problem, undefined, "quiet, not a problem");
      });

      await openChange(connected.request);
      await showAssistant(connected.request);
      await eventually(async () =>
        assert.strictEqual(
          (await overviewTake(connected.title))?.text,
          "A summary."
        )
      );
      assert.strictEqual(
        (await renderedPanel(connected.title))?.gitToolsMissing,
        undefined
      );
    } finally {
      await closeChange(failed.request);
      await closeChange(connected.request);
    }
  });
});
