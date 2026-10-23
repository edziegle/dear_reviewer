// The Markdown of a Finding's hover: its heading, which the Assistant's Hand
// leads, and its message as plain text. The Assistant reads other people's
// code, so nothing in its message may format, link or run a command (ADR
// 0017).

/** A Finding's place among the Change in front's Findings. */
export interface FindingPlace {
  position: number;
  total: number;
}

/** The cat's size in the hover, that of the hover's text. */
const catSize = 13;

/**
 * The heading: the reading cat at `cat`, the Assistant's name, and the
 * Finding's count when it has a place. The cat has empty alt text, so a
 * screen reader reads the name once. It reads the same above or below
 * another provider's part of the hover.
 */
export function hoverHeading(
  cat: string,
  place: FindingPlace | undefined
): string {
  const count = place ? ` ${place.position} of ${place.total}` : "";
  return `![](${cat}|width=${catSize},height=${catSize}) **Assistant** · Finding${count}`;
}

/**
 * The text as Markdown that shows it literally, line breaks and runs of
 * spaces included, and that wraps between words. Every ASCII punctuation
 * character is escaped, which stops emphasis, code, links, autolinks, HTML,
 * entities and anything that starts a block. A line's leading spaces, which
 * would start code, are non-breaking, as are all but the last space of a run,
 * which Markdown would collapse.
 */
export function plainText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(
      (line) =>
        line
          .replace(/[!-/:-@[-`{-~]/g, "\\$&")
          .replace(/^[ \t]+/, (lead) => "&nbsp;".repeat(lead.length))
          .replace(
            /[ \t]{2,}/g,
            (run) => `${"&nbsp;".repeat(run.length - 1)} `
          ) || "&nbsp;"
    )
    .join("\\\n");
}
