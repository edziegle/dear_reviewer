// The Agent note (see ADR 0046): a short paragraph the Assistant writes under
// the Reviewer's text in a pending pull request Comment, for the agent that
// will act on the Comment. Kept apart from `vscode` so the unit tests can run
// it under plain Node.
//
// The note goes to GitHub under the Reviewer's name, so Dear Reviewer trusts
// nothing in the Assistant's reply (ADR 0042, rule 4). It reads the reply
// strictly, repairs the note, refuses one that is too long, and writes the
// label itself.

/** The label that starts the note's paragraph. Dear Reviewer writes it, never the Assistant. */
export const noteLabel = "**For agents:**";

/** The longest note kept, counted after the repairs and without the label. */
export const maxNoteChars = 600;

/** The longest reason or warning shown. */
const maxReasonChars = 200;

/** What the Assistant answered: a note, or a reason it has none. */
export type NoteReply =
  | { kind: "note"; text: string; warning?: string }
  | { kind: "none"; reason: string; warning?: string };

/**
 * The Assistant's reply, which must be a JSON object, alone or in one
 * Markdown fence, with either `note` or `noNote` (a reason) and optionally a
 * `warning`. Gives nothing for any other reply.
 */
export function parseNoteReply(reply: string): NoteReply | undefined {
  let json = reply.trim();
  const fence = /^```[a-z]*\n([\s\S]*)\n```$/i.exec(json);
  if (fence) json = fence[1];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return;
  const fields = parsed as Record<string, unknown>;
  const keys = Object.keys(fields);
  if (keys.some((key) => !["note", "noNote", "warning"].includes(key))) return;
  if (!("note" in fields) && !("noNote" in fields)) return;
  if ("note" in fields && "noNote" in fields) return;
  const warning = oneLine(fields.warning, maxReasonChars);
  const extra = warning ? { warning } : {};
  if ("note" in fields) {
    if (typeof fields.note !== "string") return;
    const text = oneLine(fields.note);
    return text ? { kind: "note", text, ...extra } : undefined;
  }
  if (typeof fields.noNote !== "string") return;
  return {
    kind: "none",
    reason: oneLine(fields.noNote, maxReasonChars) || "It has no note to add.",
    ...extra,
  };
}

/** What the repairs of a note did, in the order they are told. */
export type Repair =
  "invisible" | "images" | "links" | "mentions" | "html" | "references";

const repairOrder: Repair[] = [
  "invisible",
  "images",
  "links",
  "mentions",
  "html",
  "references",
];

const repairWords: Record<Repair, string> = {
  invisible: "removed invisible characters",
  images: "removed images",
  links: "unlinked URLs that neither the Comment nor the diff holds",
  mentions: "neutralised @mentions",
  html: "escaped HTML",
  references: "dropped file references outside the Change",
};

/** The repairs in words for the Reviewer, such as "removed images and escaped HTML". */
export function describeRepairs(repairs: readonly Repair[]): string {
  const words = repairs.map((repair) => repairWords[repair]);
  return words.length < 2
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** What the repairs check a note against. */
export interface NoteContext {
  /** The Reviewer's own text in the Comment, without any earlier note. */
  own: string;
  /** The Change's diff. */
  diff: string;
  /** The line count of each file of the Change a `path:line` reference may name, by path from the repository root. */
  lineCounts: ReadonlyMap<string, number>;
}

export type RepairedNote =
  | { ok: true; text: string; repairs: Repair[] }
  | { ok: false; why: "empty" | "tooLong"; length: number };

/**
 * The note with what ADR 0042's rule 4 forbids taken out, and which repairs
 * that took. A note over the cap after the repairs is refused, never cut.
 */
export function repairNote(note: string, context: NoteContext): RepairedNote {
  const repairs = new Set<Repair>();
  let text = note
    .replace(invisible, () => {
      repairs.add("invisible");
      return "";
    })
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\*\*For agents:?\*\*:?\s*/i, "");
  const held = new Set([...urlsIn(context.own), ...urlsIn(context.diff)]);
  const repair = textRepair(held, repairs);
  text = codeSpans(text)
    .map((part) =>
      part.code ? referenceOf(part.text, context, repairs) : repair(part.text)
    )
    .join("");
  text = text.replace(/ {2,}/g, " ").trim();
  if (repairs.has("references")) text = text.replace(/ ([.,;:!?])/g, "$1");
  const length = text.length;
  if (length === 0) return { ok: false, why: "empty", length };
  if (length > maxNoteChars) return { ok: false, why: "tooLong", length };
  return {
    ok: true,
    text,
    repairs: repairOrder.filter((kind) => repairs.has(kind)),
  };
}

