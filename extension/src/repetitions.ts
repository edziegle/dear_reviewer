// What Dear Reviewer finds of a Change's repetition (ADR 0047), from git and
// the head worktree: the Change's hunks, an index of every tracked file at the
// head built in the background within a time budget, and the Repeated edits
// and Duplicate code candidates the rules find from them. It never blocks
// opening a Change: until the index is ready, an overview gets the Repeated
// edits without their missed sites, and says so. Kept apart from `vscode`
// so the unit tests can run it under plain Node.

import * as fs from "fs";
import * as path from "path";
import {
  changedFiles,
  type Change,
  type ChangedFile,
  type FileStatus,
} from "./changeDetails";
import { gitOutput } from "./git";
import {
  duplicateCandidates,
  repeatedEdits,
  RepositoryIndex,
  type DuplicateCandidate,
  type Hunk,
  type RepeatedEdit,
  type Site,
} from "./repetition";
import {
  generatedAtBase,
  isLockFile,
  skimOnlyOf,
  type SkimReason,
} from "./skimOnly";

export interface IndexLimits {
  /** How long indexing may take; a repository that takes longer is indexed in part. */
  budgetMs: number;
  /** The largest file indexed, in bytes. */
  maxFileBytes: number;
  /**
   * How long a request for Findings waits for an index still being built
   * before it goes on with the Change's own files alone.
   */
  waitMs: number;
}

export const defaultLimits: IndexLimits = {
  budgetMs: 10_000,
  maxFileBytes: 200_000,
  waitMs: 5_000,
};

/** How many files are read at a time; each is indexed with the extension host getting a turn between. */
const batchSize = 16;

/** The bytes at the start of a file that tell a binary file by a NUL. */
const binaryProbe = 8000;

/** How many of a Change's heads the index, hunks and results are kept for. */
const kept = 3;

/** The lines of an edit the overview shows as a sample, and the characters of each. */
const sampleLines = 3;
const sampleChars = 160;

function unquote(name: string): string {
  if (!name.startsWith('"') || !name.endsWith('"')) return name;
  const bytes: number[] = [];
  const body = name.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "\\") {
      bytes.push(...Buffer.from(body[i]));
      continue;
    }
    const next = body[++i];
    const octal = /^[0-3][0-7]{2}/.exec(body.slice(i, i + 3));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += 2;
    } else {
      const escapes: Record<string, string> = {
        t: "\t",
        n: "\n",
        r: "\r",
        a: "\x07",
        b: "\b",
        f: "\f",
        v: "\v",
      };
      bytes.push(...Buffer.from(escapes[next] ?? next));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

/** The path in a `---` or `+++` line, without its `a/` or `b/` and the tab git ends a name with spaces with. */
function headerPath(line: string): string | undefined {
  const name = unquote(line.slice(4).replace(/\t$/, ""));
  return name === "/dev/null" ? undefined : name.slice(2);
}

/**
 * The hunks of a diff made with no context lines (`git diff -U0`), as they
 * are written: each with its removed and added lines and where they start.
 * Binary files have none.
 */
export function hunksIn(diff: string): Hunk[] {
  const hunks: Hunk[] = [];
  let file: { path: string; status: FileStatus } | undefined;
  let header = false;
  let from: string | undefined;
  let current: Hunk | undefined;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      file = undefined;
      header = true;
      from = undefined;
      current = undefined;
    } else if (header && line.startsWith("--- ")) {
      from = headerPath(line);
    } else if (header && line.startsWith("+++ ")) {
      const to = headerPath(line);
      const found = to ?? from;
      file = found
        ? {
            path: found,
            status: !from ? "added" : !to ? "deleted" : "modified",
          }
        : undefined;
    } else if (line.startsWith("@@ ")) {
      header = false;
      const at = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      current =
        file && at
          ? {
              path: file.path,
              status: file.status,
              oldStart: Number(at[1]),
              removed: [],
              newStart: Number(at[2]),
              added: [],
            }
          : undefined;
      if (current) hunks.push(current);
    } else if (current && !header) {
      if (line.startsWith("-"))
        current.removed.push(line.slice(1).replace(/\r$/, ""));
      else if (line.startsWith("+"))
        current.added.push(line.slice(1).replace(/\r$/, ""));
    }
  }
  return hunks;
}

/** A place the overview links to: a hunk of the Change, or a missed site. */
export type ShownSite = Site;

