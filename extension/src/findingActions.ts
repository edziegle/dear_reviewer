// What the Quick Fix menu calls a Finding's actions. A Finding alone on the
// line is plain "Finding"; several are told apart by their lines and the
// start of their message. The message is the Assistant's, from reading other
// people's code (ADR 0017), so a label shows no more than its first line, cut
// short, without control or direction characters.

/** A Finding's lines, counted from 1, and its message. */
export interface LabelledFinding {
  first: number;
  last: number;
  message: string;
}

/** The most characters of a message a label shows. */
const maxQuoteChars = 40;

/** The label of each Finding's actions, as `<label>: Dismiss`, in the order given. */
export function quickFixLabels(findings: readonly LabelledFinding[]): string[] {
  if (findings.length <= 1) return findings.map(() => "Finding");
  const described = findings.map(
    (f) =>
      `on ${f.first === f.last ? `line ${f.first}` : `lines ${f.first}–${f.last}`}, “${quote(f.message)}”`
  );
  const counts = new Map<string, number>();
  for (const d of described) counts.set(d, (counts.get(d) ?? 0) + 1);
  const seen = new Map<string, number>();
  return described.map((d) => {
    if (counts.get(d) === 1) return `Finding ${d}`;
    const n = (seen.get(d) ?? 0) + 1;
    seen.set(d, n);
    return `Finding ${n} ${d}`;
  });
}

/** The message's first line, without control, format or direction characters, cut short. */
function quote(message: string): string {
  const line = message
    .split(/\r?\n/)[0]
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return line.length > maxQuoteChars
    ? `${line.slice(0, maxQuoteChars).trimEnd()}…`
    : line;
}
