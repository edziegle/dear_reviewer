// The facts a Dependency update's overview shows (ADR 0051): what it moves,
// whether it touches anything but manifests and lock files, and who else
// committed to it. Dear Reviewer works them out from rules, so nothing
// written in the pull request can change what they say, and they stand
// beside the Assistant's Recommendation as something to check it against.
//
// They are read once per head commit and kept, since a Change's commits and
// files don't change under it.

import { changedFiles, type Change } from "./changeDetails";
import {
  dependencyUpdateFacts,
  type DependencyUpdateFacts,
} from "./dependencyUpdate";
import type { GitHubClient } from "./github/client";

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
  /** What it says about the changed files. */
  files: string;
  /** Such as "2 commits by alice"; empty when Dependabot made them all. */
  otherCommits: string[];
  /** Set when GitHub wouldn't say what its commits are, so the facts are thin. */
  problem?: boolean;
}

const updateTypeText: Record<string, string> = {
  patch: "patch",
  minor: "minor",
  major: "major",
  unknown: "update type unknown",
};

/** How the overview words a dependency's type. */
function dependencyTypeText(type?: {
  direct: boolean;
  scope?: string;
}): string | undefined {
  if (!type) return undefined;
  const direct = type.direct ? "direct" : "indirect";
  return type.scope ? `${direct}, ${type.scope}` : direct;
}

/** How the overview words what the Change changed. */
function filesText(facts: DependencyUpdateFacts): string {
  if (facts.onlyDependencyFiles)
    return "Only manifests and lock files changed.";
  const named = facts.otherFiles.slice(0, 5).map((file) => `\`${file}\``);
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
        versions: dependency.from
          ? `${dependency.from} → ${dependency.to}`
          : dependency.to,
        updateType: updateTypeText[dependency.updateType],
        ...(dependencyType && { dependencyType }),
      };
    }),
    updateType: updateTypeText[facts.updateType],
    files: filesText(facts),
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
   * The pull requests known to be Dependency updates, by repository and
   * number. The overview asks for the facts only once its timeline says
   * Dependabot opened the pull request, so being asked is what marks one,
   * and nothing here asks GitHub a second time to find out.
   */
  private readonly known = new Set<string>();

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
    const key = [
      pullRequest.repository,
      pullRequest.number,
      change.headSha,
    ].join("\0");
    const name = `${pullRequest.repository}#${pullRequest.number}`;
    if (!this.known.has(name)) {
      this.known.add(name);
      this.found();
    }
    const known = this.byHead.get(key);
    if (known) return known;
    const [commits, files] = await Promise.all([
      this.github
        .pullRequestCommits(pullRequest.repository, pullRequest.number)
        .catch(() => undefined),
      changedFiles(change).catch(() => []),
    ]);
    const shown = shownFacts(
      dependencyUpdateFacts({
        commits: commits ?? [],
        changedFiles: files.map((file) => file.path),
      }),
      commits === undefined
    );
    // Only a reading that reached GitHub is worth keeping.
    if (commits) this.byHead.set(key, shown);
    return shown;
  }

  /**
   * Whether the Change's pull request is a Dependency update, as far as the
   * overview has told us. False until its timeline has loaded, so the
   * palette offers the Recommendation a moment later than the overview does.
   */
  isDependencyUpdate(change: Change): boolean {
    const pullRequest = change.pullRequest;
    return (
      !!pullRequest &&
      this.known.has(`${pullRequest.repository}#${pullRequest.number}`)
    );
  }

  /**
   * The facts as the Recommendation's prompt carries them: Dear Reviewer's
   * own words, so the Assistant answers about what the Reviewer is reading
   * and can be held to them. None for a Change that is no Dependency update.
   */
  async facts(change: Change): Promise<readonly string[]> {
    const shown = await this.shown(change).catch(() => undefined);
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
      shown.files,
      ...shown.otherCommits.map((commits) => `${commits}, not Dependabot.`),
    ];
  }

  /** Forgets what was read for a Change that is over. */
  forget(change: Change): void {
    const pullRequest = change.pullRequest;
    if (!pullRequest) return;
    this.byHead.delete(
      [pullRequest.repository, pullRequest.number, change.headSha].join("\0")
    );
  }
}
