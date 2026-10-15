// What a Change's conversation is named after, and the folder its `claude`
// runs in, against a real repository under plain Node (ADR 0009).

import * as assert from "assert";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { conversationFolder, conversationOf } from "../../src/conversationName";

describe("A Change's conversation", () => {
  const dir = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "dr-conversation-")
  );
  const git = (...args: string[]) =>
    cp.execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "reviewer@example.com");
  git("config", "user.name", "Reviewer");
  git("commit", "-q", "--allow-empty", "-m", "first");
  const first = git("rev-parse", "HEAD");
  git("commit", "-q", "--allow-empty", "-m", "second");
  const second = git("rev-parse", "HEAD");
  git("branch", "x", second);
  git("tag", "v1", second);
  const range = { mergeBase: first, headSha: second };
  const rangeOf = async () => range;

  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("is a pull request's, whatever its commits, without asking git", async () => {
    const name = await conversationOf(
      dir,
      { head: second, pullRequest: { repository: "Acme/API", number: 31 } },
      () => assert.fail("a pull request needs no range")
    );

    assert.strictEqual(name, "pull request acme/api#31");
  });

  it("is the branch's when the request names a branch", async () => {
    assert.strictEqual(
      await conversationOf(dir, { head: "refs/heads/x" }, rangeOf),
      `branch x in ${dir}`
    );
  });

  it("is the checked-out branch's when the request names HEAD", async () => {
    assert.strictEqual(
      await conversationOf(dir, { head: "HEAD" }, rangeOf),
      `branch main in ${dir}`
    );
  });

  it("is the commit range's when the request names a commit or a tag", async () => {
    for (const head of [second, "v1"])
      assert.strictEqual(
        await conversationOf(dir, { head }, rangeOf),
        `range ${first}..${second} in ${dir}`,
        head
      );
  });

  it("runs claude in a folder of its own, named the same each time", () => {
    const folder = conversationFolder("branch x in /repo");

    assert.match(folder, /^[0-9a-f]{16}$/);
    assert.strictEqual(conversationFolder("branch x in /repo"), folder);
    assert.notStrictEqual(conversationFolder("branch y in /repo"), folder);
  });
});
