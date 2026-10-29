// The facts a Dependency update's overview shows (ADR 0051): what it moves,
// whether it touches anything but manifests and lock files, and who else
// committed to it. Dear Reviewer works them out from rules, so nothing
// written in the pull request can change what they say, and they stand
// beside the Assistant's Recommendation as something to check it against.
//
// They are read once per head commit and kept, since a Change's commits and
// files don't change under it.

import type { Change } from "./changeDetails";
import {
  dependencyUpdateFacts,
  type DependencyUpdateFacts,
  type DependencyType,
  type UpdateType,
} from "./dependencyUpdate";
import { gitOutput } from "./git";
import type { GitHubClient } from "./github/client";

/** How many heads' facts are kept, so a long session doesn't grow without end. */
const keptHeads = 20;

/** A pull request as the facts are keyed by it. */
const nameOf = (pullRequest: { repository: string; number: number }) =>
  `${pullRequest.repository}#${pullRequest.number}`;

/**
 * Every file any commit of the Change touched, not only the ones the whole
 * Change still changes (ADR 0051 counts them "over every commit"): a file
 * edited in one commit and put back in another is worth naming, and the
 * net diff doesn't show it. None where git won't say.
 */
async function filesTouched(change: Change): Promise<string[] | undefined> {
  // `-z` and `core.quotepath=false` so a path with a space or a character
  // outside ASCII arrives whole, as the rest of the repository reads paths.
  // `--diff-merges=first-parent` so a merge's own edits, such as a conflict
  // resolved by hand, are listed rather than passed over.
  const output = await gitOutput(
    change.repository,
    "-c",
    "core.quotepath=false",
    "--literal-pathspecs",
    "log",
    "--format=",
    "--name-only",
    "--no-renames",
    "--diff-merges=first-parent",
    "-z",
    `${change.mergeBase}..${change.headSha}`
  ).catch(() => undefined);
  // None, rather than an empty list: git saying nothing mustn't read as
  // nothing but manifests having changed.
  if (output === undefined) return undefined;
  return [...new Set(output.split("\0").filter(Boolean))].sort();
}

/** A Dependency update's facts, as the overview shows them. */
export interface ShownDependencyUpdate {
  /** Each dependency, as a line of its own: name, versions and types. */
  dependencies: {
    name: string;
    /** Such as "3.1.8 → 3.1.9", or just the new version where the old is unknown. */
    versions: string;
    /** "patch", "minor", "major", or "update type unknown". */
    updateType: string;
    /** Such as "direct, development"; absent where Dependabot doesn't say. */
    dependencyType?: string;
  }[];
  /** The pull request's own update type, the largest of theirs. */
  updateType: string;
  /** What it says about the changed files, for the overview to set as text. */
  files: string;
  /** The same, with each path fenced, for a prompt (ADR 0042, rule 1). */
  filesQuoted: string;
  /** Such as "2 commits by alice"; empty when Dependabot made them all. */
  otherCommits: string[];
  /** Set when GitHub wouldn't say what its commits are, so the facts are thin. */
  problem?: boolean;
}

const updateTypeText: Record<UpdateType, string> = {
  patch: "patch",
  minor: "minor",
  major: "major",
  unknown: "update type unknown",
};

/** How the overview words a dependency's type. */
function dependencyTypeText(type?: DependencyType): string | undefined {
  if (!type) return undefined;
  const direct = type.direct ? "direct" : "indirect";
  return type.scope ? `${direct}, ${type.scope}` : direct;
}

/**
 * How what the Change changed is worded. The overview sets it as text, so it
 * carries no backticks (DESIGN.md); the prompt takes the same sentence with
 * the paths fenced, where a path is other people's text.
 */
function filesText(facts: DependencyUpdateFacts, quoted = false): string {
  if (facts.onlyDependencyFiles)
    return "Only manifests and lock files changed.";
  const named = facts.otherFiles
    .slice(0, 5)
    .map((file) => (quoted ? `\`${file}\`` : file));
  const rest = facts.otherFiles.length - named.length;
  return `Also changes ${named.join(", ")}${rest > 0 ? `, and ${rest} more` : ""}.`;
}

/** The facts, worded for the overview. */
export function shownFacts(
  facts: DependencyUpdateFacts,
  problem = false
): ShownDependencyUpdate {
  return {
    dependencies: facts.dependencies.map((dependency) => {
      const dependencyType = dependencyTypeText(dependency.dependencyType);
      return {
        name: dependency.name,
        // What is known of where it moved; "version unknown" where no
        // verified commit says, rather than an empty line.
        versions:
          dependency.from && dependency.to
            ? `${dependency.from} → ${dependency.to}`
            : (dependency.to ?? dependency.from ?? "version unknown"),
        updateType: updateTypeText[dependency.updateType],
        ...(dependencyType && { dependencyType }),
      };
    }),
    updateType: updateTypeText[facts.updateType],
    files: filesText(facts),
    filesQuoted: filesText(facts, true),
    otherCommits: facts.otherCommits.map(
      ({ author, commits }) =>
        `${commits} commit${commits === 1 ? "" : "s"} by ${author}`
    ),
    ...(problem && { problem: true }),
  };
}

