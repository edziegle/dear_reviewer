import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  assistantRuns,
  readingOrderRequests,
  replyTurn,
  scriptClaude,
} from "../assistant";
import {
  changeFiles,
  codeColumnTab,
  entryAt,
  filesIn,
  markViewed,
  render,
  review,
} from "../changeFiles";
import { buildFixtureRepo } from "../fixtures";
import { closeChange, eventually, openChange, short } from "../reviewer";
import {
  renderedTimeline,
  sentTimeline,
  type ShownReadingOrder,
} from "../timeline";

/** The Assistant's reply to a request for a Reading Order, with this JSON in it. */
function orderReply(json: unknown): Record<string, unknown>[] {
  return replyTurn(JSON.stringify(json));
}

/**
 * A Change with the three kinds of skim-only file, and files that look like
 * them but aren't:
 * - `package-lock.json` changes: a lock file.
 * - `gen/api.py` changes, and the base's `.gitattributes` marks `gen/**`
 *   generated. The head's `.gitattributes` marks `src/a.py` and
 *   `own/by_the_change.py` generated, which must not count.
 * - `old/moved.py` moves to `new/moved.py` with no edit: an exact rename.
 * - `old/edited.py` moves to `new/edited.py` with an edit: no rename.
 * Its other files are `src/a.py` to `src/f.py`.
 */
function skimChange(name: string, extraHeadCommit = false) {
  const repo = buildFixtureRepo(name);
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(repo.path, file)), { recursive: true });
    fs.writeFileSync(path.join(repo.path, file), text);
  };
  const commit = (message: string) => {
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", message);
    return repo.git("rev-parse", "HEAD");
  };
  write(".gitattributes", "gen/** linguist-generated\n");
  write("gen/api.py", "API = 1\n");
  write("package-lock.json", "{}\n");
  write("old/moved.py", "SAME = True\n");
  write("old/edited.py", "BEFORE = 1\n");
  for (const f of "abcdef") write(`src/${f}.py`, `${f.toUpperCase()} = 1\n`);
  const base = commit("skim base");

  write(
    ".gitattributes",
    "src/a.py linguist-generated\nown/** linguist-generated\n"
  );
  write("gen/api.py", "API = 2\n");
  write("package-lock.json", '{"changed": true}\n');
  fs.rmSync(path.join(repo.path, "old", "moved.py"));
  write("new/moved.py", "SAME = True\n");
  fs.rmSync(path.join(repo.path, "old", "edited.py"));
  write("new/edited.py", "AFTER = 2\n");
  write("own/by_the_change.py", "OWN = 1\n");
  for (const f of "abcdef") write(`src/${f}.py`, `${f.toUpperCase()} = 2\n`);
  let head = commit("skim head");
  if (extraHeadCommit) {
    write("src/a.py", "A = 3\n");
    head = commit("skim head again");
  }
  const request = { repository: repo.path, base, head };
  return {
    request,
    title: `${path.basename(repo.path)} ${short(base)}..${short(head)}`,
  };
}

