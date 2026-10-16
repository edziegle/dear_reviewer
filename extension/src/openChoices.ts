// What Open Pull Request or Branch… offers: the pull requests and branches
// the Dashboard lists, each once, under the Dashboard's own headings. Kept
// apart from `vscode` so the unit tests can run it under plain Node.

/** The parts of an Inbox node this reads. */
export type Listed =
  | { kind: "group"; label: string; children: Listed[] }
  | {
      kind: "pullRequest";
      pullRequest: {
        repository: string;
        number: number;
        title: string;
        author: { login: string };
      };
    }
  | {
      kind: "localBranch";
      branch: { name: string; repository: string; commitsAhead: number };
    }
  | { kind: "problem" };

export interface OpenChoice<T extends Listed> {
  /** The heading it sits under: the Inbox group's name. */
  group: string;
  /** `acme/api #482`, or the branch's name. */
  label: string;
  /** Who wrote it, or what it adds. */
  description: string;
  /** The pull request's title, or the branch's repository. */
  detail: string;
  node: T;
}

/**
 * The choices in the order the Inbox lists them. A pull request in more than
 * one group, such as one awaiting review that the Reviewer also wrote, shows
 * under the first.
 */
export function openChoices<T extends Listed>(
  groups: readonly T[]
): OpenChoice<T>[] {
  const seen = new Set<string>();
  const choices: OpenChoice<T>[] = [];
  for (const group of groups) {
    if (group.kind !== "group") continue;
    for (const node of group.children as T[]) {
      if (node.kind === "pullRequest") {
        const pr = node.pullRequest;
        const key = `${pr.repository.toLowerCase()}#${pr.number}`;
        if (seen.has(key)) continue;
        seen.add(key);
        choices.push({
          group: group.label,
          label: `${pr.repository} #${pr.number}`,
          description: pr.author.login,
          detail: pr.title,
          node,
        });
      } else if (node.kind === "localBranch") {
        const { branch } = node;
        const key = `${branch.repository.toLowerCase()}:${branch.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        choices.push({
          group: group.label,
          label: branch.name,
          description:
            branch.commitsAhead === 1
              ? "1 commit ahead"
              : `${branch.commitsAhead} commits ahead`,
          detail: branch.repository,
          node,
        });
      }
    }
  }
  return choices;
}
