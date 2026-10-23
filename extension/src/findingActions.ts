// What the Quick Fix menu calls a Finding's actions, and which lines a
// Quick Fix request asks about. A Finding alone on the line is plain
// "Finding"; several are told apart by their lines and the start of their
// message. The message is the Assistant's, from reading other people's code
// (ADR 0017), so a label shows no more than its first line, cut short,
// without control or direction characters.

/** A Finding's lines, counted from 1, and its message. */
export interface LabelledFinding {
  first: number;
  last: number;
  message: string;
}

/** A place in a document, as the editor gives it, counted from 0. */
export interface Position {
  line: number;
  character: number;
}

/** The most characters of a message a label shows. */
const maxQuoteChars = 40;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * The lines, counted from 0, that a cursor or selection from `start` to
 * `end` covers. A selection of whole lines ends at the start of the line
 * after them, which it doesn't cover.
 */
export function selectedLines(
  start: Position,
  end: Position
): { first: number; last: number } {
  const last =
    end.line > start.line && end.character === 0 ? end.line - 1 : end.line;
  return { first: start.line, last };
}

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

/**
 * The message's first line, without control, format or direction
 * characters, cut short by user-perceived characters, so a cut never splits
 * a surrogate pair or parts a letter from its combining marks.
 */
function quote(message: string): string {
  const line = message
    .split(/\r?\n/)[0]
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const characters = Array.from(graphemes.segment(line), (s) => s.segment);
  return characters.length > maxQuoteChars
    ? `${characters.slice(0, maxQuoteChars).join("").trimEnd()}…`
    : line;
}
