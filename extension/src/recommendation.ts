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

/** What the Assistant may advise. Anything else is no Recommendation. */
export const verdicts = ["approve", "close", "readClosely"] as const;

export type Verdict = (typeof verdicts)[number];

/** The longest reasons kept. */
export const maxReasonsChars = 1_000;

/** What the Assistant advised, and why. */
export interface Advice {
  verdict: Verdict;
  /** Why, in the Assistant's words; never empty. */
  reasons: string;
}

/** A Recommendation, with the head commit it was given for. */
export interface Recommendation extends Advice {
  /** The head it read. It is out of date once the Change moves past this. */
  headSha: string;
}

/** How the overview words each verdict. */
export const verdictText: Record<Verdict, string> = {
  approve: "Approve it",
  close: "Close it",
  readClosely: "Read it closely",
};

/** A Recommendation as the overview shows it. */
export interface ShownRecommendation {
  /** Whether the Assistant is being asked now. */
  asking: boolean;
  /** What it advised, once it has; absent while nothing was kept. */
  advice?: { verdict: string; reasons: string };
  /** Whether the Change has new commits since it was given. */
  outOfDate: boolean;
  /** Set when the last reply held no Recommendation. */
  problem?: boolean;
}

/**
 * The Assistant's reply, which must be a JSON object, alone or in one
 * Markdown fence, with a `verdict` of `approve`, `close` or `readClosely`
 * and `reasons`. Gives nothing for any other reply, so a reply that argues
 * its way to a fourth answer keeps whatever stood before.
 */
export function parseRecommendation(reply: string): Advice | undefined {
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
  if (Object.keys(fields).some((key) => !["verdict", "reasons"].includes(key)))
    return;
  const verdict = fields.verdict;
  if (typeof verdict !== "string") return;
  if (!verdicts.includes(verdict as Verdict)) return;
  if (typeof fields.reasons !== "string") return;
  const reasons = oneLine(fields.reasons, maxReasonsChars);
  if (!reasons) return;
  return { verdict: verdict as Verdict, reasons };
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
        verdict: verdictText[recommendation.verdict],
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

function oneLine(value: unknown, max = Infinity): string {
  if (typeof value !== "string") return "";
  const flat = value.replace(invisible, "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
