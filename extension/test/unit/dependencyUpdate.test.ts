import * as assert from "assert";
import {
  byDependabot,
  dependencyUpdateFacts,
  largestUpdateType,
  updatedDependenciesIn,
  type DependabotCommit,
} from "../../src/dependencyUpdate";

// The commit messages here are real ones from this repository's history, so
// the parser is held to the format Dependabot actually writes rather than to
// a tidied-up version of it.

/** #218: an indirect update, whose block gives no update type. */
const fastUri = `chore(deps-dev): bump fast-uri from 3.1.8 to 3.1.9 (#218)

Bumps [fast-uri](https://github.com/fastify/fast-uri) from 3.1.8 to 3.1.9.
- [Release notes](https://github.com/fastify/fast-uri/releases)
- [Commits](https://github.com/fastify/fast-uri/compare/v3.1.8...v3.1.9)

---
updated-dependencies:
- dependency-name: fast-uri
  dependency-version: 3.1.9
  dependency-type: indirect
...

Signed-off-by: dependabot[bot] <support@github.com>`;

/** #176: a group of two, each with an update type and a quoted scoped name. */
const commitlintGroup = `chore(deps-dev): bump the npm-root group with 2 updates (#176)

Bumps the npm-root group with 2 updates: [@commitlint/cli](https://github.com/conventional-changelog/commitlint/tree/HEAD/@commitlint/cli) and [@commitlint/config-conventional](https://github.com/conventional-changelog/commitlint/tree/HEAD/@commitlint/config-conventional).


Updates \`@commitlint/cli\` from 21.2.3 to 21.2.4
- [Release notes](https://github.com/conventional-changelog/commitlint/releases)

Updates \`@commitlint/config-conventional\` from 21.2.3 to 21.2.4
- [Commits](https://github.com/conventional-changelog/commitlint/commits/v21.2.4)

---
updated-dependencies:
- dependency-name: "@commitlint/cli"
  dependency-version: 21.2.4
  dependency-type: direct:development
  update-type: version-update:semver-patch
  dependency-group: npm-root
- dependency-name: "@commitlint/config-conventional"
  dependency-version: 21.2.4
  dependency-type: direct:development
  update-type: version-update:semver-patch
  dependency-group: npm-root
...

Signed-off-by: dependabot[bot] <support@github.com>`;

/** #177: a GitHub Actions update, direct and for production. */
const miseAction = `chore(deps): bump jdx/mise-action (#177)

Bumps the github-actions group with 1 update: [jdx/mise-action](https://github.com/jdx/mise-action).


Updates \`jdx/mise-action\` from 5.2.0 to 5.2.1

---
updated-dependencies:
- dependency-name: jdx/mise-action
  dependency-version: 5.2.1
  dependency-type: direct:production
  update-type: version-update:semver-patch
  dependency-group: github-actions
...`;

const commit = (
  message: string,
  more: Partial<DependabotCommit> = {}
): DependabotCommit => ({
  message,
  author: "dependabot[bot]",
  verified: true,
  ...more,
});

// GitHub answers two different logins for Dependabot, which is what made
// the first cut of this recognise no real pull request at all: a `Bot`
// login, which a pull request's author is, leaves the `[bot]` suffix off.
// Checked against this repository's own Dependabot pull requests.
describe("byDependabot", () => {
  const opened = (author: { login: string; bot?: boolean }) =>
    byDependabot({ author });

  it("recognises the Bot login GraphQL gives a pull request's author", () => {
    assert.strictEqual(opened({ login: "dependabot", bot: true }), true);
  });

  it("recognises the login with the suffix, which REST and github.com show", () => {
    assert.strictEqual(opened({ login: "dependabot[bot]", bot: true }), true);
  });

  it("recognises no person's account, whichever of those logins it goes by", () => {
    assert.strictEqual(opened({ login: "dependabot" }), false);
    assert.strictEqual(opened({ login: "dependabot[bot]" }), false);
    assert.strictEqual(opened({ login: "dependabot", bot: false }), false);
  });

  it("recognises no other bot, such as Renovate, which stays an ordinary pull request", () => {
    assert.strictEqual(opened({ login: "renovate", bot: true }), false);
    assert.strictEqual(opened({ login: "renovate[bot]", bot: true }), false);
  });
});

