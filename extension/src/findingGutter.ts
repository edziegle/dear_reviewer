// Which icon the gutter shows on the lines a file's Findings cover. A gutter
// icon repeats on every line of its decoration, so a Finding shows the
// Assistant's Hand: the reading cat beside the Assistant's rule on its first
// line, and the rule alone down the rest.

/** The cat beside the rule, or the rule alone. */
export type GutterIcon = "cat" | "bar";

/** A first and last line. */
export interface LineSpan {
  first: number;
  last: number;
}

/** Lines that show one icon. */
export interface IconSpan extends LineSpan {
  icon: GutterIcon;
}

/**
 * The icons on the lines the Findings' spans cover, as spans that don't
 * overlap, in line order. A line where a span starts shows the cat; any other
 * covered line shows the bar. The work grows with the number of spans, not
 * with the lines they cover.
 */
export function gutterIcons(spans: readonly LineSpan[]): IconSpan[] {
  const starts = [...new Set(spans.map((s) => s.first))].sort((a, b) => a - b);
  const covered = union(spans);
  const icons: IconSpan[] = [];
  let c = 0;
  starts.forEach((start, i) => {
    while (covered[c].last < start) c++;
    icons.push({ icon: "cat", first: start, last: start });
    const barLast = Math.min(covered[c].last, (starts[i + 1] ?? Infinity) - 1);
    if (barLast > start)
      icons.push({ icon: "bar", first: start + 1, last: barLast });
  });
  return icons;
}

/** The lines the spans cover, as overlapping spans merged, in line order. */
function union(spans: readonly LineSpan[]): LineSpan[] {
  const merged: LineSpan[] = [];
  for (const { first, last } of [...spans].sort((a, b) => a.first - b.first)) {
    const end = merged.at(-1);
    if (end && first <= end.last) end.last = Math.max(end.last, last);
    else merged.push({ first, last });
  }
  return merged;
}
