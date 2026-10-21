import { showHiddenCharacters } from "../hiddenText";

/**
 * The text in a code fence longer than any run of backticks in it, so that
 * nothing in the text, such as someone else's code, can end the fence early.
 * Characters the Reviewer can't see show as escapes (ADR 0042), since text in
 * a fence is other people's: the code, the diffs and the git tools' output.
 */
export function fenced(text: string, info = ""): string[] {
  const shown = showHiddenCharacters(text);
  const longest = Math.max(
    0,
    ...[...shown.matchAll(/`+/g)].map((run) => run[0].length)
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  return [`${fence}${info}`, shown, fence];
}
