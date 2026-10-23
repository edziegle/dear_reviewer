// Repeated edits and Duplicate code (ADR 0047): what Dear Reviewer finds by
// rules when a Change repeats itself, before the Assistant judges it. Every
// line is normalized the same way for every language, so the rules need no
// parser: blank and comment-only lines drop, whitespace goes, and names,
// numbers and strings become placeholders. Pure logic, kept apart from `vscode`
// and git so the unit tests can run it under plain Node.

import type { FileStatus } from "./changeDetails";

/** The normalized lines a block must share with another to be a candidate. */
export const windowSize = 6;

/** The fewest sites that make an edit a Repeated edit. */
export const minSites = 3;

/** The most Duplicate code candidates kept, largest first. */
export const maxCandidates = 20;

/** The most places kept for a candidate that matches more than one. */
const maxPlaces = 3;

/** The most missed sites listed for a Repeated edit, the rest counted. */
const maxMissed = 20;

/** The most missed sites counted past those listed, so the count stops somewhere. */
const maxMoreMissed = 480;

/** The most places read for the names a missed site must hold, for one Repeated edit. */
const maxChecked = 2000;

/** The most places the window index keeps for one block of lines, so boilerplate stays cheap. */
const maxWindowPlaces = 16;

type TokenKind = "name" | "number" | "string" | "punctuation";

interface Token {
  kind: TokenKind;
  text: string;
}

/** What starts and continues a name, in any script. */
const nameStart = /[\p{L}_$]/u;
const nameContinue = /[\p{L}\p{N}_$]/u;
const digit = /[0-9]/;

/**
 * Splits a line into tokens, leaving out its comments: a `//` or `/* *\/`
 * outside a string, a `#` or `--` that starts a word of its own, and a `*`
 * that starts the line, as in a doc comment. A `/*` opens a block comment
 * only at the start of a line or after a space or an opening bracket, comma,
 * semicolon or `=`, so a glob such as `dist/*` is not one, and only when
 * `blocks` is set. `inBlock` says the line begins inside a block comment;
 * `inBlock` in the answer says it ends inside one.
 */
