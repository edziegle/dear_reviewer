// Skim-only files (ADR 0045): changed files that Dear Reviewer itself judges
// need no close reading, so a Reviewer on a big Change knows what to skim. A
// file is skim-only when it is a lock file, when the base commit's
// `.gitattributes` marks it `linguist-generated`, or when it is an exact
// rename: an added file with the bytes of a deleted one. The Assistant never
// makes a file skim-only, and neither does the head's `.gitattributes`, which
// a pull request could edit to hide its own files.

import type { Change, ChangedFile } from "./changeDetails";
import { gitOutput } from "./git";

export type SkimReason = "lockFile" | "generated" | "renamed";

/** What the views say of why a file is skim-only. */
export const skimReasonText: Record<SkimReason, string> = {
  lockFile: "lock file",
  generated: "generated",
  renamed: "renamed",
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
 * file in `generated`, which the base's `.gitattributes` marks, or a path in
 * `renamed`, one half of a rename with no edits.
 */
export function skimOnlyFiles(input: {
  files: readonly ChangedFile[];
  generated: ReadonlySet<string>;
  renamed: ReadonlySet<string>;
}): Map<string, SkimReason> {
  const skim = new Map<string, SkimReason>();
  for (const { path } of input.files) {
    if (isLockFile(path)) skim.set(path, "lockFile");
    else if (input.generated.has(path)) skim.set(path, "generated");
    else if (input.renamed.has(path)) skim.set(path, "renamed");
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
async function generatedAtBase(
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

/**
 * The skim-only files of the Change's files, with their reasons. If git can't
 * say, no file is skim-only: a file the Reviewer should read is never hidden
 * by a failure.
 */
export function skimOnlyOf(
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