describe("Skim-only files", () => {
  const { request, title } = skimChange("skim-only");
  const cutLockFirst = [
    {
      label: "The code",
      files: ["package-lock.json", "src/a.py", "gen/api.py"],
    },
    { label: "Plumbing", files: ["src/b.py", "new/moved.py"] },
  ];
  const skimFiles = [
    { path: "gen/api.py", viewed: false, skim: "generated" },
    { path: "new/moved.py", viewed: false, skim: "renamed" },
    { path: "old/moved.py", viewed: false, skim: "renamed" },
    { path: "package-lock.json", viewed: false, skim: "lock file" },
  ];
  const nonSkimLeftOut = [
    "new/edited.py",
    "old/edited.py",
    "own/by_the_change.py",
    "src/c.py",
    "src/d.py",
    "src/e.py",
    "src/f.py",
    ".gitattributes",
  ];

  before(async () => {
    await scriptClaude(request, {
      turns: [replyTurn("Changes the code. Start with src/a.py:1.")],
      readingOrder: orderReply({
        steps: cutLockFirst.map(({ label, files }) => ({
          label,
          files: files.map((p) => ({ path: p })),
        })),
      }),
    });
    await openChange(request);
  });

  after(() => closeChange(request));

  it("puts lock files, files the base marks generated and unedited renames in a last step, and tells the Assistant", async () => {
    const shown = async (): Promise<ShownReadingOrder | undefined> =>
      (await sentTimeline(title)).readingOrder;
    let order: ShownReadingOrder | undefined;
    await eventually(async () => {
      order = await shown();
      assert.strictEqual(order?.writing, false);
      assert.ok(order.steps.length > 0, "the order is written");
    });

    await eventually(async () =>
      assert.deepStrictEqual(
        (await renderedTimeline(title))?.readingOrder,
        order,
        "the overview drew it"
      )
    );
    assert.deepStrictEqual(order?.steps, [
      {
        label: "The code",
        core: true,
        files: [{ path: "src/a.py", viewed: false }],
      },
      { label: "Plumbing", files: [{ path: "src/b.py", viewed: false }] },
      {
        label: "Other files",
        files: nonSkimLeftOut.map((p) => ({ path: p, viewed: false })),
      },
      { label: "Skim-only", skimOnly: true, files: skimFiles },
    ]);

    const [run] = await assistantRuns(request);
    const [asked] = readingOrderRequests(run);
    const [listed, skimmed] = asked.split("Skim-only files (");
    assert.ok(skimmed.startsWith("4)."), skimmed);
    for (const skim of skimFiles) {
      assert.ok(
        skimmed.includes(skim.path),
        `${skim.path} listed as skim-only`
      );
      assert.ok(
        !listed.includes(skim.path),
        `${skim.path} not among the files to order`
      );
    }
    assert.ok(listed.includes("Changed files (10)."), listed);
    assert.ok(listed.includes("src/a.py"), listed);
    assert.ok(asked.includes("the 3 to 5 files that carry its intent"));
  });

  it("shows them muted, with the reason, in Change Files in both modes, and the Skim-only step collapsed", async () => {
    const tree = await changeFiles();
    const row = (...labels: string[]) => entryAt(tree, title, ...labels);

    assert.strictEqual(row("1. The code").description, "core of the change");
    const skimStep = row("4. Skim-only");
    assert.strictEqual(skimStep.collapsed, true);
    assert.deepStrictEqual(
      skimStep.children.map((f) => [f.label, f.description, f.muted]),
      [
        ["api.py", "gen · skim-only: generated", true],
        ["moved.py", "new · skim-only: renamed", true],
        ["moved.py", "old · skim-only: renamed", true],
        ["package-lock.json", "skim-only: lock file", true],
      ]
    );
    // A file that looks like a rename but was edited, and one only the head marked, are not.
    for (const entry of [
      row("3. Other files", "edited.py"),
      row("3. Other files", "by_the_change.py"),
      row("1. The code", "a.py"),
    ])
      assert.strictEqual(entry.muted, undefined, entry.label);

    await vscode.commands.executeCommand("dearReviewer.sortByTree");
    try {
      const flat = render(await changeFiles());
      assert.ok(
        flat.includes("    api.py [M] — skim-only: generated"),
        flat.join("\n")
      );
      assert.ok(
        flat.includes("  package-lock.json [M] — skim-only: lock file"),
        flat.join("\n")
      );
      assert.ok(flat.includes("    edited.py [A]"), flat.join("\n"));
      const treeNow = await changeFiles();
      assert.strictEqual(
        entryAt(treeNow, title, "package-lock.json").muted,
        true
      );
      assert.strictEqual(
        entryAt(treeNow, title, "src", "a.py").muted,
        undefined
      );
    } finally {
      await vscode.commands.executeCommand("dearReviewer.sortByReadingOrder");
    }
  });
  describe("when stepping through the files", () => {
    const stepping = skimChange("skim-stepping");
    const nonSkim = [
      "src/a.py",
      "src/b.py",
      "new/edited.py",
      "old/edited.py",
      "own/by_the_change.py",
      "src/c.py",
      "src/d.py",
      "src/e.py",
      "src/f.py",
      ".gitattributes",
    ];
    const skimOnly = [
      "gen/api.py",
      "new/moved.py",
      "old/moved.py",
      "package-lock.json",
    ];

    /** Which of the Change's files the code column shows. */
    const shown = () => {
      const files = filesIn(codeColumnTab());
      return (
        [...nonSkim, ...skimOnly].find((f) =>
          files.some((file) => file.endsWith(path.sep + path.normalize(f)))
        ) ?? files.join(" ↔ ")
      );
    };
    const goto = async (
      command: "nextUnviewedFile" | "previousUnviewedFile"
    ) => {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await review(command);
      let opened = "";
      await eventually(() => {
        opened = shown();
        assert.ok(
          [...nonSkim, ...skimOnly].includes(opened),
          `a file of the Change is shown, not ${opened}`
        );
      });
      return opened;
    };
    const visitSkimOnly = (on: boolean | undefined) =>
      vscode.workspace
        .getConfiguration("dearReviewer")
        .update("visitSkimOnlyFiles", on, vscode.ConfigurationTarget.Global);

    before(async () => {
      await scriptClaude(stepping.request, {
        turns: [replyTurn("Changes the code. Start with src/a.py:1.")],
        readingOrder: orderReply({
          steps: [
            { label: "The code", files: [{ path: "src/a.py" }] },
            { label: "Plumbing", files: [{ path: "src/b.py" }] },
          ],
        }),
      });
      await openChange(stepping.request);
      await eventually(async () =>
        assert.strictEqual(
          (await sentTimeline(stepping.title)).readingOrder?.steps.length,
          4
        )
      );
    });

    after(async () => {
      await visitSkimOnly(undefined);
      await closeChange(stepping.request);
    });

    it("passes over skim-only files, which come last in the Reading Order, and visits them with the setting on", async () => {
      assert.strictEqual(await goto("previousUnviewedFile"), ".gitattributes");

      await visitSkimOnly(true);

      assert.strictEqual(
        await goto("previousUnviewedFile"),
        "package-lock.json"
      );
    });

    it("visits the skim-only files once nothing else is left unviewed", async () => {
      await visitSkimOnly(false);
      const tree = await changeFiles();
      const row = entryAt(tree, stepping.title);
      await markViewed(
        ...row.children
          .filter((step) => step.label !== "4. Skim-only")
          .flatMap((step) => step.children)
      );
      await eventually(async () =>
        assert.strictEqual(
          render(await changeFiles()).filter((l) => l.includes("(viewed)"))
            .length,
          nonSkim.length
        )
      );

      assert.strictEqual(await goto("nextUnviewedFile"), "gen/api.py");
    });
  });

  it("keeps the core of the change to five files, the rest of its step in a step after it, and the start file first", async () => {
    const core = skimChange("skim-core", true);
    const everything = [
      "src/a.py",
      "src/b.py",
      "src/c.py",
      "src/d.py",
      "src/e.py",
      "src/f.py",
      "new/edited.py",
    ];
    await scriptClaude(core.request, {
      turns: [replyTurn("Changes the code. Start with src/f.py:1.")],
      readingOrder: orderReply({
        steps: [
          { label: "Everything", files: everything.map((p) => ({ path: p })) },
        ],
      }),
    });

    await openChange(core.request);

    try {
      await eventually(async () => {
        const steps = (await sentTimeline(core.title)).readingOrder?.steps;
        assert.deepStrictEqual(
          steps?.map((s) => [s.label, s.core, s.files.map((f) => f.path)]),
          [
            [
              "Everything",
              true,
              ["src/f.py", "src/a.py", "src/b.py", "src/c.py", "src/d.py"],
            ],
            ["Everything", undefined, ["src/e.py", "new/edited.py"]],
            [
              "Other files",
              undefined,
              ["old/edited.py", "own/by_the_change.py", ".gitattributes"],
            ],
            [
              "Skim-only",
              undefined,
              [
                "gen/api.py",
                "new/moved.py",
                "old/moved.py",
                "package-lock.json",
              ],
            ],
          ]
        );
      });
      const tree = await changeFiles();
      assert.deepStrictEqual(
        entryAt(tree, core.title)
          .children.slice(0, 2)
          .map((step) => [step.label, step.description]),
        [
          ["1. Everything", "core of the change"],
          ["2. Everything", undefined],
        ]
      );
    } finally {
      await closeChange(core.request);
    }
  });
});
