// Which icon the gutter shows on each line a file's Findings cover. A gutter
// icon repeats on every line of its decoration, so a Finding over many lines
// gets one lightbulb, on its first line, and a bar down the rest.

/** The lightbulb alone, the lightbulb with a bar down its left edge, or the bar. */
export type GutterIcon = "lightbulb" | "lightbulbWithBar" | "bar";

/** A Finding's first and last line. */
export interface LineSpan {
  first: number;
  last: number;
}

/**
 * The one icon on each line the spans cover. A line where a span starts
 * shows a lightbulb, with a bar if a span on that line covers more lines
 * than it; any other covered line shows the bar.
 */
export function gutterIcons(
  spans: readonly LineSpan[]
): Map<number, GutterIcon> {
  const starts = new Set(spans.map((s) => s.first));
  const barred = new Set<number>();
  const covered = new Set<number>();
  for (const { first, last } of spans)
    for (let line = first; line <= last; line++) {
      covered.add(line);
      if (last > first) barred.add(line);
    }
  const icons = new Map<number, GutterIcon>();
  for (const line of [...covered].sort((a, b) => a - b))
    icons.set(
      line,
      !starts.has(line)
        ? "bar"
        : barred.has(line)
          ? "lightbulbWithBar"
          : "lightbulb"
    );
  return icons;
}
