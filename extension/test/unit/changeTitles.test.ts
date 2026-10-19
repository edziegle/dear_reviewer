import * as assert from "assert";
import { changeHeading, changeSource } from "../../src/changeDetails";
import { ChangeTitles } from "../../src/changeTitles";
import type { Change } from "../../src/openChanges";

function changeOf(more: Partial<Change> = {}): Change {
  return {
    id: "abc",
    repository: "/work/api",
    mergeBase: "f8e077e1234",
    headSha: "00bb3291234",
    baseDir: "/changes/abc/base",
    headDir: "/changes/abc/head",
    conversation: "acme/api#7",
    pullRequest: { repository: "acme/api", number: 7 },
    ...more,
  };
}

describe("The titles of the open Changes", () => {
  it("know none until a pull request loads", () => {
    assert.strictEqual(new ChangeTitles().of(changeOf()), undefined);
  });

  it("give a pull request's title by its conversation, so a newer head keeps it", () => {
    const titles = new ChangeTitles();
    titles.set(changeOf(), "Restructure pkg");
    assert.strictEqual(
      titles.of(changeOf({ id: "newer", headSha: "99aa" })),
      "Restructure pkg"
    );
    assert.strictEqual(
      titles.of(changeOf({ conversation: "acme/api#8" })),
      undefined
    );
  });

  it("tell the listeners when a title is learned or changes, and not when it is the same", () => {
    const titles = new ChangeTitles();
    let told = 0;
    titles.onDidChange(() => told++);
    titles.set(changeOf(), "Restructure pkg");
    titles.set(changeOf(), "Restructure pkg");
    titles.set(changeOf(), "Restructure the package");
    assert.strictEqual(told, 2);
  });

  it("ignore an empty title", () => {
    const titles = new ChangeTitles();
    titles.set(changeOf(), "   ");
    assert.strictEqual(titles.of(changeOf()), undefined);
  });

  it("stop telling a listener that stopped", () => {
    const titles = new ChangeTitles();
    let told = 0;
    const stop = titles.onDidChange(() => told++);
    stop();
    titles.set(changeOf(), "Restructure pkg");
    assert.strictEqual(told, 0);
  });
});

describe("A Change's heading and source", () => {
  it("is the pull request's title once loaded, and its name until then", () => {
    assert.strictEqual(changeHeading(changeOf()), "acme/api #7");
    assert.strictEqual(
      changeHeading(changeOf(), "Restructure pkg"),
      "Restructure pkg"
    );
  });

  it("is a local Change's branch, or else its commits, with no title", () => {
    const local = changeOf({
      pullRequest: undefined,
      conversation: "commits:/work/api:f8e077e1234..00bb3291234",
    });
    assert.match(changeHeading(local), /api f8e077e\.\.00bb329/);
  });

  it("names where the Change comes from, with its commits", () => {
    assert.strictEqual(
      changeSource(changeOf()),
      "acme/api #7 · f8e077e..00bb329"
    );
  });
});
