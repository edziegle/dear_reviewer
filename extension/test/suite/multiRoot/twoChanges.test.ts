import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  activeDiff,
  changeFiles,
  entryAt,
  markViewed,
  render,
  review,
  viewedFilesKey,
} from "../changeFiles";
import { buildFixtureRepo } from "../fixtures";
import {
  activeTabLabel,
  closeChange,
  eventually,
  foldersAddedSince,
  gitIn,
  openChange,
  short,
  workspaceFolders,
  worktreesOf,
} from "../reviewer";

describe("Two open Changes", () => {
  it("keep their own worktrees, and closing one leaves the other open", async () => {
    const repo = buildFixtureRepo("two");
    const rename = {
      repository: repo.path,
      base: repo.commits.initial,
      head: repo.commits.renamed,
    };
    const docs = {
      repository: repo.path,
      base: repo.commits.renamed,
      head: repo.commits.documented,
    };
    const before = workspaceFolders();

    await openChange(rename);
    const renameFolders = foldersAddedSince(before);
    await openChange(docs);
    const docsFolders = foldersAddedSince([...before, ...renameFolders]);

    assert.strictEqual(renameFolders.length, 2);
    assert.strictEqual(docsFolders.length, 2);
    const heads = [renameFolders[1], docsFolders[1]].map((f) =>
      gitIn(f.path, "rev-parse", "HEAD")
    );
    assert.deepStrictEqual(heads, [
      repo.commits.renamed,
      repo.commits.documented,
    ]);

    await closeChange(rename);

    assert.deepStrictEqual(workspaceFolders(), [...before, ...docsFolders]);
    assert.deepStrictEqual(
      worktreesOf(repo.path).map((w) => w.path),
      [repo.path, ...docsFolders.map((f) => f.path)]
    );
    assert.match(
      fs.readFileSync(path.join(docsFolders[1].path, "util.py"), "utf8"),
      /"""Two."""/
    );

    await closeChange(docs);
  });

  it("lists only the Change in front in Change Files, the one opened last (#35)", async () => {
    const repo = buildFixtureRepo("front");
    const first = {
      repository: repo.path,
      base: repo.commits.initial,
      head: repo.commits.renamed,
    };
    const second = {
      repository: repo.path,
      base: repo.commits.renamed,
      head: repo.commits.documented,
    };
    const title = `${path.basename(repo.path)} ${short(second.base)}..${short(second.head)}`;

    await openChange(first);
    await openChange(second);

    try {
      await eventually(async () =>
        assert.deepStrictEqual(render(await changeFiles()), [
          `${title} — 0 of 1 viewed`,
          "  util.py [M]",
        ])
      );
    } finally {
      await closeChange(second);
      await closeChange(first);
    }
  });

  /** Two Changes of one repository, and their titles in Change Files. */
  function twoChangesOf(name: string) {
    const repo = buildFixtureRepo(name);
    const first = {
      repository: repo.path,
      base: repo.commits.initial,
      head: repo.commits.renamed,
    };
    const second = {
      repository: repo.path,
      base: repo.commits.renamed,
      head: repo.commits.documented,
    };
    const titleOf = (c: typeof first) =>
      `${path.basename(repo.path)} ${short(c.base)}..${short(c.head)}`;
    return { first, second, titles: [titleOf(first), titleOf(second)] };
  }

  const listed = async () =>
    (await changeFiles()).map(
      (entry) => `${entry.label} — ${entry.description}`
    );

  it("lists the Change opened again in front, as the Reviewer left it", async () => {
    const { first, second, titles } = twoChangesOf("again");

    await openChange(first);
    await markViewed(entryAt(await changeFiles(), titles[0], "util.py"));
    await openChange(second);

    try {
      await eventually(async () =>
        assert.deepStrictEqual(await listed(), [`${titles[1]} — 0 of 1 viewed`])
      );
      assert.deepStrictEqual(await viewedFilesKey(), []);

      await openChange(first);

      await eventually(async () =>
        assert.deepStrictEqual(await listed(), [`${titles[0]} — 1 of 4 viewed`])
      );
      assert.strictEqual(
        entryAt(await changeFiles(), titles[0], "util.py").viewed,
        true
      );
      assert.strictEqual((await viewedFilesKey()).length, 2);
    } finally {
      await closeChange(second);
      await closeChange(first);
    }
  });

  it("lists the Change shown before once the one in front closes, and none once the last closes", async () => {
    const { first, second, titles } = twoChangesOf("closing");

    await openChange(first);
    await openChange(second);
    await openChange(first);
    await closeChange(first);

    try {
      await eventually(async () =>
        assert.deepStrictEqual(await listed(), [`${titles[1]} — 0 of 1 viewed`])
      );
    } finally {
      await closeChange(second);
    }
    assert.deepStrictEqual(await changeFiles(), []);
  });

  it("shows the Change shown before as a review starts, its overview alone, once the one in front closes", async () => {
    const { first, second, titles } = twoChangesOf("showing");
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    await openChange(first);
    await openChange(second);
    await openChange(first);
    await eventually(() => assert.strictEqual(activeTabLabel(), titles[0]));
    await closeChange(first);

    try {
      await eventually(() => {
        assert.strictEqual(activeTabLabel(), titles[1]);
        assert.deepStrictEqual(
          vscode.window.tabGroups.all.flatMap((g) =>
            g.tabs.map((t) => t.label)
          ),
          [titles[1]]
        );
      });
    } finally {
      await closeChange(second);
    }
  });

  it("moves through the Change in front's files with the review keys, without asking which Change", async () => {
    const { first, second } = twoChangesOf("keys");
    await openChange(first);
    const before = workspaceFolders();
    await openChange(second);
    const [, head] = foldersAddedSince(before).map((f) => f.path);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    try {
      await review("nextUnviewedFile");

      await eventually(() =>
        assert.strictEqual(
          activeDiff().modified.fsPath,
          path.join(head, "util.py")
        )
      );
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await closeChange(second);
      await closeChange(first);
    }
  });
});