function tokenize(
  line: string,
  inBlock: boolean,
  blocks = true
): { tokens: Token[]; inBlock: boolean } {
  const tokens: Token[] = [];
  let i = 0;
  const alone = (at: number, length: number) =>
    (at === 0 || /\s/.test(line[at - 1])) &&
    (at + length >= line.length || /\s/.test(line[at + length]));
  for (;;) {
    if (inBlock) {
      const end = line.indexOf("*/", i);
      if (end < 0) return { tokens, inBlock: true };
      i = end + 2;
      inBlock = false;
    }
    while (i < line.length) {
      const c = line[i];
      if (/\s/.test(c)) {
        i++;
      } else if (c === "/" && line[i + 1] === "/") {
        return { tokens, inBlock: false };
      } else if (
        c === "/" &&
        line[i + 1] === "*" &&
        blocks &&
        (i === 0 || /[\s(,;{[=]/.test(line[i - 1]))
      ) {
        inBlock = true;
        i += 2;
        break;
      } else if (c === "#" && alone(i, 1)) {
        return { tokens, inBlock: false };
      } else if (c === "-" && line[i + 1] === "-" && alone(i, 2)) {
        return { tokens, inBlock: false };
      } else if (
        c === "*" &&
        tokens.length === 0 &&
        (i + 1 >= line.length || /[\s/]/.test(line[i + 1]))
      ) {
        return { tokens, inBlock: false };
      } else if (c === '"' || c === "'" || c === "`") {
        let end = i + 1;
        while (end < line.length && line[end] !== c)
          end += line[end] === "\\" ? 2 : 1;
        tokens.push({ kind: "string", text: line.slice(i, end + 1) });
        i = end + 1;
      } else if (
        digit.test(c) ||
        (c === "." && digit.test(line[i + 1] ?? ""))
      ) {
        let end = i + 1;
        while (end < line.length && /[0-9A-Za-z_.]/.test(line[end])) end++;
        tokens.push({ kind: "number", text: line.slice(i, end) });
        i = end;
      } else if (nameStart.test(c)) {
        let end = i + 1;
        while (end < line.length && nameContinue.test(line[end])) end++;
        tokens.push({ kind: "name", text: line.slice(i, end) });
        i = end;
      } else {
        tokens.push({ kind: "punctuation", text: c });
        i++;
      }
    }
    if (!inBlock) return { tokens, inBlock: false };
  }
}

const placeholder: Record<TokenKind, string> = {
  name: "I",
  number: "N",
  string: "S",
  punctuation: "",
};

function normalizedOf(tokens: readonly Token[]): string {
  let text = "";
  let word = false;
  for (const token of tokens) {
    const isWord = token.kind !== "punctuation";
    // Two words in a row stay two, as `int x` and `ab` differ.
    if (isWord && word) text += " ";
    text += isWord ? placeholder[token.kind] : token.text;
    word = isWord;
  }
  return text;
}

/**
 * The lines in their normalized form, one for each, and the empty string for
 * a blank or comment-only line, which no comparison counts.
 */
export function normalizeLines(lines: readonly string[]): string[] {
  return scanLines(lines).map(normalizedOf);
}

/** How far on a block comment is looked for the `*\/` that closes it. */
const blockReach = 2000;

/**
 * The tokens of each line. A `/*` that no `*\/` within the next
 * {@link blockReach} lines closes is no comment, so it can't hide the rest of
 * a file, such as after an unquoted glob in a shell script.
 */
function scanLines(lines: readonly string[]): Token[][] {
  let inBlock = false;
  return lines.map((line, at) => {
    let scanned = tokenize(line, inBlock);
    if (
      scanned.inBlock &&
      !inBlock &&
      !lines.slice(at + 1, at + 1 + blockReach).some((l) => l.includes("*/"))
    )
      scanned = tokenize(line, false, false);
    inBlock = scanned.inBlock;
    return scanned.tokens;
  });
}

/** Whether a normalized line holds a name, number or string, and so is more than punctuation. */
export function hasContent(normalized: string): boolean {
  return /[INS]/.test(normalized);
}

/** The names in the text, the placeholders' originals. */
function namesIn(lines: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const tokens of scanLines(lines))
    for (const token of tokens)
      if (token.kind === "name") names.add(token.text);
  return names;
}

/** A 53-bit hash of the text (cyrb53), so that two different lines meet rarely. */
function hashOf(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** A place in a file at the head, by the original line numbers it spans. */
export interface Place {
  path: string;
  line: number;
  endLine: number;
}

interface IndexedFile {
  path: string;
  /** The original line number of each normalized line. */
  lines: Uint32Array;
  hashes: Float64Array;
  /** Whether each normalized line holds more than punctuation. */
  content: Uint8Array;
  /** Whether each normalized line is one the Change added, when the file is a changed one. */
  added?: Uint8Array;
}

/** A place in the index's files: the file's number and the normalized line, as one number. */
const perFile = 4_194_304;

/** The most normalized lines of one file the index keeps. */
const maxLinesPerFile = perFile - 1;

/**
 * Files of the head by their normalized lines, to find where a sequence of
 * lines occurs: each line that holds content with its places, and each
 * window of {@link windowSize} lines that does. It keeps hashes, not text.
 */
export class RepositoryIndex {
  /** Whether it left files out because time ran out, so it doesn't know the whole repository. */
  partial = false;

  private readonly files: IndexedFile[] = [];
  private readonly byPath = new Map<string, number>();
  private readonly lineIndex = new Map<number, number[]>();
  private readonly windowIndex = new Map<number, number[]>();

  /**
   * Adds the file's text. `added` names the lines, counted from 1, that the
   * Change added to it, which a Duplicate code search needs of a changed file.
   */
  add(path: string, text: string, added?: ReadonlySet<number>): void {
    const raw = text.split("\n");
    const normalized = normalizeLines(raw);
    const lines: number[] = [];
    const hashes: number[] = [];
    const content: number[] = [];
    const flags: number[] = [];
    normalized.forEach((line, at) => {
      if (line === "" || lines.length >= maxLinesPerFile) return;
      lines.push(at + 1);
      hashes.push(hashOf(line));
      content.push(hasContent(line) ? 1 : 0);
      flags.push(added?.has(at + 1) ? 1 : 0);
    });
    const file: IndexedFile = {
      path,
      lines: Uint32Array.from(lines),
      hashes: Float64Array.from(hashes),
      content: Uint8Array.from(content),
      ...(added && { added: Uint8Array.from(flags) }),
    };
    const id = this.files.length;
    this.files.push(file);
    this.byPath.set(path, id);
    for (let i = 0; i < file.hashes.length; i++) {
      if (file.content[i])
        push(this.lineIndex, file.hashes[i], id * perFile + i);
      const window = windowHashAt(file, i);
      if (window !== undefined) {
        const places = this.windowIndex.get(window);
        if (!places) this.windowIndex.set(window, [id * perFile + i]);
        else if (places.length < maxWindowPlaces) places.push(id * perFile + i);
      }
    }
  }

  /** The files added, in the order added. */
  get fileList(): readonly IndexedFile[] {
    return this.files;
  }

  fileAt(path: string): IndexedFile | undefined {
    const id = this.byPath.get(path);
    return id === undefined ? undefined : this.files[id];
  }

  /** Where the file's window of normalized lines at `at` is also found, as paths and indexes. */
  windowMatches(hash: number): { path: string; at: number }[] {
    return (this.windowIndex.get(hash) ?? []).map((place) => ({
      path: this.files[Math.floor(place / perFile)].path,
      at: place % perFile,
    }));
  }

  /**
   * Where the normalized lines occur one after another, with the blank and
   * comment-only lines between them left out. A sequence with nothing but
   * punctuation in it has no place: it would be everywhere.
   */
  occurrences(sequence: readonly string[]): Place[] {
    const wanted = sequence.map(hashOf);
    // Start from the line with the fewest places.
    let anchor = -1;
    let anchored: number[] = [];
    sequence.forEach((line, i) => {
      if (!hasContent(line)) return;
      const places = this.lineIndex.get(wanted[i]) ?? [];
      if (anchor < 0 || places.length < anchored.length) {
        anchor = i;
        anchored = places;
      }
    });
    const found: Place[] = [];
    for (const place of anchored) {
      const file = this.files[Math.floor(place / perFile)];
      const start = (place % perFile) - anchor;
      if (start < 0 || start + wanted.length > file.hashes.length) continue;
      if (wanted.every((hash, i) => file.hashes[start + i] === hash))
        found.push({
          path: file.path,
          line: file.lines[start],
          endLine: file.lines[start + wanted.length - 1],
        });
    }
    return found.sort(byPlace);
  }
}

function push(map: Map<number, number[]>, key: number, place: number): void {
  const places = map.get(key);
  if (places) places.push(place);
  else map.set(key, [place]);
}

function byPath(a: { path: string }, b: { path: string }): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

function byPlace(a: Place, b: Place): number {
  return byPath(a, b) || a.line - b.line;
}

/**
 * The hash of the window of lines starting at `at`, or none if the window
 * is too bare to match: mostly punctuation, or one line over and over. When
 * the file has Change data, the window must be all added lines.
 */
function windowHashAt(
  file: IndexedFile,
  at: number,
  onlyAdded = false
): number | undefined {
  if (at + windowSize > file.hashes.length) return undefined;
  let withContent = 0;
  const distinct = new Set<number>();
  for (let i = at; i < at + windowSize; i++) {
    if (onlyAdded && !file.added?.[i]) return undefined;
    withContent += file.content[i];
    distinct.add(file.hashes[i]);
  }
  if (withContent < windowSize / 2 || distinct.size < windowSize / 2)
    return undefined;
  return hashOf(
    Array.from(file.hashes.subarray(at, at + windowSize)).join(",")
  );
}

/** One hunk of the Change's diff, with its removed and added lines as written. */
export interface Hunk {
  path: string;
  status: FileStatus;
  /** The first line it removed, counted from 1 in the base file. */
  oldStart: number;
  removed: string[];
  /** The first line it added, counted from 1 in the head file. */
  newStart: number;
  added: string[];
}

/** Where a hunk is: on the head side, or on the base side in a deleted file. */
export interface Site {
  path: string;
  side: "head" | "base";
  line: number;
  endLine: number;
}

export interface RepeatedEdit {
  /** Every site, in the order of the diff. */
  sites: Site[];
  /** The sites that made another change than the majority's. */
  differing: Site[];
  /** Places at the head, outside the Change's hunks, that still hold the removed lines. */
  missed: Place[];
  /** How many more missed sites there were than listed. */
  moreMissed: number;
  /** Whether the search for missed sites stopped before it had read every candidate place. */
  cutOff: boolean;
  /** What most sites removed and added, as written at the first of them. */
  majority: { removed: string[]; added: string[] };
}

function siteOf(hunk: Hunk): Site {
  if (hunk.status === "deleted")
    return {
      path: hunk.path,
      side: "base",
      line: hunk.oldStart,
      endLine: hunk.oldStart + Math.max(hunk.removed.length, 1) - 1,
    };
  const line = Math.max(hunk.newStart, 1);
  return {
    path: hunk.path,
    side: "head",
    line,
    endLine: line + Math.max(hunk.added.length, 1) - 1,
  };
}

const withoutBlanks = (lines: string[]) => lines.filter((l) => l !== "");

/**
 * The Change's Repeated edits: hunks that removed the same normalized lines
 * at {@link minSites} or more sites, when those lines hold more than
 * punctuation and more than half the sites made the same change as written
 * (see {@link changeOf}). The index, if given, finds each edit's missed
 * sites: places that hold the removed lines and, when `lineText` gives a
 * file's lines as written, the names that all the sites' removed lines
 * share, so a rename's callers that kept the old name are found and other
 * code that merely looks the same is not. An edit whose sites share no name
 * has no missed sites.
 */
export async function repeatedEdits(
  hunks: readonly Hunk[],
  options: {
    index?: RepositoryIndex;
    lineText?: (
      path: string
    ) => Promise<readonly string[] | undefined> | readonly string[] | undefined;
  } = {}
): Promise<RepeatedEdit[]> {
  const groups = new Map<string, { removed: string[]; hunks: Hunk[] }>();
  for (const hunk of hunks) {
    const removed = withoutBlanks(normalizeLines(hunk.removed));
    const key = removed.join("\n");
    if (!hasContent(key)) continue;
    const group = groups.get(key);
    if (group) group.hunks.push(hunk);
    else groups.set(key, { removed, hunks: [hunk] });
  }
  const added = new Map<string, [number, number][]>();
  for (const hunk of hunks) {
    if (hunk.added.length === 0) continue;
    added.set(hunk.path, [
      ...(added.get(hunk.path) ?? []),
      [hunk.newStart, hunk.newStart + hunk.added.length - 1],
    ]);
  }
  const insideHunks = (place: Place) =>
    (added.get(place.path) ?? []).some(
      ([start, end]) => place.line <= end && start <= place.endLine
    );

  const edits: RepeatedEdit[] = [];
  for (const { removed, hunks: sites } of groups.values()) {
    if (sites.length < minSites) continue;
    const byChange = new Map<string, Hunk[]>();
    for (const hunk of sites) {
      const key = changeOf(hunk);
      byChange.set(key, [...(byChange.get(key) ?? []), hunk]);
    }
    // The most common, and of equal counts the first to appear.
    const agreeing = [...byChange.values()].reduce((best, next) =>
      next.length > best.length ? next : best
    );
    // Sites of one shape that each made their own change are no one edit.
    if (agreeing.length * 2 <= sites.length) continue;
    const differing = sites.filter((hunk) => !agreeing.includes(hunk));
    const missed: Place[] = [];
    let cutOff = false;
    const anchors = sharedNames(sites);
    // With no name in common, lines of the same shape are all there is to go
    // by, and they are all over a repository: no place is a missed site.
    if (options.index && anchors.size > 0) {
      const { lineText } = options;
      let checked = 0;
      for (const place of options.index.occurrences(removed)) {
        if (insideHunks(place)) continue;
        if (lineText) {
          // Looks that alike are everywhere, so reading them is bounded.
          if (++checked > maxChecked) {
            cutOff = true;
            break;
          }
          const lines = await lineText(place.path);
          if (!lines) continue;
          const here = namesIn(lines.slice(place.line - 1, place.endLine));
          if (![...anchors].every((name) => here.has(name))) continue;
        }
        missed.push(place);
        if (missed.length >= maxMissed + maxMoreMissed) break;
      }
    }
    edits.push({
      sites: sites.map(siteOf),
      differing: differing.map(siteOf),
      missed: missed.slice(0, maxMissed),
      moreMissed: Math.max(missed.length - maxMissed, 0),
      cutOff,
      majority: { removed: agreeing[0].removed, added: agreeing[0].added },
    });
  }
  return edits;
}

/** The most token pairs compared to align a site's removed and added tokens. */
const maxAligned = 1_000_000;

/**
 * What the site changed, as written, so two sites made the same change when
 * the texts are equal: the runs of tokens it took away and put in, where its
 * removed and added tokens differ. A site that only deleted lines is its
 * removed tokens, with names as written and numbers and strings as
 * placeholders, so `drop(1)` and `drop(2)` are one change.
 */
function changeOf(hunk: Hunk): string {
  const removed = scanLines(hunk.removed).flat();
  const added = scanLines(hunk.added).flat();
  if (added.length === 0)
    return JSON.stringify([
      "deleted",
      removed.map((t) =>
        t.kind === "number" || t.kind === "string"
          ? placeholder[t.kind]
          : t.text
      ),
    ]);
  return JSON.stringify([
    "changed",
    differences(
      removed.map((t) => t.text),
      added.map((t) => t.text)
    ),
  ]);
}

/**
 * The runs where `a` and `b` differ, each as what `a` had and what `b` has
 * there, from a longest common subsequence that prefers the earliest match,
 * so the same tokens always give the same runs. A middle too long to align
 * is one run.
 */
function differences(
  a: readonly string[],
  b: readonly string[]
): [string[], string[]][] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  const x = a.slice(start, a.length - end);
  const y = b.slice(start, b.length - end);
  if (x.length * y.length > maxAligned) return [[x, y]];
  // `common[i][j]`: the longest common subsequence of x from i and y from j.
  const common = Array.from(
    { length: x.length + 1 },
    () => new Uint32Array(y.length + 1)
  );
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      common[i][j] =
        x[i] === y[j]
          ? common[i + 1][j + 1] + 1
          : Math.max(common[i + 1][j], common[i][j + 1]);
  const runs: [string[], string[]][] = [];
  let run: [string[], string[]] | undefined;
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      run = undefined;
      i++;
      j++;
      continue;
    }
    if (!run) runs.push((run = [[], []]));
    if (j >= y.length || (i < x.length && common[i + 1][j] >= common[i][j + 1]))
      run[0].push(x[i++]);
    else run[1].push(y[j++]);
  }
  return runs;
}

