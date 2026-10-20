// The Reading Order's core step, and where skim-only files go (ADR 0022,
// ADR 0045), under plain Node.

import * as assert from "assert";
import type { Change } from "../../src/changeDetails";
import {
  maxCoreFiles,
  parseReadingOrder,
  stepsAt,
  type ReadingOrder,
} from "../../src/readingOrder";
import type { SkimReason } from "../../src/skimOnly";

const reply = (steps: unknown) => JSON.stringify({ steps });
const step = (label: string, ...paths: string[]) => ({
  label,
  files: paths.map((path) => ({ path })),
});

const files = [
  "a.ts",
  "b.ts",
  "c.ts",
  "d.ts",
  "e.ts",
  "f.ts",
  "g.ts",
  "yarn.lock",
];
const skimOnly = new Set(["yarn.lock"]);

const names = (
  steps: { label: string; files: { path: string }[] }[] | undefined
) => steps?.map((s) => [s.label, s.files.map((f) => f.path)]);

describe("The core of the change", () => {
  it("is the first step, marked as the core", () => {
    const steps = parseReadingOrder(
      reply([step("The API", "a.ts", "b.ts"), step("The rest", "c.ts")]),
      files
    );
    assert.deepStrictEqual(
      steps?.map((s) => [s.label, s.core]),
      [
        ["The API", true],
        ["The rest", undefined],
        ["Other files", undefined],
      ]
    );
  });

  it("keeps at most five files, and the rest follow in a step of their own with the same label", () => {
    const steps = parseReadingOrder(
      reply([
        step(
          "The core",
          "a.ts",
          "b.ts",
          "c.ts",
          "d.ts",
          "e.ts",
          "f.ts",
          "g.ts"
        ),
        step("Plumbing", "yarn.lock"),
      ]),
      files,
      undefined,
      skimOnly
    );
    assert.strictEqual(maxCoreFiles, 5);
    assert.deepStrictEqual(names(steps), [
      ["The core", ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"]],
      ["The core", ["f.ts", "g.ts"]],
    ]);
    assert.deepStrictEqual(
      steps?.map((s) => s.core),
      [true, undefined]
    );
  });

  it("starts with the summary's start file, even from a later step, and still holds five", () => {
    const steps = parseReadingOrder(
      reply([
        step("The core", "a.ts", "b.ts", "c.ts", "d.ts", "e.ts"),
        step("Later", "g.ts"),
      ]),
      files,
      "g.ts",
      skimOnly
    );
    assert.deepStrictEqual(names(steps), [
      ["The core", ["g.ts", "a.ts", "b.ts", "c.ts", "d.ts"]],
      ["The core", ["e.ts"]],
      ["Other files", ["f.ts"]],
    ]);
  });

  it("stays the Assistant's first step, with its label, when the start file is all it held", () => {
    const steps = parseReadingOrder(
      reply([step("The entry point", "a.ts"), step("Plumbing", "b.ts")]),
      files,
      "a.ts",
      skimOnly
    );
    assert.deepStrictEqual(
      steps?.map((s) => [s.label, s.core, s.files.map((f) => f.path)]),
      [
        ["The entry point", true, ["a.ts"]],
        ["Plumbing", undefined, ["b.ts"]],
        ["Other files", undefined, ["c.ts", "d.ts", "e.ts", "f.ts", "g.ts"]],
      ]
    );
  });

  it("is not a step of the tree-order fallback, which has no steps", () => {
    assert.strictEqual(parseReadingOrder("no order, sorry", files), undefined);
  });
});

describe("Skim-only files in the Reading Order", () => {
  it("are left out of every step the Assistant put them in, and out of the files it left out", () => {
    const steps = parseReadingOrder(
      reply([step("The core", "yarn.lock", "a.ts"), step("Plumbing", "b.ts")]),
      ["a.ts", "b.ts", "c.ts", "yarn.lock"],
      "yarn.lock",
      skimOnly
    );
    assert.deepStrictEqual(names(steps), [
      ["The core", ["a.ts"]],
      ["Plumbing", ["b.ts"]],
      ["Other files", ["c.ts"]],
    ]);
  });

  it("make a reply that holds only skim-only files unusable", () => {
    assert.strictEqual(
      parseReadingOrder(
        reply([step("Locks", "yarn.lock")]),
        files,
        undefined,
        skimOnly
      ),
      undefined
    );
  });

  const change = { repository: "/repo", headSha: "head" } as unknown as Change;
  const order: ReadingOrder = {
    headSha: "head",
    steps: [
      {
        label: "The core",
        core: true,
        files: [{ path: "a.ts", why: "first" }],
      },
      { label: "Locks", files: [{ path: "yarn.lock" }, { path: "b.ts" }] },
    ],
  };
  const tree = ["a.ts", "b.ts", "c.ts", "gen.ts", "yarn.lock"].map((path) => ({
    path,
    status: "modified" as const,
  }));

  it("go in a last step, Skim-only, after Other files, whatever the order says", async () => {
    const skim = new Map<string, SkimReason>([
      ["yarn.lock", "lockFile"],
      ["gen.ts", "generated"],
    ]);

    const { steps, outOfDate } = await stepsAt(change, order, tree, skim);

    assert.strictEqual(outOfDate, false);
    assert.deepStrictEqual(names(steps), [
      ["The core", ["a.ts"]],
      ["Locks", ["b.ts"]],
      ["Other files", ["c.ts"]],
      ["Skim-only", ["gen.ts", "yarn.lock"]],
    ]);
    assert.deepStrictEqual(
      steps.map((s) => [s.core, s.skimOnly]),
      [
        [true, undefined],
        [undefined, undefined],
        [undefined, undefined],
        [undefined, true],
      ]
    );
  });

  it("are left alone when there are none", async () => {
    const { steps } = await stepsAt(change, order, tree);
    assert.ok(steps.every((s) => !s.skimOnly));
    assert.deepStrictEqual(names(steps)?.at(-1), [
      "Other files",
      ["c.ts", "gen.ts"],
    ]);
  });
});
