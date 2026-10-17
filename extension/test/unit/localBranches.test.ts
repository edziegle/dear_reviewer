import * as assert from "assert";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { branchesAhead, branchIsOver } from "../../src/localBranches";
import { remoteFor } from "../../src/remotes";

/**
 * A repository whose commits come from `git commit-tree` and `update-ref`,
 * which don't sign, so no signing key is needed to run the tests.
 */
class Clone {
  readonly path = fs.mkdtempSync(path.join(os.tmpdir(), "dr-branches-"));

  private readonly tree: string;

  constructor() {
    this.git("init", "-q", "-b", "main");
    // Writes the empty tree, which the commits point at.
    this.tree = cp
      .execFileSync("git", ["hash-object", "-t", "tree", "-w", "--stdin"], {
        cwd: this.path,
        input: "",
        encoding: "utf8",
      })
      .trim();
  }

  git(...args: string[]): string {
    return cp
      .execFileSync("git", args, { cwd: this.path, encoding: "utf8" })
      .trim();
  }

  /** Makes a commit on top of `parent`, at `time` seconds so branches sort. */
  commit(message: string, parent?: string, time = 1_700_000_000): string {
    return cp
      .execFileSync(
        "git",
        [
          "commit-tree",
          this.tree,
          ...(parent ? ["-p", parent] : []),
          "-m",
          message,
        ],
        {
          cwd: this.path,
          encoding: "utf8",
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: "Reviewer",
            GIT_AUTHOR_EMAIL: "reviewer@example.com",
            GIT_COMMITTER_NAME: "Reviewer",
            GIT_COMMITTER_EMAIL: "reviewer@example.com",
            GIT_AUTHOR_DATE: `${time} +0000`,
            GIT_COMMITTER_DATE: `${time} +0000`,
          },
        }
      )
      .trim();
  }

  branch(name: string, commit: string): void {
    this.git("update-ref", `refs/heads/${name}`, commit);
  }

  remove(): void {
    fs.rmSync(this.path, { recursive: true, force: true });
  }
}

describe("The local branches of a clone", () => {
  let clone: Clone;
  let main: string;

  beforeEach(() => {
    clone = new Clone();
    main = clone.commit("main", undefined, 1_700_000_000);
    clone.branch("main", main);
  });

  afterEach(() => clone.remove());

  it("are the ones ahead of main, newest first, with how many commits ahead", async () => {
    const one = clone.commit("one", main, 1_700_000_100);
    clone.branch("agent/one", one);
    const twoA = clone.commit("two a", main, 1_700_000_200);
    clone.branch("agent/two", clone.commit("two b", twoA, 1_700_000_300));
    clone.branch("at-main", main);

    const branches = await branchesAhead(clone.path, "acme/tools");

    assert.deepStrictEqual(
      branches.map(({ name, commitsAhead }) => ({ name, commitsAhead })),
      [
        { name: "agent/two", commitsAhead: 2 },
        { name: "agent/one", commitsAhead: 1 },
      ]
    );
    assert.strictEqual(branches[1].headSha, one);
    assert.strictEqual(branches[1].main, "refs/heads/main");
  });

  it("leave out a branch behind main, which has nothing of its own", async () => {
    const next = clone.commit("next", main, 1_700_000_100);
    clone.branch("stale", main);
    clone.branch("main", next);

    assert.deepStrictEqual(await branchesAhead(clone.path, "acme/tools"), []);
  });

  it("find main from the remote's default branch when there is one", async () => {
    clone.git("remote", "add", "origin", "https://github.com/acme/tools.git");
    const remoteMain = clone.commit("remote main", main, 1_700_000_100);
    clone.git("update-ref", "refs/remotes/origin/main", remoteMain);
    clone.git(
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/main"
    );
    clone.branch("agent/work", clone.commit("work", remoteMain, 1_700_000_200));
    // Local main lags behind the remote's, so it isn't the base.
    const [branch] = await branchesAhead(clone.path, "acme/tools");

    assert.strictEqual(branch.main, "refs/remotes/origin/main");
    assert.strictEqual(branch.commitsAhead, 1);
  });

  it("fail for a clone that isn't there", async () => {
    await assert.rejects(
      branchesAhead(path.join(clone.path, "gone"), "acme/tools"),
      /doesn't exist/
    );
  });

  it("fail for a clone with no main or master", async () => {
    clone.git("update-ref", "-d", "refs/heads/main");

    await assert.rejects(
      branchesAhead(clone.path, "acme/tools"),
      /can't find the main branch/
    );
  });

  it("find master when there is no main", async () => {
    clone.git("update-ref", "-d", "refs/heads/main");
    clone.branch("master", main);
    clone.branch("feature", clone.commit("work", main, 1_700_000_100));

    const [branch] = await branchesAhead(clone.path, "acme/local");

    assert.deepStrictEqual(
      [branch.name, branch.main],
      ["feature", "refs/heads/master"]
    );
  });
});

describe("Whether a local branch is over", () => {
  let clone: Clone;
  let main: string;

  beforeEach(() => {
    clone = new Clone();
    main = clone.commit("main", undefined);
    clone.branch("main", main);
  });

  afterEach(() => clone.remove());

  it("is not while it has commits main lacks", async () => {
    clone.branch("agent/work", clone.commit("work", main, 1_700_000_100));

    assert.strictEqual(await branchIsOver(clone.path, "agent/work"), false);
  });

  it("is once main has all its commits", async () => {
    const work = clone.commit("work", main, 1_700_000_100);
    clone.branch("agent/work", work);
    clone.branch("main", work);

    assert.strictEqual(await branchIsOver(clone.path, "agent/work"), true);
  });

  it("is once the branch is deleted", async () => {
    assert.strictEqual(await branchIsOver(clone.path, "agent/gone"), true);
  });

  it("is never for main itself", async () => {
    assert.strictEqual(await branchIsOver(clone.path, "main"), false);
  });

  it("fails when the clone is gone, rather than say the branch is over", async () => {
    await assert.rejects(
      branchIsOver(path.join(clone.path, "gone"), "agent/work"),
      /doesn't exist/
    );
  });
});

describe("The remote of a clone that names a repository", () => {
  let clone: Clone;

  beforeEach(() => {
    clone = new Clone();
  });

  afterEach(() => clone.remove());

  it("is the one whose URL ends with the repository, whatever the case or form", async () => {
    clone.git("remote", "add", "origin", "https://github.com/me/fork.git");
    clone.git("remote", "add", "upstream", "git@github.com:Acme/Tools.git");

    assert.strictEqual(await remoteFor(clone.path, "acme/tools"), "upstream");
  });

  it("is origin when none names it", async () => {
    clone.git("remote", "add", "origin", "https://example.com/elsewhere.git");

    assert.strictEqual(await remoteFor(clone.path, "acme/tools"), "origin");
  });

  it("fails when none names it and there is no origin", async () => {
    clone.git("remote", "add", "other", "https://example.com/elsewhere.git");

    await assert.rejects(remoteFor(clone.path, "acme/tools"), /has no origin/);
  });
});
