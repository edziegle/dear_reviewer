import * as assert from "assert";
import {
  baseChoices,
  headChoices,
  mainOf,
  parseRefs,
} from "../../src/commitRange";

const output = [
  "refs/heads/agent/fix-login\tFix the login redirect",
  "refs/remotes/origin/HEAD\t",
  "refs/tags/v1.2.0\tRelease 1.2.0",
  "refs/remotes/origin/main\tMerge pull request #7",
  "refs/heads/main\tMerge pull request #7",
  "refs/notes/commits\tNotes",
  "",
].join("\n");

const names = (refs: { name: string }[]) => refs.map((r) => r.name);

describe("commitRange", () => {
  it("reads branches, remote branches and tags, without a remote's HEAD or other refs", () => {
    assert.deepStrictEqual(parseRefs(output), [
      {
        name: "agent/fix-login",
        kind: "branch",
        subject: "Fix the login redirect",
      },
      { name: "v1.2.0", kind: "tag", subject: "Release 1.2.0" },
      { name: "origin/main", kind: "remote", subject: "Merge pull request #7" },
      { name: "main", kind: "branch", subject: "Merge pull request #7" },
    ]);
  });

  it("finds main, else master, among the branches", () => {
    assert.strictEqual(mainOf(parseRefs(output)), "main");
    assert.strictEqual(
      mainOf(parseRefs("refs/heads/master\tx\nrefs/remotes/origin/main\ty")),
      "master"
    );
    assert.strictEqual(mainOf(parseRefs("refs/heads/dev\tx")), undefined);
  });

  it("offers main first as the base, then branches, remote branches and tags", () => {
    assert.deepStrictEqual(names(baseChoices(parseRefs(output), "main")), [
      "main",
      "agent/fix-login",
      "origin/main",
      "v1.2.0",
    ]);
  });

  it("offers the checked-out branch first as the head", () => {
    assert.deepStrictEqual(
      names(headChoices(parseRefs(output), "agent/fix-login")),
      ["agent/fix-login", "main", "origin/main", "v1.2.0"]
    );
    assert.deepStrictEqual(
      names(headChoices(parseRefs(output), undefined)),
      ["agent/fix-login", "main", "origin/main", "v1.2.0"],
      "a detached HEAD puts nothing first"
    );
  });
});
