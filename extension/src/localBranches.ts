// Finds the local branches of a clone that are ahead of its main branch, such
// as an agent's branch, for the Inbox (see ADR 0006).

import * as fs from "fs";
import { remoteFor } from "./changeWorkspace";
import { git } from "./git";

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
  const mainName = main.replace(/^refs\/(remotes\/[^/]+|heads)\//, "");
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
 * The clone's main branch: the default branch of the remote for the
 * repository, as `refs/remotes/<remote>/HEAD` names it, or else that remote's
 * main or master, or else the local main or master.
 */
async function mainBranch(clone: string, repository: string): Promise<string> {
  const remote = await remoteFor(clone, repository).catch(() => undefined);
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
