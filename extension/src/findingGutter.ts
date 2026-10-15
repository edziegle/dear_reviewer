// Which icon the gutter shows on the lines a file's Findings cover. A gutter
// icon repeats on every line of its decoration, so a Finding over many lines
// gets one lightbulb, on its first line, and a bar down the rest.

/** The lightbulb alone, the lightbulb with a bar down its left edge, or the bar. */
export type GutterIcon = "lightbulb" | "lightbulbWithBar" | "bar";

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
 * overlap, in line order. A line where a span starts shows a lightbulb,
 * with a bar if a span on that line covers more lines than it; any other
 * covered line shows the bar. The work grows with the number of spans, not
 * with the lines they cover.
 */
export function gutterIcons(spans: readonly LineSpan[]): IconSpan[] {
  const starts = [...new Set(spans.map((s) => s.first))].sort((a, b) => a - b);
  const covered = union(spans);
  const barred = union(spans.filter((s) => s.last > s.first));
  const icons: IconSpan[] = [];
  let b = 0;
  let c = 0;
  starts.forEach((start, i) => {
    while (barred[b] && barred[b].last < start) b++;
    while (covered[c].last < start) c++;
    const withBar = barred[b] !== undefined && barred[b].first <= start;
    icons.push({
      icon: withBar ? "lightbulbWithBar" : "lightbulb",
      first: start,
      last: start,
    });
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
