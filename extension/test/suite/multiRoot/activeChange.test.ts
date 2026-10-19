import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  shownDiff,
  changeFiles,
  entryAt,
  markViewed,
  render,
  review,
  viewedFilesKey,
} from "../changeFiles";
import { buildFixtureRepo } from "../fixtures";
import { comment, commentThreads } from "../review";
import {
  activeTabLabel,
  closeChange,
  eventually,
  foldersAddedSince,
  gitIn,
  openChange,
  short,
  shownChanges,
  workspaceFolders,
  worktreesOf,
} from "../reviewer";

// The review window holds one Change, the Active Change (ADR 0040). This
// window stands in for it.
describe("The Active Change", () => {
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
    return { repo, first, second, titles: [titleOf(first), titleOf(second)] };
  }

  const listed = async () =>
    (await changeFiles()).map(
      (entry) => `${entry.label} — ${entry.description}`
    );

  it("stops the Change before it when another opens: its worktrees and folders go", async () => {
    const { repo, first, second } = twoChangesOf("stops");
    const before = workspaceFolders();

    await openChange(first);
    const firstFolders = foldersAddedSince(before);
    await openChange(second);

    try {
      const secondFolders = foldersAddedSince(before);
      assert.strictEqual(firstFolders.length, 2);
      assert.strictEqual(secondFolders.length, 2);
      assert.ok(
        secondFolders.every(
          (folder) => !firstFolders.some((old) => old.path === folder.path)
        ),
        "the first Change's folders are gone"
      );
      assert.strictEqual(
        gitIn(secondFolders[1].path, "rev-parse", "HEAD"),
        repo.commits.documented
      );
      assert.deepStrictEqual(
        worktreesOf(repo.path).map((w) => w.path),
        [repo.path, ...secondFolders.map((f) => f.path)]
      );
      assert.match(
        fs.readFileSync(path.join(secondFolders[1].path, "util.py"), "utf8"),
        /"""Two."""/
      );
    } finally {
      await closeChange(second);
    }
    assert.deepStrictEqual(workspaceFolders(), before);
  });

  it("is the only Change Change Files lists", async () => {
    const { first, second, titles } = twoChangesOf("front");

    await openChange(first);
    await openChange(second);

    try {
      await eventually(async () =>
        assert.deepStrictEqual(render(await changeFiles()), [
          `${titles[1]} — □□□□□□□ 0/1`,
          "  util.py [M]",
        ])
      );
    } finally {
      await closeChange(second);
    }
  });

  it("is picked up again with the files the Reviewer viewed, when its Change opens again", async () => {
    const { first, second, titles } = twoChangesOf("again");

    await openChange(first);
    await markViewed(entryAt(await changeFiles(), titles[0], "util.py"));
    await openChange(second);

    try {
      await eventually(async () =>
        assert.deepStrictEqual(await listed(), [`${titles[1]} — □□□□□□□ 0/1`])
      );
      assert.deepStrictEqual(await viewedFilesKey(), []);

      await openChange(first);

      await eventually(async () =>
        assert.deepStrictEqual(await listed(), [`${titles[0]} — ■■□□□□□ 1/4`])
      );
      assert.strictEqual(
        entryAt(await changeFiles(), titles[0], "util.py").viewed,
        true
      );
      assert.strictEqual((await viewedFilesKey()).length, 2);
    } finally {
      await closeChange(first);
    }
  });

  it("keeps the pending Comments of the Change it stops, and shows them when that Change opens again", async () => {
    const { first, second } = twoChangesOf("comments");
    const before = workspaceFolders();
    await openChange(first);
    const [, head] = foldersAddedSince(before).map((f) => f.path);
    const file = path.join(head, "util.py");
    await comment(file, 0, 0, "Is the new name clearer?");
    const pending = [
      {
        file,
        lines: [0, 0],
        comments: ["Is the new name clearer?"],
        editable: [true],
      },
    ];

    await openChange(second);

    try {
      assert.deepStrictEqual(await commentThreads(), []);

      await openChange(first);

      await eventually(async () =>
        assert.deepStrictEqual(await commentThreads(), pending)
      );
    } finally {
      await closeChange(first);
    }
  });

  it("leaves none once the Active Change closes", async () => {
    const { first, second, titles } = twoChangesOf("closing");

    await openChange(first);
    await openChange(second);
    await eventually(async () =>
      assert.deepStrictEqual(await listed(), [`${titles[1]} — □□□□□□□ 0/1`])
    );

    await closeChange(second);

    await eventually(async () =>
      assert.deepStrictEqual(await changeFiles(), [])
    );
  });

  it("shows only the overview of the Change that opened last", async () => {
    const { first, second, titles } = twoChangesOf("showing");
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    await openChange(first);
    await openChange(second);

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

  it("moves through its files with the review keys, without asking which Change", async () => {
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
          shownDiff().modified.fsPath,
          path.join(head, "util.py")
        )
      );
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await closeChange(second);
    }
  });

  it("is replaced by a newer head of its branch, with only that head shown", async () => {
    const repo = buildFixtureRepo("newerHead");
    repo.git("branch", "feature", repo.commits.documented);
    const feature = {
      repository: repo.path,
      base: repo.commits.renamed,
      head: "refs/heads/feature",
    };
    await openChange(feature);
    const shownBefore = (await shownChanges()).length;
    repo.git("branch", "-f", "feature", repo.commits.restructured);

    await openChange(feature);

    try {
      await eventually(async () =>
        assert.deepStrictEqual((await shownChanges()).slice(shownBefore), [
          "feature",
        ])
      );
      await eventually(async () =>
        assert.strictEqual(
          (await changeFiles()).length > 0 &&
            worktreesOf(repo.path).length === 3,
          true
        )
      );
    } finally {
      await closeChange(feature);
    }
  });
});
