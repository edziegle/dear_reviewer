import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import {
  activeDiff,
  changeFiles,
  entryAt,
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

  it("opens a selected file's diff between its base and head worktree files", async () => {
    const tree = await changeFiles();

    await select(entryAt(tree, title, "pkg", "core.py"));
    await eventually(() => {
      const diff = activeDiff();
      assert.strictEqual(diff.original.fsPath, path.join(base, "pkg/core.py"));
      assert.strictEqual(diff.modified.fsPath, path.join(head, "pkg/core.py"));
    });

    await select(entryAt(tree, title, "pkg", "sub", "new.py"));
    await eventually(() =>
      assert.strictEqual(
        activeDiff().modified.fsPath,
        path.join(head, "pkg/sub/new.py")
      )
    );
    const added = activeDiff().original;
    assert.notStrictEqual(added.scheme, "file", "an added file has no base");
    assert.strictEqual(
      (await vscode.workspace.openTextDocument(added)).getText(),
      ""
    );

    await select(entryAt(tree, title, "pkg", "legacy.py"));
    await eventually(() =>
      assert.strictEqual(
        activeDiff().original.fsPath,
        path.join(base, "pkg/legacy.py")
      )
    );
    const deleted = activeDiff().modified;
    assert.notStrictEqual(deleted.scheme, "file", "a deleted file has no head");
    assert.strictEqual(
      (await vscode.workspace.openTextDocument(deleted)).getText(),
      ""
    );
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

  it("moves through the files not yet viewed, from the diff shown, marking it viewed on the way", async () => {
    const shows = async (file: string, side: "base" | "head") =>
      eventually(() =>
        assert.strictEqual(
          (side === "base" ? activeDiff().original : activeDiff().modified)
            .fsPath,
          path.join(side === "base" ? base : head, file)
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

    await review("markViewedAndNext");
    await shows("main.py", "head");
    const tree = await changeFiles();
    assert.strictEqual(entryAt(tree, title, "added.py").viewed, true);
    await unmarkViewed(entryAt(tree, title, "added.py"));
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
