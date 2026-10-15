import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import {
  askAboutFile,
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
  showAssistant,
  stopAssistant,
  summaryNote,
  summaryWritten,
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
    webviewTabs().filter((label) => label.startsWith("Assistant · "));

  it("sends the Reviewer's turns to the Assistant and streams its replies", async () => {
    const answer = "util.py defines new_helper, which returns 2.";
    const { request, title } = changeOf(
      repo.commits.initial,
      repo.commits.renamed
    );
    await scriptClaude(request, {
      turns: [
        replyTurn("A summary."),
        [
          ...replyTurn(answer).slice(0, 2),
          waitFor("chat-streaming"),
          ...replyTurn(answer).slice(2),
        ],
      ],
    });
    await openChange(request);
    await showAssistant(request);
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
        summaryNote,
        { from: "reviewer", text: "What does util.py do?" },
        { from: "assistant", text: answer },
      ]);
    });
    const runs = await assistantRuns(request);
    assert.strictEqual(runs.length, 1, "both turns went to one claude");
    assert.strictEqual(userMessages(runs[0])[1], "What does util.py do?");

    await closeChange(request);
  });

  it("stops a reply when the Reviewer asks, and goes on with the next message", async () => {
    const answer = "util.py defines new_helper, which returns 2.";
    const { request, title } = changeOf(
      repo.commits.initial,
      repo.commits.restructured
    );
    await scriptClaude(request, {
      turns: [
        replyTurn("A summary."),
        [...replyTurn(answer).slice(0, 2), waitFor("chat-never")],
        replyTurn("Picked up."),
      ],
    });
    await openChange(request);
    await showAssistant(request);
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(title))?.busy, false)
    );

    await askAssistant(title, "What does util.py do?");
    await eventually(async () => {
      const panel = await renderedPanel(title);
      assert.strictEqual(panel?.stoppable, true);
      assert.strictEqual(panel?.messages.length, 3);
    });
    await stopAssistant(title);

    await eventually(async () => {
      const panel = await renderedPanel(title);
      assert.strictEqual(panel?.busy, false);
      assert.strictEqual(panel?.stoppable, undefined);
      assert.strictEqual(panel?.problem, undefined);
      assert.deepStrictEqual(panel?.messages, [
        summaryNote,
        { from: "reviewer", text: "What does util.py do?" },
        { from: "assistant", text: answer.slice(0, answer.length / 2) },
        { from: "note", text: "Stopped before the reply was finished." },
      ]);
    });

    await askAssistant(title, "Go on.");
    await eventually(async () =>
      assert.deepStrictEqual((await renderedPanel(title))?.messages.at(-1), {
        from: "assistant",
        text: "Picked up.",
      })
    );
    const runs = await assistantRuns(request);
    assert.strictEqual(runs.length, 2, "the next message started claude again");
    assert.ok(flag(runs[1], "--resume"), "and resumed the conversation");

    await closeChange(request);
  });

  it("sends the selected lines of either side of the diff into the chat as context", async () => {
    const { request, title } = changeOf(
      repo.commits.initial,
      repo.commits.documented
    );
    await scriptClaude(request, {
      turns: [replyTurn("A summary."), replyTurn("Because.")],
    });
    const before = workspaceFolders();
    await openChange(request);
    await showAssistant(request);
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
    const prompt = userMessages((await assistantRuns(request))[0])[1];
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

  it("offers Ask the Assistant on every file of a Change, and binds Ctrl+Alt+R A to it", () => {
    const { menus, keybindings } = vscode.extensions.getExtension(
      "edziegle.dear-reviewer"
    )!.packageJSON.contributes as {
      menus: Record<
        string,
        { command: string; when?: string; group?: string }[]
      >;
      keybindings: { command: string; key: string }[];
    };
    const sendSelection = menus["editor/context"].find(
      (m) => m.command === "dearReviewer.sendSelectionToAssistant"
    );
    assert.deepStrictEqual(
      menus["editor/title"]
        .filter((m) => m.command === "dearReviewer.askAssistant")
        .map((m) => [m.when, m.group]),
      [[sendSelection?.when, "navigation"]]
    );
    assert.deepStrictEqual(
      keybindings.filter((k) => k.key === "ctrl+alt+r a").map((k) => k.command),
      ["dearReviewer.askAssistant"]
    );
  });

  it("asks about the selection, or else the lines on screen, from the file the Reviewer is reading", async () => {
    // A repository of its own, so the conversation is new.
    const asking = buildFixtureRepo("chat-asking");
    const request = {
      repository: asking.path,
      base: asking.commits.renamed,
      head: asking.commits.documented,
    };
    await scriptClaude(request, { turns: [replyTurn("A summary.")] });
    const title = `${path.basename(asking.path)} ${short(request.base)}..${short(request.head)}`;
    const before = workspaceFolders();
    await openChange(request);
    const [base, head] = foldersAddedSince(before);

    await askAboutFile(path.join(head.path, "util.py"), {
      startLine: 1,
      endLine: 1,
    });
    await askAboutFile(path.join(base.path, "util.py"));

    await eventually(async () =>
      assert.deepStrictEqual((await renderedPanel(title))?.context, [
        {
          path: "util.py",
          side: "head",
          startLine: 2,
          endLine: 2,
          text: '    """Two."""',
        },
        {
          path: "util.py",
          side: "base",
          startLine: 1,
          endLine: 3,
          text: "def new_helper():\n    return 2\n",
        },
      ])
    );
    assert.deepStrictEqual(
      assistantTabs(),
      [`Assistant · ${title}`],
      "the Assistant's panel is open"
    );
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(title))?.busy, false)
    );
    assert.strictEqual(
      userMessages((await assistantRuns(request))[0]).length,
      1,
      "nothing went to the Assistant but the summary"
    );

    await closeChange(request);
  });

  it("shows the Change's Assistant when asked from a file that isn't the Change's", async () => {
    // A repository of its own, so the conversation is new.
    const asking = buildFixtureRepo("chat-asking-elsewhere");
    const request = {
      repository: asking.path,
      base: asking.commits.renamed,
      head: asking.commits.documented,
    };
    await scriptClaude(request, { turns: [replyTurn("A summary.")] });
    const title = `${path.basename(asking.path)} ${short(request.base)}..${short(request.head)}`;
    await openChange(request);
    const elsewhere = await vscode.workspace.openTextDocument({
      content: "Not the Change.",
    });

    await askAboutFile(elsewhere.uri, { startLine: 0, endLine: 0 });

    await eventually(async () =>
      assert.deepStrictEqual(assistantTabs(), [`Assistant · ${title}`])
    );
    assert.deepStrictEqual((await renderedPanel(title))?.context ?? [], []);

    await vscode.window.showTextDocument(elsewhere);
    await vscode.commands.executeCommand(
      "workbench.action.revertAndCloseActiveEditor"
    );
    await closeChange(request);
  });

  it("tells the Assistant which file of the Change the Reviewer is reading, and which lines", async () => {
    // A repository of its own, so the conversation is new.
    const reading = buildFixtureRepo("chat-reading");
    const request = {
      repository: reading.path,
      base: reading.commits.renamed,
      head: reading.commits.documented,
    };
    await scriptClaude(request, {
      turns: [
        replyTurn("A summary."),
        replyTurn("It returns 2."),
        replyTurn("Nothing in front of you."),
      ],
    });
    const title = `${path.basename(reading.path)} ${short(request.base)}..${short(request.head)}`;
    const before = workspaceFolders();
    await openChange(request);
    await showAssistant(request);
    const [, head] = foldersAddedSince(before);
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(title))?.busy, false)
    );
    await vscode.window.showTextDocument(
      vscode.Uri.file(path.join(head.path, "util.py")),
      { preview: false }
    );

    await askAssistant(title, "What does line 2 return?");
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(title))?.messages.length, 3)
    );
    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument({ content: "Not the Change." })
    );
    await askAssistant(title, "And now?");
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(title))?.messages.length, 5)
    );

    const [inFile, elsewhere] = userMessages(
      (await assistantRuns(request))[0]
    ).slice(1);
    assert.strictEqual(
      inFile,
      `The Reviewer is reading util.py on the head side (${path.join(head.path, "util.py")}), with lines 1–4 on screen.\n\nWhat does line 2 return?`
    );
    assert.strictEqual(elsewhere, "And now?");

    await vscode.commands.executeCommand(
      "workbench.action.revertAndCloseActiveEditor"
    );
    await closeChange(request);
  });

  it("gives each Change its own conversation", async () => {
    const first = changeOf(repo.commits.renamed, repo.commits.documented);
    const second = changeOf(repo.commits.renamed, repo.commits.restructured);
    await scriptClaude(first.request, {
      turns: [replyTurn("The first summary.")],
    });
    await scriptClaude(second.request, {
      turns: [replyTurn("The second summary."), replyTurn("An answer.")],
    });
    try {
      await openChange(first.request);
      // Opening the second Change closes the first's chat; its conversation goes on.
      await openChange(second.request);
      await showAssistant(second.request);
      await eventually(async () =>
        assert.strictEqual((await renderedPanel(second.title))?.busy, false)
      );

      await askAssistant(second.title, "Only for the second?");

      await eventually(async () => {
        const panel = await renderedPanel(second.title);
        assert.strictEqual(panel?.busy, false);
        assert.deepStrictEqual(
          panel?.messages.map((m) => m.text),
          [summaryNote.text, "Only for the second?", "An answer."]
        );
      });
      assert.strictEqual(
        (await summaryWritten(first.title)).text,
        "The first summary.",
        "each Change's summary is its own"
      );
      await showAssistant(first.request);
      await eventually(async () =>
        assert.deepStrictEqual(
          (await renderedPanel(first.title))?.messages.map((m) => m.text),
          [summaryNote.text]
        )
      );
    } finally {
      await closeChange(first.request);
      await closeChange(second.request);
    }
    const [firstRun, ...moreFirst] = await assistantRuns(first.request);
    const [secondRun, ...moreSecond] = await assistantRuns(second.request);
    assert.deepStrictEqual([moreFirst, moreSecond], [[], []]);
    assert.notStrictEqual(firstRun.sessionId, secondRun.sessionId);
    assert.notStrictEqual(firstRun.cwd, secondRun.cwd);
    assert.deepStrictEqual(userMessages(firstRun).length, 1, "the summary");
    assert.deepStrictEqual(userMessages(secondRun).slice(1), [
      "Only for the second?",
    ]);
  });

  it("keeps a branch's conversation when the branch gets new commits", async () => {
    repo.git("branch", "-f", "chat-feature", repo.commits.renamed);
    const request = {
      repository: repo.path,
      base: repo.commits.initial,
      head: "refs/heads/chat-feature",
    };
    await scriptClaude(request, {
      turns: [replyTurn("A summary."), replyTurn("First answer.")],
    });
    const before = workspaceFolders();
    await openChange(request);
    await showAssistant(request);
    const [oldBase, oldHead] = foldersAddedSince(before);
    const oldTitle = changeOf(repo.commits.initial, repo.commits.renamed).title;
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(oldTitle))?.busy, false)
    );
    await askAssistant(oldTitle, "First question?");
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(oldTitle))?.messages.length, 3)
    );
    const [firstRun] = await assistantRuns(request);
    await closeChange(request);

    repo.git("branch", "-f", "chat-feature", repo.commits.documented);
    await scriptClaude(request, { turns: [replyTurn("Second answer.")] });
    await openChange(request);
    await showAssistant(request);
    const newTitle = changeOf(
      repo.commits.initial,
      repo.commits.documented
    ).title;
    const note = `New commits: the Change is now at ${short(repo.commits.documented)}, after ${short(repo.commits.renamed)}.`;
    await eventually(async () =>
      assert.deepStrictEqual(await renderedPanel(newTitle), {
        name: "chat-feature",
        range: `${short(repo.commits.initial)}..${short(repo.commits.documented)}`,
        login: "Claude subscription (Max)",
        busy: false,
        messages: [
          summaryNote,
          { from: "reviewer", text: "First question?" },
          { from: "assistant", text: "First answer." },
          { from: "note", text: note },
        ],
      })
    );
    assert.deepStrictEqual(await assistantRuns(request), [], "no new summary");
    assert.deepStrictEqual(assistantTabs(), ["Assistant · chat-feature"]);

    await askAssistant(newTitle, "Second question?");

    await eventually(async () =>
      assert.strictEqual(
        (await renderedPanel(newTitle))?.messages.at(-1)?.text,
        "Second answer."
      )
    );
    const [run] = await assistantRuns(request);
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

  it("keeps a pull request's conversation at its new head, which takes the old head's place", async () => {
    const pullRequest = { repository: "acme/chat", number: 5 };
    const older = changeOf(repo.commits.initial, repo.commits.renamed);
    const newer = changeOf(repo.commits.initial, repo.commits.documented);
    const olderRequest = { ...older.request, pullRequest };
    const newerRequest = { ...newer.request, pullRequest };
    // Both heads carry on the pull request's one conversation.
    await scriptClaude(olderRequest, {
      turns: [
        replyTurn("A summary."),
        replyTurn("First answer."),
        replyTurn("Second answer."),
      ],
    });
    await openChange(olderRequest);
    await showAssistant(olderRequest);
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(older.title))?.busy, false)
    );
    await askAssistant(older.title, "First question?");
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(older.title))?.messages.length, 3)
    );

    await openChange(newerRequest);

    await showAssistant(newerRequest);

    await eventually(async () =>
      assert.deepStrictEqual(
        (await renderedPanel(newer.title))?.messages.map((m) => m.from),
        ["note", "reviewer", "assistant", "note"]
      )
    );
    assert.deepStrictEqual(assistantTabs(), ["Assistant · acme/chat #5"]);
    const shown = await renderedPanel(newer.title);
    assert.strictEqual(shown?.name, "acme/chat #5");
    assert.strictEqual(
      shown?.range,
      `${short(repo.commits.initial)}..${short(repo.commits.documented)}`
    );
    await askAssistant(newer.title, "Second question?");
    await eventually(async () =>
      assert.strictEqual(
        (await renderedPanel(newer.title))?.messages.at(-1)?.text,
        "Second answer."
      )
    );
    const runs = await assistantRuns(newerRequest);
    assert.strictEqual(runs.length, 2);
    assert.strictEqual(flag(runs[1], "--resume"), runs[0].sessionId);
    assert.ok(runs[1].resumed?.includes("First question?"));

    assert.ok(
      !workspaceFolders().some((f) =>
        f.name.endsWith(`head ${short(repo.commits.renamed)}`)
      ),
      "the old head's Change closed when the new head opened"
    );
    await closeChange(newerRequest);
    await eventually(() => assert.deepStrictEqual(assistantTabs(), []));
  });

  it("starts the conversation again, and says so, when Claude Code can't resume it", async () => {
    const { request, title } = changeOf(
      repo.commits.documented,
      repo.commits.restructured
    );
    await scriptClaude(request, { turns: [replyTurn("A summary.")] });
    await openChange(request);
    await showAssistant(request);
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(title))?.busy, false)
    );
    await closeChange(request);
    forgetClaudeSessions();
    await scriptClaude(request, { turns: [replyTurn("A fresh answer.")] });
    await openChange(request);
    await showAssistant(request);
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(title))?.messages.length, 1)
    );

    await askAssistant(title, "Still there?");

    await eventually(async () =>
      assert.deepStrictEqual((await renderedPanel(title))?.messages, [
        summaryNote,
        { from: "reviewer", text: "Still there?" },
        {
          from: "note",
          text: "Claude Code couldn't resume the earlier conversation, so the Assistant starts again without it.",
        },
        { from: "assistant", text: "A fresh answer." },
      ])
    );
    const runs = await assistantRuns(request);
    assert.strictEqual(runs.length, 2);
    assert.ok(flag(runs[0], "--resume"), "it tried to resume");
    assert.strictEqual(flag(runs[1], "--resume"), undefined);
    assert.deepStrictEqual(userMessages(runs[1]), ["Still there?"]);
    assert.strictEqual((await renderedPanel(title))?.problem, undefined);

    await closeChange(request);
  });
});