/**
 * The facts of the Dependency updates open as Changes, read from GitHub once
 * per head commit.
 */
export class DependencyUpdates {
  /** By repository, number and head commit, so new commits are read again. */
  private readonly byHead = new Map<string, ShownDependencyUpdate>();
  /**
   * The pull requests the overview has found Dependabot opened, by
   * repository and number. `shown` is only called once a Change's timeline
   * says so, so asking for the facts is what records it, and nothing here
   * asks GitHub a second time to find out.
   */
  private readonly dependabotOpened = new Set<string>();

  constructor(
    private readonly github: GitHubClient,
    /**
     * Called the first time a pull request turns out to be a Dependency
     * update, so the palette offers the Recommendation without waiting for
     * the next thing to refresh the Change in front.
     */
    private readonly found: () => void = () => {}
  ) {}

  /**
   * The facts of a Change whose pull request Dependabot opened, which the
   * timeline says; undefined for any other Change.
   */
  async shown(change: Change): Promise<ShownDependencyUpdate | undefined> {
    const pullRequest = change.pullRequest;
    if (!pullRequest) return undefined;
    // The overview only asks once its timeline says Dependabot opened the
    // pull request, so asking is what records it. Reading the facts on their
    // own, as the Recommendation's prompt does, records nothing.
    const name = nameOf(pullRequest);
    if (!this.dependabotOpened.has(name)) {
      this.dependabotOpened.add(name);
      this.found();
    }
    return this.read(change);
  }

  /** The facts, from what was read for this head or by reading it now. */
  private async read(
    change: Change
  ): Promise<ShownDependencyUpdate | undefined> {
    const pullRequest = change.pullRequest;
    if (!pullRequest) return undefined;
    const key = `${nameOf(pullRequest)}\0${change.headSha}`;
    const known = this.byHead.get(key);
    if (known) return known;
    const [commits, files] = await Promise.all([
      this.github
        .pullRequestCommits(pullRequest.repository, pullRequest.number)
        .catch(() => undefined),
      filesTouched(change),
    ]);
    const shown = shownFacts(
      dependencyUpdateFacts({
        commits: commits ?? [],
        changedFiles: files ?? [],
      }),
      // Either reading falling short leaves the facts thin, and the overview
      // says so rather than vouching for what it couldn't read.
      commits === undefined || files === undefined
    );
    // Only a reading that reached both is worth keeping.
    if (commits && files) this.remember(key, shown);
    return shown;
  }

  /**
   * Keeps the facts for this head, and lets go of the oldest once there are
   * more than a window's worth, as the Repeated edits do.
   */
  private remember(key: string, shown: ShownDependencyUpdate): void {
    this.byHead.set(key, shown);
    for (const oldest of [...this.byHead.keys()].slice(0, -keptHeads))
      this.byHead.delete(oldest);
  }

  /**
   * Whether Dependabot opened the Change's pull request, as far as the
   * overview has found. False until its timeline has loaded, so the palette
   * offers the Recommendation a moment later than the overview does.
   */
  openedByDependabot(change: Change): boolean {
    const pullRequest = change.pullRequest;
    return !!pullRequest && this.dependabotOpened.has(nameOf(pullRequest));
  }

  /**
   * The facts as the Recommendation's prompt carries them: Dear Reviewer's
   * own words, so the Assistant answers about what the Reviewer is reading
   * and can be held to them. None for a Change that is no Dependency update.
   */
  async facts(change: Change): Promise<readonly string[]> {
    const shown = await this.read(change).catch(() => undefined);
    if (!shown) return [];
    return [
      ...shown.dependencies.map((dependency) =>
        [
          `${dependency.name} ${dependency.versions}`,
          dependency.updateType,
          ...(dependency.dependencyType ? [dependency.dependencyType] : []),
        ].join(", ")
      ),
      ...(shown.dependencies.length === 0
        ? ["No verified commit of Dependabot's says what this updates."]
        : [`The update as a whole: ${shown.updateType}.`]),
      shown.filesQuoted,
      ...shown.otherCommits.map((commits) => `${commits}, not Dependabot.`),
    ];
  }

  /** Forgets what was read for a Change that is over. */
  forget(change: Change): void {
    const pullRequest = change.pullRequest;
    if (!pullRequest) return;
    this.byHead.delete(`${nameOf(pullRequest)}\0${change.headSha}`);
  }
}