/** The files a note's `path:line` references name, for the caller to count the lines of. */
export function referencedPaths(note: string): string[] {
  const paths = codeSpans(note.replace(invisible, "")).flatMap((part) => {
    const ref = part.code && referenceIn(part.text);
    return ref ? [ref.path] : [];
  });
  return [...new Set(paths)];
}

/** The Comment's body split into the Reviewer's text and the note paragraph in it, if it has one. */
export function splitNote(body: string): { own: string; note?: string } {
  const found = notePattern.exec(body);
  if (!found) return { own: body };
  const start = found.index + found[1].length;
  const end = found.index + found[0].length;
  return {
    own: `${body.slice(0, start)}${body.slice(end)}`.trim(),
    note: body.slice(start + noteLabel.length, end).trim(),
  };
}

/**
 * The body with the note as its last paragraph, after a blank line. A body
 * that already has a note paragraph gets it replaced, with the rest of the
 * body as it was.
 */
export function withNote(body: string, note: string): string {
  const paragraph = `${noteLabel} ${note}`;
  const found = notePattern.exec(body);
  if (found) {
    const start = found.index + found[1].length;
    return `${body.slice(0, start)}${paragraph}${body.slice(found.index + found[0].length)}`;
  }
  const own = body.trimEnd();
  return own ? `${own}\n\n${paragraph}` : paragraph;
}

/** A paragraph that starts with the label: the blank line before it, or the start of the body, then the paragraph. */
const notePattern =
  /(^|\n[ \t]*\n)\*\*For agents:\*\*(?:(?!\n[ \t]*\n)[\s\S])*/;