export interface ShownRepeatedEdit {
  /** Such as "Same edit in 3 places in 1 file", or "Same edit in 40 files: read one, skim the rest." for a uniform edit. */
  summary: string;
  /** What most sites removed and added, cut short. */
  removed: string[];
  added: string[];
  differing: ShownSite[];
  missed: ShownSite[];
  /** How many more missed sites there are than listed. */
  moreMissed: number;
  /** The label of the button that shows the differing sites past the first few, when there are more. */
  showDiffering?: string;
  /** The label of the button that shows the missed sites past the first few, when there are more. */
  showMissed?: string;
}

/** The Repeated edits as the overview lists them. */
export interface ShownRepeatedEdits {
  /**
   * Whether the missed sites come from the whole repository: `partial` if
   * the index ran out of time, `pending` while it is still being built.
   */
  checked: "complete" | "partial" | "pending";
  /** Such as "Repeated edits: 1 to check", or "Repeated edits (2)" when every edit is uniform and the repository fully checked. */
  heading: string;
  /** Whether any edit has a differing or a missed site, which opens the section. */
  open: boolean;
  edits: ShownRepeatedEdit[];
}

/** What the Findings prompt is given: candidates for the Assistant to judge. */
export interface Repetition {
  duplicates: DuplicateCandidate[];
  /** The Repeated edits that have a differing or a missed site. */
  edits: RepeatedEdit[];
  /** Whether the check covered the Change's files and only part of the repository. */
  partial: boolean;
}

interface Prepared {
  hunks: Hunk[];
  files: ChangedFile[];
  skim: ReadonlyMap<string, SkimReason>;
}

function clip(line: string): string {
  return line.length > sampleChars ? `${line.slice(0, sampleChars)}…` : line;
}

function sample(lines: readonly string[]): string[] {
  const shown = lines.slice(0, sampleLines).map(clip);
  return lines.length > sampleLines ? [...shown, "…"] : shown;
}

/** How many sites a list shows before the button that shows the rest. */
export const fewSites = 5;

