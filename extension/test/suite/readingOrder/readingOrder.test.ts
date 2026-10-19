import * as assert from "assert";
import * as path from "path";
import {
  assistantRuns,
  renderedPanel,
  replyTurn,
  scriptClaude,
  showAssistant,
  summaryNote,
  readingOrderRequests,
  releaseClaude,
  userMessages,
  waitFor,
} from "../assistant";
import { buildFixtureRepo } from "../fixtures";
import * as fs from "fs";
import { leaveForReload } from "./handoff";
import * as vscode from "vscode";
import {
  codeColumnTab,
  filesIn,
  changeFiles,
  entryAt,
  markViewed,
  render,
  review,
} from "../changeFiles";
import {
  clickOverview,
  clickReadingOrderFile,
  overviewTake,
  sentTimeline,
  showTimeline,
  type ShownReadingOrder,
} from "../timeline";
import { closeChange, eventually, openChange, short } from "../reviewer";

/** The Assistant's reply to a request for a Reading Order, with this JSON in it. */
function orderReply(json: unknown): Record<string, unknown>[] {
  return replyTurn(
    [
      "Here is an order:",
      "```json",
      JSON.stringify(json),
      "```",
      "Enjoy.",
    ].join("\n")
  );
}

/** Waits until the overview shows this Reading Order. */
async function overviewShows(
  title: string,
  expected: ShownReadingOrder | undefined
): Promise<void> {
  await eventually(async () =>
    assert.deepStrictEqual((await sentTimeline(title)).readingOrder, expected)
  );
}

