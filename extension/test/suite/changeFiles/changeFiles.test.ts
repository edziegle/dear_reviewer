import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  codeColumnTab,
  shownDiff,
  shownText,
  changeFiles,
  entryAt,
  filesIn,
  hideViewedFiles,
  markViewed,
  onTab,
  render,
  review,
  select,
  showViewedFiles,
  unmarkViewed,
  viewedFilesKey,
} from "../changeFiles";
import { buildFixtureRepo } from "../fixtures";
import {
  commentingLines,
  commentThreads,
  comment,
  deleteComment,
} from "../review";
import { clickOverview, showTimeline } from "../timeline";
import {
  activeTabLabel,
  eventually,
  foldersAddedSince,
  openChange,
  short,
  workspaceFolders,
} from "../reviewer";
import { leaveForReload } from "./handoff";

// Runs first; ./afterReload runs in a second launch of the same workspace.
describe("The Change files view", () => {
  const repo = buildFixtureRepo("files");
  const request = {
    repository: repo.path,
    base: repo.commits.initial,
    head: repo.commits.restructured,
  };
  const title = `${path.basename(repo.path)} ${short(repo.commits.initial)}..${short(repo.commits.restructured)}`;
  let base = "";
  let head = "";

  before(async () => {
    const before = workspaceFolders();
    await openChange(request);
    [base, head] = foldersAddedSince(before).map((f) => f.path);
  });

  it("lists the open Change's files as a directory tree, with added, modified and deleted status", async () => {
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
  });

  const shownIsPinned = () =>
    assert.strictEqual(
      codeColumnTab()?.isPreview,
      false,
      "pinned, so going to a definition doesn't replace it"
    );

  it("opens a selected modified file's diff between its base and head worktree files", async () => {
    await select(entryAt(await changeFiles(), title, "pkg", "core.py"));

    await eventually(() => {
      const diff = shownDiff();
      assert.strictEqual(diff.original.fsPath, path.join(base, "pkg/core.py"));
      assert.strictEqual(diff.modified.fsPath, path.join(head, "pkg/core.py"));
    });
    shownIsPinned();
  });

  it("opens a selected added file on its own, from the head worktree", async () => {
    await select(entryAt(await changeFiles(), title, "pkg", "sub", "new.py"));

    await eventually(() =>
      assert.strictEqual(shownText().fsPath, path.join(head, "pkg/sub/new.py"))
    );
    shownIsPinned();
  });

  it("opens a selected deleted file on its own, from the base worktree", async () => {
    await select(entryAt(await changeFiles(), title, "pkg", "legacy.py"));

    await eventually(() =>
      assert.strictEqual(shownText().fsPath, path.join(base, "pkg/legacy.py"))
    );
    shownIsPinned();
  });

  it("offers Comments on every line of an added file opened on its own", async () => {
    const file = path.join(head, "added.py");
    await select(entryAt(await changeFiles(), title, "added.py"));
    await eventually(() => assert.strictEqual(shownText().fsPath, file));

    assert.deepStrictEqual(await commentingLines(file), [[0, 2]]);
    const thread = await comment(file, 2, 2, "Why compute this on import?");
    assert.deepStrictEqual(
      (await commentThreads()).map((t) => [t.file, t.lines, t.comments]),
      [[file, [2, 2], ["Why compute this on import?"]]]
    );

    await deleteComment(thread.comments[0]);
  });

  it("marks files viewed and unviewed, one at a time or a directory at once", async () => {
    let tree = await changeFiles();
    await markViewed(
      entryAt(tree, title, "pkg", "core.py"),
      entryAt(tree, title, "added.py")
    );
    tree = await changeFiles();
    assert.deepStrictEqual(render(tree), [
      `${title} — ■■□□□□□ 2/7`,
      "  pkg",
      "    sub",
      "      new.py [A]",
      "    core.py [M] (viewed)",
      "    legacy.py [D]",
      "  added.py [A] (viewed)",
      "  main.py [M]",
      "  obsolete.py [D]",
      "  util.py [M]",
    ]);

    await unmarkViewed(entryAt(tree, title, "added.py"));
    await markViewed(entryAt(await changeFiles(), title, "pkg", "sub"));

    assert.deepStrictEqual(render(await changeFiles()), [
      `${title} — ■■□□□□□ 2/7`,
      "  pkg",
      "    sub",
      "      new.py [A] (viewed)",
      "    core.py [M] (viewed)",
      "    legacy.py [D]",
      "  added.py [A]",
      "  main.py [M]",
      "  obsolete.py [D]",
      "  util.py [M]",
    ]);
  });

  it("reads the Change's progress in words to a screen reader", async () => {
    assert.strictEqual(
      entryAt(await changeFiles(), title).accessibilityLabel,
      `${title}, 2 of 7 files viewed`
    );
  });

  it("offers a local Change's actions: a Brief, not a submitted Review", async () => {
    assert.strictEqual(
      entryAt(await changeFiles(), title).contextValue,
      "change.local"
    );
  });

  it("moves through the files not yet viewed, from the file shown, marking it viewed on the way", async () => {
    const shows = async (file: string, side: "base" | "head") =>
      eventually(() =>
        assert.ok(
          filesIn(codeColumnTab()).includes(
            path.join(side === "base" ? base : head, file)
          ),
          `${file} isn't shown`
        )
      );
    await select(entryAt(await changeFiles(), title, "main.py"));
    await shows("main.py", "head");

    await review("nextUnviewedFile");
    await shows("obsolete.py", "base");
    await review("previousUnviewedFile");
    await shows("main.py", "head");
    await review("previousUnviewedFile");
    await shows("added.py", "head");
    // From an added file, shown on its own, rather than from the first again.
    await review("nextUnviewedFile");
    await shows("main.py", "head");
    await review("previousUnviewedFile");
    await shows("added.py", "head");

    await review("markViewedAndNext");
    await shows("main.py", "head");
    const tree = await changeFiles();
    assert.strictEqual(entryAt(tree, title, "added.py").viewed, true);
    await unmarkViewed(entryAt(tree, title, "added.py"));
  });

  /**
   * Waits for the code column, beside the overview, to show the file, in a
   * diff or on its own. The focus may stay on the overview.
   */
  const shows = async (file: string) =>
    eventually(() => {
      const shown = filesIn(
        vscode.window.tabGroups.all.find(
          (g) => g.viewColumn === vscode.ViewColumn.Two
        )?.activeTab
      );
      assert.ok(
        shown.includes(path.join(file === "pkg/legacy.py" ? base : head, file)),
        `${file} isn't shown: ${shown.join(" ↔ ")}`
      );
    });

  /** Brings the overview in front, then clicks its button there. */
  const nextFromOverview = async () => {
    await showTimeline(request);
    await eventually(() => assert.strictEqual(activeTabLabel(), title));
    await clickOverview(title, "nextFile");
  };

  /** Puts a tab that isn't one of the Change's files in front of the code column. */
  const showElsewhere = async () =>
    vscode.window.showTextDocument(
      // The repository's own clone, not one of the Change's worktrees.
      vscode.Uri.file(path.join(repo.path, "main.py")),
      { viewColumn: vscode.ViewColumn.Two, preview: false }
    );

  it("opens the next unviewed file from the overview after the one in the code column, not the first again", async () => {
    await showElsewhere();
    await nextFromOverview();
    await shows("pkg/legacy.py");
    await nextFromOverview();
    await shows("added.py");
    await nextFromOverview();
    await shows("main.py");
  });

  it("opens the first unviewed file from the overview when the code column shows another file", async () => {
    await select(entryAt(await changeFiles(), title, "main.py"));
    await shows("main.py");
    await showElsewhere();

    await nextFromOverview();
    await shows("pkg/legacy.py");
  });

  it("skips the files already viewed when stepping from the overview", async () => {
    await showElsewhere();
    await markViewed(entryAt(await changeFiles(), title, "pkg", "legacy.py"));

    await nextFromOverview();
    await shows("added.py");
    await nextFromOverview();
    await shows("main.py");

    await unmarkViewed(entryAt(await changeFiles(), title, "pkg", "legacy.py"));
  });

  it("marks the file beside the overview viewed with the review key pressed in the overview, and moves on", async () => {
    await select(entryAt(await changeFiles(), title, "added.py"));
    await shows("added.py");
    await showTimeline(request);
    await eventually(() => assert.strictEqual(activeTabLabel(), title));

    await review("markViewedAndNext");

    await shows("main.py");
    const tree = await changeFiles();
    assert.strictEqual(entryAt(tree, title, "added.py").viewed, true);
    await unmarkViewed(entryAt(tree, title, "added.py"));
  });

  it("lists both sides of every viewed file for the title bar's buttons, as files are marked and unmarked", async () => {
    const sides = (file: string) => [
      path.join(base, file),
      path.join(head, file),
    ];
    await markViewed(entryAt(await changeFiles(), title, "main.py"));
    await eventually(async () =>
      assert.deepStrictEqual(
        [...(await viewedFilesKey())].sort(),
        [
          ...sides("main.py"),
          ...sides("pkg/core.py"),
          ...sides("pkg/sub/new.py"),
        ].sort()
      )
    );

    await unmarkViewed(entryAt(await changeFiles(), title, "main.py"));
    await eventually(async () => {
      const key = await viewedFilesKey();
      for (const side of sides("main.py")) assert.ok(!key.includes(side));
      assert.ok(key.includes(path.join(head, "pkg/core.py")));
    });
  });

  it("offers the title bar's buttons on a Change's worktree files only, by their viewed state", () => {
    const menus = vscode.extensions.getExtension("edziegle.dear-reviewer")!
      .packageJSON.contributes.menus as Record<
      string,
      { command: string; when?: string; group?: string }[]
    >;
    const onChangeFile =
      "resourceScheme == file && resourcePath =~ /edziegle\\.dear-reviewer\\/changes\\//";
    const titleBar = menus["editor/title"].filter((m) =>
      m.when?.includes("dearReviewer.viewedFiles")
    );
    assert.deepStrictEqual(
      titleBar.map((m) => [m.command, m.when, m.group]),
      [
        [
          "dearReviewer.markViewedAndNext",
          `${onChangeFile} && resourcePath not in dearReviewer.viewedFiles`,
          "navigation",
        ],
        [
          "dearReviewer.unmarkViewed",
          `${onChangeFile} && resourcePath in dearReviewer.viewedFiles`,
          "navigation",
        ],
      ]
    );
  });

  it("marks the file of a tab from its menu, not the active one", async () => {
    await select(entryAt(await changeFiles(), title, "main.py"));
    await eventually(() =>
      assert.strictEqual(
        shownDiff().modified.fsPath,
        path.join(head, "main.py")
      )
    );
    await select(entryAt(await changeFiles(), title, "util.py"));
    await eventually(() =>
      assert.strictEqual(
        shownDiff().modified.fsPath,
        path.join(head, "util.py")
      )
    );

    await onTab("markViewed", vscode.Uri.file(path.join(head, "main.py")));

    let tree = await changeFiles();
    assert.strictEqual(entryAt(tree, title, "main.py").viewed, true);
    assert.strictEqual(entryAt(tree, title, "util.py").viewed, false);

    await onTab("unmarkViewed", vscode.Uri.file(path.join(head, "main.py")));
    tree = await changeFiles();
    assert.strictEqual(entryAt(tree, title, "main.py").viewed, false);
  });

  it("leaves a worktree file the Change doesn't change unmarked and open", async () => {
    const file = path.join(head, "notes.txt");
    fs.writeFileSync(file, "Not part of the Change.\n");
    await vscode.window.showTextDocument(vscode.Uri.file(file));

    await onTab("markViewed", vscode.Uri.file(file));
    await onTab("markViewedAndClose", vscode.Uri.file(file));

    assert.strictEqual(shownText().fsPath, file);
    // Marking a Change file afterwards shows the key once it has caught up.
    await markViewed(entryAt(await changeFiles(), title, "main.py"));
    await eventually(async () => {
      const key = await viewedFilesKey();
      assert.ok(key.includes(path.join(head, "main.py")));
      assert.ok(!key.includes(file));
    });
    await unmarkViewed(entryAt(await changeFiles(), title, "main.py"));
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    fs.rmSync(file);
  });

  it("marks a deleted file viewed from its tab's menu and closes the tab", async () => {
    const file = path.join(base, "obsolete.py");
    await select(entryAt(await changeFiles(), title, "obsolete.py"));
    await eventually(() => assert.strictEqual(shownText().fsPath, file));

    await onTab("markViewedAndClose", vscode.Uri.file(file));

    assert.strictEqual(
      entryAt(await changeFiles(), title, "obsolete.py").viewed,
      true
    );
    await eventually(() =>
      assert.ok(
        !vscode.window.tabGroups.all
          .flatMap((g) => g.tabs)
          .some((tab) => filesIn(tab).includes(file)),
        "the tab is still open"
      )
    );
    await unmarkViewed(entryAt(await changeFiles(), title, "obsolete.py"));
  });

  it("unmarks the active file from the title bar and keeps it open", async () => {
    const file = path.join(head, "util.py");
    await select(entryAt(await changeFiles(), title, "util.py"));
    await eventually(() =>
      assert.strictEqual(shownDiff().modified.fsPath, file)
    );
    await markViewed(entryAt(await changeFiles(), title, "util.py"));

    // The title bar passes the diff's resource: its modified side.
    await onTab("unmarkViewed", shownDiff().modified);

    assert.strictEqual(
      entryAt(await changeFiles(), title, "util.py").viewed,
      false
    );
    assert.strictEqual(shownDiff().modified.fsPath, file);
  });

  it("hides viewed files, and directories left empty, until they are shown again", async () => {
    await hideViewedFiles();
    const hidden = render(await changeFiles());
    await showViewedFiles();
    const shown = render(await changeFiles());
    await hideViewedFiles();

    assert.deepStrictEqual(hidden, [
      `${title} — ■■□□□□□ 2/7`,
      "  pkg",
      "    legacy.py [D]",
      "  added.py [A]",
      "  main.py [M]",
      "  obsolete.py [D]",
      "  util.py [M]",
    ]);
    assert.strictEqual(shown.length, 10);
    assert.deepStrictEqual(render(await changeFiles()), hidden);
  });

  it("leaves another Change stopped before this one for the reload", async () => {
    const stopped = {
      repository: repo.path,
      base: repo.commits.initial,
      head: repo.commits.renamed,
    };
    await openChange(stopped);
    await openChange(request);

    assert.deepStrictEqual(
      (await changeFiles()).map((entry) => entry.label),
      [title]
    );

    leaveForReload({ ...request, title });
  });
});
