// The Recommendation (ADR 0051): the Assistant's advice on a Dependency
// update, given only when the Reviewer asks — approve it, close it, or read
// it closely — with its reasons. Kept apart from `vscode` so the unit tests
// can run it under plain Node.
//
// It is the first opinion of a whole pull request Dear Reviewer offers, and
// a Dependabot pull request's description is release notes that whoever
// publishes the package wrote. So the reply is read strictly (ADR 0042, rule
// 4): one of three verdicts with reasons, or nothing is kept. No action
// follows from it either — Finish review preselects nothing, and Dear
// Reviewer never closes a pull request — so a steered approve stays one more
// thing for the Reviewer to read, beside the facts it has to agree with.

/**
 * What the Assistant may advise. Anything else is no Recommendation.
 *
 * Not a verdict: that word is the Reviewer's, for what they submit with a
 * Review (see GLOSSARY.md).
 */
export const adviceValues = ["approve", "close", "readClosely"] as const;

export type Advice = (typeof adviceValues)[number];

/** The longest reasons kept. */
export const maxReasonsChars = 1_000;

/** What the Assistant advised, and why. */
export interface Advised {
  advice: Advice;
  /** Why, in the Assistant's words, as Markdown; never empty. */
  reasons: string;
}

/** A Recommendation, with the head commit it was given for. */
export interface Recommendation extends Advised {
  /** The head it read. It is out of date once the Change moves past this. */
  headSha: string;
}

/** How the overview words each piece of advice. */
export const adviceText: Record<Advice, string> = {
  approve: "Approve it",
  close: "Close it",
  readClosely: "Read it closely",
};

/** A Recommendation as the overview shows it. */
export interface ShownRecommendation {
  /** Whether the Assistant is being asked now. */
  asking: boolean;
  /** What it advised, once it has; absent while nothing was kept. */
  advice?: {
    /** As the overview words it, such as "Approve it". */
    says: string;
    /** Why, as the Assistant wrote it; the overview renders it as Markdown. */
    reasons: string;
  };
  /** Whether the Change has new commits since it was given. */
  outOfDate: boolean;
  /** Set when the last reply held no Recommendation. */
  problem?: boolean;
}

/**
 * The Assistant's reply, which must be a JSON object, alone or in one
 * Markdown fence, with `advice` of `approve`, `close` or `readClosely` and
 * `reasons`. Gives nothing for any other reply, so a reply that argues its
 * way to a fourth answer keeps whatever stood before.
 */
export function parseRecommendation(reply: string): Advised | undefined {
  let json = reply.trim();
  const fence = /^```[a-z]*\n([\s\S]*)\n```$/i.exec(json);
  if (fence) json = fence[1];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return;
  const fields = parsed as Record<string, unknown>;
  if (Object.keys(fields).some((key) => !["advice", "reasons"].includes(key)))
    return;
  const advice = fields.advice;
  if (typeof advice !== "string") return;
  if (!adviceValues.includes(advice as Advice)) return;
  if (typeof fields.reasons !== "string") return;
  const reasons = kept(fields.reasons, maxReasonsChars);
  if (!reasons) return;
  return { advice: advice as Advice, reasons };
}

/** How it shows once the Change may have moved past the head it read. */
export function shownRecommendation(
  headSha: string,
  recommendation: Recommendation | undefined,
  state: { asking?: boolean; problem?: boolean } = {}
): ShownRecommendation {
  return {
    asking: state.asking === true,
    ...(recommendation && {
      advice: {
        says: adviceText[recommendation.advice],
        reasons: recommendation.reasons,
      },
    }),
    outOfDate: !!recommendation && recommendation.headSha !== headSha,
    ...(state.problem && { problem: true }),
  };
}

/** Tag characters, zero-width characters, the word joiner, the byte order mark and bidi controls. */
const invisible =
  /[\u{E0000}-\u{E007F}\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/gu;

/**
 * The reasons as the overview will render them: the Assistant's own
 * Markdown, without the invisible characters that could hide words from the
 * Reviewer, and no longer than `max`.
 */
function kept(value: string, max: number): string {
  const text = value
    .replace(invisible, "")
    .replace(/[ \t]+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
