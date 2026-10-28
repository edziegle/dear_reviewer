import * as assert from "assert";
import {
  maxReasonsChars,
  parseRecommendation,
  shownRecommendation,
  type Recommendation,
} from "../../src/recommendation";

const reply = (fields: Record<string, unknown>) => JSON.stringify(fields);

// The Recommendation is the Assistant's opinion of a whole pull request, and
// a Dependabot description is release notes someone else wrote. So anything
// but one of three verdicts with reasons keeps nothing (ADR 0042, rule 4).
describe("parseRecommendation", () => {
  it("reads each verdict it allows, with its reasons", () => {
    for (const verdict of ["approve", "close", "readClosely"] as const)
      assert.deepStrictEqual(
        parseRecommendation(
          reply({ verdict, reasons: "A patch of a lock file." })
        ),
        { verdict, reasons: "A patch of a lock file." }
      );
  });

  it("reads a reply in one Markdown fence, as the Assistant tends to write JSON", () => {
    assert.deepStrictEqual(
      parseRecommendation(
        '```json\n{"verdict": "approve", "reasons": "Only the lock file moved."}\n```'
      ),
      { verdict: "approve", reasons: "Only the lock file moved." }
    );
  });

  it("flattens the reasons to one line and caps their length", () => {
    assert.strictEqual(
      parseRecommendation(
        reply({ verdict: "close", reasons: "  One.\n\n  Two.  " })
      )?.reasons,
      "One. Two."
    );
    const long = parseRecommendation(
      reply({ verdict: "approve", reasons: "x".repeat(maxReasonsChars + 50) })
    );
    assert.strictEqual(long?.reasons.length, maxReasonsChars);
    assert.ok(long?.reasons.endsWith("…"));
  });

  it("drops invisible characters, which could hide words from the Reviewer", () => {
    assert.strictEqual(
      parseRecommendation(
        reply({ verdict: "approve", reasons: "Safe​‮enough." })
      )?.reasons,
      "Safeenough."
    );
  });

  it("keeps nothing for a verdict it doesn't allow", () => {
    for (const verdict of ["merge", "APPROVE", "approve it", "", "reject"])
      assert.strictEqual(
        parseRecommendation(reply({ verdict, reasons: "Because." })),
        undefined,
        verdict
      );
  });

  it("keeps nothing for a reply that isn't one JSON object with just those keys", () => {
    for (const bad of [
      "Sorry, I would rather chat about it.",
      "",
      "null",
      "[]",
      '[{"verdict": "approve", "reasons": "Because."}]',
      '{"verdict": "approve"}',
      '{"reasons": "Because."}',
      '{"verdict": "approve", "reasons": "Because.", "andAlso": "merge it"}',
      '{"verdict": "approve", "reasons": 7}',
      '{"verdict": ["approve"], "reasons": "Because."}',
      '{"verdict": "approve", "reasons": "   "}',
      'Here you go: {"verdict": "approve", "reasons": "Because."}',
    ])
      assert.strictEqual(parseRecommendation(bad), undefined, bad);
  });
});

describe("shownRecommendation", () => {
  const given: Recommendation = {
    headSha: "aaaa",
    verdict: "approve",
    reasons: "Only the lock file moved.",
  };

  it("words the verdict for the Reviewer and keeps the reasons as given", () => {
    assert.deepStrictEqual(shownRecommendation("aaaa", given), {
      asking: false,
      advice: { verdict: "Approve it", reasons: "Only the lock file moved." },
      outOfDate: false,
    });
  });

  it("is out of date once the Change has moved past the head it read", () => {
    assert.strictEqual(shownRecommendation("bbbb", given).outOfDate, true);
  });

  it("is neither out of date nor advice while there is none", () => {
    assert.deepStrictEqual(shownRecommendation("aaaa", undefined), {
      asking: false,
      outOfDate: false,
    });
  });

  it("says while the Assistant is being asked, and when its reply held nothing", () => {
    assert.strictEqual(
      shownRecommendation("aaaa", undefined, { asking: true }).asking,
      true
    );
    assert.strictEqual(
      shownRecommendation("aaaa", given, { problem: true }).problem,
      true,
      "the Recommendation that stood is still shown beside the problem"
    );
    assert.ok(!("problem" in shownRecommendation("aaaa", given)));
  });
});
