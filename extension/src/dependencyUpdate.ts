// Dependency updates (ADR 0051): what Dear Reviewer itself can say about a
// Dependabot pull request, worked out from rules with no Assistant, so that
// nothing written in the pull request can change it.
//
// The metadata comes only from commits that `dependabot[bot]` authored and
// GitHub verified. Anyone who can push to the branch can write a commit
// message, so an unverified commit claiming
// `update-type: version-update:semver-patch` is never read; it would
// otherwise make a major update look harmless.
//
// This module must not import `vscode`, so the Node unit tests can load it.

import { isLockFile } from "./skimOnly";

/** The login GitHub gives Dependabot. Nobody else can open a pull request as it. */
export const DEPENDABOT_LOGIN = "dependabot[bot]";

/** How far a version moved, where Dear Reviewer can tell. */
export type UpdateType = "patch" | "minor" | "major" | "unknown";

/** Whether a dependency is depended on directly, and what for. */
export interface DependencyType {
  direct: boolean;
  /** What it is used for; absent when Dependabot doesn't say. */
  scope?: "production" | "development";
}

/** One dependency a Dependency update moves, as its commits describe it. */
export interface UpdatedDependency {
  name: string;
  /** The version it moves to. */
  to: string;
  /** The version it moves from; absent when no commit says. */
  from?: string;
  updateType: UpdateType;
  /** Absent when Dependabot doesn't say. */
  dependencyType?: DependencyType;
  /** The group it was updated in, for a grouped update. */
  group?: string;
}

/** A commit of a pull request, with what decides whether its message is read. */
export interface DependabotCommit {
  message: string;
  /** The author's login, as GitHub gives it. */
  author: string;
  /** Whether GitHub verified its signature. */
  verified: boolean;
}

/** Commits of a Dependency update that Dependabot didn't author. */
export interface CommitsByOther {
  author: string;
  commits: number;
}

/** What Dear Reviewer says about a Dependency update without asking anything. */
export interface DependencyUpdateFacts {
  /** Every dependency the verified Dependabot commits name, in the order found. */
  dependencies: UpdatedDependency[];
  /** The largest update type among them: what the pull request as a whole does. */
  updateType: UpdateType;
  /** Whether every changed file is a manifest or a lock file. */
  onlyDependencyFiles: boolean;
  /** The changed files that are neither, which need reading. */
  otherFiles: string[];
  /** Who else committed to the branch, and how often. */
  otherCommits: CommitsByOther[];
}

/** Each ecosystem's manifest, by file name, in any folder. */
const manifestNames: ReadonlySet<string> = new Set([
  "package.json",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "requirements.txt",
  "Pipfile",
  "Gemfile",
  "composer.json",
  "pubspec.yaml",
  "mix.exs",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Podfile",
  "flake.nix",
]);

/**
 * Whether the file is one a dependency update is expected to touch: a lock
 * file, an ecosystem's manifest, or a workflow, which a GitHub Actions
 * update edits.
 */
export function isDependencyFile(filePath: string): boolean {
  if (isLockFile(filePath)) return true;
  if (manifestNames.has(filePath.slice(filePath.lastIndexOf("/") + 1)))
    return true;
  return /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(filePath);
}

const updateTypeRank: Record<UpdateType, number> = {
  unknown: 0,
  patch: 1,
  minor: 2,
  major: 3,
};

/**
 * The largest of the update types: a group's own type. An unknown ranks
 * below the types Dear Reviewer can read, so it only wins when nothing else
 * is known.
 */
export function largestUpdateType(types: readonly UpdateType[]): UpdateType {
  return types.reduce<UpdateType>(
    (largest, type) =>
      updateTypeRank[type] > updateTypeRank[largest] ? type : largest,
    "unknown"
  );
}

