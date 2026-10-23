// What the Findings view lists: the Change in front's Findings by file, in
// the order Next Finding steps through them, the current Finding, and where
// the focus goes when its Finding goes. Kept apart from `vscode` so the unit
// tests can run it under plain Node.

import type { Placed } from "./findingOrder";

/** A Finding as the view lists it: `file` is its side's file, `path` its path in the Change. */
export interface Listed extends Placed {
  path: string;
  /** Whether it's on the base side. */
  base: boolean;
  message: string;
}

/** A Finding's row. */
export interface FindingsRow {
  id: string;
  /** Its line or range, counted from 1, such as `12` or `16–18`. */
  lines: string;
  base: boolean;
  /** The whole message, shown as plain text when the row is open. */
  message: string;
  /** The message's first line, cut to the row. */
  firstLine: string;
  /** Its name for a screen reader: its place and message. */
  name: string;
}

/** A file's row and the rows of its Findings. */
export interface FindingsFile {
  /** Its side's file, which tells a base-side file from the head side's. */
  key: string;
  /** The file's name, and its folder in the Change, empty at the top. */
  name: string;
  folder: string;
  findings: FindingsRow[];
}

/** The Findings, already in step order, under a row per file. */
export function byFile(ordered: readonly Listed[]): FindingsFile[] {
  const files: FindingsFile[] = [];
  for (const finding of ordered) {
    let file = files.at(-1);
    if (file?.key !== finding.file) {
      const slash = finding.path.lastIndexOf("/");
      file = {
        key: finding.file,
        name: finding.path.slice(slash + 1),
        folder: slash < 0 ? "" : finding.path.slice(0, slash),
        findings: [],
      };
      files.push(file);
    }
    file.findings.push(rowOf(finding, file.name));
  }
  return files;
}

/**
 * The current Finding: the one under the cursor, as a step from the cursor
 * starts from it, else the one stepped to or clicked last while it's still
 * listed, else none.
 */
export function currentFinding(
  ordered: readonly Placed[],
  cursor: { file: string; line: number } | undefined,
  last: string | undefined
): string | undefined {
  if (cursor) {
    const covering = ordered.filter(
      (f) =>
        f.file === cursor.file &&
        f.first <= cursor.line &&
        cursor.line <= f.last
    );
    const stepped = covering.find((f) => f.id === last);
    if (stepped) return stepped.id;
    // The one that starts nearest above the cursor, as Next Finding has it.
    const nearest = Math.max(...covering.map((f) => f.first));
    const under = covering.find((f) => f.first === nearest);
    if (under) return under.id;
  }
  return ordered.some((f) => f.id === last) ? last : undefined;
}

/** The stepper's count: `2 of 5`, or `5 Findings` with no current Finding. */
export function countText(
  ordered: readonly Placed[],
  current: string | undefined
): string {
  const i = ordered.findIndex((f) => f.id === current);
  if (i >= 0) return `${i + 1} of ${ordered.length}`;
  return `${ordered.length} Finding${ordered.length === 1 ? "" : "s"}`;
}

/**
 * Where the focus goes when the list changes under it: the focused Finding
 * if it's still listed, else the one that takes its place, else the one
 * before it, else nowhere in the list. The webview runs it from its source,
 * so it uses nothing from outside itself.
 */
export function focusAfterRemoval(
  before: readonly string[],
  after: readonly string[],
  focused: string
): string | undefined {
  if (after.includes(focused)) return focused;
  const i = before.indexOf(focused);
  const later = before.slice(i + 1).find((id) => after.includes(id));
  if (later !== undefined) return later;
  const earlier = before
    .slice(0, Math.max(i, 0))
    .reverse()
    .find((id) => after.includes(id));
  return earlier ?? after.at(-1);
}

function rowOf(finding: Listed, fileName: string): FindingsRow {
  const first = finding.first + 1;
  const last = finding.last + 1;
  const place = first === last ? `line ${first}` : `lines ${first} to ${last}`;
  return {
    id: finding.id,
    lines: first === last ? `${first}` : `${first}–${last}`,
    base: finding.base,
    message: finding.message,
    firstLine: finding.message.split("\n")[0],
    name: `${fileName} ${place}${finding.base ? ", base" : ""}: ${finding.message.replace(/\s*\n\s*/g, " ")}`,
  };
}
