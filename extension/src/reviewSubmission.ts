// How a pull request's Review is submitted from its overview (ADR 0033): the
// verdicts it offers, when GitHub would refuse one, and the line each pending
// Comment shows as. Kept apart from `vscode` so the unit tests can run it
// under plain Node.

export type Verdict = "comment" | "approve" | "requestChanges";

/** The verdicts in the order the overview offers them, as GitHub's review page does. */
export const verdictOrder: readonly Verdict[] = [
  "comment",
  "approve",
  "requestChanges",
];

export const verdicts: Record<
  Verdict,
  { label: string; detail: string; done: string }
> = {
  comment: {
    label: "Comment",
    detail: "Publish your summary and Comments without approving.",
    done: "Commented on",
  },
  approve: {
    label: "Approve",
    detail: "Publish your summary and Comments, and approve merging.",
    done: "Approved",
  },
  requestChanges: {
    label: "Request Changes",
    detail: "Publish your summary and Comments as changes to make first.",
    done: "Requested changes on",
  },
};

export function isVerdict(value: unknown): value is Verdict {
  return typeof value === "string" && value in verdicts;
}

/**
 * Why GitHub would refuse the verdict without a summary: commenting or
 * requesting changes needs something to say, a summary or a Comment. Gives
 * the reason for each verdict that needs a summary, with this many pending
 * Comments.
 */
export function summaryNeeded(
  pendingComments: number
): Partial<Record<Verdict, string>> {
  if (pendingComments > 0) return {};
  return {
    comment: "Write a summary to comment, or add a Comment in the diff.",
    requestChanges:
      "Write a summary of the changes to make, or add a Comment in the diff.",
  };
}

/** The most of a Comment's first line the overview shows. */
const maxLine = 120;

/**
 * The first line of a Comment with words in it, as plain text: such as
 * "Rename this to retries", or "Suggested change" for a suggestion alone.
 */
export function firstLineOf(body: string): string {
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  const suggestion = lines.some((line) => /^```suggestion\b/.test(line));
  let fenced = false;
  for (const line of lines) {
    if (line.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !line) continue;
    const text = line.replace(/^(#+|>|[-*+]|\d+[.)])\s+/, "");
    return text.length > maxLine ? `${text.slice(0, maxLine - 1)}…` : text;
  }
  return suggestion ? "Suggested change" : "";
}
