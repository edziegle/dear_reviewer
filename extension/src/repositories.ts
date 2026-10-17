// Which GitHub repositories feed the Inbox, and where each one is cloned on
// this machine (see ADR 0010).
//
// A repository comes from the Repositories setting, from a folder open in one
// of the Reviewer's windows whose remote is on GitHub, or from a folder the
// Reviewer picked. Folders seen in a window, and folders picked, are
// remembered in the extension's storage, so the review window, which never
// holds the Reviewer's own folders, knows them too.

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { git } from "./git";
import {
  gitHubHost,
  gitHubRepository,
  isRepositoryName,
  namesRepository,
} from "./repositoryNames";

/** A GitHub repository and its clone on this machine. */
export interface LocalClone {
  /** owner/name */
  repository: string;
  clone: string;
}

/** The settings a workspace may not choose, read from the user's settings only. */
export interface UserSettings {
  /** The GitHub API base URL. */
  apiUrl(): string;
  /** `dearReviewer.localClones`, with `~` expanded. */
  localClones(): Record<string, string>;
}

/** A folder open in this window: its clone, and the GitHub repositories its remotes name. */
interface OpenFolder {
  clone: string;
  /** The repository the folder adds to the Inbox. */
  repository?: string;
  /** Every repository its remotes name, for finding a pull request's clone. */
  named: string[];
}

export class Repositories {
  private readonly file: string;
  private readonly changed = new vscode.EventEmitter<void>();
  /** Fires when the repositories or clones may have changed. */
  readonly onDidChange = this.changed.event;
  private openHere: OpenFolder[] = [];
  private scanning: Promise<void> = Promise.resolve();

  constructor(
    private readonly storageDir: string,
    /** The Repositories setting; a workspace may set it. */
    private readonly listed: () => string[],
    private readonly user: UserSettings
  ) {
    this.file = path.join(storageDir, "repositories.json");
  }

  /**
   * Reads which repositories the folders open in this window are clones of,
   * and remembers them. Only a trusted window's folders count: git reads a
   * repository's own config, which can name programs to run.
   */
  scanWindow(): Promise<void> {
    const scan = this.scanning.then(async () => {
      const folders = vscode.workspace.isTrusted
        ? (vscode.workspace.workspaceFolders ?? []).filter(
            (f) => f.uri.scheme === "file" && !this.isOurs(f.uri.fsPath)
          )
        : [];
      const host = gitHubHost(this.user.apiUrl());
      const found = await Promise.all(
        folders.map((f) => openFolder(f.uri.fsPath, host))
      );
      const before = signature(this.openHere);
      this.openHere = found.filter((f): f is OpenFolder => !!f);
      let changed = signature(this.openHere) !== before;
      for (const folder of this.openHere) {
        const repository = folder.repository;
        if (!repository) continue;
        const remembered = this.remembered();
        const known = remembered.find((r) => same(r.repository, repository));
        if (known?.clone === folder.clone) continue;
        this.write([
          ...remembered.filter((r) => !same(r.repository, repository)),
          { repository, clone: folder.clone },
        ]);
        changed = true;
      }
      if (changed) this.changed.fire();
    });
    this.scanning = scan.catch(() => undefined);
    return this.scanning;
  }

  /** The Inbox's repositories: the setting's, this window's folders', and the remembered ones. */
  async inboxRepositories(): Promise<string[]> {
    await this.scanning;
    const all = [
      ...this.listed(),
      ...this.openHere.flatMap((f) => (f.repository ? [f.repository] : [])),
      ...this.remembered().map((r) => r.repository),
    ];
    const result: string[] = [];
    for (const name of all) {
      if (isRepositoryName(name) && !result.some((r) => same(r, name)))
        result.push(name);
    }
    return result;
  }

  /** The clones of the Inbox's repositories, one entry per clone. */
  async inboxClones(): Promise<LocalClone[]> {
    const found = new Map<string, LocalClone>();
    for (const repository of await this.inboxRepositories()) {
      const clone = await this.cloneOf(repository);
      if (clone && !found.has(path.resolve(clone)))
        found.set(path.resolve(clone), { repository, clone });
    }
    return [...found.values()];
  }

  /**
   * Where the repository is cloned: the Local Clones setting, else a folder
   * open in this window, else a clone remembered from another window or
   * picked by the Reviewer.
   */
  async cloneOf(repository: string): Promise<string | undefined> {
    await this.scanning;
    for (const [name, clone] of Object.entries(this.user.localClones())) {
      if (same(name, repository) && clone) return clone;
    }
    const open = this.openHere.find((f) =>
      f.named.some((n) => same(n, repository))
    );
    if (open) return open.clone;
    const known = this.remembered().find((r) => same(r.repository, repository));
    if (known && fs.existsSync(known.clone)) return known.clone;
  }

