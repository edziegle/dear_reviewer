import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import {
  askAssistant,
  assistantRuns,
  flag,
  mcpCall,
  releaseClaude,
  renderedPanel,
  replyTurn,
  scriptClaude,
  showAssistant,
  waitFor,
} from "../assistant";
import { buildFixtureRepo } from "../fixtures";
import {
  closeChange,
  eventually,
  openChange,
  short,
  type ChangeRequest,
} from "../reviewer";

describe("The Assistant's git history tools", () => {
  const repo = buildFixtureRepo("history");
  const head = repo.commits.restructured;
  // Each test opens a Change of its own, so none resumes another's conversation.
  const opened: ChangeRequest[] = [];
  const changeOf = (base: string) => {
    const request = { repository: repo.path, base, head };
    opened.push(request);
    return {
      request,
      title: `${path.basename(repo.path)} ${short(base)}..${short(head)}`,
    };
  };
  afterEach(async () => {
    for (const request of opened.splice(0)) await closeChange(request);
  });

  it("starts Dear Reviewer's git server for claude on VS Code's own binary, limited to the Change's repository and history", async () => {
    const base = repo.commits.renamed;
    const { request } = changeOf(base);
    scriptClaude(request, {});
    await openChange(request);
    await eventually(() => assert.ok(assistantRuns(request).length > 0));
    const [run] = assistantRuns(request);

    assert.ok(run.args.includes("--strict-mcp-config"));
    const config = JSON.parse(flag(run, "--mcp-config") ?? "{}") as {
      mcpServers: Record<
        string,
        { command: string; args: string[]; env: Record<string, string> }
      >;
    };
    assert.deepStrictEqual(Object.keys(config.mcpServers), ["git"]);
    const server = config.mcpServers.git;
    assert.strictEqual(server.command, process.execPath);
    assert.strictEqual(path.basename(server.args[0]), "gitServer.js");
    assert.ok(fs.existsSync(server.args[0]), "the server is built");
    assert.deepStrictEqual(server.env, {
      ELECTRON_RUN_AS_NODE: "1",
      DEAR_REVIEWER_GIT_REPOSITORY: repo.path,
      DEAR_REVIEWER_GIT_BASE: base,
      DEAR_REVIEWER_GIT_HEAD: head,
    });
    assert.deepStrictEqual(
      flag(run, "--allowedTools")
        ?.split(",")
        .filter((tool) => tool.startsWith("mcp__")),
      ["mcp__git__log", "mcp__git__show", "mcp__git__blame", "mcp__git__diff"]
    );
    assert.strictEqual(flag(run, "--tools"), "Read,Grep,Glob");
    assert.ok(
      (flag(run, "--append-system-prompt") ?? "").includes(
        "Your git tools, log, show, blame and diff"
      )
    );
  });

  it("answers the Assistant's git calls from the Change's history, refuses other commits, and shows each call in the panel", async () => {
    const { request, title } = changeOf(repo.commits.initial);
    const [init, ...rest] = replyTurn("util.py changed in rename helper.");
    scriptClaude(request, {
      turns: [
        replyTurn("A summary."),
        [
          init,
          mcpCall("git", "log", { path: "util.py" }),
          mcpCall("git", "show", { revision: repo.commits.sideline }),
          mcpCall("git", "blame", {
            path: "util.py",
            startLine: 2,
            endLine: 2,
          }),
          waitFor("history-done"),
          ...rest,
        ],
      ],
    });
    await openChange(request);
    await showAssistant(request);
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(title))?.busy, false)
    );

    await askAssistant(title, "When did util.py change?");

    await eventually(async () =>
      assert.deepStrictEqual((await renderedPanel(title))?.steps, [
        { doing: "Reading the history of", subject: "util.py" },
        { doing: "Reading commit", subject: repo.commits.sideline },
        { doing: "Reading who last changed", subject: "util.py:2-2" },
      ])
    );
    const results = () =>
      assistantRuns(request).flatMap((r) => r.mcpResults ?? []);
    await eventually(() => assert.strictEqual(results().length, 3));
    const [log, sideline, blame] = results();

    assert.strictEqual(log.isError, false, log.text);
    assert.match(
      log.text,
      /^Commits of util\.py from git log, newest first\. .*other people's text/
    );
    const subjects = [...log.text.matchAll(/^Date: .*\n\n(.*)$/gm)].map(
      (m) => m[1]
    );
    assert.deepStrictEqual(subjects, [
      "document helper",
      "rename helper",
      "initial",
    ]);

    assert.strictEqual(sideline.isError, true);
    assert.match(sideline.text, /isn't a commit in the Change's history/);

    assert.strictEqual(blame.isError, false, blame.text);
    assert.ok(
      blame.text.includes(`${repo.commits.documented} (Reviewer`),
      blame.text
    );

    releaseClaude("history-done");
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(title))?.busy, false)
    );
  });
});
