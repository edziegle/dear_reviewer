import * as assert from "assert";
import * as path from "path";
import { buildFixtureRepo } from "../fixtures";
import {
  closeChange,
  definitionOf,
  foldersAddedSince,
  openChange,
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
});
