// Skim-only files (ADR 0045): changed files that Dear Reviewer itself judges
// need no close reading, so a Reviewer on a big Change knows what to skim. A
// file is skim-only when it is a lock file, when the base commit's
// `.gitattributes` marks it `linguist-generated`, when it is an exact
// rename: an added file with the bytes of a deleted one, or when its base and
// head versions have the same syntax tree (ADR 0048), a file only reformatted
// or moved and reformatted. The Assistant never makes a file skim-only, and
// neither does the head's `.gitattributes`, which a pull request could edit to
// hide its own files.

import type { Change, ChangedFile } from "./changeDetails";
import type { FormattingMarks, FormattingReason } from "./formattingMarks";
import { gitOutput } from "./git";

export type SkimReason =
  "lockFile" | "generated" | "renamed" | FormattingReason;

/** What the views say of why a file is skim-only. */
export const skimReasonText: Record<SkimReason, string> = {
  lockFile: "lock file",
  generated: "generated",
  renamed: "renamed",
  formatting: "formatting only",
  movedFormatting: "moved, formatting only",
};

/** Lock files by name, in any folder. */
const lockFileNames: ReadonlySet<string> = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "Cargo.lock",
  "uv.lock",
  "poetry.lock",
  "Pipfile.lock",
  "Gemfile.lock",
  "go.sum",
  "composer.lock",
  "Podfile.lock",
  "pubspec.lock",
  "mix.lock",
  "flake.lock",
]);

export function isLockFile(filePath: string): boolean {
  return lockFileNames.has(filePath.slice(filePath.lastIndexOf("/") + 1));
}

/**
 * Each skim-only file of the Change with its reason: a lock file by name, a
 * file in `generated`, which the base's `.gitattributes` marks, a path in
 * `renamed`, one half of a rename with no edits, or one in `formatting`,
 * whose versions have the same syntax tree.
 */
export function skimOnlyFiles(input: {
  files: readonly ChangedFile[];
  generated: ReadonlySet<string>;
  renamed: ReadonlySet<string>;
  formatting?: ReadonlyMap<string, FormattingReason>;
}): Map<string, SkimReason> {
  const skim = new Map<string, SkimReason>();
  for (const { path } of input.files) {
    const formatting = input.formatting?.get(path);
    if (isLockFile(path)) skim.set(path, "lockFile");
    else if (input.generated.has(path)) skim.set(path, "generated");
    else if (input.renamed.has(path)) skim.set(path, "renamed");
    else if (formatting) skim.set(path, formatting);
  }
  return skim;
}

/**
 * The paths of a rename with no edits, from `git diff --raw --no-renames
 * --no-abbrev -z`: each added file with the blob of a deleted file, and each
 * deleted file with the blob of an added one.
 */
export function exactRenamesIn(raw: string): Set<string> {
  const added = new Map<string, string[]>();
  const deleted = new Map<string, string[]>();
  const fields = raw.split("\0");
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const match = /^:\d+ \d+ ([0-9a-f]+) ([0-9a-f]+) ([AD])$/.exec(fields[i]);
    if (!match) continue;
    const [, before, after, status] = match;
    const [into, blob] =
      status === "A" ? ([added, after] as const) : ([deleted, before] as const);
    into.set(blob, [...(into.get(blob) ?? []), fields[i + 1]]);
  }
  const renamed = new Set<string>();
  for (const [blob, paths] of added) {
    if (!deleted.has(blob)) continue;
    for (const path of [...paths, ...deleted.get(blob)!]) renamed.add(path);
  }
  return renamed;
}

/** The paths git answers for at a time, so a big Change's arguments stay short. */
const attrChunk = 400;

/**
 * Which of the paths the base commit's `.gitattributes` marks
 * `linguist-generated`, set or true. `--source` reads the attributes from the
 * base's tree alone, so the head's `.gitattributes` has no say.
 */
export async function generatedAtBase(
  repository: string,
  base: string,
  paths: readonly string[]
): Promise<Set<string>> {
  const generated = new Set<string>();
  for (let i = 0; i < paths.length; i += attrChunk) {
    const out = await gitOutput(
      repository,
      "check-attr",
      `--source=${base}`,
      "-z",
      "linguist-generated",
      "--",
      ...paths.slice(i, i + attrChunk)
    );
    const fields = out.split("\0");
    for (let f = 0; f + 2 < fields.length; f += 3) {
      if (fields[f + 2] === "set" || fields[f + 2] === "true")
        generated.add(fields[f]);
    }
  }
  return generated;
}

const found = new Map<string, Promise<Map<string, SkimReason>>>();

let formattingMarks: FormattingMarks | undefined;

/**
 * Where the formatting-only marks come from, which the extension sets once
 * (ADR 0048). Without it only the rules git answers count, as in the tests of
 * those rules.
 */
export function useFormattingMarks(marks: FormattingMarks | undefined): void {
  formattingMarks = marks;
}

/**
 * The skim-only files of the Change's files, with their reasons. If git can't
 * say, no file is skim-only: a file the Reviewer should read is never hidden
 * by a failure. The rules git answers come first. Formatting-only marks are
 * found in the background and are here once ready, so asking again later can
 * give more files.
 */
export async function skimOnlyOf(
  change: Change,
  files: readonly ChangedFile[]
): Promise<Map<string, SkimReason>> {
  const rules = await rulesOf(change, files);
  if (!formattingMarks) return rules;
  void formattingMarks.start(change, files, new Set(rules.keys()));
  const skim = new Map(rules);
  for (const [path, reason] of formattingMarks.ready(change)) {
    if (!skim.has(path)) skim.set(path, reason);
  }
  return skim;
}

function rulesOf(
  change: Change,
  files: readonly ChangedFile[]
): Promise<Map<string, SkimReason>> {
  const key = [change.repository, change.mergeBase, change.headSha].join("\0");
  let skim = found.get(key);
  if (!skim) {
    skim = (async () => {
      const [generated, raw] = await Promise.all([
        generatedAtBase(
          change.repository,
          change.mergeBase,
          files.map((f) => f.path)
        ),
        gitOutput(
          change.repository,
          "diff",
          "--raw",
          "--no-renames",
          "--no-abbrev",
          "-z",
          change.mergeBase,
          change.headSha
        ),
      ]);
      return skimOnlyFiles({
        files,
        generated,
        renamed: exactRenamesIn(raw),
      });
    })().catch(() => {
      found.delete(key);
      return new Map<string, SkimReason>();
    });
    found.set(key, skim);
  }
  return skim;
}
