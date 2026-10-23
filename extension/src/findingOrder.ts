// The order Next Finding and Previous Finding step through a Change's
// Findings, and a Finding's place in it. Kept apart from `vscode` so the
// unit tests can run it under plain Node.

/** A Finding's file and first and last line, counted from 0. */
export interface Placed {
  id: string;
  file: string;
  first: number;
  last: number;
}

/** Where a step starts: a Finding, or the cursor and the Finding stepped to last. */
export type StepStart =
  { id: string } | { file: string; line: number; current?: string };

/**
 * The Findings by file, then by first line. Findings that start on the same
 * line keep the order they came in, so each has a place of its own.
 */
export function stepOrder<T extends Placed>(findings: readonly T[]): T[] {
  return [...findings].sort(
    (a, b) =>
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || a.first - b.first
  );
}

/** The Finding's place among the ordered Findings, counted from 1. */
export function placeAmong(
  ordered: readonly Placed[],
  id: string
): { position: number; total: number } | undefined {
  const i = ordered.findIndex((f) => f.id === id);
  return i < 0 ? undefined : { position: i + 1, total: ordered.length };
}

/**
 * The Finding after `from`, or the one before it when `direction` is -1,
 * going round at either end. From the cursor, a step starts at the Finding
 * stepped to last while the cursor is still on its lines, then at the first
 * Finding on the cursor's line, and otherwise at the cursor's line itself.
 * From nowhere, or from a Finding not among them, it goes to the first or
 * last.
 */
export function findingAfter<T extends Placed>(
  ordered: readonly T[],
  from: StepStart | undefined,
  direction: 1 | -1
): T | undefined {
  if (ordered.length === 0) return;
  const ends = () => (direction === 1 ? ordered[0] : ordered.at(-1));
  if (!from) return ends();
  let start: number;
  if ("id" in from) start = ordered.findIndex((f) => f.id === from.id);
  else {
    const covers = (f: T) =>
      f.file === from.file && f.first <= from.line && from.line <= f.last;
    start = ordered.findIndex((f) => f.id === from.current && covers(f));
    if (start < 0) start = ordered.findIndex(covers);
    if (start < 0) {
      const before = (f: T) =>
        f.file < from.file || (f.file === from.file && f.first < from.line);
      const after = ordered.findIndex((f) => !before(f));
      const next = after < 0 ? ordered.length : after;
      return direction === 1
        ? (ordered[next] ?? ordered[0])
        : (ordered[next - 1] ?? ordered.at(-1));
    }
  }
  if (start < 0) return ends();
  return ordered[(start + direction + ordered.length) % ordered.length];
}
