// Text that the Reviewer can't see but that reaches the Assistant (ADR 0042):
// characters that render as nothing, and HTML comments, which GitHub hides
// and the Markdown renderer drops (ADR 0011). Pure logic, kept apart from
// `vscode` so the unit tests and the git server can load it.

/**
 * Tag characters, which spell ASCII with no glyph ("ASCII smuggling"),
 * zero-width characters, the word joiner, the byte order mark and bidi
 * controls (Trojan Source, CVE-2021-42574). The zero-width joiner joins emoji
 * too; such an emoji shows as its parts and an escape, which is safe.
 */
const hiddenCharacter =
  /[\u{E0000}-\u{E007F}\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/u;

/**
 * A run of tag characters, or one hidden character of another kind. Exported
 * so what strips them rather than escaping them, such as a Recommendation's
 * reasons, works from this one list.
 */
export const hiddenRun =
  /[\u{E0000}-\u{E007F}]+|[\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/gu;

/** Whether the text has any character that renders as nothing or hides other text. */
export function hasHiddenCharacters(text: string): boolean {
  return hiddenCharacter.test(text);
}

/** The ASCII that a run of tag characters spells; they spell none outside U+E0020–U+E007E. */
function spelledBy(tags: string): string {
  return [...tags]
    .map((c) => c.codePointAt(0)! - 0xe0000)
    .filter((ascii) => ascii >= 0x20 && ascii <= 0x7e)
    .map((ascii) => String.fromCharCode(ascii))
    .join("");
}

function escapeOf(char: string): string {
  const code = char.codePointAt(0)!;
  return code > 0xffff
    ? `\\u{${code.toString(16).toUpperCase()}}`
    : `\\u${code.toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * The text with each hidden character as a visible escape, `\u{E0041}` for
 * a tag character and `\u200B` for one of the rest, so a reader takes it for
 * a marker in the data. A run of tag characters also gets what it spells,
 * with quotes and backslashes escaped to leave a JSON string whole. Text
 * that shows no hidden character comes back as it is, and showing the
 * result again changes nothing.
 */
export function showHiddenCharacters(text: string): string {
  return text.replace(hiddenRun, (run) => {
    const escapes = [...run].map(escapeOf).join("");
    const spelled = spelledBy(run);
    return spelled
      ? `${escapes} [hidden text: ${spelled.replace(/["\\]/g, "\\$&")}]`
      : escapes;
  });
}

/**
 * The text without its HTML comments. GitHub hides a comment and everything
 * after one that is never closed, and ends it at the first `-->`. Removing
 * one can join text into another, so it goes on until none is left.
 */
export function withoutHtmlComments(text: string): string {
  let kept = text;
  for (;;) {
    const next = kept.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
    if (next === kept) return kept;
    kept = next;
  }
}

/** Text of a Change that some of the Assistant's prompts carry, and where it is. */
export interface TextPlace {
  /** Where it is, as a sentence's start: "The description", "Commit f8e077e". */
  where: string;
  text: string;
  /** Whether an HTML comment in it is hidden from the Reviewer, so counts. */
  htmlComments?: boolean;
}

/** The most of what hidden characters spell that a notice gives. */
const maxSpelledChars = 200;

/**
 * What to tell the Reviewer, a sentence for each place whose text hides
 * something from them: hidden characters, with what tag characters spell,
 * or an HTML comment. No sentence for a place with nothing hidden.
 */
export function hiddenTextNotices(places: TextPlace[]): string[] {
  return places.flatMap(({ where, text, htmlComments }) => {
    const found = [
      ...(hasHiddenCharacters(text) ? ["hidden characters"] : []),
      ...(htmlComments && withoutHtmlComments(text) !== text
        ? ["an HTML comment"]
        : []),
    ];
    if (found.length === 0) return [];
    const spelled = [...text.matchAll(hiddenRun)]
      .map(([run]) => spelledBy(run))
      .filter(Boolean)
      .map((words) =>
        words.length > maxSpelledChars
          ? `${words.slice(0, maxSpelledChars)}…`
          : words
      );
    const spells = spelled.length
      ? ` They spell ${spelled.map((words) => `"${words}"`).join(", ")}`
      : "";
    return [`${where} holds ${found.join(" and ")}.${spells}`];
  });
}
