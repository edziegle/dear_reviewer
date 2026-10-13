import * as assert from "assert";
import * as fs from "fs";
import { buildFixtureRepo } from "../fixtures";
import {
  closeChange,
  foldersAddedSince,
  openChange,
  workspaceFolders,
  worktreesOf,
} from "../reviewer";

describe("Close Change", () => {
  it("removes that Change's worktrees and workspace folders", async () => {
    const repo = buildFixtureRepo("close");
    const request = {
      repository: repo.path,
      base: repo.commits.initial,
      head: repo.commits.renamed,
    };
    const before = workspaceFolders();
    await openChange(request);
    const opened = foldersAddedSince(before);

    await closeChange(request);

    assert.deepStrictEqual(workspaceFolders(), before);
    assert.deepStrictEqual(
      worktreesOf(repo.path).map((w) => w.path),
      [repo.path]
    );
    for (const folder of opened) {
      assert.ok(!fs.existsSync(folder.path), `${folder.path} was deleted`);
    }
  });
});
