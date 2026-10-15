import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { changeFiles, render } from "../changeFiles";
import { buildFixtureRepo } from "../fixtures";
import {
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
});
