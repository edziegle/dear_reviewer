import * as assert from "assert";
import { shownFacts } from "../../src/dependencyUpdates";
import type { DependencyUpdateFacts } from "../../src/dependencyUpdate";

const facts = (
  more: Partial<DependencyUpdateFacts> = {}
): DependencyUpdateFacts => ({
  dependencies: [],
  updateType: "unknown",
  onlyDependencyFiles: true,
  otherFiles: [],
  otherCommits: [],
  ...more,
});

// How the overview words the facts. The wording is what the Reviewer reads
// against the Assistant's Recommendation, so it says plainly what is known
// and what isn't.
describe("shownFacts", () => {
  it("gives a dependency its versions, its update type and what it is depended on for", () => {
    assert.deepStrictEqual(
      shownFacts(
        facts({
          dependencies: [
            {
              name: "fast-uri",
              from: "3.1.8",
              to: "3.1.9",
              updateType: "patch",
              dependencyType: { direct: false },
            },
            {
              name: "left-pad",
              to: "2.0.0",
              updateType: "major",
              dependencyType: { direct: true, scope: "development" },
            },
          ],
          updateType: "major",
        })
      ).dependencies,
      [
        {
          name: "fast-uri",
          versions: "3.1.8 → 3.1.9",
          updateType: "patch",
          dependencyType: "indirect",
        },
        {
          name: "left-pad",
          versions: "2.0.0",
          updateType: "major",
          dependencyType: "direct, development",
        },
      ]
    );
  });

  it("says an update type it couldn't read is unknown, rather than guessing", () => {
    assert.strictEqual(
      shownFacts(facts({ updateType: "unknown" })).updateType,
      "update type unknown"
    );
    assert.strictEqual(
      shownFacts(facts({ updateType: "minor" })).updateType,
      "minor"
    );
  });

  it("says when only manifests and lock files changed", () => {
    assert.strictEqual(
      shownFacts(facts({ onlyDependencyFiles: true })).files,
      "Only manifests and lock files changed."
    );
  });

  it("names the other files, and counts the rest past the first five", () => {
    assert.strictEqual(
      shownFacts(
        facts({
          onlyDependencyFiles: false,
          otherFiles: ["src/uri.ts", "src/parse.ts"],
        })
      ).files,
      "Also changes `src/uri.ts`, `src/parse.ts`."
    );
    assert.strictEqual(
      shownFacts(
        facts({
          onlyDependencyFiles: false,
          otherFiles: ["a", "b", "c", "d", "e", "f", "g"],
        })
      ).files,
      "Also changes `a`, `b`, `c`, `d`, `e`, and 2 more."
    );
  });

  it("counts the commits anyone else made, in the singular and the plural", () => {
    assert.deepStrictEqual(
      shownFacts(
        facts({
          otherCommits: [
            { author: "alice", commits: 2 },
            { author: "bob", commits: 1 },
          ],
        })
      ).otherCommits,
      ["2 commits by alice", "1 commit by bob"]
    );
    assert.deepStrictEqual(shownFacts(facts()).otherCommits, []);
  });

  it("marks the facts as thin when GitHub wouldn't say what the commits are", () => {
    assert.strictEqual(shownFacts(facts(), true).problem, true);
    assert.ok(!("problem" in shownFacts(facts())));
  });
});
