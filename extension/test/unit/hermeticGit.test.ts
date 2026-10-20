// Unit tests run git without the machine's config (see hermeticGit.ts), so a
// developer's signing options can't fail a test that builds a repository.

import * as assert from "assert";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("The git a unit test starts", () => {
  const dir = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "dr-hermetic-git-")
  );
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("reads no global or system config", () => {
    const scopes = cp
      .execFileSync("git", ["config", "--list", "--show-scope"], {
        cwd: dir,
        encoding: "utf8",
      })
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("\t")[0]);
    assert.deepStrictEqual(scopes, []);
  });

  it("makes a lightweight tag and an unsigned commit with no config of the machine's", () => {
    const git = (...args: string[]) =>
      cp.execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
    git("init", "-q", "-b", "main");
    git("config", "user.email", "reviewer@example.com");
    git("config", "user.name", "Reviewer");
    git("commit", "-q", "--allow-empty", "-m", "first");
    git("tag", "v1");
    assert.strictEqual(git("tag", "--list"), "v1");
  });
});
