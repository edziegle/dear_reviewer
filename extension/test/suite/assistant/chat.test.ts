import * as assert from "assert";
import * as path from "path";
import {
  askAssistant,
  assistantRuns,
  flag,
  forgetClaudeSessions,
  releaseClaude,
  removeSelection,
  renderedPanel,
  replyTurn,
  scriptClaude,
  sendSelection,
  userMessages,
  waitFor,
  webviewTabs,
} from "../assistant";
import { buildFixtureRepo } from "../fixtures";
import {
  closeChange,
  eventually,
  foldersAddedSince,
  openChange,
  short,
  workspaceFolders,
} from "../reviewer";

describe("Chatting with the Assistant about a Change", () => {
  const repo = buildFixtureRepo("chat");
  const changeOf = (base: string, head: string) => ({
    request: { repository: repo.path, base, head },
    title: `${path.basename(repo.path)} ${short(base)}..${short(head)}`,
  });
  const assistantTabs = () =>
    webviewTabs().filter((label) => label.startsWith("Assistant:"));

  it("sends the Reviewer's turns to the Assistant and streams its replies", async () => {
    const answer = "util.py defines new_helper, which returns 2.";
    scriptClaude({
      turns: [
        replyTurn("A summary."),
        [
          ...replyTurn(answer).slice(0, 2),
          waitFor("chat-streaming"),
          ...replyTurn(answer).slice(2),
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

    await askAssistant(title, "What does util.py do?");

    await eventually(async () => {
      const panel = await renderedPanel(title);
      assert.strictEqual(panel?.busy, true);
      assert.deepStrictEqual(panel?.messages.slice(1), [
        { from: "reviewer", text: "What does util.py do?" },
        { from: "assistant", text: answer.slice(0, answer.length / 2) },
      ]);
    });
    releaseClaude("chat-streaming");
    await eventually(async () => {
      const panel = await renderedPanel(title);
      assert.strictEqual(panel?.busy, false);
      assert.deepStrictEqual(panel?.messages, [
        { from: "assistant", text: "A summary." },
        { from: "reviewer", text: "What does util.py do?" },
        { from: "assistant", text: answer },
      ]);
    });
    const runs = assistantRuns();
    assert.strictEqual(runs.length, 1, "both turns went to one claude");
    assert.strictEqual(userMessages(runs[0])[1], "What does util.py do?");

    await closeChange(request);
  });

  it("sends the selected lines of either side of the diff into the chat as context", async () => {
    scriptClaude({ turns: [replyTurn("A summary."), replyTurn("Because.")] });
    const { request, title } = changeOf(
      repo.commits.initial,
      repo.commits.documented
    );
    const before = workspaceFolders();
    await openChange(request);
    const [base, head] = foldersAddedSince(before);
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(title))?.busy, false)
    );

    await sendSelection(path.join(base.path, "util.py"), 0, 1);
    await sendSelection(path.join(head.path, "main.py"), 0, 2);
    await sendSelection(path.join(head.path, "util.py"), 1, 1);
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(title))?.context?.length, 3)
    );
    await removeSelection(title, 1);

    await eventually(async () =>
      assert.deepStrictEqual((await renderedPanel(title))?.context, [
        {
          path: "util.py",
          side: "base",
          startLine: 1,
          endLine: 2,
          text: "def old_helper():\n    return 1",
        },
        {
          path: "util.py",
          side: "head",
          startLine: 2,
          endLine: 2,
          text: '    """Two."""',
        },
      ])
    );

    await askAssistant(title, "Why the docstring?");

    await eventually(async () => {
      const panel = await renderedPanel(title);
      assert.strictEqual(panel?.busy, false);
      assert.deepStrictEqual(panel?.context ?? [], []);
      assert.deepStrictEqual(panel?.messages.slice(1), [
        {
          from: "reviewer",
          text: "Why the docstring?",
          context: [
            { path: "util.py", side: "base", startLine: 1, endLine: 2 },
            { path: "util.py", side: "head", startLine: 2, endLine: 2 },
          ],
        },
        { from: "assistant", text: "Because." },
      ]);
    });
    const prompt = userMessages(assistantRuns()[0])[1];
    for (const expected of [
      "lines 1–2 of util.py on the base side",
      path.join(base.path, "util.py"),
      "def old_helper():\n    return 1",
      "line 2 of util.py on the head side",
      path.join(head.path, "util.py"),
      '    """Two."""',
      "Why the docstring?",
    ])
      assert.ok(
        prompt.includes(expected),
        `the prompt has ${expected}:\n${prompt}`
      );

    await closeChange(request);
  });

  it("gives each Change its own conversation", async () => {
    scriptClaude({
      turns: [
        replyTurn("A summary."),
        replyTurn("A summary."),
        replyTurn("An answer."),
      ],
    });
    const first = changeOf(repo.commits.renamed, repo.commits.documented);
    const second = changeOf(repo.commits.renamed, repo.commits.restructured);
    try {
      await openChange(first.request);
      await openChange(second.request);
      for (const { title } of [first, second])
        await eventually(async () =>
          assert.strictEqual((await renderedPanel(title))?.busy, false)
        );

      await askAssistant(second.title, "Only for the second?");

      await eventually(async () => {
        const panel = await renderedPanel(second.title);
        assert.strictEqual(panel?.busy, false);
        assert.deepStrictEqual(
          panel?.messages.map((m) => m.text),
          ["A summary.", "Only for the second?", "An answer."]
        );
      });
      assert.deepStrictEqual(
        (await renderedPanel(first.title))?.messages.map((m) => m.text),
        ["A summary."]
      );
    } finally {
      await closeChange(first.request);
      await closeChange(second.request);
    }
    const runs = assistantRuns();
    assert.strictEqual(runs.length, 2);
    assert.notStrictEqual(runs[0].sessionId, runs[1].sessionId);
    assert.notStrictEqual(runs[0].cwd, runs[1].cwd);
    const asked = runs.filter((run) =>
      userMessages(run).includes("Only for the second?")
    );
    assert.strictEqual(asked.length, 1);
  });

  it("keeps a branch's conversation when the branch gets new commits", async () => {
    repo.git("branch", "-f", "chat-feature", repo.commits.renamed);
    scriptClaude({
      turns: [replyTurn("A summary."), replyTurn("First answer.")],
    });
    const request = {
      repository: repo.path,
      base: repo.commits.initial,
      head: "refs/heads/chat-feature",
    };
    const before = workspaceFolders();
    await openChange(request);
    const [oldBase, oldHead] = foldersAddedSince(before);
    const oldTitle = changeOf(repo.commits.initial, repo.commits.renamed).title;
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(oldTitle))?.busy, false)
    );
    await askAssistant(oldTitle, "First question?");
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(oldTitle))?.messages.length, 3)
    );
    const [firstRun] = assistantRuns();
    await closeChange(request);

    repo.git("branch", "-f", "chat-feature", repo.commits.documented);
    scriptClaude({ turns: [replyTurn("Second answer.")] });
    await openChange(request);
    const newTitle = changeOf(
      repo.commits.initial,
      repo.commits.documented
    ).title;
    const note = `New commits: the Change is now at ${short(repo.commits.documented)}, after ${short(repo.commits.renamed)}.`;
    await eventually(async () =>
      assert.deepStrictEqual(await renderedPanel(newTitle), {
        title: newTitle,
        login: "Claude subscription (Max)",
        busy: false,
        messages: [
          { from: "assistant", text: "A summary." },
          { from: "reviewer", text: "First question?" },
          { from: "assistant", text: "First answer." },
          { from: "note", text: note },
        ],
      })
    );
    assert.deepStrictEqual(assistantRuns(), [], "no new summary");

    await askAssistant(newTitle, "Second question?");

    await eventually(async () =>
      assert.strictEqual(
        (await renderedPanel(newTitle))?.messages.at(-1)?.text,
        "Second answer."
      )
    );
    const [run] = assistantRuns();
    assert.strictEqual(flag(run, "--resume"), firstRun.sessionId);
    assert.strictEqual(run.cwd, firstRun.cwd);
    assert.ok(
      run.resumed?.includes("First question?"),
      `the resumed session has the earlier turns: ${run.resumed}`
    );
    const prompt = userMessages(run)[0];
    assert.ok(prompt.includes(repo.commits.documented), prompt);
    assert.ok(prompt.endsWith("Second question?"), prompt);
    assert.ok(
      !run.args.includes(oldHead.path) && !run.args.includes(oldBase.path),
      "the old worktrees are gone"
    );

    await closeChange(request);
  });

  it("keeps a pull request's conversation at its new head, even while the old head is open", async () => {
    scriptClaude({
      turns: [
        replyTurn("A summary."),
        replyTurn("First answer."),
        replyTurn("Second answer."),
      ],
    });
    const pullRequest = { repository: "acme/chat", number: 5 };
    const older = changeOf(repo.commits.initial, repo.commits.renamed);
    const newer = changeOf(repo.commits.initial, repo.commits.documented);
    const olderRequest = { ...older.request, pullRequest };
    const newerRequest = { ...newer.request, pullRequest };
    await openChange(olderRequest);
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(older.title))?.busy, false)
    );
    await askAssistant(older.title, "First question?");
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(older.title))?.messages.length, 3)
    );

    await openChange(newerRequest);

    await eventually(async () =>
      assert.deepStrictEqual(
        (await renderedPanel(newer.title))?.messages.map((m) => m.from),
        ["assistant", "reviewer", "assistant", "note"]
      )
    );
    assert.deepStrictEqual(assistantTabs(), [`Assistant: ${newer.title}`]);
    await askAssistant(newer.title, "Second question?");
    await eventually(async () =>
      assert.strictEqual(
        (await renderedPanel(newer.title))?.messages.at(-1)?.text,
        "Second answer."
      )
    );
    const runs = assistantRuns();
    assert.strictEqual(runs.length, 2);
    assert.strictEqual(flag(runs[1], "--resume"), runs[0].sessionId);
    assert.ok(runs[1].resumed?.includes("First question?"));

    await closeChange(olderRequest);
    assert.deepStrictEqual(assistantTabs(), [`Assistant: ${newer.title}`]);
    await closeChange(newerRequest);
    await eventually(() => assert.deepStrictEqual(assistantTabs(), []));
  });

  it("starts the conversation again, and says so, when Claude Code can't resume it", async () => {
    scriptClaude({ turns: [replyTurn("A summary.")] });
    const { request, title } = changeOf(
      repo.commits.documented,
      repo.commits.restructured
    );
    await openChange(request);
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(title))?.busy, false)
    );
    await closeChange(request);
    forgetClaudeSessions();
    scriptClaude({ turns: [replyTurn("A fresh answer.")] });
    await openChange(request);
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(title))?.messages.length, 1)
    );

    await askAssistant(title, "Still there?");

    await eventually(async () =>
      assert.deepStrictEqual((await renderedPanel(title))?.messages, [
        { from: "assistant", text: "A summary." },
        { from: "reviewer", text: "Still there?" },
        {
          from: "note",
          text: "Claude Code couldn't resume the earlier conversation, so the Assistant starts again without it.",
        },
        { from: "assistant", text: "A fresh answer." },
      ])
    );
    const runs = assistantRuns();
    assert.strictEqual(runs.length, 2);
    assert.ok(flag(runs[0], "--resume"), "it tried to resume");
    assert.strictEqual(flag(runs[1], "--resume"), undefined);
    assert.deepStrictEqual(userMessages(runs[1]), ["Still there?"]);
    assert.strictEqual((await renderedPanel(title))?.problem, undefined);

    await closeChange(request);
  });
});
