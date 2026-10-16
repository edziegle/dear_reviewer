import * as assert from "assert";
import { checksInOrder } from "../../src/checkRuns";

describe("A commit's checks in the overview", () => {
  const runs = [
    { name: "test", status: "passed" as const },
    { name: "lint", status: "failed" as const },
    { name: "deploy", status: "running" as const },
    { name: "docs", status: "skipped" as const },
    { name: "e2e", status: "failed" as const },
    { name: "legacy", status: "passed" as const },
  ];

  it("lists failed checks first, then running, then the rest, each in GitHub's order", () => {
    assert.deepStrictEqual(
      checksInOrder(runs).runs.map((run) => run.name),
      ["lint", "e2e", "deploy", "test", "legacy", "docs"]
    );
  });

  it("counts the checks that need the Reviewer, which lead the list", () => {
    assert.strictEqual(checksInOrder(runs).attention, 3);
  });

  it("sums them up, what needs the Reviewer first", () => {
    assert.strictEqual(
      checksInOrder(runs).summary,
      "2 failed · 1 running · 2 passed · 1 skipped"
    );
    assert.strictEqual(
      checksInOrder([{ status: "passed" as const }]).summary,
      "1 passed"
    );
  });

  it("has nothing to say of no checks", () => {
    assert.deepStrictEqual(checksInOrder([]), {
      runs: [],
      attention: 0,
      summary: "",
    });
  });
});