/** The names every site's removed lines hold. */
function sharedNames(sites: readonly Hunk[]): Set<string> {
  const [first, ...rest] = sites.map((h) => namesIn(h.removed));
  return new Set([...first].filter((name) => rest.every((n) => n.has(name))));
}

/** A block of added lines that matches code elsewhere. */
export interface DuplicateCandidate {
  path: string;
  startLine: number;
  endLine: number;
  /** How many normalized lines the block has. */
  lines: number;
  /** A few of the places it matches. */
  places: Place[];
}

interface Run {
  start: number;
  end: number;
  target: string;
  targetStart: number;
}

/**
 * The Duplicate code candidates in the Change's files: each block of
 * {@link windowSize} or more normalized lines, all of them added, that
 * matches a block elsewhere in these files or in the index. Adjacent
 * matching windows make one block. Of two matching blocks the Change added,
 * the later one is the candidate and the earlier the original. Largest first,
 * at most {@link maxCandidates}.
 */
export function duplicateCandidates(input: {
  /** The Change's files at the head, apart from skim-only ones. */
  files: readonly { path: string; text: string; added: ReadonlySet<number> }[];
  index?: RepositoryIndex;
}): DuplicateCandidate[] {
  const own = new RepositoryIndex();
  for (const file of input.files) own.add(file.path, file.text, file.added);
  const fileAt = (path: string) =>
    own.fileAt(path) ?? input.index?.fileAt(path);
  const placeOf = (file: IndexedFile, start: number, end: number): Place => ({
    path: file.path,
    line: file.lines[start],
    endLine: file.lines[end],
  });

  const candidates: DuplicateCandidate[] = [];
  const files = [...own.fileList].sort(byPath);
  for (const file of files) {
    const runs: Run[] = [];
    let open = new Map<string, Run>();
    for (let at = 0; at + windowSize <= file.hashes.length; at++) {
      const hash = windowHashAt(file, at, true);
      const next = new Map<string, Run>();
      if (hash !== undefined) {
        const seen = new Set<string>();
        for (const match of [
          ...own.windowMatches(hash),
          ...(input.index?.windowMatches(hash) ?? []),
        ]) {
          const id = `${match.path}\0${match.at}`;
          if (seen.has(id)) continue;
          seen.add(id);
          if (match.path === file.path && Math.abs(match.at - at) < windowSize)
            continue;
          if (isLaterAdded(own, match, file.path, at)) continue;
          const key = `${match.path}\0${match.at - at}`;
          const run = open.get(key);
          if (run) {
            run.end = at;
            next.set(key, run);
          } else {
            const started = {
              start: at,
              end: at,
              target: match.path,
              targetStart: match.at,
            };
            runs.push(started);
            next.set(key, started);
          }
        }
      }
      open = next;
    }
    // The largest runs make blocks, and a run over the same lines adds a place.
    const blocks: { run: Run; places: Place[] }[] = [];
    runs.sort(
      (a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start
    );
    for (const run of runs) {
      const target = fileAt(run.target);
      if (!target) continue;
      const place = placeOf(
        target,
        run.targetStart,
        run.targetStart + run.end - run.start + windowSize - 1
      );
      const block = blocks.find(
        (b) => b.run.start <= run.end && run.start <= b.run.end
      );
      if (!block) blocks.push({ run, places: [place] });
      else if (block.places.length < maxPlaces) block.places.push(place);
    }
    for (const { run, places } of blocks) {
      const last = run.end + windowSize - 1;
      candidates.push({
        path: file.path,
        startLine: file.lines[run.start],
        endLine: file.lines[last],
        lines: last - run.start + 1,
        places: places.sort(byPlace),
      });
    }
  }
  return candidates
    .sort(
      (a, b) => b.lines - a.lines || byPath(a, b) || a.startLine - b.startLine
    )
    .slice(0, maxCandidates);
}

/** Whether the match is a window the Change added too, which sorts after the one at `path` and `at`. */
function isLaterAdded(
  own: RepositoryIndex,
  match: { path: string; at: number },
  path: string,
  at: number
): boolean {
  const file = own.fileAt(match.path);
  if (!file || windowHashAt(file, match.at, true) === undefined) return false;
  return match.path > path || (match.path === path && match.at > at);
}