describe("updatedDependenciesIn", () => {
  it("reads a dependency's name, versions and types from the block and the Bumps line", () => {
    assert.deepStrictEqual(updatedDependenciesIn(fastUri), [
      {
        name: "fast-uri",
        from: "3.1.8",
        to: "3.1.9",
        updateType: "patch",
        dependencyType: { direct: false },
      },
    ]);
  });

  it("reads every dependency of a grouped update, with the versions each Updates line gives", () => {
    assert.deepStrictEqual(updatedDependenciesIn(commitlintGroup), [
      {
        name: "@commitlint/cli",
        from: "21.2.3",
        to: "21.2.4",
        updateType: "patch",
        dependencyType: { direct: true, scope: "development" },
        group: "npm-root",
      },
      {
        name: "@commitlint/config-conventional",
        from: "21.2.3",
        to: "21.2.4",
        updateType: "patch",
        dependencyType: { direct: true, scope: "development" },
        group: "npm-root",
      },
    ]);
  });

  it("keeps a direct production dependency's type, as a GitHub Actions update has", () => {
    assert.deepStrictEqual(updatedDependenciesIn(miseAction), [
      {
        name: "jdx/mise-action",
        from: "5.2.0",
        to: "5.2.1",
        updateType: "patch",
        dependencyType: { direct: true, scope: "production" },
        group: "github-actions",
      },
    ]);
  });

  it("takes the update type from the block when it gives one, over the versions", () => {
    const message = `Bumps [left-pad](https://example.com) from 1.0.0 to 2.0.0.

---
updated-dependencies:
- dependency-name: left-pad
  dependency-version: 2.0.0
  dependency-type: direct:production
  update-type: version-update:semver-minor
...`;

    assert.strictEqual(updatedDependenciesIn(message)[0].updateType, "minor");
  });

  it("derives the update type from the versions, by the first part that differs", () => {
    const bump = (from: string, to: string) =>
      updatedDependenciesIn(`Bumps [pkg](https://example.com) from ${from} to ${to}.

---
updated-dependencies:
- dependency-name: pkg
  dependency-version: ${to}
  dependency-type: indirect
...`)[0].updateType;

    assert.strictEqual(bump("1.2.3", "1.2.4"), "patch");
    assert.strictEqual(bump("1.2.3", "1.3.0"), "minor");
    assert.strictEqual(bump("1.2.3", "2.0.0"), "major");
    assert.strictEqual(bump("v1.2.3", "v2.0.0"), "major", "a leading v");
    assert.strictEqual(bump("1.2.3", "1.2.3"), "unknown", "no change");
  });

  it("says unknown when neither the block nor a versions line gives a type", () => {
    const message = `Bumps pkg to a newer release.

---
updated-dependencies:
- dependency-name: pkg
  dependency-version: 2026.1
  dependency-type: indirect
...`;

    assert.deepStrictEqual(updatedDependenciesIn(message), [
      {
        name: "pkg",
        to: "2026.1",
        updateType: "unknown",
        dependencyType: { direct: false },
      },
    ]);
  });

  it("gives none for a message with no updated-dependencies block", () => {
    assert.deepStrictEqual(
      updatedDependenciesIn("fix: a change a person wrote\n\nNo block here."),
      []
    );
  });

  it("gives none for a block that names no dependency", () => {
    assert.deepStrictEqual(
      updatedDependenciesIn(
        "Bumps things.\n\n---\nupdated-dependencies:\n...\n"
      ),
      []
    );
  });
});

describe("largestUpdateType", () => {
  it("takes the largest of the types given", () => {
    assert.strictEqual(largestUpdateType(["patch", "minor"]), "minor");
    assert.strictEqual(largestUpdateType(["minor", "major", "patch"]), "major");
    assert.strictEqual(largestUpdateType(["patch", "patch"]), "patch");
  });

  it("ignores an unknown beside a type it knows, and is unknown with no type at all", () => {
    assert.strictEqual(largestUpdateType(["unknown", "patch"]), "patch");
    assert.strictEqual(largestUpdateType(["unknown", "unknown"]), "unknown");
    assert.strictEqual(largestUpdateType([]), "unknown");
  });
});

describe("dependencyUpdateFacts", () => {
  const changedFiles = ["package.json", "package-lock.json"];

  it("combines the dependencies of every verified Dependabot commit", () => {
    const facts = dependencyUpdateFacts({
      commits: [commit(fastUri), commit(miseAction)],
      changedFiles,
    });

    assert.deepStrictEqual(
      facts.dependencies.map((d) => d.name),
      ["fast-uri", "jdx/mise-action"]
    );
    assert.strictEqual(facts.updateType, "patch");
  });

  it("reads no metadata from a commit someone else authored, whatever its message says", () => {
    const facts = dependencyUpdateFacts({
      commits: [
        commit(fastUri, { author: "alice", verified: true }),
        commit(miseAction),
      ],
      changedFiles,
    });

    assert.deepStrictEqual(
      facts.dependencies.map((d) => d.name),
      ["jdx/mise-action"]
    );
  });

  it("reads no metadata from an unverified commit, which anyone who can push could write", () => {
    const facts = dependencyUpdateFacts({
      commits: [commit(fastUri, { verified: false })],
      changedFiles,
    });

    assert.deepStrictEqual(facts.dependencies, []);
    assert.strictEqual(facts.updateType, "unknown");
  });

  it("lists the commits anyone other than Dependabot authored, with their authors", () => {
    const facts = dependencyUpdateFacts({
      commits: [
        commit(fastUri),
        commit("fix: tweak the test", { author: "alice" }),
        commit("fix: tweak it again", { author: "alice", verified: false }),
        commit("chore: regenerate", { author: "bob" }),
      ],
      changedFiles,
    });

    assert.deepStrictEqual(facts.otherCommits, [
      { author: "alice", commits: 2 },
      { author: "bob", commits: 1 },
    ]);
  });

  it("says only manifests and lock files changed for a manifest and its lock file", () => {
    const facts = dependencyUpdateFacts({
      commits: [commit(fastUri)],
      changedFiles: ["extension/package.json", "extension/package-lock.json"],
    });

    assert.strictEqual(facts.onlyDependencyFiles, true);
    assert.deepStrictEqual(facts.otherFiles, []);
  });

  it("names the files that are neither a manifest nor a lock file", () => {
    const facts = dependencyUpdateFacts({
      commits: [commit(fastUri)],
      changedFiles: ["package.json", "package-lock.json", "src/uri.ts"],
    });

    assert.strictEqual(facts.onlyDependencyFiles, false);
    assert.deepStrictEqual(facts.otherFiles, ["src/uri.ts"]);
  });

  it("counts each ecosystem's manifest, and a workflow for an Actions update, as a dependency file", () => {
    const facts = dependencyUpdateFacts({
      commits: [commit(miseAction)],
      changedFiles: [
        "Cargo.toml",
        "Cargo.lock",
        "go.mod",
        "go.sum",
        "pyproject.toml",
        "Gemfile",
        "Gemfile.lock",
        ".github/workflows/ci.yml",
      ],
    });

    assert.deepStrictEqual(facts.otherFiles, []);
    assert.strictEqual(facts.onlyDependencyFiles, true);
  });
});
