// Builds real git repositories for the tests, all on a single branch.

import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";

export interface FixtureRepo {
  path: string;
  git(...args: string[]): string;
  commits: {
    /** util.py with old_helper, main.py calling it, obsolete.py, and pkg/core.py and pkg/legacy.py. */
    initial: string;
    /** Renames old_helper to new_helper, deletes obsolete.py, adds added.py. */
    renamed: string;
    /** Changes util.py again so later Changes can be told apart. */
    documented: string;
    /** Changes pkg/core.py, deletes pkg/legacy.py and adds pkg/sub/new.py. */
    restructured: string;
    /** A commit off `initial` that is not on main, to make the merge base matter. */
    sideline: string;
  };
}

let counter = 0;

export function buildFixtureRepo(name: string): FixtureRepo {
  const root = process.env.DEAR_REVIEWER_FIXTURES;
  if (!root) throw new Error("DEAR_REVIEWER_FIXTURES is not set");
  const repo = path.join(root, `${name}-${process.pid}-${counter++}`);
  fs.rmSync(repo, { recursive: true, force: true });
  fs.mkdirSync(repo, { recursive: true });

  const git = (...args: string[]) =>
    cp.execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  const write = (file: string, text: string) =>
    fs.writeFileSync(path.join(repo, file), text);
  const commit = (message: string) => {
    git("add", "-A");
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };

  git("init", "-q", "-b", "main");
  git("config", "user.email", "reviewer@example.com");
  git("config", "user.name", "Reviewer");

  write("util.py", "def old_helper():\n    return 1\n");
  write("main.py", "from util import old_helper\n\nprint(old_helper())\n");
  write("obsolete.py", "UNUSED = True\n");
  fs.mkdirSync(path.join(repo, "pkg"));
  write("pkg/core.py", "CORE = 1\n");
  write("pkg/legacy.py", "LEGACY = True\n");
  const initial = commit("initial");

  write("util.py", "def new_helper():\n    return 2\n");
  write("main.py", "from util import new_helper\n\nprint(new_helper())\n");
  fs.rmSync(path.join(repo, "obsolete.py"));
  write("added.py", "from util import new_helper\n\nVALUE = new_helper()\n");
  const renamed = commit("rename helper");

  write("util.py", 'def new_helper():\n    """Two."""\n    return 2\n');
  const documented = commit("document helper");

  write("pkg/core.py", "CORE = 2\n");
  fs.rmSync(path.join(repo, "pkg", "legacy.py"));
  fs.mkdirSync(path.join(repo, "pkg", "sub"));
  write("pkg/sub/new.py", "NEW = True\n");
  const restructured = commit("restructure pkg");

  const tree = git("rev-parse", `${initial}^{tree}`);
  const sideline = git("commit-tree", tree, "-p", initial, "-m", "sideline");

  return {
    path: repo,
    git,
    commits: { initial, renamed, documented, restructured, sideline },
  };
}

export interface PullRequestFixture {
  /** The Reviewer's local clone, which doesn't have the pull request's commits. */
  clone: string;
  /** owner/name */
  repository: string;
  number: number;
  /** The base branch on GitHub, ahead of what the clone last fetched. */
  base: string;
  /** The pull request's head, only on GitHub as refs/pull/<number>/head. */
  head: string;
}

/**
 * A bare repository standing in for the GitHub repository `owner/name`, with
 * refs/pull/<number>/head pushed to it, and a local clone that last fetched
 * before the pull request and the latest main were pushed. The clone's
 * `origin` is the Reviewer's fork, which has neither; `upstream` is the
 * GitHub repository.
 */
export function buildPullRequestFixture(
  name: string,
  repository: string,
  number: number
): PullRequestFixture {
  const repo = buildFixtureRepo(name);
  const remotes = path.join(repo.path, "..", `${path.basename(repo.path)}-remotes`);
  const upstream = path.join(remotes, ...`${repository}.git`.split("/"));
  const fork = path.join(remotes, "reviewer", `${repository.split("/")[1]}.git`);
  const clone = `${repo.path}-clone`;
  const run = (cwd: string, ...args: string[]) =>
    cp.execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  fs.rmSync(remotes, { recursive: true, force: true });
  fs.rmSync(clone, { recursive: true, force: true });
  // The bare repositories fetch commits from the fixture repo, which leaves
  // them as a push would.
  const publish = (bare: string, commit: string, ref: string) =>
    run(bare, "fetch", "-q", repo.path, `+${commit}:${ref}`);
  for (const bare of [upstream, fork]) {
    fs.mkdirSync(bare, { recursive: true });
    run(bare, "init", "-q", "--bare", "-b", "main");
    publish(bare, repo.commits.initial, "refs/heads/main");
  }
  fs.mkdirSync(clone);
  run(clone, "init", "-q", "-b", "main");
  run(clone, "remote", "add", "origin", fork);
  run(clone, "remote", "add", "upstream", upstream);
  run(clone, "fetch", "-q", "--all");

  // On GitHub, main moves on and the pull request is opened on top of it.
  const tree = repo.git("rev-parse", `${repo.commits.restructured}^{tree}`);
  const head = repo.git(
    "commit-tree",
    tree,
    "-p",
    repo.commits.renamed,
    "-m",
    "restructure on top of the rename"
  );
  publish(upstream, repo.commits.renamed, "refs/heads/main");
  publish(upstream, head, `refs/pull/${number}/head`);

  return {
    clone,
    repository,
    number,
    base: repo.commits.renamed,
    head,
  };
}
