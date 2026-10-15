import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { buildFixtureRepo } from "../fixtures";
import { threadsFileOf } from "../review";
import {
  closeChange,
  eventually,
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
    const [, head] = opened;
    // The Change's Comments are written for its Assistant to read.
    await eventually(() =>
      assert.ok(fs.existsSync(threadsFileOf(head.path)), "the threads file")
    );

    await closeChange(request);

    assert.deepStrictEqual(workspaceFolders(), before);
    assert.deepStrictEqual(
      worktreesOf(repo.path).map((w) => w.path),
      [repo.path]
    );
    for (const folder of opened) {
      assert.ok(!fs.existsSync(folder.path), `${folder.path} was deleted`);
    }
    const assistantDir = path.dirname(threadsFileOf(head.path));
    assert.ok(!fs.existsSync(assistantDir), `${assistantDir} was deleted`);
  });
});
