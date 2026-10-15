/**
 * The text in a code fence longer than any run of backticks in it, so that
 * nothing in the text, such as someone else's code, can end the fence early.
 */
export function fenced(text: string, info = ""): string[] {
  const longest = Math.max(
    0,
    ...[...text.matchAll(/`+/g)].map((run) => run[0].length)
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  return [`${fence}${info}`, text, fence];
}
