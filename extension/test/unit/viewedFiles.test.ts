import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { Change } from "../../src/openChanges";
import { LocalViewedFiles } from "../../src/viewedFiles";

function changeOf(id: string, conversation: string): Change {
  return {
    id,
    repository: "/repo",
    mergeBase: "base",
    headSha: id,
    baseDir: `/changes/${id}/base`,
    headDir: `/changes/${id}/head`,
    conversation,
  };
}

describe("A local Change's viewed files", () => {
  let dir: string;
  let viewedFiles: LocalViewedFiles;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "viewed-files-"));
    viewedFiles = new LocalViewedFiles(dir);
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("are kept by its branch, so they outlive the Change's stopping", async () => {
    const change = changeOf("abc", "branch:/repo:feature");
    await viewedFiles.setViewed(change, ["a.py", "b.py"], true);

    await viewedFiles.forget();

    const reopened = changeOf("xyz", "branch:/repo:feature");
    assert.deepStrictEqual(
      [...(await viewedFiles.viewed(reopened))],
      ["a.py", "b.py"]
    );
  });

  it("are not shared with another branch", async () => {
    await viewedFiles.setViewed(changeOf("abc", "one"), ["a.py"], true);
    assert.deepStrictEqual(
      [...(await viewedFiles.viewed(changeOf("xyz", "two")))],
      []
    );
  });

  it("go once the branch is over", async () => {
    await viewedFiles.setViewed(changeOf("abc", "one"), ["a.py"], true);
    viewedFiles.forgetConversation("one");
    assert.deepStrictEqual(
      [...(await viewedFiles.viewed(changeOf("abc", "one")))],
      []
    );
  });
});
