import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import {
  activeDiff,
  activeText,
  changeFiles,
  entryAt,
  filesIn,
  hideViewedFiles,
  markViewed,
  render,
  review,
  select,
  showViewedFiles,
  unmarkViewed,
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
      `${title} — 0 of 7 viewed`,
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

  const activeIsPinned = () =>
    assert.strictEqual(
      vscode.window.tabGroups.activeTabGroup.activeTab?.isPreview,
      false,
      "pinned, so going to a definition doesn't replace it"
    );

  it("opens a selected modified file's diff between its base and head worktree files", async () => {
    await select(entryAt(await changeFiles(), title, "pkg", "core.py"));

    await eventually(() => {
      const diff = activeDiff();
      assert.strictEqual(diff.original.fsPath, path.join(base, "pkg/core.py"));
      assert.strictEqual(diff.modified.fsPath, path.join(head, "pkg/core.py"));
    });
    activeIsPinned();
  });

  it("opens a selected added file on its own, from the head worktree", async () => {
    await select(entryAt(await changeFiles(), title, "pkg", "sub", "new.py"));

    await eventually(() =>
      assert.strictEqual(activeText().fsPath, path.join(head, "pkg/sub/new.py"))
    );
    activeIsPinned();
  });

  it("opens a selected deleted file on its own, from the base worktree", async () => {
    await select(entryAt(await changeFiles(), title, "pkg", "legacy.py"));

    await eventually(() =>
      assert.strictEqual(activeText().fsPath, path.join(base, "pkg/legacy.py"))
    );
    activeIsPinned();
  });

  it("offers Comments on every line of an added file opened on its own", async () => {
    const file = path.join(head, "added.py");
    await select(entryAt(await changeFiles(), title, "added.py"));
    await eventually(() => assert.strictEqual(activeText().fsPath, file));

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
      `${title} — 2 of 7 viewed`,
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
      `${title} — 2 of 7 viewed`,
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
          filesIn(vscode.window.tabGroups.activeTabGroup.activeTab).includes(
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

  it("hides viewed files, and directories left empty, until they are shown again", async () => {
    await hideViewedFiles();
    const hidden = render(await changeFiles());
    await showViewedFiles();
    const shown = render(await changeFiles());
    await hideViewedFiles();

    assert.deepStrictEqual(hidden, [
      `${title} — 2 of 7 viewed`,
      "  pkg",
      "    legacy.py [D]",
      "  added.py [A]",
      "  main.py [M]",
      "  obsolete.py [D]",
      "  util.py [M]",
    ]);
    assert.strictEqual(shown.length, 10);
    assert.deepStrictEqual(render(await changeFiles()), hidden);

    leaveForReload({ ...request, title });
  });
});
