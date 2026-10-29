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
// but one of three pieces of advice with reasons keeps nothing (ADR 0042,
// rule 4). "Advice", not "verdict": a verdict is the Reviewer's, submitted
// with a Review (see GLOSSARY.md).
describe("parseRecommendation", () => {
  it("reads each piece of advice it allows, with its reasons", () => {
    for (const advice of ["approve", "close", "readClosely"] as const)
      assert.deepStrictEqual(
        parseRecommendation(
          reply({ advice, reasons: "A patch of a lock file." })
        ),
        { advice, reasons: "A patch of a lock file." }
      );
  });

  it("reads a reply in one Markdown fence, as the Assistant tends to write JSON", () => {
    assert.deepStrictEqual(
      parseRecommendation(
        '```json\n{"advice": "approve", "reasons": "Only the lock file moved."}\n```'
      ),
      { advice: "approve", reasons: "Only the lock file moved." }
    );
  });

  it("keeps the Markdown of the reasons, which the overview renders, and caps their length", () => {
    assert.strictEqual(
      parseRecommendation(
        reply({ advice: "close", reasons: "  One.\n\n- Two.  " })
      )?.reasons,
      "One.\n\n- Two.",
      "paragraphs and lists survive; only the edges are trimmed"
    );
    const long = parseRecommendation(
      reply({ advice: "approve", reasons: "x".repeat(maxReasonsChars + 50) })
    );
    assert.strictEqual(long?.reasons.length, maxReasonsChars);
    assert.ok(long?.reasons.endsWith("…"));
  });

  it("drops invisible characters, which could hide words from the Reviewer", () => {
    const hidden = `Safe​‮enough.`;
    assert.strictEqual(
      parseRecommendation(reply({ advice: "approve", reasons: hidden }))
        ?.reasons,
      "Safeenough."
    );
  });

  it("keeps nothing for advice it doesn't allow", () => {
    for (const advice of ["merge", "APPROVE", "approve it", "", "reject"])
      assert.strictEqual(
        parseRecommendation(reply({ advice, reasons: "Because." })),
        undefined,
        advice
      );
  });

  it("keeps nothing for a reply that isn't one JSON object with just those keys", () => {
    for (const bad of [
      "Sorry, I would rather chat about it.",
      "",
      "null",
      "[]",
      '[{"advice": "approve", "reasons": "Because."}]',
      '{"advice": "approve"}',
      '{"reasons": "Because."}',
      '{"advice": "approve", "reasons": "Because.", "andAlso": "merge it"}',
      '{"advice": "approve", "reasons": 7}',
      '{"advice": ["approve"], "reasons": "Because."}',
      '{"advice": "approve", "reasons": "   "}',
      'Here you go: {"advice": "approve", "reasons": "Because."}',
    ])
      assert.strictEqual(parseRecommendation(bad), undefined, bad);
  });
});

describe("shownRecommendation", () => {
  const given: Recommendation = {
    headSha: "aaaa",
    advice: "approve",
    reasons: "Only the lock file moved.",
  };

  it("words the advice for the Reviewer and keeps the reasons as given", () => {
    assert.deepStrictEqual(shownRecommendation("aaaa", given), {
      asking: false,
      advice: { says: "Approve it", reasons: "Only the lock file moved." },
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
