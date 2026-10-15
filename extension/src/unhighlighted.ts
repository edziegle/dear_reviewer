// Which of a Change's file extensions no installed language highlights,
// from the languages and associations the extension host reports. Kept apart
// from `vscode` so the unit tests can run it under plain Node.

import * as path from "path";

/** A changed file, as far as highlighting goes. */
export interface CheckedFile {
  /** Relative to the repository root, with forward slashes. */
  path: string;
  binary?: boolean;
}

/** Which files a language covers, as an extension's `contributes.languages` entry says. */
export interface LanguageContribution {
  extensions?: string[];
  filenames?: string[];
  filenamePatterns?: string[];
}

/**
 * File extensions that are plain on purpose, or name files no editor
 * highlights. They only keep the offer quiet; they say nothing about which
 * extension suits any file type.
 */
const plainOnPurpose = new Set([
  ".txt",
  ".log",
  ".lock",
  ".csv",
  ".tsv",
  ".svg",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
]);

/**
 * The file extensions, lowercased and with their dot, of the files no
 * language covers: by its `extensions`, `filenames` or `filenamePatterns`,
 * or by a key of the Reviewer's `files.associations`. Files without an
 * extension, binary files, extensions plain on purpose and dismissed ones
 * are left out.
 */
export function unhighlighted(
  files: readonly CheckedFile[],
  languages: readonly LanguageContribution[],
  associations: Readonly<Record<string, string>>,
  dismissed: ReadonlySet<string>
): string[] {
  const extensions = languages.flatMap((l) => l.extensions ?? []);
  const filenames = new Set(
    languages.flatMap((l) => l.filenames ?? []).map((f) => f.toLowerCase())
  );
  const patterns = [
    ...languages.flatMap((l) => l.filenamePatterns ?? []),
    ...Object.keys(associations),
  ];
  const covered = (file: string) => {
    const name = path.posix.basename(file).toLowerCase();
    return (
      filenames.has(name) ||
      extensions.some((ext) => name.endsWith(ext.toLowerCase())) ||
      patterns.some((pattern) => globMatches(pattern, file))
    );
  };
  const found = new Set<string>();
  for (const file of files) {
    const extension = path.posix.extname(file.path).toLowerCase();
    if (
      !extension ||
      file.binary ||
      plainOnPurpose.has(extension) ||
      dismissed.has(extension) ||
      found.has(extension) ||
      covered(file.path)
    )
      continue;
    found.add(extension);
  }
  return [...found];
}

/**
 * Whether a glob, as `filenamePatterns` and `files.associations` use them,
 * matches the file: by its name, or by its path when the glob has a `/`.
 */
function globMatches(glob: string, file: string): boolean {
  const target = glob.includes("/") ? file : path.posix.basename(file);
  return globRegExp(glob).test(target);
}

function globRegExp(glob: string): RegExp {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      // `**/` matches no folders too.
      const slash = glob[i + 2] === "/";
      source += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") source += "[^/]*";
    else if (c === "?") source += "[^/]";
    else if (c === "{") source += "(?:";
    else if (c === "}") source += ")";
    else if (c === ",") source += "|";
    else source += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  // A leading `**/` or `/` lets a path glob match anywhere in the repository.
  return new RegExp(`^(?:.*/)?${source.replace(/^\//, "")}$`, "i");
}