// The Reading Order the Assistant suggests after its summary: in the
// overview, in Change Files, and for stepping through the files. Runs first;
// ./afterReload runs in a second launch of the same workspace.
describe("The Reading Order", () => {
  const repo = buildFixtureRepo("reading-order");
  const request = {
    repository: repo.path,
    base: repo.commits.initial,
    head: repo.commits.restructured,
  };
  const title = `${path.basename(repo.path)} ${short(repo.commits.initial)}..${short(repo.commits.restructured)}`;
  const longLabel = `Then the package, ${"and more ".repeat(12)}`;
  const longWhy = "because ".repeat(20);

  it("lists the Assistant's steps in the overview, keeping only the Change's files, with its start first and the rest last", async () => {
    await scriptClaude(request, {
      turns: [
        replyTurn(
          "Renames the helper and restructures pkg. Start with util.py:1, where the rename happens."
        ),
      ],
      readingOrder: [
        waitFor("reading-order-written"),
        ...orderReply({
          steps: [
            {
              label: "The rename",
              files: [
                { path: "main.py", why: "calls the new name" },
                { path: "util.py", why: "defines it" },
                { path: "unknown.py", why: "not in the Change" },
                { path: "main.py", why: "again" },
              ],
            },
            {
              label: longLabel,
              files: [
                { path: "pkg/core.py", why: longWhy },
                { path: "../outside.py" },
                { path: 42 },
              ],
            },
            { label: "Nothing real", files: [{ path: "nowhere.py" }] },
          ],
        }),
      ],
    });

    await openChange(request);

    await overviewShows(title, { writing: true, outOfDate: false, steps: [] });
    releaseClaude("reading-order-written");

    await overviewShows(title, {
      writing: false,
      outOfDate: false,
      steps: [
        {
          label: "The rename",
          files: [
            { path: "util.py", why: "defines it", viewed: false },
            { path: "main.py", why: "calls the new name", viewed: false },
          ],
        },
        {
          label: `${longLabel.slice(0, 79)}…`,
          files: [
            {
              path: "pkg/core.py",
              why: `${longWhy.slice(0, 79)}…`,
              viewed: false,
            },
          ],
        },
        {
          label: "Other files",
          files: [
            { path: "pkg/sub/new.py", viewed: false },
            { path: "pkg/legacy.py", viewed: false },
            { path: "added.py", viewed: false },
            { path: "obsolete.py", viewed: false },
          ],
        },
      ],
    });
    const [run] = await assistantRuns(request);
    assert.strictEqual(userMessages(run).length, 1, "the summary");
    const [asked, ...more] = readingOrderRequests(run);
    assert.deepStrictEqual(more, [], "then one request for the order");
    for (const expected of ["Start with util.py", "pkg/sub/new.py"])
      assert.ok(asked.includes(expected), `${expected} in ${asked}`);
    await showAssistant(request);
    await eventually(async () =>
      assert.deepStrictEqual((await renderedPanel(title))?.messages, [
        summaryNote,
      ])
    );

    await closeChange(request);
  });

  it("leaves a Change in tree order when the reply holds no usable order, and says so in the overview, not as an error in the take", async () => {
    const other = { ...request, head: repo.commits.renamed };
    await scriptClaude(other, {
      turns: [replyTurn("Renames the helper. Start with util.py:1.")],
      readingOrder: replyTurn("I would rather not say."),
    });
    const otherTitle = `${path.basename(repo.path)} ${short(repo.commits.initial)}..${short(repo.commits.renamed)}`;

    await openChange(other);

    await eventually(async () => {
      const [run] = await assistantRuns(other);
      assert.strictEqual(run && readingOrderRequests(run).length, 1);
    });
    await eventually(async () =>
      assert.deepStrictEqual(render(await changeFiles()), [
        `${otherTitle} — □□□□□□□ 0/4`,
        "  added.py [A]",
        "  main.py [M]",
        "  obsolete.py [D]",
        "  util.py [M]",
      ])
    );
    await overviewShows(otherTitle, {
      writing: false,
      outOfDate: false,
      problem: true,
      steps: [],
    });
    assert.strictEqual((await overviewTake(otherTitle))?.problem, undefined);

    await closeChange(other);
  });

  it("lists a Change in Change Files by its Reading Order, kept from its conversation, or as a tree", async () => {
    await scriptClaude(request, {
      turns: [replyTurn("A summary that shouldn't be written.")],
    });
    const cutLabel = `${longLabel.slice(0, 79)}…`;
    const cutWhy = `${longWhy.slice(0, 79)}…`;
    const inReadingOrder = [
      `${title} — □□□□□□□ 0/7`,
      "  1. The rename",
      "    util.py [M] — defines it",
      "    main.py [M] — calls the new name",
      `  2. ${cutLabel}`,
      `    core.py [M] — pkg · ${cutWhy}`,
      "  3. Other files",
      "    new.py [A] — pkg/sub",
      "    legacy.py [D] — pkg",
      "    added.py [A]",
      "    obsolete.py [D]",
    ];

    await openChange(request);

    await eventually(async () =>
      assert.deepStrictEqual(render(await changeFiles()), inReadingOrder)
    );
    assert.deepStrictEqual(await assistantRuns(request), [], "no new turn");

    await vscode.commands.executeCommand("dearReviewer.sortByTree");

    assert.deepStrictEqual(render(await changeFiles()), [
      `${title} — □□□□□□□ 0/7`,
      "  pkg",
      "    sub",
      "      new.py [A]",
      "    core.py [M]",
      "    legacy.py [D]",
      "  added.py [A]",
      "  main.py [M]",
      "  obsolete.py [D]",
      "  util.py [M]",
    ]);

    await vscode.commands.executeCommand("dearReviewer.sortByReadingOrder");

    assert.deepStrictEqual(render(await changeFiles()), inReadingOrder);
  });

  it("steps through the unviewed files in the Reading Order, and checks them off in the overview", async () => {
    const tree = await changeFiles();
    await markViewed(
      entryAt(tree, title, `2. ${longLabel.slice(0, 79)}…`, "core.py")
    );
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    // A worktree file's path ends with the file's, whether in a diff or on its own.
    const shown = () => {
      const files = filesIn(codeColumnTab());
      return (
        ["util.py", "main.py", "pkg/sub/new.py", "pkg/core.py"].find((f) =>
          files.some((file) => file.endsWith(path.sep + path.normalize(f)))
        ) ?? files.join(" ↔ ")
      );
    };
    const opened: string[] = [];
    const step = async (command: "nextUnviewedFile" | "markViewedAndNext") => {
      const before = opened.at(-1);
      await review(command);
      await eventually(() => assert.notStrictEqual(shown(), before));
      opened.push(shown());
    };

    await step("nextUnviewedFile");
    await step("markViewedAndNext");
    await step("markViewedAndNext");

    assert.deepStrictEqual(opened, ["util.py", "main.py", "pkg/sub/new.py"]);
    // Closing every editor closed the overview too.
    await showTimeline(request);
    await eventually(async () => {
      const viewed = (await sentTimeline(title)).readingOrder?.steps
        .flatMap((s) => s.files)
        .filter((f) => f.viewed)
        .map((f) => f.path);
      assert.deepStrictEqual(viewed, ["util.py", "main.py", "pkg/core.py"]);
    });
  });

  it("keeps the Reading Order after new commits, marked out of date with what they changed last, until the Reviewer asks again", async () => {
    repo.git("branch", "order", repo.commits.documented);
    const branch = {
      repository: repo.path,
      base: repo.commits.initial,
      head: "refs/heads/order",
    };
    // A branch's overview is named after the branch, whatever its head.
    const overview = "order";
    await scriptClaude(branch, {
      turns: [replyTurn("Renames the helper. Start with util.py:1.")],
      readingOrder: orderReply({
        steps: [
          {
            label: "The rename",
            files: [
              { path: "util.py" },
              { path: "main.py" },
              { path: "added.py" },
              { path: "obsolete.py" },
            ],
          },
        ],
      }),
    });
    await openChange(branch);
    await eventually(async () =>
      assert.strictEqual(
        (await sentTimeline(overview)).readingOrder?.steps.length,
        1
      )
    );

    await clickReadingOrderFile(overview, "main.py");

    // The diff opens in front of the code column, beside the overview.
    // VS Code can hand the focus back to the overview a moment later, so
    // which of the two is active isn't the click's to say.
    await eventually(() => {
      const input = vscode.window.tabGroups.all.find(
        (group) => group.viewColumn === vscode.ViewColumn.Two
      )?.activeTab?.input;
      assert.ok(
        input instanceof vscode.TabInputTextDiff &&
          input.modified.path.endsWith("/main.py"),
        `the code column shows ${JSON.stringify(input)}`
      );
    });

    fs.writeFileSync(
      path.join(repo.path, "util.py"),
      "def new_helper():\n    return 3\n"
    );
    fs.writeFileSync(path.join(repo.path, "since.py"), "SINCE = 1\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "later");
    const later = repo.git("rev-parse", "HEAD");
    repo.git("branch", "-f", "order", later);
    // Main without the branch's commits, or the branch's Change would end as merged.
    repo.git("reset", "-q", "--hard", repo.commits.restructured);
    await scriptClaude(branch, {
      turns: [replyTurn("Shouldn't be asked.")],
      readingOrder: orderReply({
        steps: [{ label: "Everything", files: [{ path: "since.py" }] }],
      }),
    });

    await openChange(branch);

    await overviewShows(overview, {
      writing: false,
      outOfDate: true,
      steps: [
        {
          label: "The rename",
          files: [
            { path: "main.py", viewed: false },
            { path: "added.py", viewed: false },
            { path: "obsolete.py", viewed: false },
          ],
        },
        {
          label: "Since the suggestion",
          files: [
            { path: "pkg/sub/new.py", viewed: false },
            { path: "pkg/core.py", viewed: false },
            { path: "pkg/legacy.py", viewed: false },
            { path: "since.py", viewed: false },
            { path: "util.py", viewed: false },
          ],
        },
      ],
    });
    assert.deepStrictEqual(
      await assistantRuns(branch),
      [],
      "no new turn on its own"
    );

    await clickOverview(overview, "suggestReadingOrder");

    await overviewShows(overview, {
      writing: false,
      outOfDate: false,
      steps: [
        {
          label: "Everything",
          files: [
            { path: "util.py", viewed: false },
            { path: "since.py", viewed: false },
          ],
        },
        {
          label: "Other files",
          files: [
            { path: "pkg/sub/new.py", viewed: false },
            { path: "pkg/core.py", viewed: false },
            { path: "pkg/legacy.py", viewed: false },
            { path: "added.py", viewed: false },
            { path: "main.py", viewed: false },
            { path: "obsolete.py", viewed: false },
          ],
        },
      ],
    });
    const [run] = await assistantRuns(branch);
    const [prompt] = readingOrderRequests(run);
    assert.ok(prompt.includes(later), `it hears of the new head: ${prompt}`);

    leaveForReload({
      branch,
      overview,
      open: [
        request,
        branch,
        { ...branch, head: repo.commits.documented },
        { ...branch, head: later },
      ],
      readingOrder: (await sentTimeline(overview)).readingOrder!,
      changeFiles: render(await changeFiles()),
    });
  });
});