function counted(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The edit's headline: where it was made, and for a uniform edit, what that
 * lets the Reviewer do.
 */
export function headlineOf(sites: readonly Site[], uniform: boolean): string {
  const files = new Set(sites.map((s) => s.path)).size;
  const where =
    sites.length === files
      ? counted(files, "file", "files")
      : `${counted(sites.length, "place", "places")} in ${counted(files, "file", "files")}`;
  return uniform
    ? `Same edit in ${where}: read one, skim the rest.`
    : `Same edit in ${where}`;
}

/**
 * The label of the button that shows a list's sites past the first few:
 * how many more it lists, or all of them when no more were counted past
 * those listed. None when the list shows whole.
 */
export function showMoreOf(listed: number, more = 0): string | undefined {
  if (listed <= fewSites) return undefined;
  return more > 0 ? `Show ${listed - fewSites} more` : `Show all ${listed}`;
}

/**
 * The section's heading: how many edits have a site to check, or how many
 * there are when none has. Until the repository is fully checked, an edit
 * with none may yet have missed sites, so the heading says so.
 */
export function headingOf(
  edits: readonly ShownRepeatedEdit[],
  checked: ShownRepeatedEdits["checked"]
): string {
  const toCheck = edits.filter(
    (e) => e.differing.length > 0 || e.missed.length > 0
  ).length;
  if (toCheck > 0) return `Repeated edits: ${toCheck} to check`;
  const all = `Repeated edits (${edits.length})`;
  return checked === "pending"
    ? `${all}: still checking`
    : checked === "partial"
      ? `${all}: not fully checked`
      : all;
}

function shownOf(
  edits: readonly RepeatedEdit[],
  index: RepositoryIndex | undefined
): ShownRepeatedEdits {
  // A search that stopped early checked the repository in part, as an index that ran out of time did.
  const partial = index?.partial || edits.some((edit) => edit.cutOff);
  const checked = !index ? "pending" : partial ? "partial" : "complete";
  const shown = edits
    .map((edit): ShownRepeatedEdit => {
      const showDiffering = showMoreOf(edit.differing.length);
      const showMissed = showMoreOf(edit.missed.length, edit.moreMissed);
      // Until the whole repository is checked, an edit may yet have missed sites.
      const uniform =
        checked === "complete" &&
        edit.differing.length === 0 &&
        edit.missed.length === 0;
      return {
        summary: headlineOf(edit.sites, uniform),
        removed: sample(edit.majority.removed),
        added: sample(edit.majority.added),
        differing: edit.differing,
        missed: edit.missed.map((place): ShownSite => ({
          ...place,
          side: "head",
        })),
        moreMissed: edit.moreMissed,
        ...(showDiffering && { showDiffering }),
        ...(showMissed && { showMissed }),
      };
    })
    // The edits with something to look at come first.
    .sort(
      (a, b) =>
        b.differing.length +
        b.missed.length -
        (a.differing.length + a.missed.length)
    );
  return {
    checked,
    heading: headingOf(shown, checked),
    open: shown.some((e) => e.differing.length > 0 || e.missed.length > 0),
    edits: shown,
  };
}

/**
 * A regular file's text, if the index may take it: not a link, which could
 * lead out of the worktree, not over the size cap and not binary.
 */
async function readIndexable(
  dir: string,
  file: string,
  maxBytes: number
): Promise<string | undefined> {
  try {
    const where = path.join(dir, file);
    const stat = await fs.promises.lstat(where);
    if (!stat.isFile() || stat.size === 0 || stat.size > maxBytes)
      return undefined;
    const bytes = await fs.promises.readFile(where);
    if (bytes.subarray(0, binaryProbe).includes(0)) return undefined;
    return bytes.toString("utf8");
  } catch {
    return undefined;
  }
}

const yieldToHost = () => new Promise<void>((resolve) => setImmediate(resolve));

/** What the promise gives, or nothing if it takes longer than `ms`. */
async function within<T>(
  promise: Promise<T>,
  ms: number
): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(resolve, Math.max(ms, 0), undefined);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Indexes the tracked files at the head, leaving out the skim-only files
 * (ADR 0045: lock files, files the base marks generated, exact renames),
 * binary files and files over the cap. Stops when the budget is gone and says
 * the index is partial. Any failure gives an index as far as it got, partial.
 */
async function buildIndex(
  change: Change,
  skim: ReadonlyMap<string, SkimReason>,
  limits: IndexLimits
): Promise<RepositoryIndex> {
  const index = new RepositoryIndex();
  const deadline = Date.now() + limits.budgetMs;
  try {
    const tracked = (await gitOutput(change.headDir, "ls-files", "-z"))
      .split("\0")
      .filter((file) => file && !skim.has(file) && !isLockFile(file));
    const generated = await within(
      generatedAtBase(change.repository, change.mergeBase, tracked),
      deadline - Date.now()
    );
    if (!generated) {
      index.partial = true;
      return index;
    }
    const files = tracked.filter((file) => !generated.has(file));
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      const texts = await Promise.all(
        batch.map((file) =>
          readIndexable(change.headDir, file, limits.maxFileBytes)
        )
      );
      for (const [at, file] of batch.entries()) {
        // A file's indexing is the longest the extension host waits.
        if (Date.now() >= deadline) {
          index.partial = true;
          return index;
        }
        const text = texts[at];
        if (text !== undefined) index.add(file, text);
        await yieldToHost();
      }
    }
  } catch {
    index.partial = true;
  }
  return index;
}

/**
 * Finds the repetition in Changes: Repeated edits for the overview, and
 * candidates for a request for Findings. Keeps the index and results of the
 * last few heads.
 */
export class Repetitions {
  private readonly limits: IndexLimits;
  private readonly prepared = new Map<string, Promise<Prepared>>();
  private readonly indexes = new Map<string, Promise<RepositoryIndex>>();
  private readonly ready = new Map<string, RepositoryIndex>();
  private readonly shown = new Map<
    string,
    Promise<ShownRepeatedEdits | undefined>
  >();
  private readonly settled: (() => void)[] = [];

  constructor(limits: Partial<IndexLimits> = {}) {
    this.limits = { ...defaultLimits, ...limits };
  }

  /** Calls back each time an index finishes, so an overview shows what it found. */
  onDidSettle(callback: () => void): void {
    this.settled.push(callback);
  }

  private keyOf(change: Change): string {
    return [change.repository, change.mergeBase, change.headSha].join("\0");
  }

  /** Keeps only the last few entries of the map, with this one the newest. */
  private remember<T>(map: Map<string, T>, key: string, value: T): T {
    map.delete(key);
    map.set(key, value);
    for (const old of [...map.keys()].slice(0, Math.max(map.size - kept, 0)))
      map.delete(old);
    return value;
  }

