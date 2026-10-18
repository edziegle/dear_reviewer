// Which of a Change's files the Reviewer has marked viewed.

import * as fs from "fs";
import * as path from "path";
import type { GitHubClient } from "./github/client";
import type { Change, PullRequestRef } from "./openChanges";

/**
 * Viewed state for a Change's files, by path relative to the repository root.
 * Local Changes keep it in the extension's storage; pull requests keep it on
 * GitHub.
 */
export interface ViewedFiles {
  viewed(change: Change): Promise<ReadonlySet<string>>;
  setViewed(change: Change, paths: string[], viewed: boolean): Promise<void>;
  /** Lets go of what's kept for a Change that stopped; what outlives it stays. */
  forget(change: Change): Promise<void>;
}

/**
 * Keeps viewed files in a file in the extension's storage, so they survive
 * reloads and every window sees the same state. They are kept by the
 * Change's conversation, its branch or commit range, rather than by its id,
 * so they outlive the Change's stopping (ADR 0040); `forgetConversation`
 * drops them once the branch is over.
 */
export class LocalViewedFiles implements ViewedFiles {
  private readonly file: string;

  constructor(storageDir: string) {
    this.file = path.join(storageDir, "viewed-files.json");
  }

  async viewed(change: Change): Promise<ReadonlySet<string>> {
    return new Set(this.read()[change.conversation] ?? []);
  }

  async setViewed(
    change: Change,
    paths: string[],
    viewed: boolean
  ): Promise<void> {
    const all = this.read();
    const files = new Set(all[change.conversation] ?? []);
    for (const p of paths) {
      if (viewed) files.add(p);
      else files.delete(p);
    }
    all[change.conversation] = [...files].sort();
    if (files.size === 0) delete all[change.conversation];
    this.write(all);
  }

  /** Stopping a Change keeps its viewed files, for when it is opened again. */
  async forget(): Promise<void> {}

  /** Drops the viewed files of a branch or pull request that is over. */
  forgetConversation(conversation: string): void {
    const all = this.read();
    if (!(conversation in all)) return;
    delete all[conversation];
    this.write(all);
  }

  private read(): Record<string, string[]> {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8")) as Record<
        string,
        string[]
      >;
    } catch {
      return {};
    }
  }

  private write(all: Record<string, string[]>): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(all, null, 2));
  }
}

/**
 * GitHub's own viewed-file state for a pull request, so it matches github.com
 * and follows the Reviewer to other machines.
 */
export class GitHubViewedFiles implements ViewedFiles {
  constructor(private readonly github: GitHubClient) {}

  async viewed(change: Change): Promise<ReadonlySet<string>> {
    const { files } = await this.files(change);
    return new Set(files.filter((f) => f.viewed).map((f) => f.path));
  }

  async setViewed(
    change: Change,
    paths: string[],
    viewed: boolean
  ): Promise<void> {
    const { id } = await this.files(change);
    await this.github.setFilesViewed(id, paths, viewed);
  }

  /** Viewed state stays on GitHub, where it outlives the Change. */
  async forget(): Promise<void> {}

  private files(change: Change) {
    const pullRequest: PullRequestRef | undefined = change.pullRequest;
    if (!pullRequest) throw new Error("Not a pull request's Change");
    return this.github.pullRequestFiles(
      pullRequest.repository,
      pullRequest.number
    );
  }
}

/** Keeps each Change's viewed state where its source does: GitHub for pull requests. */
export class ViewedFilesBySource implements ViewedFiles {
  constructor(
    private readonly local: ViewedFiles,
    private readonly github: ViewedFiles
  ) {}

  viewed(change: Change): Promise<ReadonlySet<string>> {
    return this.of(change).viewed(change);
  }

  setViewed(change: Change, paths: string[], viewed: boolean): Promise<void> {
    return this.of(change).setViewed(change, paths, viewed);
  }

  forget(change: Change): Promise<void> {
    return this.of(change).forget(change);
  }

  private of(change: Change): ViewedFiles {
    return change.pullRequest ? this.github : this.local;
  }
}