const unquote = (value: string) => value.replace(/^["']|["']$/g, "").trim();

/**
 * The entries of the message's `updated-dependencies:` YAML block, each as
 * its fields. The block runs to the `...` that closes Dependabot's document,
 * and its entries start with `- `.
 */
function blockEntries(message: string): Map<string, string>[] {
  const lines = message.split("\n");
  const start = lines.findIndex((line) =>
    /^updated-dependencies:\s*$/.test(line)
  );
  if (start < 0) return [];
  const entries: Map<string, string>[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^(\.\.\.|---)\s*$/.test(line)) break;
    const first = /^-\s+([\w-]+):\s*(.*)$/.exec(line);
    if (first) {
      entries.push(new Map([[first[1], unquote(first[2])]]));
      continue;
    }
    const field = /^\s+([\w-]+):\s*(.*)$/.exec(line);
    if (field && entries.length) {
      entries[entries.length - 1].set(field[1], unquote(field[2]));
      continue;
    }
    if (line.trim() !== "") break;
  }
  return entries;
}

/**
 * The versions each `Bumps <name> from A to B` or `Updates \`<name>\` from A
 * to B` line gives, by dependency name. The block names only the version a
 * dependency moves to, so the one it moves from comes from here.
 */
function versionsByName(message: string): Map<string, [string, string]> {
  const versions = new Map<string, [string, string]>();
  for (const line of message.split("\n")) {
    const match =
      /^(?:Bumps|Updates)\s+(?:\[([^\]]+)\]\([^)]*\)|`([^`]+)`|"([^"]+)"|(\S+))\s+from\s+(\S+?)\s+to\s+(\S+?)[.,]?\s*$/.exec(
        line.trim()
      );
    if (!match) continue;
    const name = match[1] ?? match[2] ?? match[3] ?? match[4];
    versions.set(name.toLowerCase(), [match[5], match[6]]);
  }
  return versions;
}

/** The parts of a version Dear Reviewer can compare, or none for anything else. */
function versionParts(version: string): [number, number, number] | undefined {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/.exec(
    version.trim()
  );
  return match
    ? [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)]
    : undefined;
}

/** The update type the versions themselves show: the first part that differs. */
function updateTypeOfVersions(from?: string, to?: string): UpdateType {
  if (!from || !to) return "unknown";
  const before = versionParts(from);
  const after = versionParts(to);
  if (!before || !after) return "unknown";
  if (before[0] !== after[0]) return "major";
  if (before[1] !== after[1]) return "minor";
  if (before[2] !== after[2]) return "patch";
  return "unknown";
}

function dependencyTypeOf(raw?: string): DependencyType | undefined {
  if (!raw) return undefined;
  const [kind, scope] = raw.split(":");
  if (kind !== "direct" && kind !== "indirect") return undefined;
  return {
    direct: kind === "direct",
    ...(scope === "production" || scope === "development" ? { scope } : {}),
  };
}

/**
 * The dependencies one commit message describes. Call it only for a commit
 * Dependabot authored and GitHub verified; it reads the message as given.
 */
export function updatedDependenciesIn(message: string): UpdatedDependency[] {
  const versions = versionsByName(message);
  const dependencies: UpdatedDependency[] = [];
  for (const entry of blockEntries(message)) {
    const name = entry.get("dependency-name");
    if (!name) continue;
    const said = versions.get(name.toLowerCase());
    const from = said?.[0];
    const to = entry.get("dependency-version") ?? said?.[1];
    if (!to) continue;
    const declared = /^version-update:semver-(patch|minor|major)$/.exec(
      entry.get("update-type") ?? ""
    );
    const dependencyType = dependencyTypeOf(entry.get("dependency-type"));
    const group = entry.get("dependency-group");
    dependencies.push({
      name,
      ...(from ? { from } : {}),
      to,
      updateType: declared
        ? (declared[1] as UpdateType)
        : updateTypeOfVersions(from, to),
      ...(dependencyType ? { dependencyType } : {}),
      ...(group ? { group } : {}),
    });
  }
  return dependencies;
}

/**
 * What the pull request's commits and changed files say, reading metadata
 * only from the commits Dependabot authored and GitHub verified.
 */
export function dependencyUpdateFacts(input: {
  commits: readonly DependabotCommit[];
  changedFiles: readonly string[];
}): DependencyUpdateFacts {
  const found = new Map<string, UpdatedDependency>();
  const byOther = new Map<string, number>();
  for (const commit of input.commits) {
    if (commit.author !== DEPENDABOT_LOGIN) {
      byOther.set(commit.author, (byOther.get(commit.author) ?? 0) + 1);
      continue;
    }
    if (!commit.verified) continue;
    // A later commit describes the same dependency afresh, as after a rebase.
    for (const dependency of updatedDependenciesIn(commit.message))
      found.set(dependency.name.toLowerCase(), dependency);
  }
  const dependencies = [...found.values()];
  const otherFiles = input.changedFiles.filter(
    (file) => !isDependencyFile(file)
  );
  return {
    dependencies,
    updateType: largestUpdateType(dependencies.map((d) => d.updateType)),
    onlyDependencyFiles: otherFiles.length === 0,
    otherFiles,
    otherCommits: [...byOther].map(([author, commits]) => ({
      author,
      commits,
    })),
  };
}
