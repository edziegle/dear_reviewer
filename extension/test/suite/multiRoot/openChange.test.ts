import * as assert from "assert";
import * as path from "path";
import { changeFiles, render } from "../changeFiles";
import { buildFixtureRepo } from "../fixtures";
import {
  closeChange,
  foldersAddedSince,
  gitIn,
  openChange,
  short,
  workspaceFolders,
  worktreesOf,
} from "../reviewer";

describe("Open Change on a local Change", () => {
  it("adds detached base (merge base) and head worktrees as workspace folders", async () => {
    const repo = buildFixtureRepo("open");
    const name = path.basename(repo.path);
    const request = {
      repository: repo.path,
      base: repo.commits.sideline,
      head: repo.commits.renamed,
    };
    const before = workspaceFolders();

    await openChange(request);

    const [base, head] = foldersAddedSince(before);
    assert.deepStrictEqual(
      [base?.name, head?.name],
      [
        `${name} base ${short(repo.commits.initial)}`,
        `${name} head ${short(repo.commits.renamed)}`,
      ]
    );
    assert.strictEqual(
      gitIn(base.path, "rev-parse", "HEAD"),
      repo.commits.initial
    );
    assert.strictEqual(
      gitIn(head.path, "rev-parse", "HEAD"),
      repo.commits.renamed
    );
    const worktrees = worktreesOf(repo.path);
    for (const folder of [base, head]) {
      assert.deepStrictEqual(
        worktrees.find((w) => w.path === folder.path),
        { path: folder.path, detached: true },
        `${folder.path} is a detached worktree of the repository`
      );
      assert.ok(
        folder.path.includes(
          path.join("globalStorage", "edziegle.dear-reviewer")
        ),
        `${folder.path} is in the extension's storage`
      );
    }

    await closeChange(request);
  });

  it("refuses a Change with nothing in it, and leaves nothing behind", async () => {
    const repo = buildFixtureRepo("empty");
    const before = workspaceFolders();

    await openChange({ repository: repo.path, base: "main", head: "main" });

    assert.deepStrictEqual(workspaceFolders(), before);
    assert.deepStrictEqual(
      worktreesOf(repo.path).map((w) => w.path),
      [repo.path]
    );
    const name = path.basename(repo.path);
    assert.deepStrictEqual(
      render(await changeFiles()).filter((line) => line.includes(name)),
      [],
      "no Change is left open"
    );
  });
});