/** Tag characters, zero-width characters, the word joiner, the byte order mark and bidi controls. */
const invisible =
  /[\u{E0000}-\u{E007F}\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/gu;

const imageSyntax = String.raw`!\[(?:[^\[\]]|\[[^\]]*\])*\](?:\([^)]*\)|\[[^\]]*\])?`;
const linkSyntax = String.raw`\[((?:[^\[\]]|\[[^\]]*\])*)\]\(\s*<?([^\s)>]*)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)`;
const urlSyntax = String.raw`(?<!\w)(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>\x60]+`;
const mentionSyntax = String.raw`(?<![\w@])@[A-Za-z0-9][\w-]*(?:\/[\w.-]*\w)?`;
const htmlSyntax = String.raw`<(?=[A-Za-z\/!?])|&(?=#?\w+;)`;

/**
 * Repairs text outside code spans: images, links and bare URLs, mentions
 * and HTML, in one pass so that a repair never builds what another forbids.
 */
function textRepair(
  held: ReadonlySet<string>,
  repairs: Set<Repair>
): (text: string) => string {
  const master = new RegExp(
    `(${imageSyntax})|(${linkSyntax})|(${urlSyntax})|(${mentionSyntax})|(${htmlSyntax})`,
    "giu"
  );
  const repair = (text: string): string =>
    text.replace(
      master,
      (
        match: string,
        image?: string,
        link?: string,
        inner?: string,
        destination?: string,
        url?: string,
        mention?: string
      ) => {
        if (image) {
          repairs.add("images");
          return "";
        }
        if (link) {
          const label = repair(inner ?? "");
          if (destination && held.has(destination))
            return label === inner ? match : `[${label}](${destination})`;
          repairs.add("links");
          const plain = escapeBrackets(label);
          return destination && !destination.includes("`")
            ? `${plain} (\`${destination}\`)`
            : plain;
        }
        if (url) {
          const { link, after } = splitUrl(url);
          if (isImageUrl(link)) {
            repairs.add("images");
            return after;
          }
          if (held.has(link)) return match;
          repairs.add("links");
          return `\`${link}\`${after}`;
        }
        if (mention) {
          repairs.add("mentions");
          return `\`${mention}\``;
        }
        repairs.add("html");
        return match === "<" ? "&lt;" : "&amp;";
      }
    );
  return repair;
}

/** Whether a URL is one GitHub shows as an image or a video in a Comment. */
function isImageUrl(url: string): boolean {
  return (
    /\.(?:png|jpe?g|gif|svg|webp|bmp|ico|avif|tiff?)(?:[?#].*)?$/i.test(url) ||
    /^(?:https?:)?\/\/(?:(?:www\.)?github\.com\/user-attachments\/|user-images\.githubusercontent\.com\/)/i.test(
      url
    )
  );
}

/** Drops a code span that is a `path:line` reference to a file or line the Change doesn't have. */
function referenceOf(
  span: string,
  context: NoteContext,
  repairs: Set<Repair>
): string {
  const ref = referenceIn(span);
  if (!ref) return span;
  const lines = context.lineCounts.get(ref.path);
  if (
    lines !== undefined &&
    ref.first >= 1 &&
    ref.first <= ref.last &&
    ref.last <= lines
  )
    return span;
  repairs.add("references");
  return "";
}

/** The place a code span names, if it is only a `path:line` or `path:first-last` reference. */
function referenceIn(
  span: string
): { path: string; first: number; last: number } | undefined {
  const inside = /^(`+) ?([\s\S]*?) ?\1$/.exec(span)?.[2];
  const found = /^(\S+?):(\d+)(?:-(\d+))?$/.exec(inside ?? "");
  if (!found || !/[./]/.test(found[1])) return;
  const first = Number(found[2]);
  return {
    path: found[1].replace(/^\.\//, ""),
    first,
    last: found[3] === undefined ? first : Number(found[3]),
  };
}

/** The text split into code spans and the text between them, which together make the text again. */
function codeSpans(text: string): { code: boolean; text: string }[] {
  const parts: { code: boolean; text: string }[] = [];
  let plain = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "`") {
      plain += text[i++];
      continue;
    }
    let open = i;
    while (text[open] === "`") open++;
    const size = open - i;
    let close = open;
    let end = -1;
    while (close < text.length) {
      if (text[close] !== "`") {
        close++;
        continue;
      }
      let run = close;
      while (text[run] === "`") run++;
      if (run - close === size) {
        end = run;
        break;
      }
      close = run;
    }
    if (end < 0) {
      plain += text.slice(i, open);
      i = open;
      continue;
    }
    if (plain) parts.push({ code: false, text: plain });
    plain = "";
    parts.push({ code: true, text: text.slice(i, end) });
    i = end;
  }
  if (plain) parts.push({ code: false, text: plain });
  return parts;
}

function escapeBrackets(text: string): string {
  return codeSpans(text)
    .map((part) =>
      part.code ? part.text : part.text.replace(/[[\]]/g, (c) => `\\${c}`)
    )
    .join("");
}

/** The URLs in the text, as a link's destination would give them. */
function urlsIn(text: string): string[] {
  return [...text.matchAll(new RegExp(urlSyntax, "giu"))].map(
    (match) => splitUrl(match[0]).link
  );
}

/** A bare URL, and the punctuation after it that isn't part of it. */
function splitUrl(url: string): { link: string; after: string } {
  let link = url;
  for (;;) {
    const last = link.at(-1);
    const unbalanced =
      (last === ")" && count(link, ")") > count(link, "(")) ||
      (last === "]" && count(link, "]") > count(link, "["));
    if (!last || !(unbalanced || /[.,;:!?'"*_~]/.test(last))) break;
    link = link.slice(0, -1);
  }
  return { link, after: url.slice(link.length) };
}

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

/** The text on one line, cut off with an ellipsis past `max`; empty if it isn't text. */
function oneLine(value: unknown, max = Infinity): string {
  if (typeof value !== "string") return "";
  const flat = value.replace(invisible, "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
