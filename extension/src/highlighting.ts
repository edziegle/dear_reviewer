// Syntax highlighting for a Change's files depends on the language
// extensions the Reviewer has installed, since the files open in ordinary
// editors (ADR 0012). VSCodium mostly lacks VS Code's suggestions of an
// extension for a file type, so the overview notices which file extensions
// no installed language covers and offers to search the Extensions view for
// each, once, without pressure (as ADR 0021 asks). Dear Reviewer keeps no
// mapping from file types to extensions and never installs one itself.

import * as path from "path";
import * as vscode from "vscode";

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

/** Keeps the Reviewer's installed languages, associations and dismissals in view. */
export class LanguageOffer implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  /** Fires when what counts as unhighlighted may have changed. */
  readonly onDidChange = this.changed.event;
  private readonly subscriptions: vscode.Disposable[];
  private search: (query: string) => unknown = searchExtensions;

  constructor(private readonly memory: vscode.Memento) {
    this.subscriptions = [
      this.changed,
      vscode.extensions.onDidChange(() => this.changed.fire()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("files.associations")) this.changed.fire();
      }),
    ];
  }

  /** The file extensions among these files that no installed language covers, and that weren't dismissed. */
  unhighlighted(files: readonly CheckedFile[]): string[] {
    const languages = vscode.extensions.all.flatMap(
      (extension) =>
        (extension.packageJSON?.contributes?.languages as
          LanguageContribution[] | undefined) ?? []
    );
    const associations =
      vscode.workspace
        .getConfiguration("files")
        .get<Record<string, string>>("associations") ?? {};
    return unhighlighted(files, languages, associations, this.dismissed());
  }

  /** Opens the Extensions view with a search for the file extension, without its dot. */
  find(extension: string): void {
    this.search(extension.replace(/^\./, ""));
  }

  /** Never offers these file extensions again, in any Change. */
  async dismiss(extensions: readonly string[]): Promise<void> {
    const all = new Set([...this.dismissed(), ...extensions]);
    await this.memory.update(dismissedKey, [...all]);
    this.changed.fire();
  }

  /** Hands the Extensions view's search to `search` instead, or back with none; for the tests. */
  searchWith(search?: (query: string) => void): void {
    this.search = search ?? searchExtensions;
  }

  private dismissed(): Set<string> {
    return new Set(this.memory.get<string[]>(dismissedKey) ?? []);
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
  }
}

function searchExtensions(query: string): Thenable<unknown> {
  return vscode.commands.executeCommand("workbench.extensions.search", query);
}

const dismissedKey = "dearReviewer.dismissedFileExtensions";