  private prepare(change: Change): Promise<Prepared> {
    const key = this.keyOf(change);
    const found = this.prepared.get(key);
    if (found) return found;
    const preparing = (async (): Promise<Prepared> => {
      const files = await changedFiles(change);
      const skim = await skimOnlyOf(change, files);
      const diff = await gitOutput(
        change.repository,
        "-c",
        "core.quotePath=false",
        "diff",
        "-U0",
        "--no-color",
        "--no-ext-diff",
        "--no-renames",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        change.mergeBase,
        change.headSha
      );
      return {
        hunks: hunksIn(diff).filter((hunk) => !skim.has(hunk.path)),
        files,
        skim,
      };
    })();
    preparing.catch(() => this.prepared.delete(key));
    return this.remember(this.prepared, key, preparing);
  }

  /** The Change's index, started if it hasn't been, which settles once it is built. */
  private indexOf(
    change: Change,
    prepared: Prepared
  ): Promise<RepositoryIndex> {
    const key = this.keyOf(change);
    const found = this.indexes.get(key);
    if (found) return found;
    const building: Promise<RepositoryIndex> = buildIndex(
      change,
      prepared.skim,
      this.limits
    ).then((index) => {
      // An index of a head already forgotten is of no use to an overview.
      if (this.indexes.get(key) === building) {
        this.ready.set(key, index);
        for (const callback of this.settled) callback();
      }
      return index;
    });
    this.remember(this.indexes, key, building);
    for (const built of [...this.ready.keys()])
      if (!this.indexes.has(built)) this.ready.delete(built);
    return building;
  }

  /** Gives a file's lines as written, for the names a missed site must hold. */
  private lineTexts(change: Change) {
    const read = new Map<string, Promise<string[] | undefined>>();
    return (file: string) => {
      let lines = read.get(file);
      if (!lines) {
        lines = readIndexable(
          change.headDir,
          file,
          this.limits.maxFileBytes
        ).then((text) => text?.split("\n"));
        read.set(file, lines);
      }
      return lines;
    };
  }

  /**
   * The Change's Repeated edits for its overview, or none if it has none or
   * git can't say. Starts the index, and gives the edits without missed sites
   * until it is ready.
   */
  async repeatedEdits(change: Change): Promise<ShownRepeatedEdits | undefined> {
    try {
      const prepared = await this.prepare(change);
      const key = this.keyOf(change);
      void this.indexOf(change, prepared);
      const index = this.ready.get(key);
      const shownKey = `${key}\0${index ? "ready" : "pending"}`;
      let shown = this.shown.get(shownKey);
      if (!shown) {
        shown = repeatedEdits(prepared.hunks, {
          index,
          lineText: this.lineTexts(change),
        }).then((edits) =>
          edits.length > 0 ? shownOf(edits, index) : undefined
        );
        this.remember(this.shown, shownKey, shown);
      }
      return await shown;
    } catch {
      return undefined;
    }
  }

  /**
   * The candidates for a request for Findings: copied code, and the Repeated
   * edits with a differing or a missed site. Waits for the index, but not
   * past `waitMs`: after that the check is partial and covers the Change's own
   * files. If git can't say, there are none, and the check is partial.
   */
  async candidates(change: Change): Promise<Repetition> {
    try {
      const prepared = await this.prepare(change);
      const index =
        (await within(this.indexOf(change, prepared), this.limits.waitMs)) ??
        Object.assign(new RepositoryIndex(), { partial: true });
      const found = await repeatedEdits(prepared.hunks, {
        index,
        lineText: this.lineTexts(change),
      });
      const edits = found.filter(
        (edit) => edit.differing.length > 0 || edit.missed.length > 0
      );
      const duplicates = duplicateCandidates({
        files: await this.ownFiles(change, prepared),
        index,
      });
      return {
        duplicates,
        edits,
        partial: index.partial || found.some((edit) => edit.cutOff),
      };
    } catch {
      return { duplicates: [], edits: [], partial: true };
    }
  }

  /** The Change's files at the head that it added lines to, with those lines. */
  private async ownFiles(change: Change, prepared: Prepared) {
    const added = new Map<string, Set<number>>();
    for (const hunk of prepared.hunks) {
      if (hunk.status === "deleted" || hunk.added.length === 0) continue;
      const lines = added.get(hunk.path) ?? new Set<number>();
      for (let i = 0; i < hunk.added.length; i++) lines.add(hunk.newStart + i);
      added.set(hunk.path, lines);
    }
    const files: { path: string; text: string; added: Set<number> }[] = [];
    for (const [file, lines] of added) {
      const text = await readIndexable(
        change.headDir,
        file,
        this.limits.maxFileBytes
      );
      if (text !== undefined) files.push({ path: file, text, added: lines });
    }
    return files;
  }
}
