import * as assert from "assert";
import * as path from "path";
import { buildFixtureRepo } from "../fixtures";
import {
  closeChange,
  definitionOf,
  eventually,
  foldersAddedSince,
  openChange,
  usagesOf,
  workspaceFolders,
} from "../reviewer";

describe("Navigation in a Change (basedpyright)", () => {
  it("resolves go to definition inside the worktree of the side it starts from", async () => {
    const repo = buildFixtureRepo("navigation");
    const request = {
      repository: repo.path,
      base: repo.commits.initial,
      head: repo.commits.renamed,
    };
    const before = workspaceFolders();
    await openChange(request);
    const [base, head] = foldersAddedSince(before);

    // Line 3 of main.py is `print(old_helper())` on the base side and
    // `print(new_helper())` on the head side; column 8 is inside the name.
    const baseHits = await definitionOf(path.join(base.path, "main.py"), 2, 8);
    const headHits = await definitionOf(path.join(head.path, "main.py"), 2, 8);

    assert.deepStrictEqual(baseHits, [path.join(base.path, "util.py")]);
    assert.deepStrictEqual(headHits, [path.join(head.path, "util.py")]);

    await closeChange(request);
  });

  it("finds usages inside the worktree of the side it starts from", async () => {
    const repo = buildFixtureRepo("usages");
    const request = {
      repository: repo.path,
      base: repo.commits.initial,
      head: repo.commits.renamed,
    };
    const before = workspaceFolders();
    await openChange(request);
    const [base, head] = foldersAddedSince(before);

    // Line 1 of util.py defines old_helper on the base side and new_helper on
    // the head side; column 4 is inside the name. main.py uses both, and only
    // the head's added.py uses new_helper. The language server indexes the
    // other files in its own time.
    const inBase = (file: string) => path.join(base.path, file);
    const inHead = (file: string) => path.join(head.path, file);
    await eventually(async () => {
      assert.deepStrictEqual(await usagesOf(inBase("util.py"), 0, 4), [
        inBase("main.py"),
        inBase("util.py"),
      ]);
      assert.deepStrictEqual(await usagesOf(inHead("util.py"), 0, 4), [
        inHead("added.py"),
        inHead("main.py"),
        inHead("util.py"),
      ]);
    }, 90_000);

    await closeChange(request);
  });
});
