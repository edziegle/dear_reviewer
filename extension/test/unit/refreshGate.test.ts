import * as assert from "assert";
import {
  foundText,
  isCommitId,
  isSafeBranchName,
  minimumGapMs,
  RefreshGate,
} from "../../src/refreshGate";

describe("RefreshGate", () => {
  let now = 1_000_000;
  const gate = () => new RefreshGate(() => now);

  beforeEach(() => {
    now = 1_000_000;
  });

  it("lets the first check of a Change begin", () => {
    assert.ok(gate().begin("a", true));
  });

  it("refuses a check while another of the same Change runs", () => {
    const g = gate();
    assert.ok(g.begin("a", true));
    now += minimumGapMs * 2;
    assert.strictEqual(g.begin("a", true), undefined);
    assert.strictEqual(g.begin("a", false), undefined);
  });

  it("refuses an automatic check soon after the last, but not one the Reviewer asked for", () => {
    const g = gate();
    g.begin("a", true)!();
    now += minimumGapMs - 1;
    assert.strictEqual(g.begin("a", true), undefined);
    assert.ok(g.begin("a", false));
  });

  it("allows an automatic check once the gap has passed", () => {
    const g = gate();
    g.begin("a", true)!();
    now += minimumGapMs;
    assert.ok(g.begin("a", true));
  });

  it("keeps Changes apart", () => {
    const g = gate();
    assert.ok(g.begin("a", true));
    assert.ok(g.begin("b", true));
  });

  it("forgets a closed Change", () => {
    const g = gate();
    g.begin("a", true);
    g.forget("a");
    assert.ok(g.begin("a", true));
  });
});

describe("foundText", () => {
  it("says what arrived", () => {
    assert.strictEqual(
      foundText({ newCommits: 2, threads: 0 }),
      "2 new commits"
    );
    assert.strictEqual(
      foundText({ newCommits: 1, threads: 0 }),
      "1 new commit"
    );
    assert.strictEqual(
      foundText({ newCommits: 1, threads: 3 }),
      "1 new commit, 3 new threads"
    );
    assert.strictEqual(
      foundText({ newCommits: "some", threads: 1 }),
      "New commits, 1 new thread"
    );
  });

  it("says when nothing did", () => {
    assert.strictEqual(foundText({ newCommits: 0, threads: 0 }), "Up to date");
  });
});

describe("what GitHub gives that git is handed", () => {
  it("accepts commit ids only", () => {
    assert.ok(isCommitId("a".repeat(40)));
    assert.ok(!isCommitId("--upload-pack=x"));
    assert.ok(!isCommitId("abc"));
    assert.ok(!isCommitId(undefined));
  });

  it("accepts ordinary branch names only", () => {
    for (const ok of ["main", "release/1.2", "feat_x-1", "v1.0.x"])
      assert.ok(isSafeBranchName(ok), ok);
    for (const bad of [
      "-x",
      "a..b",
      "a b",
      "/x",
      "x/",
      "a//b",
      "x.lock",
      "a/.hidden",
      "a;b",
      "",
    ])
      assert.ok(!isSafeBranchName(bad), bad);
  });
});
