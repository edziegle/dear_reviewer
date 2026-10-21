// How the review keys read in Dear Reviewer's own words, in the Reviewer's
// notation: every key is the chord Ctrl+Alt+R, then a letter.

/** A review key, such as `Ctrl+Alt+R F`, or `⌃⌥R F` on a Mac. */
export function reviewKey(
  letter: string,
  platform: NodeJS.Platform = process.platform
): string {
  return `${platform === "darwin" ? "⌃⌥R" : "Ctrl+Alt+R"} ${letter}`;
}
