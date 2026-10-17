// Finds the local branches of a clone that are ahead of its main branch, such
// as an agent's branch, for the Inbox (see ADR 0006).

import * as fs from "fs";
import { git } from "./git";
import { remoteFor } from "./remotes";

export interface LocalBranch {
  /** The branch's short name, such as `agent/fix-login`. */
  name: string;
  /** The ref the Change starts from: main, as the clone knows it. */
  main: string;
  commitsAhead: number;
  /** The commit the branch points at. */
  headSha: string;
}

/** The clone's branches with commits that main doesn't have, newest first. */
export async function branchesAhead(
  clone: string,
  repository: string
): Promise<LocalBranch[]> {
  if (!fs.existsSync(clone)) throw new Error(`${clone} doesn't exist`);
  const main = await mainBranch(clone, repository);
  const mainName = shortName(main);
  const refs = await git(
    clone,
    "for-each-ref",
    "--sort=refname",
    "--sort=-committerdate",
    "--format=%(refname) %(objectname)",
    "refs/heads"
  );
  const branches: LocalBranch[] = [];
  for (const line of refs.split("\n").filter(Boolean)) {
    const [ref, headSha] = line.split(" ");
    const name = ref.slice("refs/heads/".length);
    if (name === mainName) continue;
    const commitsAhead = Number(
      await git(clone, "rev-list", "--count", `${main}..${ref}`)
    );
    if (commitsAhead > 0) branches.push({ name, main, commitsAhead, headSha });
  }
  return branches;
}

/**
 * Whether the clone's local branch is over: deleted, or with all its commits
 * on main, as `branchesAhead` finds main for the GitHub repository, if the
 * clone has one. Main itself never is. Fails when git can't tell, such as
 * when the clone is gone.
 */
export async function branchIsOver(
  clone: string,
  branch: string,
  repository?: string
): Promise<boolean> {
  if (!fs.existsSync(clone)) throw new Error(`${clone} doesn't exist`);
  const ref = `refs/heads/${branch}`;
  const exists = await git(clone, "rev-parse", "-q", "--verify", ref).then(
    () => true,
    () => false
  );
  if (!exists) return true;
  const main = await mainBranch(clone, repository);
  if (branch === shortName(main)) return false;
  // Exits 0 when the branch is an ancestor of main, 1 when it isn't.
  return git(clone, "merge-base", "--is-ancestor", ref, main).then(
    () => true,
    () => false
  );
}

/**
 * The clone's main branch: the default branch of the remote for the
 * repository, as `refs/remotes/<remote>/HEAD` names it, or else that remote's
 * main or master, or else the local main or master.
 */
async function mainBranch(clone: string, repository?: string): Promise<string> {
  const remote =
    repository && (await remoteFor(clone, repository).catch(() => undefined));
  if (remote) {
    const head = await git(
      clone,
      "symbolic-ref",
      "-q",
      `refs/remotes/${remote}/HEAD`
    ).catch(() => "");
    if (head) return head;
  }
  const candidates = [
    ...(remote
      ? [`refs/remotes/${remote}/main`, `refs/remotes/${remote}/master`]
      : []),
    "refs/heads/main",
    "refs/heads/master",
  ];
  for (const ref of candidates) {
    const exists = await git(clone, "rev-parse", "-q", "--verify", ref).then(
      () => true,
      () => false
    );
    if (exists) return ref;
  }
  throw new Error(`can't find the main branch of ${clone}`);
}

/** A branch's name without its `refs/heads/` or `refs/remotes/<remote>/`. */
function shortName(ref: string): string {
  return ref.replace(/^refs\/(remotes\/[^/]+|heads)\//, "");
}