  /**
   * Remembers a folder the Reviewer picked as the clone of `repository`, if
   * it is the top of a git repository with a remote that names it.
   * Gives the reason when it isn't.
   */
  async rememberClone(
    repository: string,
    folder: string
  ): Promise<{ clone: string } | { problem: string }> {
    if (!isRepositoryName(repository))
      return {
        problem: `${repository} isn't a GitHub repository name, owner/name.`,
      };
    const clone = path.resolve(folder);
    if (this.isOurs(clone))
      return { problem: `${clone} is one of Dear Reviewer's own worktrees.` };
    const urls = await remoteUrls(clone);
    if (!urls)
      return { problem: `${clone} isn't the top folder of a git repository.` };
    if (!urls.some((url) => namesRepository(url, repository)))
      return { problem: `No remote of ${clone} points at ${repository}.` };
    this.remember({ repository, clone });
    return { clone };
  }

  /**
   * Remembers a folder the Reviewer picked as the clone of the GitHub
   * repository its remotes name, and gives that repository.
   */
  async rememberFolder(
    folder: string
  ): Promise<{ repository: string } | { problem: string }> {
    const clone = path.resolve(folder);
    if (this.isOurs(clone))
      return { problem: `${clone} is one of Dear Reviewer's own worktrees.` };
    const found = await openFolder(clone, gitHubHost(this.user.apiUrl()));
    if (!found)
      return { problem: `${clone} isn't the top folder of a git repository.` };
    if (!found.repository)
      return {
        problem: `No remote of ${clone} is on ${gitHubHost(this.user.apiUrl())}.`,
      };
    this.remember({ repository: found.repository, clone });
    return { repository: found.repository };
  }

  /** Forgets the remembered clone of the repository. */
  forget(repository: string): void {
    const remembered = this.remembered();
    const kept = remembered.filter((r) => !same(r.repository, repository));
    if (kept.length !== remembered.length) this.write(kept);
    this.changed.fire();
  }

  /** The repositories and clones remembered from the Reviewer's windows and pickers. */
  remembered(): LocalClone[] {
    let entries: unknown;
    try {
      entries = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      return [];
    }
    if (!Array.isArray(entries)) return [];
    return entries.filter(
      (e): e is LocalClone =>
        typeof e?.repository === "string" &&
        typeof e?.clone === "string" &&
        isRepositoryName(e.repository) &&
        path.isAbsolute(e.clone)
    );
  }

  /** Whether the repository's clone in this window is one of its open folders. */
  isOpenHere(repository: string): boolean {
    return this.openHere.some(
      (f) => f.repository && same(f.repository, repository)
    );
  }

  /** Folders in the extension's storage: Change worktrees and the review window's home. */
  private isOurs(folder: string): boolean {
    const storage = realpath(this.storageDir);
    const real = realpath(folder);
    return real === storage || real.startsWith(storage + path.sep);
  }

  private remember(entry: LocalClone): void {
    this.write([
      ...this.remembered().filter((r) => !same(r.repository, entry.repository)),
      entry,
    ]);
    this.changed.fire();
  }

  private write(entries: LocalClone[]): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}`;
    fs.writeFileSync(temp, JSON.stringify(entries, null, 2));
    fs.renameSync(temp, this.file);
  }
}

/**
 * The folder, if it is the top of a git repository, with the repository it
 * adds to the Inbox: its `upstream` remote's on GitHub, else its `origin`'s,
 * else the first remote's that is on GitHub.
 */
async function openFolder(
  folder: string,
  host: string
): Promise<OpenFolder | undefined> {
  const remotes = await remotesOf(folder);
  if (!remotes) return;
  const onGitHub = remotes.flatMap(({ name, url }) => {
    const repository = gitHubRepository(url, host);
    return repository ? [{ name, repository }] : [];
  });
  const chosen =
    onGitHub.find((r) => r.name === "upstream") ??
    onGitHub.find((r) => r.name === "origin") ??
    onGitHub[0];
  return {
    clone: folder,
    repository: chosen?.repository,
    named: onGitHub.map((r) => r.repository),
  };
}

async function remoteUrls(folder: string): Promise<string[] | undefined> {
  return (await remotesOf(folder))?.map((r) => r.url);
}

/**
 * The remotes of the git repository whose top folder this is, with their URLs
 * as configured (before any `insteadOf` rewriting). Undefined if the folder
 * isn't the top of a git repository: a folder inside a repository doesn't
 * count, so opening some folder under a clone doesn't make it the clone.
 */
async function remotesOf(
  folder: string
): Promise<{ name: string; url: string }[] | undefined> {
  if (!fs.existsSync(path.join(folder, ".git"))) return;
  try {
    const top = await git(folder, "rev-parse", "--show-toplevel");
    if (realpath(top) !== realpath(folder)) return;
  } catch {
    return;
  }
  const config = await git(
    folder,
    "config",
    "--get-regexp",
    "^remote\\..*\\.url$"
  ).catch(() => "");
  const remotes: { name: string; url: string }[] = [];
  for (const line of config.split("\n")) {
    const match = /^remote\.(.+)\.url (.+)$/.exec(line);
    if (match) remotes.push({ name: match[1], url: match[2] });
  }
  return remotes;
}

function signature(folders: OpenFolder[]): string {
  return JSON.stringify(folders.map((f) => [f.clone, f.repository, f.named]));
}

/** GitHub matches owner/name without regard to case. */
function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function realpath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}
