import * as assert from "assert";
import { unviewedAfter } from "../../src/stepping";

const files = ["a.ts", "yarn.lock", "b.ts", "c.ts"].map((path) => ({ path }));
const skimOnly = new Set(["yarn.lock"]);

function step(
  over: Partial<Parameters<typeof unviewedAfter>[0]> & { from?: string }
): string | undefined {
  return unviewedAfter({
    files,
    viewed: new Set(),
    skimOnly,
    from: undefined,
    direction: 1,
    visitSkimOnly: false,
    ...over,
  })?.path;
}

describe("Next and Previous Unviewed File", () => {
  it("move to the next file not viewed, round the end, and from no file to the first or last", () => {
    assert.strictEqual(step({}), "a.ts");
    assert.strictEqual(step({ direction: -1 }), "c.ts");
    assert.strictEqual(step({ from: "b.ts" }), "c.ts");
    assert.strictEqual(step({ from: "c.ts" }), "a.ts");
    assert.strictEqual(step({ from: "a.ts", direction: -1 }), "c.ts");
    assert.strictEqual(
      step({ from: "b.ts", viewed: new Set(["c.ts", "a.ts", "yarn.lock"]) }),
      undefined
    );
  });

  it("skip skim-only files", () => {
    assert.strictEqual(step({ from: "a.ts" }), "b.ts");
    assert.strictEqual(step({ from: "b.ts", direction: -1 }), "a.ts");
  });

  it("visit skim-only files when the Reviewer's setting says to", () => {
    assert.strictEqual(
      step({ from: "a.ts", visitSkimOnly: true }),
      "yarn.lock"
    );
    assert.strictEqual(
      step({ from: "b.ts", direction: -1, visitSkimOnly: true }),
      "yarn.lock"
    );
  });

  it("visit skim-only files when only they are left unviewed", () => {
    const viewed = new Set(["a.ts", "b.ts", "c.ts"]);
    assert.strictEqual(step({ from: "c.ts", viewed }), "yarn.lock");
    assert.strictEqual(step({ viewed, direction: -1 }), "yarn.lock");
  });

  it("find nothing when every file is viewed, or the one file is the one shown", () => {
    assert.strictEqual(
      step({ viewed: new Set(files.map((f) => f.path)) }),
      undefined
    );
    assert.strictEqual(
      unviewedAfter({
        files: [{ path: "only.lock" }],
        viewed: new Set(),
        skimOnly: new Set(["only.lock"]),
        from: "only.lock",
        direction: 1,
        visitSkimOnly: false,
      }),
      undefined
    );
  });
});
